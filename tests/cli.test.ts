import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";

const CLI = path.join(import.meta.dirname, "..", "src", "cli.ts");

// No explicit `env` defaults to the ambient one with CLAUDE_CODE_SESSION_ID stripped (see
// `envWithout` below), not raw `process.env`: this test runner may itself be running inside a
// Claude Code session, and an ambient session id would make `start` stamp `last_drive` for
// every one of the ~250 calls below that never opted into an explicit env — turning stop-hook
// assertions that predate ADR-0027 into a coin flip on whether that stamp happens to match a
// payload's own `session_id` (most of which is simply absent in a pre-ADR-0027 test's input).
function run(args: string[], opts: { cwd: string; input?: string; env?: NodeJS.ProcessEnv }): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd: opts.cwd, encoding: "utf8", input: opts.input ?? "", env: opts.env ?? envWithout("CLAUDE_CODE_SESSION_ID") });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

// Like `run`, but non-blocking so multiple invocations can race each other concurrently
// (used by the lock-contention regression test below).
function runAsync(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; status: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status: number | null) => resolve({ stdout, stderr, status }));
  });
}

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "headsign-cli-"));
}

function initRepo(): string {
  const dir = tmpdir();
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-q", "-m", "init", "--allow-empty"], { cwd: dir });
  return dir;
}

function writeWorkflow(dir: string, yaml: string): void {
  fs.mkdirSync(path.join(dir, ".headsign"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".headsign", "workflow.yaml"), yaml);
}

function writeNamedWorkflow(dir: string, filename: string, yaml: string): void {
  fs.mkdirSync(path.join(dir, ".headsign"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".headsign", filename), yaml);
}

function readState(dir: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(dir, ".headsign", "state.json"), "utf8"));
}

function readLog(dir: string): string[] {
  const raw = fs.readFileSync(path.join(dir, ".headsign", "log"), "utf8");
  return raw.split("\n").filter((l) => l.length > 0);
}

// The test *runner* may itself be running inside a Claude Code session that has opted out
// (HEADSIGN_OBSERVER set ambiently), which would turn every stop-hook assertion below into a
// pass-through. Child processes get an env with it stripped unless a test opts back in.
function envWithout(...keys: string[]): NodeJS.ProcessEnv {
  const e = { ...process.env };
  for (const k of keys) delete e[k];
  return e;
}

// CLAUDE_CODE_SESSION_ID stripped here too (ADR-0027), for the same ambient-environment reason
// as HEADSIGN_OBSERVER above and `run`'s own default: a test that wants `last_drive` stamped
// opts in explicitly with its own env, built on top of this one.
const NO_OBSERVER_ENV = envWithout("HEADSIGN_OBSERVER", "CLAUDE_CODE_SESSION_ID");

const TWO_PHASE_WORKFLOW = `
version: 0.1
name: demo
entry: build
phases:
  build:
    description: "Build the thing."
    gate:
      checks:
        - name: "marker exists"
          run: "test -f marker.txt"
    on_pass: verify
  verify:
    description: "Verify the thing."
    gate:
      checks:
        - run: "true"
    on_pass: "$end"
`;

test("acceptance: start -> next RETRY -> create file -> next ADVANCE -> next COMPLETE", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);

  const startResult = run(["start"], { cwd: dir });
  assert.equal(startResult.status, 0);
  assert.match(startResult.stdout, /^START build\n/);

  const retryResult = run(["next"], { cwd: dir });
  assert.equal(retryResult.status, 1);
  assert.match(retryResult.stdout, /^RETRY 1 build\n/);

  fs.writeFileSync(path.join(dir, "marker.txt"), "");
  const advanceResult = run(["next"], { cwd: dir });
  assert.equal(advanceResult.status, 0);
  assert.match(advanceResult.stdout, /^ADVANCE verify\n/);

  const completeResult = run(["next"], { cwd: dir });
  assert.equal(completeResult.status, 0);
  assert.match(completeResult.stdout, /^COMPLETE\n/);
});

// --- gate progress: one stderr line per finished check, whichever way it went, live (ADR-0032) ---

test("next: a passing gate writes its progress to stderr, and stdout's first line is still the token", () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 0.1
name: demo
entry: build
phases:
  build:
    description: "Build."
    gate:
      checks:
        - name: "typecheck"
          run: "true"
        - name: "tests"
          run: "true"
    on_pass: "$end"
`,
  );
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });

  const result = run(["next"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(result.status, 0);
  // The token line is line 1 of stdout, unmoved by any of this — ADR-0030's contract.
  assert.match(result.stdout, /^COMPLETE\n/);
  assert.match(
    result.stderr,
    /^--- gate: 2 checks ---\n--- check 1\/2 passed: typecheck \(\d+(\.\d+)?s\) ---\n--- check 2\/2 passed: tests \(\d+(\.\d+)?s\) ---\n$/,
  );
});

// A failing check gets a progress line of its own too (ADR-0032 §3): the RETRY token stays on
// stdout's first line, unmoved, and the failed check's name reaches stderr on the same lap —
// not only inside the RETRY body, which the exhaustion test below never prints at all.
test("next: a failing gate writes a failed progress line to stderr, and the RETRY token is still stdout's first line", () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 0.1
name: demo
entry: build
phases:
  build:
    description: "Build."
    gate:
      checks:
        - name: "typecheck"
          run: "true"
        - name: "lint"
          run: "exit 1"
    on_pass: "$end"
`,
  );
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });

  const result = run(["next"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^RETRY 1 build\n/);
  assert.match(
    result.stderr,
    /^--- gate: 2 checks ---\n--- check 1\/2 passed: typecheck \(\d+(\.\d+)?s\) ---\n--- check 2\/2 failed: lint \(\d+(\.\d+)?s\) ---\n$/,
  );
});

// The motivating case (ADR-0032 §3): `max_attempts: 1` means ESCALATE prints only the
// exhaustion reason on stdout, no check name anywhere in it — but the failed check still
// reaches stderr, live, while the gate was running.
test("next: a max_attempts: 1 exhaustion names the failing check on stderr even though stdout carries only the exhaustion reason", () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 0.1
name: demo
entry: build
phases:
  build:
    description: "Build."
    gate:
      checks:
        - name: "lint"
          run: "exit 1"
    on_pass: "$end"
    max_attempts: 1
`,
  );
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });

  const result = run(["next"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /^ESCALATE build: max_attempts \(1\) exhausted/);
  assert.doesNotMatch(result.stdout, /lint/, "stdout carries only the exhaustion reason, no check name");
  assert.match(result.stderr, /^--- gate: 1 check ---\n--- check 1\/1 failed: lint \(\d+(\.\d+)?s\) ---\n$/);
});

// A check whose PRINTED elapsed time has reached half its declared `timeout:` names that
// limit too — the rule is about the number on the line, not about how long the check really
// ran, because the two can differ by up to a rounding step (ADR-0032, "The comparison is made
// on the number the line prints"). `timeout: 2` keeps this fast, and its half of 1.0 is a
// tenth-of-a-second multiple, so this fixture sits clear of that edge rather than on it.
test("next: a check whose printed elapsed time reaches half its declared timeout: shows the limit on stderr", () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 0.1
name: demo
entry: build
phases:
  build:
    description: "Build."
    gate:
      checks:
        - name: "slow but passing"
          run: "sleep 1.3 && true"
          timeout: 2
    on_pass: "$end"
`,
  );
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });

  const result = run(["next"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^COMPLETE\n/);
  assert.match(result.stderr, /^--- gate: 1 check ---\n--- check 1\/1 passed: slow but passing \(\d+(\.\d+)?s of 2s\) ---\n$/);
});

// Every test above reads `result.stderr` after the process has already exited, so a buggy
// implementation that buffered every progress line and flushed them all at once, on exit, would
// pass every one of them just as well as a streaming one — a `close` event follows every `data`
// event by definition, whichever implementation wrote the data, so watching for that order alone
// proves nothing. What actually tells the two apart: a buffering implementation writes the answer
// to stdout, THEN flushes stderr and exits, all in the same final step — so by the time its line
// ever reaches this test, `stdout` already carries the token, whatever a kill sent at that moment
// does or doesn't land in time to stop. The streaming case never gets that far: the line reaches
// stderr in the instant before the slow check even starts, while `next` is still blocked inside
// `spawnSync`, roughly two seconds from exiting on its own — so a `SIGKILL` sent right then lands
// on a process still mid-sleep (`signal: "SIGKILL"`) with nothing yet on stdout. Asserting both
// together is what makes the two cases distinguishable, confirmed by patching cli.ts's sink to
// buffer-and-flush and watching this test fail on the stdout assertion, with `signal` sometimes
// still `"SIGKILL"` (the kill can still win that race; the token on stdout is what it cannot avoid
// having already written first).
test("next: the gate's first progress line reaches stderr while the first check is still running, killed there to prove it", async () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 0.1
name: demo
entry: build
phases:
  build:
    description: "Build."
    gate:
      checks:
        - name: "slow"
          run: "sleep 2 && true"
    on_pass: "$end"
`,
  );
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });

  const child = spawn(process.execPath, [CLI, "next"], { cwd: dir, env: NO_OBSERVER_ENV });
  let stdout = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));

  await new Promise<void>((resolve, reject) => {
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
      if (/^--- gate: 1 check ---\n/.test(stderr)) resolve();
    });
    child.on("error", reject);
    // If the line never streams, the process runs the ~2s check to completion and exits on its
    // own before the line handler above ever resolves — fail fast instead of hanging on it.
    child.on("close", () => reject(new Error("the process exited before the gate-size line ever reached stderr")));
  });

  child.kill("SIGKILL");
  const { signal } = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.on("close", (code, signal) => resolve({ code, signal })));

  assert.equal(signal, "SIGKILL", "the process must still be mid-check (killable) when the line arrives, not already on its way to a normal exit");
  assert.equal(stdout, "", "a process killed mid-gate must never have reached its answer");
});

// `next` judges every time it is asked: two calls on an untouched tree are two verdicts,
// two counted attempts, and two runs of the gate. Nothing is memoized between them, so
// "ask twice, get judged twice" is the whole rule (a reader who only wants to look uses
// `status`, which runs no gate at all).
test("two next calls with nothing changed in between count two attempts and run the gate twice", () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 0.1
name: demo
entry: build
phases:
  build:
    description: "Build."
    gate:
      checks:
        - name: "marker exists"
          run: "echo run >> gate-runs.txt; test -f marker.txt"
    on_pass: "$end"
`,
  );
  const gateRuns = (): number => fs.readFileSync(path.join(dir, "gate-runs.txt"), "utf8").split("\n").filter((l) => l.length > 0).length;
  run(["start"], { cwd: dir });

  const first = run(["next"], { cwd: dir });
  assert.match(first.stdout, /^RETRY 1 build\n/);
  assert.equal((readState(dir).attempts as Record<string, number>).build, 1);
  assert.equal(gateRuns(), 1);

  const second = run(["next"], { cwd: dir }); // nothing touched since `first`
  assert.equal(second.status, 1);
  assert.match(second.stdout, /^RETRY 2 build\n/);
  assert.equal((readState(dir).attempts as Record<string, number>).build, 2);
  assert.equal(readState(dir).total_iterations, 2);
  assert.equal(gateRuns(), 2, "the gate must run again on the second question, not be answered from a remembered verdict");
});

// A run that keeps being pushed back without progress therefore reaches max_attempts and
// lands in front of a human, instead of being retried unbounded.
test("repeated next calls on an unfixed failure exhaust max_attempts and escalate", () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 0.1
name: demo
entry: build
phases:
  build:
    description: "Build."
    gate:
      checks:
        - run: "false"
    on_pass: "$end"
    max_attempts: 2
`,
  );
  run(["start"], { cwd: dir });

  assert.match(run(["next"], { cwd: dir }).stdout, /^RETRY 1\/2 build\n/);
  const second = run(["next"], { cwd: dir });
  assert.equal(second.status, 2);
  // Both attempts ran the identical `run: "false"` check and got the identical (no) output, so
  // the streak reaches max_attempts right as the budget exhausts.
  assert.match(second.stdout, /^ESCALATE build: max_attempts \(2\) exhausted — 2 attempts in a row failed the same check with the same output\n/);
});

// End-to-end: a real gate, run twice, so the second RETRY's body actually contains the
// same-failure line and the changed closing sentence — not just what step()/render.retry
// produce from hand-built fixtures.
test("a second identical gate failure in a row shows '2 in a row' in the RETRY body", () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 0.1
name: demo
entry: build
phases:
  build:
    description: "Build."
    gate:
      checks:
        - run: "false"
    on_pass: "$end"
    max_attempts: 3
`,
  );
  run(["start"], { cwd: dir });

  const first = run(["next"], { cwd: dir });
  assert.match(first.stdout, /^RETRY 1\/3 build\n/);
  assert.doesNotMatch(first.stdout, /in a row/, "the first-ever failure has nothing to repeat yet");

  const second = run(["next"], { cwd: dir });
  assert.equal(second.status, 1);
  assert.match(second.stdout, /^RETRY 2\/3 build\n--- gate failed: .* ---\n--- same check, same exit code, same output as last time — 2 in a row ---\n/);
  assert.match(second.stdout, /work out whether this gate can pass at all/);
});

test("start refuses to clobber a running workflow", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  const second = run(["start"], { cwd: dir });
  assert.equal(second.status, 3);
  assert.match(second.stderr, /^ERROR:/);
});

test("abort on an already-terminal (escalated) run names the actual status instead of claiming no run is in progress", () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 0.1
name: demo
entry: build
phases:
  build:
    description: "Build."
    gate:
      checks:
        - run: "exit 1"
    on_pass: "$end"
    on_fail: escalate
`,
  );
  run(["start"], { cwd: dir });
  const escalateResult = run(["next"], { cwd: dir });
  assert.equal(escalateResult.status, 2);
  assert.match(escalateResult.stdout, /^ESCALATE/);

  const abortResult = run(["abort", "changed", "my", "mind"], { cwd: dir });
  assert.equal(abortResult.status, 3);
  assert.match(abortResult.stderr, /escalated/);
});

test("escalate: the reason names the failing check, in the answer, the record and the log", () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 0.1
name: demo
entry: build
phases:
  build:
    description: "Build."
    gate:
      checks:
        - name: "the bundle is current"
          run: "exit 3"
    on_pass: "$end"
    on_fail: escalate
`,
  );
  run(["start"], { cwd: dir });
  const escalated = run(["next"], { cwd: dir });
  assert.equal(escalated.status, 2);
  // One failure ends this run, so the person who reads it next has the reason and no
  // `last_failure` to fall back on — and the check's name is otherwise only on stderr, which
  // a driver may not have kept.
  assert.match(escalated.stdout, /^ESCALATE build: gate failed \(on_fail: escalate\) — check 'the bundle is current' exited 3\n/);
  const state = readState(dir);
  assert.equal(state.end_reason, "build: gate failed (on_fail: escalate) — check 'the bundle is current' exited 3");
  assert.equal(state.last_failure, null, "the field still means a failure the run is sitting on");
  assert.equal(state.status, "escalated");

  // The log line carries the same two keys `retry` writes, so one grep answers "which check
  // ended this run" whichever way the run stopped. `reason=` keeps the place it always had.
  const escalateLine = readLog(dir).find((l) => l.includes(" escalate "));
  assert.ok(escalateLine, "the run wrote an escalate line");
  assert.match(escalateLine, /reason="build: gate failed \(on_fail: escalate\) — check 'the bundle is current' exited 3" check="the bundle is current" exit=3$/);

  // And the terminal reprint answers out of the record, so it says the same thing.
  const reprint = run(["next"], { cwd: dir });
  assert.equal(reprint.status, 2);
  assert.match(reprint.stdout, /^ESCALATE build: gate failed \(on_fail: escalate\) — check 'the bundle is current' exited 3\n/);
});

test("abort then next reprints ABORT idempotently", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  const abortResult = run(["abort", "changed", "my", "mind"], { cwd: dir });
  assert.equal(abortResult.status, 2);
  assert.match(abortResult.stdout, /^ABORT changed my mind\n/);

  const reprint = run(["next"], { cwd: dir });
  assert.equal(reprint.status, 2);
  assert.match(reprint.stdout, /^ABORT changed my mind\n/);
});

test("next is idempotent after COMPLETE", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "marker.txt"), "");
  run(["next"], { cwd: dir });
  run(["next"], { cwd: dir });
  const reprint = run(["next"], { cwd: dir });
  assert.equal(reprint.status, 0);
  assert.match(reprint.stdout, /^COMPLETE\n/);
});

test("next is idempotent after ESCALATE", () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 0.1
name: demo
entry: build
phases:
  build:
    description: "Build."
    gate:
      checks:
        - run: "exit 1"
    on_pass: "$end"
    on_fail: escalate
`,
  );
  run(["start"], { cwd: dir });
  const escalateResult = run(["next"], { cwd: dir });
  assert.equal(escalateResult.status, 2);
  assert.match(escalateResult.stdout, /^ESCALATE/);
  const reprint = run(["next"], { cwd: dir });
  assert.equal(reprint.status, 2);
  assert.match(reprint.stdout, /^ESCALATE/);
});

test("next with no run in progress errors with exit 3 and explains the cwd-only contract", () => {
  const result = run(["next"], { cwd: tmpdir() });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /^ERROR:/);
  assert.match(result.stderr, /does not search parent directories/);
  assert.match(result.stderr, /headsign start/);
});

test("abort with no run in progress errors with exit 3 and explains the cwd-only contract", () => {
  const result = run(["abort"], { cwd: tmpdir() });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /^ERROR:/);
  assert.match(result.stderr, /does not search parent directories/);
});

// --- nested project: cwd is a subdirectory of a larger git repo ---

test("nested project (cwd inside a larger git repo): the run is driven entirely by cwd's .headsign/, and a fixed file passes the gate", () => {
  const outer = tmpdir();
  execFileSync("git", ["init", "-q"], { cwd: outer });
  execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-q", "-m", "init", "--allow-empty"], { cwd: outer });

  const projectDir = path.join(outer, "sub");
  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, "notes.txt"), "clean\n");
  execFileSync("git", ["add", "."], { cwd: outer });
  execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-q", "-m", "add notes"], { cwd: outer });

  writeWorkflow(
    projectDir,
    `
version: 0.1
name: demo
entry: build
phases:
  build:
    description: "Build."
    gate:
      checks:
        - run: "! grep -q TODO notes.txt"
    on_pass: "$end"
`,
  );

  const startResult = run(["start"], { cwd: projectDir });
  assert.equal(startResult.status, 0);

  fs.writeFileSync(path.join(projectDir, "notes.txt"), "TODO: fix this\n");
  const first = run(["next"], { cwd: projectDir });
  assert.equal(first.status, 1);
  assert.match(first.stdout, /^RETRY 1 build\n/);
  assert.equal(fs.existsSync(path.join(outer, ".headsign")), false, "the enclosing repo root must not acquire a .headsign/ of its own");

  fs.writeFileSync(path.join(projectDir, "notes.txt"), "done, no more work\n");
  const second = run(["next"], { cwd: projectDir });
  assert.match(second.stdout, /^COMPLETE\n/);
  assert.equal(second.status, 0);
});

// --- concurrency lock on `next` (L3) ---

test("next: a lock held by this (alive) process's own pid blocks with exit 3 mentioning the pid, and leaves attempts/total_iterations untouched", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  const before = readState(dir);

  fs.writeFileSync(path.join(dir, ".headsign", "lock"), String(process.pid));
  const result = run(["next"], { cwd: dir });
  assert.equal(result.status, 3);
  assert.match(result.stderr, new RegExp(`pid ${process.pid}\\b`));

  const after = readState(dir);
  assert.deepEqual(after.attempts, before.attempts);
  assert.equal(after.total_iterations, before.total_iterations);
});

test("next: a lock held by a definitely-dead pid is stolen and the run proceeds normally, leaving no lock file behind", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });

  fs.writeFileSync(path.join(dir, ".headsign", "lock"), "2147483647");
  const result = run(["next"], { cwd: dir });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^RETRY 1 build\n/);
  assert.equal(fs.existsSync(path.join(dir, ".headsign", "lock")), false);
});

test("next: a lock file containing garbage (unparseable pid) is stolen and the run proceeds normally", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });

  fs.writeFileSync(path.join(dir, ".headsign", "lock"), "not-a-pid");
  const result = run(["next"], { cwd: dir });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^RETRY 1 build\n/);
  assert.equal(fs.existsSync(path.join(dir, ".headsign", "lock")), false);
});

test("a normal next leaves no .headsign/lock behind", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  run(["next"], { cwd: dir });
  assert.equal(fs.existsSync(path.join(dir, ".headsign", "lock")), false);
});

// Retries a blocked (`exit 3`, lock held by a live process) `next` after a short wait,
// exactly as plugin/skills/loop/SKILL.md now tells a delegated subagent to do on lock
// contention. A single un-retried attempt per process is not enough to exercise the
// FIX-A race: the lock never waits, so whichever process's atomic lock-file create wins
// holds it for the whole ~300ms gate, and every other process observes it as already
// taken and exits immediately — none of them get a *second* look at the state, so a
// stale-snapshot bug can never surface. Retrying is what gives later processes a fresh
// pre-lock read close to when the lock actually frees, which is the condition FIX-A
// closed (evaluate on a state snapshot read *before*, not after, acquiring the lock).
async function nextRetryingOnLock(dir: string, maxAttempts: number): Promise<{ stdout: string; stderr: string; status: number | null }> {
  for (let i = 0; i < maxAttempts; i++) {
    const r = await runAsync(["next"], dir);
    if (r.status !== 3) return r;
  }
  throw new Error(`gave up waiting for the lock after ${maxAttempts} attempts`);
}

test("concurrency: several real `next` processes contending for the lock never lose an attempt/total_iterations increment (FIX-A/FIX-B regression)", async () => {
  // Exercises the TOCTOU that FIX-A closed (cmdNext used to evaluate against a state
  // snapshot read *before* acquiring the lock, so a process that acquired the
  // now-free lock late could clobber another process's already-written attempt) and
  // the steal-readback/owner-only-release hardening from FIX-B.
  //
  // Verified by temporarily reverting FIX-A: without it, this test fails intermittently
  // (attempts/total_iterations end up less than the number of processes that reported a
  // real RETRY) because a late acquirer overwrites an earlier writer's increment; with
  // FIX-A restored it is reliably green.
  const dir = tmpdir();
  writeWorkflow(
    dir,
    `
version: 0.1
name: demo
entry: build
phases:
  build:
    description: "Build."
    gate:
      checks:
        - name: "slow always-failing check"
          run: "sleep 0.3; false"
    on_pass: "$end"
    max_attempts: 1000
`,
  );
  run(["start"], { cwd: dir });

  const PROCESS_COUNT = 5;
  const results = await Promise.all(Array.from({ length: PROCESS_COUNT }, () => nextRetryingOnLock(dir, 40)));

  // Every process retries past lock contention (exit 3) until it gets a real answer, so
  // all of them should land on RETRY (exit 1) — the gate always fails.
  for (const r of results) assert.equal(r.status, 1, `expected every process to eventually get a real RETRY, got status ${r.status}`);

  const finalState = readState(dir);
  assert.equal((finalState.attempts as Record<string, number>).build, PROCESS_COUNT, "every process's real evaluation must have counted, none lost to a stale overwrite");
  assert.equal(finalState.total_iterations, PROCESS_COUNT, "no evaluation's total_iterations increment may be lost to a stale overwrite");
});

test("start ensures .headsign/.gitignore contains state.json, lock, log, and tmp/, one entry per line", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  const lines = fs
    .readFileSync(path.join(dir, ".headsign", ".gitignore"), "utf8")
    .split("\n")
    .map((l) => l.trim());
  assert.ok(lines.includes("state.json"));
  assert.ok(lines.includes("lock"));
  assert.ok(lines.includes("log"));
  assert.ok(lines.includes("tmp/"));
});

test("start amends a .gitignore whose last line has no newline, rather than joining two entries", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  // An editor that saves without a trailing newline is common enough, and the append would
  // otherwise produce `somethinglock` — a pattern matching neither entry, leaving whichever
  // file it swallowed tracked.
  fs.writeFileSync(path.join(dir, ".headsign", ".gitignore"), "something");
  run(["start"], { cwd: dir });
  const lines = fs
    .readFileSync(path.join(dir, ".headsign", ".gitignore"), "utf8")
    .split("\n")
    .map((l) => l.trim());
  assert.ok(lines.includes("something"), "the entry that was already there survives");
  for (const entry of ["state.json", "lock", "log", "tmp/"]) assert.ok(lines.includes(entry));
});

test("abort with an empty reason records null and says so, rather than an empty ABORT line", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  // `headsign abort ""` is what a caller building the command from a variable produces when
  // the variable is empty. The run still ends — refusing it would leave a run nobody can end —
  // and the record holds null rather than "", so a reader sees the same absence a pre-field
  // record shows.
  const aborted = run(["abort", ""], { cwd: dir });
  assert.equal(aborted.status, 2);
  assert.match(aborted.stdout, /^ABORT \(no reason given\)\n/);
  assert.equal(readState(dir).end_reason, null);
  // And the terminal reprint answers the same way, from the record rather than from the call.
  const reprint = run(["next"], { cwd: dir });
  assert.equal(reprint.status, 2);
  assert.match(reprint.stdout, /^ABORT \(no reason given\)\n/);
});

test("status stays silent about a last_drive whose session or timestamp is empty", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  // Two hand-edited shapes, each well-formed as an object and empty in one half. Both mean
  // "nothing to report" rather than a crash: `status` is the command a person runs while
  // diagnosing, so a malformed record must not be the thing that stops them looking.
  const statePath = path.join(dir, ".headsign", "state.json");
  for (const last_drive of [{ session: "", at: "2026-09-03T00:00:00+09:00" }, { session: "s", at: "" }]) {
    const state = readState(dir);
    fs.writeFileSync(statePath, JSON.stringify({ ...state, last_drive }, null, 2));
    const result = run(["status"], { cwd: dir });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /^RUNNING build/);
    assert.ok(!result.stdout.includes("last moved:"), `an empty half must print no line: ${JSON.stringify(last_drive)}`);
  }
});

// --- .headsign/tmp/: run-scoped scratch directory (F1) ---

test("start creates .headsign/tmp/ and empties any pre-existing contents from a previous run", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  const tmpDir = path.join(dir, ".headsign", "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "leftover.txt"), "from a previous run\n");

  const result = run(["start"], { cwd: dir });
  assert.equal(result.status, 0);
  assert.equal(fs.existsSync(tmpDir), true);
  assert.deepEqual(fs.readdirSync(tmpDir), []);
});

test("next when the current phase was removed/renamed from workflow.yaml mid-run exits 3 with an actionable message, not a crash", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "marker.txt"), "");
  const advance = run(["next"], { cwd: dir });
  assert.match(advance.stdout, /^ADVANCE verify\n/);
  assert.equal(readState(dir).phase, "verify");

  // Rewrite workflow.yaml to remove the "verify" phase the run is now sitting on.
  writeWorkflow(
    dir,
    `
version: 0.1
name: demo
entry: build
phases:
  build:
    description: "Build the thing."
    gate:
      checks:
        - run: "test -f marker.txt"
    on_pass: "$end"
`,
  );

  const result = run(["next"], { cwd: dir });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /verify/);
  assert.match(result.stderr, /workflow\.yaml/);
  assert.doesNotMatch(result.stderr, /Cannot read propert/);
});

test("validate prints OK for a valid workflow", () => {
  const dir = tmpdir();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  const result = run(["validate", "--workflow", ".headsign/workflow.yaml"], { cwd: dir });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^OK: workflow 'demo'/);
});

test("validate prints INVALID to stderr for a broken workflow", () => {
  const dir = tmpdir();
  writeWorkflow(dir, "version: 2\nname: x\n");
  const result = run(["validate", "--workflow", ".headsign/workflow.yaml"], { cwd: dir });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /^INVALID:/);
});

// A typo'd key is a config error, so it comes out of the same exit-3 door as any other
// invalid workflow — the point of the end-to-end check is that the line a person actually
// reads carries the key, the phase, and the keys that level accepts (ADR-0015).
test("validate rejects a misspelled key and prints the phase, the key, and the allowed keys", () => {
  const dir = tmpdir();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW.replace("    on_pass: verify", "    on_pass: verify\n    max_atempts: 3"));
  const result = run(["validate", "--workflow", ".headsign/workflow.yaml"], { cwd: dir });
  assert.equal(result.status, 3);
  assert.match(
    result.stderr,
    /- phase 'build': unknown key 'max_atempts' \(allowed: description, clear, ready, gate, on_pass, on_fail, max_attempts\)/,
  );
});

test("validate rejects a workflow still declaring version: 1 and says the fields need checking too", () => {
  const dir = tmpdir();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW.replace("version: 0.1", "version: 1"));
  const result = run(["validate", "--workflow", ".headsign/workflow.yaml"], { cwd: dir });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /version must be 0\.1/);
  assert.match(result.stderr, /not just the number changed/);
});

// --- help: -h / --help / no args print usage and exit 0 (human convenience, ADR-0002) ---

test("-h prints usage to stdout and exits 0", () => {
  const result = run(["-h"], { cwd: tmpdir() });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /headsign start/);
});

test("--help prints usage to stdout and exits 0", () => {
  const result = run(["--help"], { cwd: tmpdir() });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /headsign start/);
});

test("no arguments prints usage to stdout and exits 0 (no error on stderr)", () => {
  const result = run([], { cwd: tmpdir() });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /headsign start/);
  assert.equal(result.stderr, "");
});

test("an unknown command errors to stderr (exit 3) and points at --help", () => {
  const result = run(["bogus"], { cwd: tmpdir() });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /unknown command/);
  assert.match(result.stderr, /--help/);
});

// One text, four ways in — asserted as bytes rather than as four separate /Usage:/ matches,
// because the failure this guards against is a second help text growing beside the first.
test("help prints byte-identically to --help, -h and the no-argument invocation, and exits 0", () => {
  const spellings = [["help"], ["--help"], ["-h"], []];
  const results = spellings.map((args) => run(args, { cwd: tmpdir() }));
  for (const result of results) {
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, results[0]!.stdout);
  }
  assert.match(results[0]!.stdout, /Usage:/);
});

test("--help lists the two commands that answer about the tool rather than about a run", () => {
  const result = run(["--help"], { cwd: tmpdir() });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /headsign version/);
  assert.match(result.stdout, /headsign help/);
});

// Run from src/ under Node's type stripping there is no esbuild --define, so the constant is
// never substituted — the same state a bundle built by invoking esbuild directly would be in.
// Pinned deliberately: the command exists to answer which copy is running, so a build that
// cannot answer must say so (exit 3, the usage/configuration code) rather than print a
// plausible-looking fallback that might be wrong.
test("version refuses rather than guessing when the build did not bake a version in", () => {
  const result = run(["version"], { cwd: tmpdir() });
  assert.equal(result.status, 3);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /no version/);
  assert.match(result.stderr, /npm run build/);
});

// --- workflow name resolution: `start <name>` / `validate <name>` (bare positional -> .headsign/<name>.yaml) ---

test("start <name> resolves .headsign/<name>.yaml, stores that workflow_path, and a subsequent next runs it", () => {
  const dir = initRepo();
  writeNamedWorkflow(dir, "feature.yaml", TWO_PHASE_WORKFLOW);
  const startResult = run(["start", "feature"], { cwd: dir });
  assert.equal(startResult.status, 0);
  assert.match(startResult.stdout, /^START build\n/);
  assert.equal(readState(dir).workflow_path, ".headsign/feature.yaml");

  const retryResult = run(["next"], { cwd: dir });
  assert.equal(retryResult.status, 1);
  assert.match(retryResult.stdout, /^RETRY 1 build\n/);
});

test("start <name.yaml> resolves the same file without doubling the extension", () => {
  const dir = initRepo();
  writeNamedWorkflow(dir, "feature.yaml", TWO_PHASE_WORKFLOW);
  const result = run(["start", "feature.yaml"], { cwd: dir });
  assert.equal(result.status, 0);
  assert.equal(readState(dir).workflow_path, ".headsign/feature.yaml");
});

test("start with no name still defaults to .headsign/workflow.yaml", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  const result = run(["start"], { cwd: dir });
  assert.equal(result.status, 0);
  assert.equal(readState(dir).workflow_path, ".headsign/workflow.yaml");
});

test("start --workflow <path> still works and wins", () => {
  const dir = initRepo();
  writeNamedWorkflow(dir, "custom.yaml", TWO_PHASE_WORKFLOW);
  const result = run(["start", "--workflow", ".headsign/custom.yaml"], { cwd: dir });
  assert.equal(result.status, 0);
  assert.equal(readState(dir).workflow_path, ".headsign/custom.yaml");
});

test("start <name> --workflow <path> together errors (exit 3): use one or the other", () => {
  const dir = initRepo();
  writeNamedWorkflow(dir, "feature.yaml", TWO_PHASE_WORKFLOW);
  const result = run(["start", "feature", "--workflow", ".headsign/feature.yaml"], { cwd: dir });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /^ERROR:/);
  assert.match(result.stderr, /workflow name or --workflow/);
});

test("start <name> containing a path separator errors (exit 3), pointing at --workflow instead", () => {
  const dir = initRepo();
  const result = run(["start", "foo/bar"], { cwd: dir });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /^ERROR:/);
  assert.match(result.stderr, /--workflow/);
});

test("start <name> for a nonexistent workflow errors (exit 3) and names the resolved path", () => {
  const dir = initRepo();
  const result = run(["start", "missing"], { cwd: dir });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /\.headsign\/missing\.yaml/);
});

test("validate <name> validates .headsign/<name>.yaml", () => {
  const dir = tmpdir();
  writeNamedWorkflow(dir, "feature.yaml", TWO_PHASE_WORKFLOW);
  const result = run(["validate", "feature"], { cwd: dir });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^OK: workflow 'demo'/);
});

// --- HEADSIGN_WORKFLOW_FILE: a gate checking the workflow file it runs under (ADR-0033) ---

test("HEADSIGN_WORKFLOW_FILE: a gate check reads the workflow file through it and greps for a mark that appears nowhere in the check's own run: string", () => {
  const dir = initRepo();
  writeNamedWorkflow(
    dir,
    "feature.yaml",
    `
version: 0.1
name: selfcheck
entry: build
phases:
  build:
    description: "Check that the workflow file was filled in."
    gate:
      checks:
        - name: "the workflow file carries its own mark"
          run: 'grep -q "workflow-carries[-]its-own-mark" "$HEADSIGN_WORKFLOW_FILE"'
        - name: "record the value the check was handed"
          run: 'printf %s "$HEADSIGN_WORKFLOW_FILE" > seen-path'
    on_pass: "$end"
# workflow-carries-its-own-mark
`,
  );
  const startResult = run(["start", "feature"], { cwd: dir });
  assert.equal(startResult.status, 0);
  assert.equal(readState(dir).workflow_path, ".headsign/feature.yaml");

  const nextResult = run(["next"], { cwd: dir });
  assert.equal(nextResult.status, 0);
  assert.match(nextResult.stdout, /^COMPLETE\n/);
  // The second check recorded the variable's exact value, which is what pins ADR-0033 §2's
  // "verbatim" end to end: the grep above would pass just as well against an absolute path,
  // so normalising anywhere along cli.ts -> engine.ts -> state.json -> gate.ts would not show
  // up there. It shows up here.
  assert.equal(fs.readFileSync(path.join(dir, "seen-path"), "utf8"), ".headsign/feature.yaml");

  // Renaming the file is the failure this variable exists to remove: a check that hardcoded
  // the path would break here, and the `run:` strings above are not touched between the two
  // runs. Asserted rather than described, because the description is what the ADR is for.
  fs.renameSync(path.join(dir, ".headsign", "feature.yaml"), path.join(dir, ".headsign", "renamed.yaml"));
  const restart = run(["start", "renamed"], { cwd: dir });
  assert.equal(restart.status, 0);
  assert.equal(readState(dir).workflow_path, ".headsign/renamed.yaml");

  const afterRename = run(["next"], { cwd: dir });
  assert.equal(afterRename.status, 0);
  assert.match(afterRename.stdout, /^COMPLETE\n/);
  assert.equal(fs.readFileSync(path.join(dir, "seen-path"), "utf8"), ".headsign/renamed.yaml");
});

// --- validate: no-args default resolution (ADR-0009) ---

test("validate with no args and no run here still falls back to the plain .headsign/workflow.yaml default", () => {
  const dir = tmpdir();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  const result = run(["validate"], { cwd: dir });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^OK: workflow 'demo'/);
});

test("validate with no args and a running run present validates the run's own workflow_path, not the plain default", () => {
  const dir = initRepo();
  // Only feature.yaml exists — no plain .headsign/workflow.yaml at all — so this only
  // passes if validate actually reads state.workflow_path instead of the plain default.
  writeNamedWorkflow(dir, "feature.yaml", TWO_PHASE_WORKFLOW);
  run(["start", "feature"], { cwd: dir });
  assert.equal(readState(dir).workflow_path, ".headsign/feature.yaml");

  const result = run(["validate"], { cwd: dir });
  assert.equal(result.status, 0, `expected validate to resolve state's workflow_path; stderr: ${result.stderr}`);
  assert.match(result.stdout, /^OK: workflow 'demo'/);
});

test("validate with no args and a terminal (aborted) run present still validates the run's own workflow_path — status is not a factor", () => {
  const dir = initRepo();
  writeNamedWorkflow(dir, "feature.yaml", TWO_PHASE_WORKFLOW);
  run(["start", "feature"], { cwd: dir });
  run(["abort", "done"], { cwd: dir });
  assert.equal(readState(dir).status, "aborted");

  const result = run(["validate"], { cwd: dir });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^OK: workflow 'demo'/);
});

test("validate: an explicit name always wins over a run's own workflow_path", () => {
  const dir = initRepo();
  writeNamedWorkflow(dir, "feature.yaml", TWO_PHASE_WORKFLOW);
  writeNamedWorkflow(
    dir,
    "other.yaml",
    `
version: 0.1
name: other-demo
entry: only
phases:
  only:
    description: "Only phase."
    gate:
      checks:
        - run: "true"
    on_pass: "$end"
`,
  );
  run(["start", "feature"], { cwd: dir });

  const result = run(["validate", "other"], { cwd: dir });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^OK: workflow 'other-demo'/);
});

test("validate: an explicit --workflow path always wins over a run's own workflow_path", () => {
  const dir = initRepo();
  writeNamedWorkflow(dir, "feature.yaml", TWO_PHASE_WORKFLOW);
  writeNamedWorkflow(
    dir,
    "other.yaml",
    `
version: 0.1
name: other-demo
entry: only
phases:
  only:
    description: "Only phase."
    gate:
      checks:
        - run: "true"
    on_pass: "$end"
`,
  );
  run(["start", "feature"], { cwd: dir });

  const result = run(["validate", "--workflow", ".headsign/other.yaml"], { cwd: dir });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^OK: workflow 'other-demo'/);
});

// --- clear: phase-entry artifact reset ---

test("clear-on-ADVANCE: entering a phase deletes its declared artifacts, so a stale verdict left from a previous pass can't wrongly pass the gate", () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 0.1
name: demo
entry: build
phases:
  build:
    description: "Build."
    gate:
      checks:
        - run: "true"
    on_pass: review
  review:
    description: "Review."
    clear: [.headsign/verdict]
    gate:
      checks:
        - run: "grep -qx APPROVED .headsign/verdict"
    on_pass: "$end"
`,
  );
  fs.mkdirSync(path.join(dir, ".headsign"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".headsign", "verdict"), "APPROVED\n");

  const startResult = run(["start"], { cwd: dir });
  assert.equal(startResult.status, 0);
  assert.equal(fs.existsSync(path.join(dir, ".headsign", "verdict")), true, "build has no `clear`, so the stale verdict survives entry into build");

  // build's gate passes trivially -> ADVANCE into review, whose entry must delete the
  // stale verdict left over from before `start`. Without the fix, the very next `next`
  // would wrongly read the leftover APPROVED and pass immediately.
  const advanceResult = run(["next"], { cwd: dir });
  assert.equal(advanceResult.status, 0);
  assert.match(advanceResult.stdout, /^ADVANCE review\n/);
  assert.equal(fs.existsSync(path.join(dir, ".headsign", "verdict")), false, "entering review must delete the stale verdict");

  const retryResult = run(["next"], { cwd: dir });
  assert.equal(retryResult.status, 1);
  assert.match(retryResult.stdout, /^RETRY 1 review\n/);

  fs.writeFileSync(path.join(dir, ".headsign", "verdict"), "APPROVED\n");
  const completeResult = run(["next"], { cwd: dir });
  assert.equal(completeResult.status, 0);
  assert.match(completeResult.stdout, /^COMPLETE\n/);
});

test("clear-on-START: the entry phase's declared artifacts are deleted by `start` itself", () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 0.1
name: demo
entry: build
phases:
  build:
    description: "Build."
    clear: [.headsign/scratch]
    gate:
      checks:
        - run: "true"
    on_pass: "$end"
`,
  );
  fs.mkdirSync(path.join(dir, ".headsign"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".headsign", "scratch"), "leftover\n");

  const result = run(["start"], { cwd: dir });
  assert.equal(result.status, 0);
  assert.equal(fs.existsSync(path.join(dir, ".headsign", "scratch")), false);
});

test("clear is NOT applied on RETRY: staying in the same phase must not delete its artifacts again", () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 0.1
name: demo
entry: build
phases:
  build:
    description: "Build."
    gate:
      checks:
        - run: "true"
    on_pass: phase2
  phase2:
    description: "Phase 2."
    clear: [artifact.txt]
    gate:
      checks:
        - run: "false"
    on_pass: "$end"
`,
  );
  run(["start"], { cwd: dir });
  const advanceResult = run(["next"], { cwd: dir }); // ADVANCE into phase2; artifact.txt doesn't exist yet, so this clear is a no-op
  assert.match(advanceResult.stdout, /^ADVANCE phase2\n/);

  fs.writeFileSync(path.join(dir, "artifact.txt"), "produced by the agent\n");
  const retryResult = run(["next"], { cwd: dir }); // phase2's gate always fails -> RETRY, staying in phase2 (not a fresh entry)
  assert.equal(retryResult.status, 1);
  assert.match(retryResult.stdout, /^RETRY 1 phase2\n/);
  assert.equal(fs.existsSync(path.join(dir, "artifact.txt")), true, "a retry within the same phase must not re-run that phase's clear");
});

test("clear announcement: a non-empty cleared file on ADVANCE is announced right after the token line, before the phase block", () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 0.1
name: demo
entry: build
phases:
  build:
    description: "Build."
    gate:
      checks:
        - run: "true"
    on_pass: review
  review:
    description: "Review."
    clear: [.headsign/verdict]
    gate:
      checks:
        - run: "grep -qx APPROVED .headsign/verdict"
    on_pass: "$end"
`,
  );
  fs.mkdirSync(path.join(dir, ".headsign"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".headsign", "verdict"), "REJECTED\n");
  run(["start"], { cwd: dir });

  const advanceResult = run(["next"], { cwd: dir });
  assert.equal(advanceResult.status, 0);
  assert.equal(advanceResult.stdout, `ADVANCE review\n--- cleared: .headsign/verdict ---\n--- phase: review ---\nReview.\n`);
});

// The engine classifies a directory and render has the line for it, but each is tested on its
// own, and the field carrying the answer between them is optional — so dropping it here would
// typecheck, pass both of those, and take the report away without failing anything. That is the
// same shape of silence the report was added to end, so it is asserted where the user reads it:
// stdout, on both paths that clear.
test("clear announcement: a directory named in clear: is announced as not cleared, at start and on ADVANCE", () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 0.1
name: demo
entry: build
phases:
  build:
    description: "Build."
    clear: [artifacts]
    gate:
      checks:
        - run: "true"
    on_pass: review
  review:
    description: "Review."
    clear: [artifacts]
    gate:
      checks:
        - run: "true"
    on_pass: "$end"
`,
  );
  fs.mkdirSync(path.join(dir, "artifacts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "artifacts", "round-1.md"), "from an earlier run\n");

  const startResult = run(["start"], { cwd: dir });
  assert.equal(startResult.status, 0);
  assert.equal(
    startResult.stdout,
    "START build\n--- not cleared: artifacts (a directory — `clear:` removes files only) ---\n--- phase: build ---\nBuild.\n",
  );

  const advanceResult = run(["next"], { cwd: dir });
  assert.equal(advanceResult.status, 0);
  assert.equal(
    advanceResult.stdout,
    "ADVANCE review\n--- not cleared: artifacts (a directory — `clear:` removes files only) ---\n--- phase: review ---\nReview.\n",
  );
  assert.equal(fs.existsSync(path.join(dir, "artifacts", "round-1.md")), true, "the directory and its contents are untouched");
});

test("clear announcement: an absent or empty cleared file is not announced", () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 0.1
name: demo
entry: build
phases:
  build:
    description: "Build."
    gate:
      checks:
        - run: "true"
    on_pass: review
  review:
    description: "Review."
    clear: [.headsign/verdict, .headsign/empty]
    gate:
      checks:
        - run: "true"
    on_pass: "$end"
`,
  );
  fs.mkdirSync(path.join(dir, ".headsign"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".headsign", "empty"), ""); // exists but zero-size -> not announced
  run(["start"], { cwd: dir });

  const advanceResult = run(["next"], { cwd: dir });
  assert.equal(advanceResult.status, 0);
  assert.equal(advanceResult.stdout, `ADVANCE review\n--- phase: review ---\nReview.\n`);
});

test("clear announcement on start: the entry phase's non-empty cleared file is announced right after START <phase>", () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 0.1
name: demo
entry: build
phases:
  build:
    description: "Build."
    clear: [.headsign/scratch]
    gate:
      checks:
        - run: "true"
    on_pass: "$end"
`,
  );
  fs.mkdirSync(path.join(dir, ".headsign"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".headsign", "scratch"), "leftover\n");

  const result = run(["start"], { cwd: dir });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, `START build\n--- cleared: .headsign/scratch ---\n--- phase: build ---\nBuild.\n`);
});

test("validate rejects a phase's clear entry that is an absolute path", () => {
  const dir = tmpdir();
  writeWorkflow(
    dir,
    `
version: 0.1
name: demo
entry: build
phases:
  build:
    description: "Build."
    clear: ["/abs/path"]
    gate:
      checks:
        - run: "true"
    on_pass: "$end"
`,
  );
  const result = run(["validate", "--workflow", ".headsign/workflow.yaml"], { cwd: dir });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /INVALID/);
  assert.match(result.stderr, /clear/);
});

test("validate rejects a phase's clear entry containing a '..' path segment", () => {
  const dir = tmpdir();
  writeWorkflow(
    dir,
    `
version: 0.1
name: demo
entry: build
phases:
  build:
    description: "Build."
    clear: ["../escape"]
    gate:
      checks:
        - run: "true"
    on_pass: "$end"
`,
  );
  const result = run(["validate", "--workflow", ".headsign/workflow.yaml"], { cwd: dir });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /INVALID/);
  assert.match(result.stderr, /clear/);
});

// --- ready: / PENDING ---

const READY_REVIEW_WORKFLOW = `
version: 0.1
name: demo
entry: review
phases:
  review:
    description: "Review."
    ready: "test -f .headsign/tmp/verdict"
    gate:
      checks:
        - run: "grep -qx APPROVED .headsign/tmp/verdict"
    on_pass: "$end"
`;

test("ready non-zero: next prints PENDING <phase> as the first line, exits 1, and leaves state.json byte-identical (no write at all)", () => {
  const dir = initRepo();
  writeWorkflow(dir, READY_REVIEW_WORKFLOW);
  run(["start"], { cwd: dir });
  const beforeBytes = fs.readFileSync(path.join(dir, ".headsign", "state.json"));

  const result = run(["next"], { cwd: dir });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^PENDING review\n/);
  assert.match(result.stdout, /not ready yet — no attempt counted/);

  const afterBytes = fs.readFileSync(path.join(dir, ".headsign", "state.json"));
  assert.deepEqual(afterBytes, beforeBytes, "the PENDING path must not call writeState at all");
});

// ADR-0027 §5: PENDING is the one `next` path most likely to be the normal shape of a driver
// walking away to wait, and exactly the stretch the backstop exists to cover — so it stamps
// `last_drive` even though (per the test just above) it writes nothing else to state.json.
test("PENDING re-stamps last_drive with the calling session, even though nothing else in state.json changes", () => {
  const dir = initRepo();
  writeWorkflow(dir, READY_REVIEW_WORKFLOW);
  const sessionEnv = { ...NO_OBSERVER_ENV, CLAUDE_CODE_SESSION_ID: "session-alpha" };
  run(["start"], { cwd: dir, env: sessionEnv });
  assert.equal((readState(dir).last_drive as { session: string })?.session, "session-alpha");

  const pending = run(["next"], { cwd: dir, env: { ...sessionEnv, CLAUDE_CODE_SESSION_ID: "session-beta" } });
  assert.match(pending.stdout, /^PENDING review\n/);
  assert.equal((readState(dir).last_drive as { session: string })?.session, "session-beta", "the session that ran THIS next, not the one that ran start");
});

test("after PENDING, writing the verdict artifact makes the probe pass and next proceeds to a real (counted) evaluation", () => {
  const dir = initRepo();
  writeWorkflow(dir, READY_REVIEW_WORKFLOW);
  run(["start"], { cwd: dir });

  const pendingResult = run(["next"], { cwd: dir });
  assert.match(pendingResult.stdout, /^PENDING review\n/);

  fs.writeFileSync(path.join(dir, ".headsign", "tmp", "verdict"), "REJECTED\n");
  const evaluated = run(["next"], { cwd: dir });
  assert.equal(evaluated.status, 1);
  assert.match(evaluated.stdout, /^RETRY 1 review\n/);
  assert.equal((readState(dir).attempts as Record<string, number>).review, 1);

  fs.writeFileSync(path.join(dir, ".headsign", "tmp", "verdict"), "APPROVED\n");
  const completeResult = run(["next"], { cwd: dir });
  assert.equal(completeResult.status, 0);
  assert.match(completeResult.stdout, /^COMPLETE\n/);
});

test("PENDING never routes via on_fail, even when the phase declares one — it always prints PENDING <phase> for the current phase", () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 0.1
name: demo
entry: review
phases:
  review:
    description: "Review."
    ready: "test -f .headsign/tmp/verdict"
    gate:
      checks:
        - run: "grep -qx APPROVED .headsign/tmp/verdict"
    on_pass: "$end"
    on_fail: implement
  implement:
    description: "Implement."
    gate:
      checks:
        - run: "true"
    on_pass: review
`,
  );
  run(["start"], { cwd: dir });
  const result = run(["next"], { cwd: dir });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, `PENDING review\n--- not ready yet — no attempt counted (readiness: test -f .headsign/tmp/verdict) ---\n--- phase: review ---\nReview.\nThis is not a failure. Do the work above so the gate can run, then run \`headsign next\` again.\n`);
});

test("PENDING does not reset stop_nudges — it never runs step(), so the loop guard is untouched", () => {
  const dir = initRepo();
  writeWorkflow(dir, READY_REVIEW_WORKFLOW);
  run(["start"], { cwd: dir });
  run(["stop-hook"], { cwd: dir, input: "{}" });
  run(["stop-hook"], { cwd: dir, input: "{}" });
  assert.equal(readState(dir).stop_nudges, 2);

  const result = run(["next"], { cwd: dir });
  assert.match(result.stdout, /^PENDING review\n/);
  assert.equal(readState(dir).stop_nudges, 2);
});

// --- a check headsign could not run at all: no verdict, so no transition (exit 3) ---

test("a gate check that produces no exit code stops the run at exit 3 and moves nothing", () => {
  const dir = initRepo();
  // `yes` floods far past the 64 MiB maxBuffer, so spawnSync kills it and reports ENOBUFS
  // instead of a status: headsign ran a check and got no answer out of it. The distinction
  // this test exists for is that the answer is NOT `RETRY 1` — a fail nobody measured would
  // spend an attempt, and enough of them would end the run.
  writeWorkflow(
    dir,
    `
version: 0.1
name: floods
entry: build
phases:
  build:
    description: "Build the thing."
    gate:
      checks:
        - name: "unit tests"
          run: "yes"
    on_pass: "$end"
    max_attempts: 2
`,
  );
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  const stateBefore = fs.readFileSync(path.join(dir, ".headsign", "state.json"));
  const logBefore = fs.readFileSync(path.join(dir, ".headsign", "log"));

  const result = run(["next"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(result.status, 3);
  // The gate's size is reported before the first check starts, so it still lands even though
  // the one check this gate holds never produced a verdict — and that check gets no `passed`
  // line of its own, the same way a failing one wouldn't (ADR-0032 §3).
  assert.match(result.stderr, /^--- gate: 1 check ---\nERROR: phase 'build': could not run the gate check 'unit tests' \(`yes`\) — ENOBUFS\./);
  assert.match(result.stderr, /the run has not moved and no attempt was spent/);
  assert.match(result.stderr, /Fix that command in '\.headsign\/workflow\.yaml'/);
  assert.equal(result.stdout, "", "no verdict was reached, so the agent-facing channel says nothing at all");

  assert.deepEqual(fs.readFileSync(path.join(dir, ".headsign", "state.json")), stateBefore, "state.json must be byte-identical");
  assert.deepEqual(fs.readFileSync(path.join(dir, ".headsign", "log")), logBefore, "no transition happened, so nothing is logged");
  assert.equal(fs.existsSync(path.join(dir, ".headsign", "lock")), false, "the lock is released before exiting");
});

// --- the global ceiling: limits.max_total_iterations (ADR-0017) ---

// A one-phase workflow whose gate always fails, so every `next` below is a counted RETRY
// until the ceiling stops answering them. The limit is a parameter because raising it is
// half of what these tests are about.
const CEILING_WORKFLOW = (limit: number): string => `
version: 0.1
name: demo
entry: build
phases:
  build:
    description: "Build."
    gate:
      checks:
        - run: "false"
    on_pass: "$end"
limits:
  max_total_iterations: ${limit}
`;

test("ceiling: ESCALATE is answered, but the run stays running — status is unchanged on disk", () => {
  const dir = initRepo();
  writeWorkflow(dir, CEILING_WORKFLOW(1));
  run(["start"], { cwd: dir });
  assert.equal(run(["next"], { cwd: dir }).status, 1); // RETRY, total_iterations -> 1

  const result = run(["next"], { cwd: dir });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /^ESCALATE build: max_total_iterations \(1\) reached/);
  const after = readState(dir);
  assert.equal(after.status, "running");
  assert.equal(after.end_reason, null);
  assert.equal(after.phase, "build");
});

// ADR-0027 §5: the ceiling is the other `next` path that writes no state of its own (no
// writeState — the run stays at the wall, unmoved), and it stamps too, for the same reason
// PENDING does.
test("ceiling: the wall re-stamps last_drive with the calling session, even though total_iterations/attempts/phase are untouched", () => {
  const dir = initRepo();
  writeWorkflow(dir, CEILING_WORKFLOW(1));
  const sessionEnv = { ...NO_OBSERVER_ENV, CLAUDE_CODE_SESSION_ID: "session-alpha" };
  run(["start"], { cwd: dir, env: sessionEnv });
  run(["next"], { cwd: dir, env: sessionEnv }); // RETRY: total_iterations -> 1, at the wall

  const atWall = { ...(readState(dir) as Record<string, unknown>) };
  delete atWall.last_drive;

  const result = run(["next"], { cwd: dir, env: { ...sessionEnv, CLAUDE_CODE_SESSION_ID: "session-beta" } });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /^ESCALATE/);

  const afterWall = { ...(readState(dir) as Record<string, unknown>) };
  delete afterWall.last_drive;
  assert.deepEqual(afterWall, atWall, "everything except last_drive is untouched by hitting the wall");
  assert.equal((readState(dir).last_drive as { session: string })?.session, "session-beta", "the session that asked at the wall, not the one that hit it first");
});

test("ceiling: the reason says how to continue and how to end it", () => {
  const dir = initRepo();
  writeWorkflow(dir, CEILING_WORKFLOW(1));
  run(["start"], { cwd: dir });
  run(["next"], { cwd: dir });

  const line1 = run(["next"], { cwd: dir }).stdout.split("\n")[0];
  assert.match(line1, /raise limits\.max_total_iterations in \.headsign\/workflow\.yaml/);
  assert.match(line1, /run `headsign next` to continue/);
  assert.match(line1, /`headsign abort <reason>` to end it/);
});

test("ceiling: asking again reprints the wall and spends no iteration or attempt", () => {
  const dir = initRepo();
  writeWorkflow(dir, CEILING_WORKFLOW(1));
  run(["start"], { cwd: dir });
  run(["next"], { cwd: dir }); // RETRY: i=1, a=1
  const atWall = readState(dir);

  for (let i = 0; i < 3; i++) {
    const result = run(["next"], { cwd: dir });
    assert.equal(result.status, 2);
    assert.match(result.stdout, /^ESCALATE/);
  }
  const after = readState(dir);
  assert.equal(after.total_iterations, atWall.total_iterations);
  assert.deepEqual(after.attempts, atWall.attempts);
  assert.equal(after.status, "running");
});

test("ceiling: raising the limit and running next resumes the same phase, gate and all", () => {
  const dir = initRepo();
  writeWorkflow(dir, CEILING_WORKFLOW(1));
  run(["start"], { cwd: dir });
  run(["next"], { cwd: dir }); // RETRY 1: i=1, a=1
  assert.match(run(["next"], { cwd: dir }).stdout, /^ESCALATE/);

  // What a person does after reading the reason: edit the number, ask again.
  writeWorkflow(dir, CEILING_WORKFLOW(5));
  const resumed = run(["next"], { cwd: dir });
  assert.equal(resumed.status, 1);
  assert.match(resumed.stdout, /^RETRY 2 build\n/); // same phase, its gate really ran again
  const after = readState(dir);
  assert.equal(after.total_iterations, 2);
  assert.equal(after.phase, "build");
});

test("ceiling: `headsign status` reports RUNNING, not ESCALATED", () => {
  const dir = initRepo();
  writeWorkflow(dir, CEILING_WORKFLOW(1));
  run(["start"], { cwd: dir });
  run(["next"], { cwd: dir });
  run(["next"], { cwd: dir }); // the wall

  const result = run(["status"], { cwd: dir });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^RUNNING build \(attempt 1\)\n/);
  assert.doesNotMatch(result.stdout, /ESCALATED/);
});

// The line ADR-0017 draws: the two escalations that mean something is wrong still end the
// run. Without these, "the ceiling is recoverable" could quietly become "escalation is".
test("regression: exhausting max_attempts still ends the run for good", () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 0.1
name: demo
entry: build
phases:
  build:
    description: "Build."
    gate:
      checks:
        - run: "false"
    on_pass: "$end"
    max_attempts: 1
`,
  );
  run(["start"], { cwd: dir });
  const escalated = run(["next"], { cwd: dir });
  assert.equal(escalated.status, 2);
  assert.match(escalated.stdout, /^ESCALATE build: max_attempts \(1\) exhausted/);
  assert.equal(readState(dir).status, "escalated");

  const again = run(["next"], { cwd: dir });
  assert.equal(again.status, 2);
  assert.match(again.stdout, /^ESCALATE build: max_attempts \(1\) exhausted/);
  assert.match(run(["status"], { cwd: dir }).stdout, /^ESCALATED\n/);
});

test("regression: `headsign abort` still ends the run for good", () => {
  const dir = initRepo();
  writeWorkflow(dir, CEILING_WORKFLOW(5));
  run(["start"], { cwd: dir });
  assert.equal(run(["abort", "not worth it"], { cwd: dir }).status, 2);
  assert.equal(readState(dir).status, "aborted");

  const again = run(["next"], { cwd: dir });
  assert.equal(again.status, 2);
  assert.match(again.stdout, /^ABORT not worth it\n/);
  assert.match(run(["status"], { cwd: dir }).stdout, /^ABORTED\n/);
});

// --- .headsign/log ---

test("log: the first start in a fresh directory creates the log with exactly one start line naming the workflow", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  const lines = readLog(dir);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\S+ start build a=0 i=0 workflow=demo$/);
});

test("log: timestamp is local time with a numeric UTC offset, no milliseconds (generic format check; CI runs UTC, so +00:00)", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  const lines = readLog(dir);
  assert.match(lines[0], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2} /);
});

test("log: timestamp reflects TZ (Asia/Tokyo, +09:00), not UTC", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: { ...process.env, TZ: "Asia/Tokyo" } });
  const lines = readLog(dir);
  assert.match(lines[0], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00 start /);
});

test("log: a timezone west of UTC carries a minus offset, not a plus", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  // The sign comes off the running machine's own offset, so one side of it is whichever side
  // the machine sits on and the other side is never taken — unless a child process is handed a
  // TZ. Both sides are pinned here, one test each, because a timestamp whose sign is wrong
  // reads as a run that happened at another time of day.
  run(["start"], { cwd: dir, env: { ...process.env, TZ: "America/Los_Angeles" } });
  assert.match(readLog(dir)[0], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-0[78]:00 start /);
});

test("start with --workflow and no path after it refuses, rather than reading the default", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  // The flag is last on the line, which is what a caller building the command from a variable
  // produces when the variable is empty. Falling back to `.headsign/workflow.yaml` would start
  // a run against a file nobody named.
  const result = run(["start", "--workflow"], { cwd: dir });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /--workflow requires a path argument/);
  assert.equal(result.stdout, "");
  assert.ok(!fs.existsSync(path.join(dir, ".headsign", "state.json")), "no run may begin");
});

// Reading one run out of an append-only log: the event name is ALWAYS the second field and
// free text like reason="…" always sits after a=/i=, so anchoring on `^[^ ]* start ` cannot be
// fooled by a reason that happens to contain the word (a naive `grep ' start '` can be).
// These are the exact pipelines a person is told to use, run through a shell so the tests below
// protect the advice and not just an equivalent regex.
const LAST_START_LINE_NO = String.raw`grep -n '^[^ ]* start ' .headsign/log | tail -1 | cut -d: -f1`;
const COUNT_START_LINES = String.raw`grep -c '^[^ ]* start ' .headsign/log`;
const COUNT_START_LINES_NAIVE = String.raw`grep -c ' start ' .headsign/log`;

function sh(dir: string, script: string): string {
  return execFileSync("sh", ["-c", script], { cwd: dir, encoding: "utf8" }).trim();
}

test("log: a second start appends to the previous run's log, leaving the previous run's bytes exactly as they were", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  run(["abort", "done"], { cwd: dir });
  const before = fs.readFileSync(path.join(dir, ".headsign", "log"), "utf8");
  assert.ok(readLog(dir).length >= 2);

  run(["start"], { cwd: dir });
  const after = fs.readFileSync(path.join(dir, ".headsign", "log"), "utf8");
  assert.ok(after.startsWith(before), `the previous run's bytes were rewritten:\n${after}`);
  // Byte-exact on the tail as well: a restart adds its own start line and NOTHING else — no
  // blank line, no separator. Framing runs is render.ts's business, and the start line already
  // does it.
  assert.match(after.slice(before.length), /^\S+ start build a=0 i=0 workflow=demo\n$/);
});

test("log: the abort reason survives the next start — restarting is not a cheap way to erase why the last run stopped", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  run(["abort", "the", "spec", "was", "wrong"], { cwd: dir });
  run(["start"], { cwd: dir });

  const lines = readLog(dir);
  assert.ok(
    lines.some((l) => /^\S+ abort build a=0 i=0 reason="the spec was wrong"$/.test(l)),
    `the abort line is gone after the restart:\n${lines.join("\n")}`,
  );
});

test("log: after a restart the anchored start grep matches twice, and the slice from the last match is only the new run", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  run(["next"], { cwd: dir }); // RETRY — a line that belongs to the first run
  run(["abort", "done"], { cwd: dir });
  run(["start"], { cwd: dir });
  run(["next"], { cwd: dir }); // RETRY — a line that belongs to the second run

  assert.equal(sh(dir, COUNT_START_LINES), "2");
  const currentRun = readLog(dir).slice(Number(sh(dir, LAST_START_LINE_NO)) - 1);
  assert.equal(currentRun.length, 2, `the slice caught lines from the previous run:\n${currentRun.join("\n")}`);
  assert.match(currentRun[0], /^\S+ start build a=0 i=0 workflow=demo$/);
  assert.match(currentRun[1], /^\S+ retry build a=1 i=1 check="/);
});

// The reconstruction the held line exists for, done the way a person does it: slice the current
// run out of the log, read the event word off the second field (the anchor the format promises),
// and count the holds between the lines that moved the run. Written against the bytes rather than
// against the API, so it fails if the line format drifts.
const MOVES_THE_RUN = new Set(["start", "advance", "retry", "complete", "escalate", "abort"]);
const eventWord = (line: string): string => line.split(" ")[1];

test("log: the holds a run spent between two transitions are countable from the log alone", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });

  run(["stop-hook"], { cwd: dir, input: "{}", env: NO_OBSERVER_ENV });
  run(["stop-hook"], { cwd: dir, input: "{}", env: NO_OBSERVER_ENV });
  run(["next"], { cwd: dir, env: NO_OBSERVER_ENV }); // RETRY: a real judgment, which resets the count
  run(["stop-hook"], { cwd: dir, input: "{}", env: NO_OBSERVER_ENV });
  run(["stop-hook"], { cwd: dir, input: "{}", env: NO_OBSERVER_ENV });
  run(["stop-hook"], { cwd: dir, input: "{}", env: NO_OBSERVER_ENV });

  const currentRun = readLog(dir).slice(Number(sh(dir, LAST_START_LINE_NO)) - 1);
  const holdsPerStretch: number[] = [];
  let holds = 0;
  for (const line of currentRun) {
    if (eventWord(line) === "held") holds += 1;
    else if (MOVES_THE_RUN.has(eventWord(line))) {
      holdsPerStretch.push(holds);
      holds = 0;
    }
  }
  holdsPerStretch.push(holds);
  assert.deepEqual(holdsPerStretch, [0, 2, 3], `could not count the holds in:\n${currentRun.join("\n")}`);

  // The count each line carries agrees with the count of the lines, and restarts with the stretch.
  assert.deepEqual(
    currentRun.filter((l) => eventWord(l) === "held").map((l) => l.split(" ").at(-1)),
    ["nudges=1", "nudges=2", "nudges=1", "nudges=2", "nudges=3"],
  );
});

test("log: an abort reason containing the word start does not add a match to the anchored grep", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  run(["abort", "let's start over"], { cwd: dir });
  run(["start"], { cwd: dir });

  assert.ok(readLog(dir).some((l) => l.includes(`reason="let's start over"`)));
  assert.equal(sh(dir, COUNT_START_LINES), "2");
  // Why the anchor is not decoration: without it the reason is counted as a third run.
  assert.equal(sh(dir, COUNT_START_LINES_NAIVE), "3");
});

test("log: every retry/advance/complete appends one line, including a repeated retry on an untouched tree", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  assert.equal(readLog(dir).length, 1); // start

  run(["next"], { cwd: dir }); // RETRY
  assert.equal(readLog(dir).length, 2);

  run(["next"], { cwd: dir }); // asked again with nothing changed -> a second, equally real RETRY
  assert.equal(readLog(dir).length, 3);

  fs.writeFileSync(path.join(dir, "marker.txt"), "");
  run(["next"], { cwd: dir }); // ADVANCE
  assert.equal(readLog(dir).length, 4);

  run(["next"], { cwd: dir }); // COMPLETE
  assert.equal(readLog(dir).length, 5);

  const lines = readLog(dir);
  assert.match(lines[1], /^\S+ retry build a=1 i=1 check="/);
  assert.match(lines[2], /^\S+ retry build a=2 i=2 check="/);
  assert.match(lines[3], /^\S+ advance verify a=0 i=3 from=build$/);
  assert.match(lines[4], /^\S+ complete verify a=0 i=4$/);
});

test("log: complete re-display (idempotent next after COMPLETE) appends nothing", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "marker.txt"), "");
  run(["next"], { cwd: dir });
  run(["next"], { cwd: dir }); // COMPLETE
  const lengthAfterComplete = readLog(dir).length;

  run(["next"], { cwd: dir }); // idempotent re-display
  assert.equal(readLog(dir).length, lengthAfterComplete);
});

test("log: abort appends one line", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  const before = readLog(dir).length;
  run(["abort", "changed", "my", "mind"], { cwd: dir });
  const lines = readLog(dir);
  assert.equal(lines.length, before + 1);
  assert.match(lines[lines.length - 1], /^\S+ abort build a=0 i=0 reason="changed my mind"$/);
});

test("log: PENDING appends nothing", () => {
  const dir = initRepo();
  writeWorkflow(dir, READY_REVIEW_WORKFLOW);
  run(["start"], { cwd: dir });
  const before = readLog(dir).length;
  run(["next"], { cwd: dir }); // PENDING
  assert.equal(readLog(dir).length, before);
});

test("log: hitting max_total_iterations appends one ceiling line, not an escalate one", () => {
  const dir = initRepo();
  writeWorkflow(dir, CEILING_WORKFLOW(1));
  run(["start"], { cwd: dir });
  const first = run(["next"], { cwd: dir }); // real RETRY, total_iterations -> 1
  assert.equal(first.status, 1);
  const before = readLog(dir).length;

  const result = run(["next"], { cwd: dir }); // total_iterations(1) >= limit(1) -> ESCALATE, checked before the gate
  assert.equal(result.status, 2);
  assert.match(result.stdout, /^ESCALATE/);
  const lines = readLog(dir);
  assert.equal(lines.length, before + 1);
  // `ceiling`, because this run has not ended (ADR-0017) and `escalate` is the word for one
  // that has. i=1 is unchanged from the RETRY above: the wall costs no iteration.
  assert.match(lines[lines.length - 1], /^\S+ ceiling build a=1 i=1 reason="/);
});

// --- stop hook (ADR-0006) ---

test("stop-hook: no state file -> exit 0", () => {
  const result = run(["stop-hook"], { cwd: tmpdir(), input: "{}" });
  assert.equal(result.status, 0);
});

test("stop-hook: running -> exit 2 with stderr mentioning `headsign next`", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  const result = run(["stop-hook"], { cwd: dir, input: "{}" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /headsign next/);
});

test("stop-hook: each block increments stop_nudges in state.json; the guard trips on the 6th consecutive stop", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  assert.equal(readState(dir).stop_nudges, 0);

  for (let expected = 1; expected <= 5; expected++) {
    const result = run(["stop-hook"], { cwd: dir, input: "{}" });
    assert.equal(result.status, 2, `stop #${expected} should still block`);
    assert.equal(readState(dir).stop_nudges, expected);
  }

  // A 6th consecutive stop, with no real `next` evaluation (and no stop-note) in between,
  // trips the loop guard.
  const sixth = run(["stop-hook"], { cwd: dir, input: "{}" });
  assert.equal(sixth.status, 0);
  assert.equal(readState(dir).stop_nudges, 5); // guard fires without incrementing further
});

test("stop-hook: a non-numeric stop_nudges in state.json is treated as 0 (not an infinite block), and the 5th block warns it's the final automatic reminder", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  const statePath = path.join(dir, ".headsign", "state.json");
  fs.writeFileSync(statePath, JSON.stringify({ ...readState(dir), stop_nudges: "x" }));

  const first = run(["stop-hook"], { cwd: dir, input: "{}" });
  assert.equal(first.status, 2, "still blocks despite the corrupt starting value");
  assert.equal(readState(dir).stop_nudges, 1);
  assert.equal(typeof readState(dir).stop_nudges, "number", "the bad value is replaced with a clean number");

  for (let expected = 2; expected <= 4; expected++) {
    const result = run(["stop-hook"], { cwd: dir, input: "{}" });
    assert.equal(result.status, 2);
    assert.equal(readState(dir).stop_nudges, expected);
  }

  const fifth = run(["stop-hook"], { cwd: dir, input: "{}" });
  assert.equal(fifth.status, 2);
  assert.equal(readState(dir).stop_nudges, 5);
  assert.match(fifth.stderr, /final automatic reminder/);

  const sixth = run(["stop-hook"], { cwd: dir, input: "{}" });
  assert.equal(sixth.status, 0, "fail-open reached despite the corrupt starting value");
});

test("stop-hook: a real `next` evaluation between stops resets stop_nudges", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  run(["stop-hook"], { cwd: dir, input: "{}" });
  run(["stop-hook"], { cwd: dir, input: "{}" });
  assert.equal(readState(dir).stop_nudges, 2);

  run(["next"], { cwd: dir }); // real evaluation (fails, no marker.txt yet) -> resets the guard
  assert.equal(readState(dir).stop_nudges, 0);

  const result = run(["stop-hook"], { cwd: dir, input: "{}" });
  assert.equal(result.status, 2);
  assert.equal(readState(dir).stop_nudges, 1);
});

test("stop-hook: complete/escalated/aborted -> exit 0", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  run(["abort", "done"], { cwd: dir });
  const result = run(["stop-hook"], { cwd: dir, input: "{}" });
  assert.equal(result.status, 0);
});

test("stop-hook: stop_hook_active true short-circuits even while running, and does not increment stop_nudges", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  const result = run(["stop-hook"], { cwd: dir, input: JSON.stringify({ stop_hook_active: true }) });
  assert.equal(result.status, 0);
  assert.equal(readState(dir).stop_nudges, 0);
});

test("stop-hook: garbage stdin fails open (exit 0)", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  const result = run(["stop-hook"], { cwd: dir, input: "not json{{{" });
  assert.equal(result.status, 0);
});

test("stop-hook: corrupt state.json fails open (exit 0)", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  fs.writeFileSync(path.join(dir, ".headsign", "state.json"), "{not valid json");
  const result = run(["stop-hook"], { cwd: dir, input: "{}" });
  assert.equal(result.status, 0);
});

// --- stop hook: exit-note gate (ADR-0006 revision) ---

function stopNotePath(dir: string): string {
  return path.join(dir, ".headsign", "tmp", "stop-note");
}

function writeStopNote(dir: string, content: string): void {
  fs.mkdirSync(path.join(dir, ".headsign", "tmp"), { recursive: true });
  fs.writeFileSync(stopNotePath(dir), content);
}

test("stop-hook: a non-empty stop-note pauses — exit 0, note deleted, stop_nudges reset, one paused log line with the note's first line", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  run(["stop-hook"], { cwd: dir, input: "{}" });
  run(["stop-hook"], { cwd: dir, input: "{}" });
  assert.equal(readState(dir).stop_nudges, 2);

  writeStopNote(dir, "stepping away, resume tomorrow");
  const result = run(["stop-hook"], { cwd: dir, input: "{}" });
  assert.equal(result.status, 0);
  assert.ok(!fs.existsSync(stopNotePath(dir)), "note must be consumed (deleted)");
  assert.equal(readState(dir).stop_nudges, 0);

  const lines = readLog(dir);
  const pausedLines = lines.filter((l) => l.includes(" paused "));
  assert.equal(pausedLines.length, 1);
  assert.match(pausedLines[0], /paused build a=0 i=0 note="stepping away, resume tomorrow"/);
});

test("stop-hook: a whitespace-only stop-note is treated as absent — still blocks", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  writeStopNote(dir, "   \n\t\n  ");

  const result = run(["stop-hook"], { cwd: dir, input: "{}" });
  assert.equal(result.status, 2);
  assert.equal(readState(dir).stop_nudges, 1);
  assert.equal(readLog(dir).filter((l) => l.includes(" paused ")).length, 0);
});

test("stop-hook: no stop-note -> blocks, and the message names both the stop-note instructions and the abort escape hatch", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });

  const result = run(["stop-hook"], { cwd: dir, input: "{}" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /\.headsign\/tmp\/stop-note/);
  assert.match(result.stderr, /headsign abort/);
});

test("stop-hook: four held lines then exactly one stalled; later stops repeat neither", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });

  for (let i = 1; i <= 5; i++) run(["stop-hook"], { cwd: dir, input: "{}" });
  let stalledLines = readLog(dir).filter((l) => l.includes(" stalled "));
  assert.equal(stalledLines.length, 1);
  assert.match(stalledLines[0], /stalled build a=0 i=0 nudges=5/);
  assert.deepEqual(
    readLog(dir).filter((l) => l.includes(" held ")).map((l) => l.split(" ").at(-1)),
    ["nudges=1", "nudges=2", "nudges=3", "nudges=4"],
    "the four holds before the cap each carry the count they spent",
  );

  run(["stop-hook"], { cwd: dir, input: "{}" });
  run(["stop-hook"], { cwd: dir, input: "{}" });
  stalledLines = readLog(dir).filter((l) => l.includes(" stalled "));
  assert.equal(stalledLines.length, 1, "stalled must not be repeated on later stops");
  assert.equal(readLog(dir).filter((l) => l.includes(" held ")).length, 4, "a stop nothing held is not a hold");
});

// --- stop hook: bounded walk-up (fs-only, bounded by the enclosing git worktree/repo root) ---

test("stop-hook: stdin cwd in a deep subdirectory of a running root finds the root run and increments the root's stop_nudges", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });

  const sub = path.join(dir, "a", "b", "c");
  fs.mkdirSync(sub, { recursive: true });

  const result = run(["stop-hook"], { cwd: dir, input: JSON.stringify({ cwd: sub }) });
  assert.equal(result.status, 2);
  assert.match(result.stderr, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(result.stderr, /cd there/);
  assert.equal(readState(dir).stop_nudges, 1);
});

test("stop-hook: a nested project's own run (no .git of its own) is found before reaching the enclosing repo's .git", () => {
  const dir = initRepo(); // repo root has .git, but NO headsign run of its own
  const svc = path.join(dir, "svc");
  writeWorkflow(svc, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: svc });

  const sub = path.join(svc, "src");
  fs.mkdirSync(sub, { recursive: true });

  const result = run(["stop-hook"], { cwd: dir, input: JSON.stringify({ cwd: sub }) });
  assert.equal(result.status, 2);
  assert.match(result.stderr, new RegExp(svc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(readState(svc).stop_nudges, 1);
  assert.ok(!fs.existsSync(path.join(dir, ".headsign", "state.json")));
});

test("stop-hook: walk-up stops at a linked worktree's .git FILE and never crosses into the main worktree's running run", () => {
  const base = tmpdir();
  const main = path.join(base, "main");
  fs.mkdirSync(main);
  execFileSync("git", ["init", "-q"], { cwd: main });
  execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-q", "-m", "init", "--allow-empty"], { cwd: main });
  writeWorkflow(main, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: main });
  assert.equal(readState(main).status, "running");

  const wt = path.join(main, "wt");
  execFileSync("git", ["worktree", "add", "-b", "wt-branch", "./wt"], { cwd: main });
  assert.ok(fs.statSync(path.join(wt, ".git")).isFile(), "linked worktree's .git must be a file, not a directory");

  const somesub = path.join(wt, "somesub");
  fs.mkdirSync(somesub, { recursive: true });

  const result = run(["stop-hook"], { cwd: wt, input: JSON.stringify({ cwd: somesub }) });
  assert.equal(result.status, 0, "must allow: the walk-up should stop at wt/.git and never reach main's running run");
  assert.equal(readState(main).stop_nudges, 0, "main's running run must never be touched by a stop-hook invoked inside the sibling worktree");
});

test("stop-hook: no .headsign anywhere from cwd up to the git root -> exit 0", () => {
  const dir = initRepo();
  const sub = path.join(dir, "x", "y");
  fs.mkdirSync(sub, { recursive: true });
  const result = run(["stop-hook"], { cwd: dir, input: JSON.stringify({ cwd: sub }) });
  assert.equal(result.status, 0);
});

test("stop-hook: backward-compat — stdin with no `cwd` field falls back to the process cwd (unchanged behavior)", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  const result = run(["stop-hook"], { cwd: dir, input: "{}" });
  assert.equal(result.status, 2);
  assert.equal(readState(dir).stop_nudges, 1);
});

test("stop-hook: stop_hook_active true with a walked-up cwd allows and does not increment nudges", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });

  const sub = path.join(dir, "deep", "sub");
  fs.mkdirSync(sub, { recursive: true });

  const result = run(["stop-hook"], { cwd: dir, input: JSON.stringify({ stop_hook_active: true, cwd: sub }) });
  assert.equal(result.status, 0);
  assert.equal(readState(dir).stop_nudges, 0);
});

test("stop-hook: the 5-nudge cap and final-reminder text still work when the run is found via walk-up", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });

  const sub = path.join(dir, "deep", "sub");
  fs.mkdirSync(sub, { recursive: true });
  const stdin = JSON.stringify({ cwd: sub });

  for (let expected = 1; expected <= 5; expected++) {
    const result = run(["stop-hook"], { cwd: dir, input: stdin });
    assert.equal(result.status, 2, `stop #${expected} should still block`);
    assert.equal(readState(dir).stop_nudges, expected);
    if (expected === 5) assert.match(result.stderr, /final automatic reminder/);
  }

  const sixth = run(["stop-hook"], { cwd: dir, input: stdin });
  assert.equal(sixth.status, 0);
  assert.equal(readState(dir).stop_nudges, 5);
});

test("stop-hook: walk-up-found run — note consumption and paused logging operate on runDir, and the blocked message shows the runDir-prefixed note path", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });

  const sub = path.join(dir, "deep", "sub");
  fs.mkdirSync(sub, { recursive: true });
  const stdin = JSON.stringify({ cwd: sub });

  // Without a note, the block message must name the runDir-prefixed note path.
  const blocked = run(["stop-hook"], { cwd: dir, input: stdin });
  assert.equal(blocked.status, 2);
  assert.match(blocked.stderr, new RegExp(`${dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/\\.headsign/tmp/stop-note`));
  assert.match(blocked.stderr, /headsign abort/);
  assert.equal(readState(dir).stop_nudges, 1);

  const noteDir = path.join(dir, ".headsign", "tmp");
  fs.mkdirSync(noteDir, { recursive: true });
  fs.writeFileSync(path.join(noteDir, "stop-note"), "pausing from a subdirectory session");

  const paused = run(["stop-hook"], { cwd: dir, input: stdin });
  assert.equal(paused.status, 0);
  assert.ok(!fs.existsSync(path.join(noteDir, "stop-note")), "note must be consumed on runDir");
  assert.equal(readState(dir).stop_nudges, 0);

  const lines = readLog(dir);
  assert.match(lines[lines.length - 1], /paused build a=0 i=0 note="pausing from a subdirectory session"/);
});

// --- driver ownership: only a claim can name a driver (ADR-0013) ---

test("start: a new run is always undelegated — driver_agent is stamped null", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(readState(dir).driver_agent, null);
});

test("next: never writes a driver — the field stays null across a real RETRY", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(readState(dir).driver_agent, null);

  const result = run(["next"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(result.status, 1);
  assert.equal(readState(dir).driver_agent, null);
});

test("next: never overwrites the driver a claim sealed", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  run(["claim"], { cwd: dir });
  run(["subagent-stop-hook"], { cwd: dir, input: JSON.stringify({ agent_id: "agent-alpha" }), env: NO_OBSERVER_ENV });
  assert.equal(readState(dir).driver_agent, "agent-alpha");

  run(["next"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(readState(dir).driver_agent, "agent-alpha", "the claimed driver survives a `next` it did not run itself");
});

test("next: the PENDING path writes nothing at all to state.json", () => {
  const dir = initRepo();
  writeWorkflow(dir, READY_REVIEW_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });

  const before = fs.readFileSync(path.join(dir, ".headsign", "state.json"));
  const result = run(["next"], { cwd: dir, env: NO_OBSERVER_ENV }); // not ready -> PENDING
  assert.match(result.stdout, /^PENDING review\n/);
  const after = fs.readFileSync(path.join(dir, ".headsign", "state.json"));
  assert.deepEqual(after, before, "PENDING must not touch state.json at all");
});

test("stop-hook: HEADSIGN_OBSERVER unconditionally passes through while running, without incrementing stop_nudges", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  const result = run(["stop-hook"], { cwd: dir, input: "{}", env: { ...NO_OBSERVER_ENV, HEADSIGN_OBSERVER: "1" } });
  assert.equal(result.status, 0);
  assert.equal(readState(dir).stop_nudges, 0);
});

test("stop-hook: an unclaimed run nudges whoever stopped, whatever session_id the payload carries", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });

  const named = run(["stop-hook"], { cwd: dir, input: JSON.stringify({ session_id: "some-session" }), env: NO_OBSERVER_ENV });
  assert.equal(named.status, 2);
  assert.equal(readState(dir).stop_nudges, 1);

  const unnamed = run(["stop-hook"], { cwd: dir, input: "{}", env: NO_OBSERVER_ENV });
  assert.equal(unnamed.status, 2);
  assert.equal(readState(dir).stop_nudges, 2);
});

test("stop-hook: a claimed run passes through — no write, no output, note left unconsumed", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  run(["claim"], { cwd: dir });
  run(["subagent-stop-hook"], { cwd: dir, input: JSON.stringify({ agent_id: "agent-alpha" }), env: NO_OBSERVER_ENV });

  const noteDir = path.join(dir, ".headsign", "tmp");
  fs.mkdirSync(noteDir, { recursive: true });
  fs.writeFileSync(path.join(noteDir, "stop-note"), "the driving agent is stepping away");

  const before = fs.readFileSync(path.join(dir, ".headsign", "state.json"));
  const result = run(["stop-hook"], { cwd: dir, input: JSON.stringify({ session_id: "agent-alpha" }), env: NO_OBSERVER_ENV });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");

  const after = fs.readFileSync(path.join(dir, ".headsign", "state.json"));
  assert.deepEqual(after, before, "a stop on a claimed run must not write state.json at all");
  assert.ok(fs.existsSync(path.join(noteDir, "stop-note")), "an enclosing session's stop must not consume the driving agent's note");
});

test("stop-hook: a state.json still carrying the pre-rename driver_session field reads as unclaimed and nudges, rather than crashing", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  const legacy = readState(dir) as Record<string, unknown>;
  delete legacy.driver_agent;
  legacy.driver_session = "session-alpha";
  legacy.driver_source = "env";
  fs.writeFileSync(path.join(dir, ".headsign", "state.json"), JSON.stringify(legacy));

  const result = run(["stop-hook"], { cwd: dir, input: "{}", env: NO_OBSERVER_ENV });
  assert.equal(result.status, 2);
  assert.equal(readState(dir).stop_nudges, 1);
});

// --- claim: the driver-adoption handshake (ADR-0009, re-homed onto SubagentStop by ADR-0010) ---

function claimMarkerPath(dir: string): string {
  return path.join(dir, ".headsign", "tmp", "claim");
}

test("claim: no run in progress here -> exit 3, actionable cwd-only message", () => {
  const result = run(["claim"], { cwd: tmpdir() });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /^ERROR:/);
  assert.match(result.stderr, /does not search parent directories/);
  assert.match(result.stderr, /headsign start/);
});

test("claim: a terminal (aborted) run -> exit 3, names the actual status, nothing to claim", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  run(["abort", "done"], { cwd: dir, env: NO_OBSERVER_ENV });

  const result = run(["claim"], { cwd: dir });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /^ERROR:/);
  assert.match(result.stderr, /already aborted/);
  assert.match(result.stderr, /nothing to claim/);
});

test("claim: a running run -> creates .headsign/tmp/claim, exit 0, and the output tells the caller to end its turn; state.json is untouched", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  const before = fs.readFileSync(path.join(dir, ".headsign", "state.json"));

  const result = run(["claim"], { cwd: dir });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^CLAIM armed\n/);
  assert.match(result.stdout, /Now end your turn/);
  assert.equal(fs.existsSync(claimMarkerPath(dir)), true);

  const after = fs.readFileSync(path.join(dir, ".headsign", "state.json"));
  assert.deepEqual(after, before, "claim must write nothing to state.json — adoption is the SubagentStop hook's job");
});

test("claim: a re-run (e.g. after a mistaken adoption) harmlessly re-arms the marker rather than erroring", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  const first = run(["claim"], { cwd: dir });
  assert.equal(first.status, 0);
  const second = run(["claim"], { cwd: dir });
  assert.equal(second.status, 0);
  assert.equal(fs.existsSync(claimMarkerPath(dir)), true);
});

test("claim + subagent-stop-hook end-to-end: the claiming agent's own turn end seals the claim, blocking with the confirmation message", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  run(["claim"], { cwd: dir });

  const result = run(["subagent-stop-hook"], { cwd: dir, input: JSON.stringify({ agent_id: "agent-alpha" }), env: NO_OBSERVER_ENV });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /^Claim confirmed: this agent now drives workflow 'demo' \(phase: build\)\./);
  assert.match(result.stderr, /headsign next`/);
  assert.match(result.stderr, /headsign abort/);

  const after = readState(dir);
  assert.equal(after.driver_agent, "agent-alpha");
  assert.equal(after.stop_nudges, 0);
  assert.equal(fs.existsSync(claimMarkerPath(dir)), false);

  const lines = readLog(dir);
  assert.equal(lines.filter((l) => l.includes(" claimed ")).length, 1);
});

test("claim + stop-hook end-to-end: an enclosing session's stop does NOT seal the claim — the marker survives for the claiming agent's own turn end", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  run(["claim"], { cwd: dir });

  // The regression ADR-0010 exists to prevent: under ADR-0009 this stop stole the driver
  // seat that a delegated agent had just asked for, simply by stopping first.
  const stolen = run(["stop-hook"], { cwd: dir, input: JSON.stringify({ session_id: "session-alpha" }), env: NO_OBSERVER_ENV });
  assert.equal(stolen.status, 2, "the run is still unclaimed, so the ordinary nudge applies");
  assert.doesNotMatch(stolen.stderr, /Claim confirmed/);
  assert.equal(readState(dir).driver_agent, null);
  assert.equal(fs.existsSync(claimMarkerPath(dir)), true, "the marker must still be armed");

  // ...and the claiming agent then gets it, as asked.
  const sealed = run(["subagent-stop-hook"], { cwd: dir, input: JSON.stringify({ agent_id: "agent-alpha" }), env: NO_OBSERVER_ENV });
  assert.equal(sealed.status, 2);
  assert.match(sealed.stderr, /^Claim confirmed/);
  assert.equal(readState(dir).driver_agent, "agent-alpha");
});

test("re-claim re-adopts: a second claim, sealed by the right agent's turn end, overrides a previous mistaken adoption", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });

  run(["claim"], { cwd: dir });
  run(["subagent-stop-hook"], { cwd: dir, input: JSON.stringify({ agent_id: "agent-beta" }), env: NO_OBSERVER_ENV });
  assert.equal(readState(dir).driver_agent, "agent-beta");

  // The right agent notices the mistake and re-claims. Unlike ADR-0009's version of this
  // handshake, the retry can reach the right answer at all: that agent's own turn end always
  // fires SubagentStop, making it an eligible winner. Eligible, not certain — the gate still
  // seats whichever agent names itself first, which is why this test drives that order
  // explicitly rather than asserting the retry is guaranteed to land.
  run(["claim"], { cwd: dir });
  const result = run(["subagent-stop-hook"], { cwd: dir, input: JSON.stringify({ agent_id: "agent-alpha" }), env: NO_OBSERVER_ENV });
  assert.equal(result.status, 2);
  assert.equal(readState(dir).driver_agent, "agent-alpha", "the later adoption replaces the earlier one");
});

test("subagent-stop-hook: reads stdin and exits 0 when the stopping agent is not this run's driver", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });

  // An unclaimed run: an unrelated subagent stopping under it must never be trapped.
  const result = run(["subagent-stop-hook"], { cwd: dir, input: JSON.stringify({ agent_id: "agent-alpha" }), env: NO_OBSERVER_ENV });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(readState(dir).stop_nudges, 0);
});

test("subagent-stop-hook: the driving agent's own turn end exits 2 with the nudge on stderr and increments stop_nudges", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  run(["claim"], { cwd: dir });
  run(["subagent-stop-hook"], { cwd: dir, input: JSON.stringify({ agent_id: "agent-alpha" }), env: NO_OBSERVER_ENV });

  const result = run(["subagent-stop-hook"], { cwd: dir, input: JSON.stringify({ agent_id: "agent-alpha" }), env: NO_OBSERVER_ENV });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /headsign workflow 'demo' is still running \(phase: build\)\./);
  assert.equal(readState(dir).stop_nudges, 1);
});

test("subagent-stop-hook: no run here, and no stdin at all, exit 0 (fail open)", () => {
  const noRun = run(["subagent-stop-hook"], { cwd: tmpdir(), input: JSON.stringify({ agent_id: "agent-alpha" }) });
  assert.equal(noRun.status, 0);

  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  const noStdin = run(["subagent-stop-hook"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(noStdin.status, 0);
});

test("status: a claimed run reports driver: a delegated agent, and never the agent id itself", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  run(["claim"], { cwd: dir });
  run(["subagent-stop-hook"], { cwd: dir, input: JSON.stringify({ agent_id: "agent-alpha" }), env: NO_OBSERVER_ENV });

  // The delegated-agent phrasing is a plain report of who the handshake seated, not a
  // judgment about the reader: the CLI can't resolve an agent id for itself, so it must not
  // claim to know whether the reader is that agent.
  const result = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /driver: a delegated agent\n/);
  assert.doesNotMatch(result.stdout, /agent-alpha/);
});

test("--help lists the claim command and its validate line describes the new default (current run's workflow, then .headsign/workflow.yaml)", () => {
  const result = run(["--help"], { cwd: tmpdir() });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /headsign claim/);
  assert.match(result.stdout, /defaults to the current run's workflow, then \.headsign\/workflow\.yaml/);
});

test("--help keeps both hook subcommands hidden: they are wiring for Claude Code, not part of the six-command surface", () => {
  const result = run(["--help"], { cwd: tmpdir() });
  assert.doesNotMatch(result.stdout, /stop-hook/);
});

// A caller under a "don't run headsign here" constraint needs to be able to tell, from --help
// alone, which commands touch .headsign/ and which don't — the situation that motivated this:
// discovering `validate` was read-only meant starting a run in a spare worktree to check.
test("--help names each command's effect on .headsign/: read-only commands say so, writing commands name what they write", () => {
  const result = run(["--help"], { cwd: tmpdir() });
  const lines = result.stdout.split("\n");
  const lineFor = (needle: string): string => {
    const found = lines.find((l) => l.includes(needle));
    assert.ok(found, `no help line contains '${needle}'`);
    return found as string;
  };

  assert.match(lineFor("headsign start "), /writes state\.json, log/);
  assert.match(lineFor("headsign start "), /tmp\//, "start also says it wipes and recreates tmp/");
  assert.match(lineFor("headsign next "), /--accept-graph-change/, "the flag itself is named in the usage line");
  assert.match(lineFor("headsign next "), /writes state\.json, log, lock/);
  assert.match(lineFor("headsign abort "), /writes state\.json, log/);
  assert.match(lineFor("headsign status"), /read-only/);
  assert.match(lineFor("headsign validate "), /read-only/);
  assert.match(lineFor("headsign claim"), /writes tmp\//);
  assert.match(lineFor("headsign version"), /read-only/);
  assert.match(lineFor("headsign help"), /read-only/);

  // The two writes that leave `.headsign/` — the ones a reader deciding "can this disturb my
  // repository" cares about most, and the ones the first version of this list omitted.
  assert.match(lineFor("headsign start "), /\.gitignore/, "start amends a tracked .gitignore");
  assert.match(lineFor("headsign start "), /clear:/, "start deletes the entry phase's clear: paths");
  assert.match(lineFor("headsign next "), /clear:/, "advancing deletes the next phase's clear: paths");

  // The hidden subcommands stay hidden — this test's own line-scan must not accidentally
  // require them to appear.
  assert.doesNotMatch(result.stdout, /stop-hook/);
});

test("src/cli.ts no longer describes the command surface as \"five commands\" now that claim makes six", () => {
  const src = fs.readFileSync(CLI, "utf8");
  assert.doesNotMatch(src, /five commands/);
  assert.match(src, /six commands/);
});

// --- status: read-only view of the current run (ADR-0002/0008) ---

test("status: no run in progress here -> exit 3, actionable message", () => {
  const result = run(["status"], { cwd: tmpdir() });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /^ERROR:/);
  assert.match(result.stderr, /does not search parent directories/);
  assert.match(result.stderr, /headsign start/);
});

test("status: running -> RUNNING <phase> (attempt n/max), workflow line, driver line, exit 0", () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 0.1
name: demo
entry: build
phases:
  build:
    description: "Build."
    gate:
      checks:
        - run: "false"
    on_pass: "$end"
    max_attempts: 3
`,
  );
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  const before = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(before.status, 0);
  assert.equal(
    before.stdout,
    `RUNNING build (attempt 0/3)\nworkflow: demo\ndriver: not delegated yet — no agent has claimed this run\nentered: ${readState(dir).phase_entered_at as string} — when this run last entered the phase above\n--- phase: build ---\nBuild.\n`,
  );

  run(["next"], { cwd: dir, env: NO_OBSERVER_ENV }); // real RETRY -> attempts.build = 1
  const after = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(after.status, 0);
  assert.match(after.stdout, /^RUNNING build \(attempt 1\/3\)\n/);
});

test("status: no max_attempts on the phase -> bare attempt number (no slash)", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW); // build has no max_attempts
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  const result = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.match(result.stdout, /^RUNNING build \(attempt 0\)\n/);
});

// The one case the phase-block feature must leave untouched byte-for-byte: description can't
// be resolved (same condition attemptUnknown already names), so there is nothing to place in
// the block and none is printed — pinned as the WHOLE line, not just a prefix, against the
// exact text `status` printed before the phase block existed.
test("status: an unreadable workflow.yaml degrades the attempt display to n/? without erroring, and the whole line is byte-identical to before the phase block existed", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  fs.rmSync(path.join(dir, ".headsign", "workflow.yaml"));

  const result = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, `RUNNING build (attempt 0/?)\nworkflow: demo\ndriver: not delegated yet — no agent has claimed this run\nentered: ${readState(dir).phase_entered_at as string} — when this run last entered the phase above\n`);
});

// Same pin, the other way a description fails to resolve: the workflow loads fine but no
// longer defines the phase the run is currently on — also byte-identical to before the phase
// block existed.
test("status: current phase no longer defined in a (readable) workflow.yaml also degrades to n/?", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV }); // state.phase = "build"
  writeWorkflow(
    dir,
    `
version: 0.1
name: demo
entry: otherphase
phases:
  otherphase:
    description: "Other."
    gate:
      checks:
        - run: "true"
    on_pass: "$end"
`,
  );

  const result = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, `RUNNING build (attempt 0/?)\nworkflow: demo\ndriver: not delegated yet — no agent has claimed this run\nentered: ${readState(dir).phase_entered_at as string} — when this run last entered the phase above\n`);
});

test("status: a matching last_failure renders a last-failure block with the failing check and output tail", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  run(["next"], { cwd: dir, env: NO_OBSERVER_ENV }); // real RETRY -> last_failure set for phase "build"

  const result = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  // The duration is real elapsed time (gate.ts's own clock), not a fixed value — assert the
  // shape (`in <n>s`) rather than a number that would make this test flaky.
  assert.match(result.stdout, /--- last failure: marker exists \(test -f marker\.txt, exit 1 in \d+(\.\d)?s\) ---\n/);
});

test("status: a last_failure belonging to a different (stale) phase than the current one is not shown", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  run(["next"], { cwd: dir, env: NO_OBSERVER_ENV }); // last_failure.phase = "build", state.phase = "build"

  // Not reachable via the normal engine flow (see engine.ts: last_failure is always cleared
  // on any phase change) — simulates a hand-edited/legacy state.json to pin the defensive
  // guard against misreading a stale failure as current.
  const st = readState(dir) as Record<string, unknown>;
  st.phase = "verify";
  fs.writeFileSync(path.join(dir, ".headsign", "state.json"), JSON.stringify(st));

  const result = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.doesNotMatch(result.stdout, /last failure/);
});

// The driver line is two-valued, and it answers exactly one question: did the claim
// handshake land? That handshake is two beats (`headsign claim`, then the agent's own turn
// end), so it can fail quietly, and one `headsign status` is how anyone checks.
test("status: the driver line is two-valued — undelegated before a claim, a delegated agent after it", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });

  const before = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.match(before.stdout, /driver: not delegated yet — no agent has claimed this run\n/);

  // A `claim` on its own is only the first beat: nothing is sealed until the claiming
  // agent's own turn end, so the line must not change yet.
  run(["claim"], { cwd: dir });
  const armed = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.match(armed.stdout, /driver: not delegated yet — no agent has claimed this run\n/);

  run(["subagent-stop-hook"], { cwd: dir, input: JSON.stringify({ agent_id: "agent-alpha" }), env: NO_OBSERVER_ENV });
  const after = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.match(after.stdout, /driver: a delegated agent\n/);
  assert.doesNotMatch(after.stdout, /agent-alpha/, "the recorded agent id is never printed");
});

test("status: a state.json still carrying the pre-rename driver_session field reads as undelegated, rather than crashing", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  const legacy = readState(dir) as Record<string, unknown>;
  delete legacy.driver_agent;
  legacy.driver_session = "session-mine";
  legacy.driver_source = "env";
  fs.writeFileSync(path.join(dir, ".headsign", "state.json"), JSON.stringify(legacy));

  const result = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /driver: not delegated yet — no agent has claimed this run\n/);
  assert.doesNotMatch(result.stdout, /session-mine/);
});

// --- status: what happened at the last stop (the quiet-stop diagnostic) ---
//
// The whole point of the field: a turn end that passed because Claude Code had already resumed
// the turn used to leave no trace anywhere, so a driver could not tell "the hook ran and stood
// down" from "the hook is not installed". These walk the diagnostic end to end, through the same
// two commands a person would actually run.

test("status: a turn end that Claude Code had already resumed leaves both an unheld log line and a last-stop line, and the two carry the same timestamp", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });

  const passed = run(["stop-hook"], { cwd: dir, input: JSON.stringify({ cwd: dir, stop_hook_active: true }), env: NO_OBSERVER_ENV });
  assert.equal(passed.status, 0, "a flagged turn end is never blocked");
  assert.equal(passed.stderr, "", "and nothing is said to the agent about it");

  const unheld = readLog(dir).filter((l) => l.includes(" unheld "));
  assert.equal(unheld.length, 1);
  assert.match(unheld[0], /^\S+ unheld build a=0 i=0 by=stop_hook_active$/);
  const at = unheld[0].split(" ")[0];

  // Same event, two representations, one locked write: the line and the field cannot disagree.
  const result = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(result.status, 0);
  assert.equal(
    result.stdout,
    `RUNNING build (attempt 0)\nworkflow: demo\ndriver: not delegated yet — no agent has claimed this run\n` +
      `last stop: not held — Claude Code had already resumed the turn (stop_hook_active) — at ${at}\n` +
      `entered: ${readState(dir).phase_entered_at as string} — when this run last entered the phase above\n` +
      `--- phase: build ---\nBuild the thing.\n`,
  );
});

// The counterpart claim the documentation makes: a nudge is not silent in the record or the log,
// so the field never reads "not held" about a stop that was in fact held, and the two agree.
test("status: a held turn end updates the last-stop line, so a later stop never reads as an earlier pass", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });

  run(["stop-hook"], { cwd: dir, input: JSON.stringify({ cwd: dir, stop_hook_active: true }), env: NO_OBSERVER_ENV });
  assert.match(run(["status"], { cwd: dir, env: NO_OBSERVER_ENV }).stdout, /^last stop: not held — Claude Code had already resumed the turn \(stop_hook_active\) — at \S+$/m);

  const nudged = run(["stop-hook"], { cwd: dir, input: JSON.stringify({ cwd: dir }), env: NO_OBSERVER_ENV });
  assert.equal(nudged.status, 2, "an unflagged turn end on an unclaimed run is still held");
  assert.match(run(["status"], { cwd: dir, env: NO_OBSERVER_ENV }).stdout, /^last stop: held, and pointed back to headsign next — at \S+$/m);
  assert.equal(readState(dir).stop_nudges, 1);
  assert.match(readLog(dir).at(-1) as string, /^\S+ held build a=0 i=0 nudges=1$/, "the same stop is a held line carrying the count the field was just given");
});

// The transitional half of the field's tolerance (state.ts's driver_agent declaration carries the
// criterion for dropping it): a run already in progress across the release that added the field
// has no field at all, and must print exactly what it printed before the field existed.
test("status: a record with no last_stop at all prints byte-identical output to before the field existed", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  const withField = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV }).stdout;

  const legacy = readState(dir) as Record<string, unknown>;
  delete legacy.last_stop;
  fs.writeFileSync(path.join(dir, ".headsign", "state.json"), JSON.stringify(legacy));

  const withoutField = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(withoutField.status, 0);
  assert.equal(withoutField.stdout, withField);
  assert.doesNotMatch(withoutField.stdout, /last stop:/);
});

// The permanent half: a hand-edited record is always possible, and `status` is the one command
// whose whole promise is that it is safe to run while diagnosing — so a malformed value reads as
// "nothing to report" rather than crashing the command someone is diagnosing WITH.
test("status: a malformed last_stop is read as absent rather than crashing, whatever shape the damage takes", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });

  for (const damaged of ["not an object", 42, [], {}, { disposition: "unheld" }, { at: "T" }, { disposition: "vanished", at: "T" }, { disposition: "unheld", at: 5 }]) {
    const st = readState(dir) as Record<string, unknown>;
    st.last_stop = damaged;
    fs.writeFileSync(path.join(dir, ".headsign", "state.json"), JSON.stringify(st));

    const result = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
    assert.equal(result.status, 0, `last_stop = ${JSON.stringify(damaged)} must not break status`);
    assert.doesNotMatch(result.stdout, /last stop:/, `last_stop = ${JSON.stringify(damaged)} must print no line`);
    assert.match(result.stdout, /^RUNNING build \(attempt 0\)\n/);
  }
});

// --- status: the last stop's note ---
//
// The motivating case: a run left `running` for days behind an unpassable gate, with only a
// pause note to say whether that was intended. `.headsign/log`'s `paused` line carries the
// note, but `status` does not read the log — this is the same fact, read from state.json.

test("status: a paused stop's note appears on its own line under `last stop:`, so a later reader can tell an intended pause from a stuck run", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });

  writeStopNote(dir, "handing off to review, resume after CI");
  const paused = run(["stop-hook"], { cwd: dir, input: JSON.stringify({ cwd: dir }), env: NO_OBSERVER_ENV });
  assert.equal(paused.status, 0);

  const result = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^last stop: paused by a note — at \S+$/m);
  assert.match(result.stdout, /^note: handing off to review, resume after CI$/m);
});

test("status: a paused stop's note is truncated to 120 chars plus an ellipsis, the same rule the log line's is", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });

  writeStopNote(dir, "x".repeat(200));
  run(["stop-hook"], { cwd: dir, input: JSON.stringify({ cwd: dir }), env: NO_OBSERVER_ENV });

  const result = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.match(result.stdout, new RegExp(`^note: ${"x".repeat(120)}…$`, "m"));
});

// The transitional half of the field's tolerance, same criterion as `last_stop` itself: a
// record written before `note` existed simply lacks it, and must print exactly what it printed
// before the field existed — no blank or undefined-looking line.
test("status: a paused disposition with no note (a record predating the field) prints byte-identical output to before the note line existed", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });

  const st = readState(dir) as Record<string, unknown>;
  st.last_stop = { disposition: "paused", at: "2026-08-14T00:00:00+09:00" };
  fs.writeFileSync(path.join(dir, ".headsign", "state.json"), JSON.stringify(st));

  const result = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^last stop: paused by a note — at 2026-08-14T00:00:00\+09:00$/m);
  assert.doesNotMatch(result.stdout, /\nnote:/);
});

// --- status: last moved (ADR-0027 §7) ---

test("status: a run with no last_drive prints byte-identical output to before this line existed, and never a 'last moved:' line", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  // NO_OBSERVER_ENV strips CLAUDE_CODE_SESSION_ID too (ADR-0027), so `start` here stamps
  // nothing: exactly the run this test needs.
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });

  const result = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(result.status, 0);
  assert.equal(
    result.stdout,
    `RUNNING build (attempt 0)\nworkflow: demo\ndriver: not delegated yet — no agent has claimed this run\nentered: ${readState(dir).phase_entered_at as string} — when this run last entered the phase above\n--- phase: build ---\nBuild the thing.\n`,
  );
  assert.doesNotMatch(result.stdout, /last moved:/);
});

test("status: a run with a last_drive stamp prints the exact 'last moved:' line, right after 'last stop:' and before the graph lines", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: { ...NO_OBSERVER_ENV, CLAUDE_CODE_SESSION_ID: "session-alpha" } });
  run(["stop-hook"], { cwd: dir, input: JSON.stringify({ cwd: dir, session_id: "session-alpha" }), env: NO_OBSERVER_ENV }); // a real nudge, for last stop: too

  const result = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(result.status, 0);
  const at = readState(dir).last_drive as { session: string; at: string };
  assert.equal(typeof at.at, "string");
  assert.equal(
    result.stdout,
    "RUNNING build (attempt 0)\nworkflow: demo\ndriver: not delegated yet — no agent has claimed this run\n" +
      `last stop: held, and pointed back to headsign next — at ${(readState(dir).last_stop as { at: string }).at}\n` +
      `last moved: ${at.at} — turn ends from any other session pass without a nudge\n` +
      `entered: ${readState(dir).phase_entered_at as string} — when this run last entered the phase above\n` +
      `--- phase: build ---\nBuild the thing.\n`,
  );
});

test("status: the run's session id never appears in the output, even though last_drive holds one", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  const sessionId = "session-should-not-print-me";
  run(["start"], { cwd: dir, env: { ...NO_OBSERVER_ENV, CLAUDE_CODE_SESSION_ID: sessionId } });

  const result = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /last moved:/);
  assert.doesNotMatch(result.stdout, new RegExp(sessionId));
});

// The only quiet-ending cause a caller can answer ABOUT ITSELF: no identifier to resolve, just
// the environment the command was run in. Which is also the limit — what is read is the
// environment of the process `status` runs in, normally the session's but not necessarily.
test("status: the observer line prints only when HEADSIGN_OBSERVER is set in the calling environment", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });

  const optedIn = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.doesNotMatch(optedIn.stdout, /observer:/);

  const observing = run(["status"], { cwd: dir, env: { ...NO_OBSERVER_ENV, HEADSIGN_OBSERVER: "1" } });
  assert.equal(observing.status, 0);
  assert.match(observing.stdout, /^observer: HEADSIGN_OBSERVER is set here — turn ends from this environment are never held$/m);
  // Any non-empty value is the whole signal (ADR-0008), and `status` must report the switch on
  // exactly the values the hooks honour.
  assert.match(run(["status"], { cwd: dir, env: { ...NO_OBSERVER_ENV, HEADSIGN_OBSERVER: "0" } }).stdout, /^observer: /m);
  assert.doesNotMatch(run(["status"], { cwd: dir, env: { ...NO_OBSERVER_ENV, HEADSIGN_OBSERVER: "" } }).stdout, /observer:/);
});

// The hook's observer path stays a complete no-op, so the two lines answer different questions:
// the observer line says turn ends from HERE are never held, and there is no last stop to report
// because nothing was ever recorded from this environment.
test("status: an observing environment's own turn ends leave no last stop to report", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  const observerEnv = { ...NO_OBSERVER_ENV, HEADSIGN_OBSERVER: "1" };

  const passed = run(["stop-hook"], { cwd: dir, input: JSON.stringify({ cwd: dir, stop_hook_active: true }), env: observerEnv });
  assert.equal(passed.status, 0);

  const result = run(["status"], { cwd: dir, env: observerEnv });
  assert.doesNotMatch(result.stdout, /last stop:/, "an opted-out session's turn end is not this run's business");
  assert.match(result.stdout, /^observer: /m);
  assert.deepEqual(readLog(dir).filter((l) => l.includes(" unheld ")), []);
});

// --- the graph pin, end to end through the CLI (ADR-0016 §5, ADR-0017) ---
//
// A run may rewrite the workflow it is walking; what it may not do is have that pass
// unmentioned. These two pin the whole path — verdict, exit code, `status`, and the line
// COMPLETE ends with — because every module in it is allowed to be right on its own while the
// wiring between them drops the fact.

// Same two phases as TWO_PHASE_WORKFLOW, with `build`'s gate loosened from a real file check
// to one that cannot fail: exactly the edit that is indistinguishable, without a pin, from the
// ceiling-raising ADR-0017 recommends.
const TWO_PHASE_WORKFLOW_LOOSENED = TWO_PHASE_WORKFLOW.replace(`run: "test -f marker.txt"`, `run: "true"`);

test("next: a change to the current phase's rules mid-run escalates without ending the run, repeats on a bare `next`, and only --accept-graph-change accepts it", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  writeWorkflow(dir, TWO_PHASE_WORKFLOW_LOOSENED);

  const escalated = run(["next"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(escalated.status, 2);
  assert.match(escalated.stdout, /^ESCALATE build: the workflow's rules changed under this run \(phase 'build'\) — the run is still open and nothing was counted: /);
  assert.match(escalated.stdout, /run `headsign next --accept-graph-change` to accept the change and continue/);
  assert.equal(readState(dir).status, "running", "an ESCALATE that ends nothing");

  // The bug this flag exists to fix: a second, then a third, bare `next` must escalate again —
  // never accept the change just by being asked again.
  const escalatedAgain = run(["next"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(escalatedAgain.status, 2);
  assert.match(escalatedAgain.stdout, /^ESCALATE build:/);
  const escalatedYetAgain = run(["next"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(escalatedYetAgain.status, 2);
  assert.equal(readState(dir).accepted_graph_changes, 0, "three bare laps have accepted nothing");
  assert.equal(readState(dir).total_iterations, 0, "and spent no iteration");

  const asking = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(asking.status, 0);
  assert.match(asking.stdout, /^graph: changed since this run accepted it — restore the file, or `headsign next --accept-graph-change` to accept$/m);
  assert.doesNotMatch(asking.stdout, /accepted change/, "nothing is counted until it is accepted");

  const accepting = run(["next", "--accept-graph-change"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(accepting.status, 0);
  assert.match(accepting.stdout, /^ADVANCE verify\n/, "the accepted gate ran in the accepting lap");

  const after = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.match(after.stdout, /^graph: 1 accepted change to the workflow's rules during this run$/m);
  assert.doesNotMatch(after.stdout, /changed since this run accepted it/);
  assert.deepEqual(
    readLog(dir).filter((l) => l.includes(" graph-changed ")).map((l) => l.split(" ").slice(-2).join(" ")),
    ["state=reported phases=build", "state=reported phases=build", "state=reported phases=build", "state=accepted phases=build"],
  );
});

test("status: the two graph lines a run's own record cannot hold, end to end (ADR-0029)", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });

  // A file edited with no lap run leaves nothing in the record, so this line is computed from
  // the file each time `status` is called. It is the question a read-only viewer of a run has
  // to ask before it can trust the picture it draws: is the file on disk the graph this run
  // pinned? Answering it from timestamps is what these lines exist to replace.
  const edited = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(edited.status, 0, "looking is free, whatever the file says");
  assert.doesNotMatch(edited.stdout, /^graph:/m, "an unedited file says nothing");
  writeWorkflow(dir, TWO_PHASE_WORKFLOW_LOOSENED);
  const changed = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.match(changed.stdout, /^graph: the file no longer matches the rules this run pinned — `headsign next` will report it before it runs the gate$/m);
  assert.equal(readState(dir).status, "running", "and it judged nothing to say so");

  // Restoring the file while a report stands: the standing question keeps its line, and the
  // answer sits under it. Both are true at once, which is why the two print together.
  run(["next"], { cwd: dir, env: NO_OBSERVER_ENV });
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  const restored = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.match(restored.stdout, /^graph: changed since this run accepted it — restore the file, or `headsign next --accept-graph-change` to accept$/m);
  assert.match(restored.stdout, /^graph: the file matches the rules this run pinned again — `headsign next` will clear the line above and cost nothing$/m);
});

// The flag's own guard, exercised end to end: a habitually-attached flag must be visibly wrong
// (exit 3), not a quiet no-op that teaches a caller it is always safe to include.
test("next: --accept-graph-change with nothing reported refuses with exit 3, and leaves the run untouched", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  const before = readLog(dir);

  const refused = run(["next", "--accept-graph-change"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(refused.status, 3);
  assert.match(refused.stderr, /^ERROR: --accept-graph-change was given, but there is no reported graph change to accept right now\./);
  assert.equal(readState(dir).status, "running", "a refused flag leaves the run exactly where it was");
  assert.deepEqual(readLog(dir), before, "and writes no log line");
});

test("next: --accept-graph-change refuses a change other than the one that was reported", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  writeWorkflow(dir, TWO_PHASE_WORKFLOW_LOOSENED);
  run(["next"], { cwd: dir, env: NO_OBSERVER_ENV });

  // The flag accepts the change a person was shown, and this edit is a third state: the file
  // now differs from the pin AND from what the report named. Accepting here would wave through
  // rules nobody read, which is the whole thing the two-beat handshake is for.
  writeWorkflow(dir, TWO_PHASE_WORKFLOW_LOOSENED.replace(`run: "true"`, `run: "test -f other.txt"`));
  const refused = run(["next", "--accept-graph-change"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(refused.status, 3);
  assert.match(refused.stderr, /^ERROR: --accept-graph-change was given, but there is no reported graph change to accept right now\./);
  assert.equal(readState(dir).status, "running", "and the run stands where it stood");

  // The bare lap reports the new state, which is the beat the flag was asking to skip.
  const reported = run(["next"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(reported.status, 2);
  assert.match(reported.stdout, /^ESCALATE build: the workflow's rules changed under this run/);
});

test("next: COMPLETE names how many changes the run accepted to its own rules, and says nothing when there were none", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  writeWorkflow(dir, TWO_PHASE_WORKFLOW_LOOSENED);
  run(["next"], { cwd: dir, env: NO_OBSERVER_ENV }); // ESCALATE: the change is reported
  run(["next", "--accept-graph-change"], { cwd: dir, env: NO_OBSERVER_ENV }); // accepted, then ADVANCE verify

  const done = run(["next"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(done.status, 0);
  assert.equal(done.stdout, `COMPLETE\nWorkflow 'demo' finished.\nThis run accepted 1 change to its own workflow rules while it was running.\n`);

  const untouched = initRepo();
  writeWorkflow(untouched, TWO_PHASE_WORKFLOW_LOOSENED);
  run(["start"], { cwd: untouched, env: NO_OBSERVER_ENV });
  run(["next"], { cwd: untouched, env: NO_OBSERVER_ENV }); // ADVANCE verify
  const plain = run(["next"], { cwd: untouched, env: NO_OBSERVER_ENV });
  assert.equal(plain.stdout, `COMPLETE\nWorkflow 'demo' finished.\n`, "a run that changed nothing prints what it always printed");
});

test("status: complete -> COMPLETE token, workflow line, no reason line, exit 0", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  fs.writeFileSync(path.join(dir, "marker.txt"), "");
  run(["next"], { cwd: dir, env: NO_OBSERVER_ENV }); // ADVANCE
  run(["next"], { cwd: dir, env: NO_OBSERVER_ENV }); // COMPLETE

  const result = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, `COMPLETE\nworkflow: demo\n`);
});

test("status: escalated -> ESCALATED token with reason line, exit 0 (not next's exit 2)", () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 0.1
name: demo
entry: build
phases:
  build:
    description: "Build."
    gate:
      checks:
        - run: "exit 1"
    on_pass: "$end"
    on_fail: escalate
`,
  );
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  run(["next"], { cwd: dir, env: NO_OBSERVER_ENV }); // ESCALATE

  const result = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^ESCALATED\nworkflow: demo\nreason: /);
});

test("status: aborted -> ABORTED token with reason line, exit 0", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  run(["abort", "changed", "my", "mind"], { cwd: dir, env: NO_OBSERVER_ENV });

  const result = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, `ABORTED\nworkflow: demo\nreason: changed my mind\n`);
});

// A finished run has no "current phase" to instruct anyone about — the phase block is a
// RUNNING-only line, and all three terminal statuses above already pin their full output
// bytewise with no such block. This test names the constraint directly, across all three.
test("status: no terminal status (complete/escalated/aborted) ever prints the phase block", () => {
  for (const stdout of [
    (() => {
      const dir = initRepo();
      writeWorkflow(dir, TWO_PHASE_WORKFLOW);
      run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
      fs.writeFileSync(path.join(dir, "marker.txt"), "");
      run(["next"], { cwd: dir, env: NO_OBSERVER_ENV }); // ADVANCE
      run(["next"], { cwd: dir, env: NO_OBSERVER_ENV }); // COMPLETE
      return run(["status"], { cwd: dir, env: NO_OBSERVER_ENV }).stdout;
    })(),
    (() => {
      const dir = initRepo();
      writeWorkflow(dir, TWO_PHASE_WORKFLOW);
      run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
      run(["abort", "changed", "my", "mind"], { cwd: dir, env: NO_OBSERVER_ENV });
      return run(["status"], { cwd: dir, env: NO_OBSERVER_ENV }).stdout;
    })(),
    (() => {
      const dir = initRepo();
      writeWorkflow(
        dir,
        `
version: 0.1
name: demo
entry: build
phases:
  build:
    description: "Build."
    gate:
      checks:
        - run: "exit 1"
    on_pass: "$end"
    on_fail: escalate
`,
      );
      run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
      run(["next"], { cwd: dir, env: NO_OBSERVER_ENV }); // ESCALATE
      return run(["status"], { cwd: dir, env: NO_OBSERVER_ENV }).stdout;
    })(),
  ]) {
    assert.doesNotMatch(stdout, /--- phase:/);
  }
});

test("status: read-only — state.json bytes are identical before and after, and it never acquires the lock", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  run(["next"], { cwd: dir, env: NO_OBSERVER_ENV }); // real RETRY, gives status something to show

  const before = fs.readFileSync(path.join(dir, ".headsign", "state.json"));
  const result = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(result.status, 0);
  const after = fs.readFileSync(path.join(dir, ".headsign", "state.json"));
  assert.deepEqual(after, before);
  assert.equal(fs.existsSync(path.join(dir, ".headsign", "lock")), false, "status must never acquire the lock");
});

test("status: never executes the ready probe or the gate", () => {
  const dir = initRepo();
  const readyMarker = path.join(dir, ".headsign", "tmp", "ready.marker");
  const gateMarker = path.join(dir, ".headsign", "tmp", "gate.marker");
  writeWorkflow(
    dir,
    `
version: 0.1
name: demo
entry: review
phases:
  review:
    description: "Review."
    ready: "touch ${readyMarker} && test -f .headsign/tmp/verdict"
    gate:
      checks:
        - run: "touch ${gateMarker} && grep -qx APPROVED .headsign/tmp/verdict"
    on_pass: "$end"
`,
  );
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });

  const result = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^RUNNING review/);
  assert.equal(fs.existsSync(readyMarker), false, "status must never execute the ready probe");
  assert.equal(fs.existsSync(gateMarker), false, "status must never execute the gate");
});

// --- git worktrees: 1 worktree = 1 independent run (cwd-only state, ADR-0004) ---

test("worktree: 1 worktree = 1 independent run — a linked worktree drives start -> RETRY -> fix -> COMPLETE entirely in its own .headsign, leaving the main checkout's run untouched", () => {
  const base = tmpdir();
  const main = path.join(base, "main");
  fs.mkdirSync(main);
  execFileSync("git", ["init", "-q"], { cwd: main });
  execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=test", "commit", "-q", "-m", "init", "--allow-empty"], { cwd: main });

  // The main checkout carries a run of its own, so "independent" is asserted against a
  // live neighbor rather than against an empty directory.
  writeWorkflow(main, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: main });
  const mainStateBefore = fs.readFileSync(path.join(main, ".headsign", "state.json"));
  const mainLogBefore = fs.readFileSync(path.join(main, ".headsign", "log"));

  const wt = path.join(base, "wt");
  execFileSync("git", ["worktree", "add", "-b", "wt-branch", wt], { cwd: main });
  assert.ok(fs.statSync(path.join(wt, ".git")).isFile(), "linked worktree's .git must be a file, not a directory");

  // A live lock in the main checkout must not block the worktree: locks are per-.headsign,
  // and the test runner's own pid is alive, so a shared lock path would refuse `next`.
  fs.writeFileSync(path.join(main, ".headsign", "lock"), String(process.pid));

  writeWorkflow(wt, TWO_PHASE_WORKFLOW);
  const started = run(["start"], { cwd: wt });
  assert.equal(started.status, 0);
  assert.match(started.stdout, /^START build\n/);

  const retry = run(["next"], { cwd: wt });
  assert.equal(retry.status, 1);
  assert.match(retry.stdout, /^RETRY 1 build\n/);

  fs.writeFileSync(path.join(wt, "marker.txt"), "");
  const advance = run(["next"], { cwd: wt });
  assert.equal(advance.status, 0);
  assert.match(advance.stdout, /^ADVANCE verify\n/);

  const complete = run(["next"], { cwd: wt });
  assert.equal(complete.status, 0);
  assert.match(complete.stdout, /^COMPLETE\n/);

  // The worktree's run state lives in the worktree's own .headsign, and nowhere else.
  assert.equal(readState(wt).status, "complete");
  assert.ok(readLog(wt).length > 0);
  assert.equal(fs.existsSync(path.join(wt, ".headsign", "lock")), false, "the worktree's lock is released in its own .headsign");
  assert.equal(fs.existsSync(path.join(main, ".git", ".headsign")), false, "nothing may be written under the shared .git");
  assert.equal(fs.existsSync(path.join(main, ".git", "worktrees", "wt", ".headsign")), false, "nothing may be written under the shared .git");

  // The main checkout's run is byte-for-byte untouched, and its lock still belongs to it.
  assert.deepEqual(fs.readFileSync(path.join(main, ".headsign", "state.json")), mainStateBefore);
  assert.deepEqual(fs.readFileSync(path.join(main, ".headsign", "log")), mainLogBefore);
  assert.equal(readState(main).status, "running");
  assert.equal(readState(main).phase, "build");
  assert.equal(fs.readFileSync(path.join(main, ".headsign", "lock"), "utf8"), String(process.pid));

  // …and the main checkout can still be driven afterwards, from its own state.
  fs.unlinkSync(path.join(main, ".headsign", "lock"));
  const mainRetry = run(["next"], { cwd: main });
  assert.equal(mainRetry.status, 1);
  assert.match(mainRetry.stdout, /^RETRY 1 build\n/, "the main run advances on its own attempt counter, unaffected by the worktree's completed run");
});

// --- help: status is documented among the command surface ---

test("--help lists the status command and its RUNNING/COMPLETE/ESCALATED/ABORTED vocabulary", () => {
  const result = run(["--help"], { cwd: tmpdir() });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /headsign status/);
  assert.match(result.stdout, /RUNNING/);
  assert.match(result.stdout, /COMPLETE/);
  assert.match(result.stdout, /ESCALATED/);
  assert.match(result.stdout, /ABORTED/);
});

// --- k-way on_pass: routing a pass by `when:` predicates (ADR-0011) ---

// Three destinations behind one gate. The `route` file stands in for whatever the agent
// wrote down during the phase; the gate proves it says something legible, and the `when:`
// predicates read it to pick an edge that was declared here, in the workflow.
const ROUTER_WORKFLOW = `
version: 0.1
name: router
entry: classify
phases:
  classify:
    description: "Classify the request."
    gate:
      checks:
        - name: "route recorded"
          run: "test -s route"
    on_pass:
      - when: "grep -qx docs route"
        to: write-docs
      - when: "grep -qx bug route"
        to: fix-bug
      - to: implement
  write-docs:
    description: "Write the docs."
    gate:
      checks:
        - run: "true"
    on_pass: "$end"
  fix-bug:
    description: "Fix the bug."
    gate:
      checks:
        - run: "true"
    on_pass: "$end"
  implement:
    description: "Implement it."
    gate:
      checks:
        - run: "true"
    on_pass: "$end"
`;

function startRouterRun(route: string, workflow = ROUTER_WORKFLOW): string {
  const dir = initRepo();
  writeWorkflow(dir, workflow);
  fs.writeFileSync(path.join(dir, "route"), `${route}\n`);
  const started = run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(started.status, 0);
  return dir;
}

test("routing: the first matching when takes the pass, and one routed line names it", () => {
  const dir = startRouterRun("docs");
  const result = run(["next"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(result.status, 0);
  assert.equal(
    result.stdout,
    `ADVANCE write-docs\n--- routed: when "grep -qx docs route" → write-docs ---\n--- phase: write-docs ---\nWrite the docs.\n`,
  );
  assert.equal(readState(dir).phase, "write-docs");
  assert.match(readLog(dir).at(-1)!, /advance write-docs a=0 i=1 from=classify routed-when="grep -qx docs route"$/);
});

test("routing: a later when takes the pass when the earlier one does not match", () => {
  const dir = startRouterRun("bug");
  const result = run(["next"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^ADVANCE fix-bug\n--- routed: when "grep -qx bug route" → fix-bug ---\n/);
  assert.equal(readState(dir).phase, "fix-bug");
  assert.match(readLog(dir).at(-1)!, /routed-when="grep -qx bug route"$/);
});

test("routing: nothing matching falls to the last entry, announced as the default", () => {
  const dir = startRouterRun("something-else");
  const result = run(["next"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^ADVANCE implement\n--- routed: default → implement ---\n/);
  assert.equal(readState(dir).phase, "implement");
  assert.match(readLog(dir).at(-1)!, /advance implement a=0 i=1 from=classify routed-default$/);
});

test("routing: a routed run reaches COMPLETE through the branch it picked", () => {
  const dir = startRouterRun("docs");
  run(["next"], { cwd: dir, env: NO_OBSERVER_ENV });
  const done = run(["next"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(done.status, 0);
  assert.match(done.stdout, /^COMPLETE\n/);
  assert.equal(readState(dir).status, "complete");
});

test("routing: a route whose 'to' is $end completes the run", () => {
  const dir = startRouterRun(
    "done",
    `
version: 0.1
name: router-end
entry: classify
phases:
  classify:
    description: "Classify."
    gate:
      checks:
        - run: "test -s route"
    on_pass:
      - when: "grep -qx done route"
        to: "$end"
      - to: implement
  implement:
    description: "Implement it."
    gate:
      checks:
        - run: "true"
    on_pass: "$end"
`,
  );
  const result = run(["next"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^COMPLETE\n/);
  assert.equal(readState(dir).status, "complete");
});

test("routing: the branch costs no attempt — the pass cleared the counter, same as any pass", () => {
  const dir = initRepo();
  writeWorkflow(dir, ROUTER_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });

  // Two real failures first, so there is an attempt count that routing could plausibly touch.
  assert.equal(run(["next"], { cwd: dir, env: NO_OBSERVER_ENV }).status, 1);
  assert.equal(run(["next"], { cwd: dir, env: NO_OBSERVER_ENV }).status, 1);
  assert.equal((readState(dir).attempts as Record<string, number>).classify, 2);

  fs.writeFileSync(path.join(dir, "route"), "docs\n");
  const routed = run(["next"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(routed.status, 0);
  assert.deepEqual(readState(dir).attempts, {}, "a routed pass clears attempts like any other pass");
});

test("routing: a failing gate never evaluates a when — the fail path is untouched by branching", () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 0.1
name: router-fail
entry: classify
phases:
  classify:
    description: "Classify."
    gate:
      checks:
        - name: "route recorded"
          run: "test -s route"
    on_pass:
      - when: "touch when-ran && grep -qx docs route"
        to: write-docs
      - to: implement
  write-docs:
    description: "Write the docs."
    gate:
      checks:
        - run: "true"
    on_pass: "$end"
  implement:
    description: "Implement it."
    gate:
      checks:
        - run: "true"
    on_pass: "$end"
`,
  );
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });

  const failed = run(["next"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /^RETRY 1 classify\n/);
  assert.doesNotMatch(failed.stdout, /routed:/);
  assert.equal(fs.existsSync(path.join(dir, "when-ran")), false, "no when: may run on the failure path");
  assert.equal(readState(dir).phase, "classify");
});

test("routing: a when that cannot be evaluated stops the run at exit 3 and moves nothing", () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 0.1
name: router-broken
entry: classify
phases:
  classify:
    description: "Classify."
    gate:
      checks:
        - run: "true"
    on_pass:
      - when: "sleep 5"
        timeout: 0.2
        to: write-docs
      - to: implement
  write-docs:
    description: "Write the docs."
    gate:
      checks:
        - run: "true"
    on_pass: "$end"
  implement:
    description: "Implement it."
    gate:
      checks:
        - run: "true"
    on_pass: "$end"
`,
  );
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  const stateBefore = fs.readFileSync(path.join(dir, ".headsign", "state.json"));
  const logBefore = fs.readFileSync(path.join(dir, ".headsign", "log"));

  const result = run(["next"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /could not evaluate the on_pass condition `sleep 5`/);
  assert.match(result.stderr, /timed out after 0.2s/);
  assert.match(result.stderr, /The run has not moved\./);
  assert.equal(result.stdout, "", "a configuration error says nothing on stdout");

  assert.deepEqual(fs.readFileSync(path.join(dir, ".headsign", "state.json")), stateBefore, "state.json must be byte-identical");
  assert.deepEqual(fs.readFileSync(path.join(dir, ".headsign", "log")), logBefore, "no transition happened, so nothing is logged");
  assert.equal(fs.existsSync(path.join(dir, ".headsign", "lock")), false, "the lock is released before exiting");
});

test("routing: a string on_pass is unchanged — no routed line on stdout, no routed detail in the log", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  fs.writeFileSync(path.join(dir, "marker.txt"), "");

  const result = run(["next"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, `ADVANCE verify\n--- phase: verify ---\nVerify the thing.\n`);
  assert.doesNotMatch(result.stdout, /routed/);
  assert.match(readLog(dir).at(-1)!, /advance verify a=0 i=1 from=build$/);
});

// --- unreachable phases: a warning now, not an error (ADR-0011) ---

const UNREACHABLE_WORKFLOW = `
version: 0.1
name: has-orphan
entry: build
phases:
  build:
    description: "Build the thing."
    gate:
      checks:
        - run: "true"
    on_pass: "$end"
  draft:
    description: "A phase nothing points at yet."
    gate:
      checks:
        - run: "true"
    on_pass: "$end"
`;

test("an unreachable phase no longer blocks validate: exit 0, warning on stderr", () => {
  const dir = initRepo();
  writeWorkflow(dir, UNREACHABLE_WORKFLOW);
  const result = run(["validate"], { cwd: dir });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^OK: workflow 'has-orphan' \(2 phases\)\n$/);
  assert.equal(result.stderr, `WARNING: .headsign/workflow.yaml\n- phase 'draft' is unreachable from entry 'build'\n`);
});

test("an unreachable phase no longer blocks a run: start works and says so once", () => {
  const dir = initRepo();
  writeWorkflow(dir, UNREACHABLE_WORKFLOW);
  const started = run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(started.status, 0);
  assert.match(started.stdout, /^START build\n/);
  assert.match(started.stderr, /phase 'draft' is unreachable from entry 'build'/);
  assert.equal(readState(dir).phase, "build");
});

test("next stays quiet about warnings: the loop's hot path prints none", () => {
  const dir = initRepo();
  writeWorkflow(dir, UNREACHABLE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  const result = run(["next"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^COMPLETE\n/);
  // Not silent any more — `build`'s one-check gate writes its own progress lines (ADR-0032) —
  // but a WARNING is still absent: this test's point is the warning, not the progress lines a
  // dedicated test covers elsewhere.
  assert.match(result.stderr, /^--- gate: 1 check ---\n--- check 1\/1 passed: true \(\d+(\.\d+)?s\) ---\n$/);
  assert.doesNotMatch(result.stderr, /WARNING/);
});

test("a real error still fails validate, and is not softened into a warning", () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 0.1
name: broken
entry: build
phases:
  build:
    description: "Build the thing."
    gate:
      checks:
        - run: "true"
    on_pass: nowhere
`,
  );
  const result = run(["validate"], { cwd: dir });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /^INVALID: /);
  assert.match(result.stderr, /on_pass 'nowhere' does not name a defined phase or '\$end'/);
});

// --- every refusal of the five commands that moved into engine.ts (ADR-0018) ---
//
// One test per refusal `start` / `next` / `abort` / `claim` / `status` can produce, each
// asserting the WHOLE `ERROR: …` line, an empty stdout, and exit 3. Whole line and exit code
// together, because the two fail apart: until ADR-0018 each of these was an `errorExit` inside
// the command's own body, and now it is a value the command returns for a switch in cli.ts to
// map back. A refusal that never reaches that switch prints its message and exits 0 — the
// message assertions alone would pass, and every script that reads the status would be lied
// to. The compiler holds the mapping (a missed arm makes a `never`-returning function's end
// reachable); these tests hold the words and the code the mapping produces.
//
// Not covered here, for stated reasons: `next`'s "the run ended while acquiring the lock"
// needs state.json to vanish inside the window between the pre-lock read and the acquire,
// which no CLI-level test can arrange; and the on_pass-resolution refusal has its own test
// above ("routing: a when that cannot be evaluated…"), which already asserts the message, the
// untouched state, and the released lock.

const NO_RUN_HERE_LINE =
  "ERROR: no run in progress here. headsign uses the .headsign/ directory in the current directory and does not search parent directories — " +
  "run it from the directory that owns the workflow (usually the repo or git-worktree root). To begin one here, run `headsign start`.\n";

const SOLO_WORKFLOW = `
version: 0.1
name: solo
entry: only
phases:
  only:
    description: "Do the thing."
    gate:
      checks:
        - run: "true"
    on_pass: "$end"
`;

test("refusal: start with a run already in progress -> whole ERROR line, nothing on stdout, exit 3", () => {
  const dir = initRepo();
  writeWorkflow(dir, SOLO_WORKFLOW);
  run(["start"], { cwd: dir });

  const result = run(["start"], { cwd: dir });
  assert.equal(result.status, 3);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    "ERROR: a headsign run is already in progress (phase: only). Run `headsign next` to continue, or `headsign abort` to stop it.\n",
  );
});

test("refusal: next with no run here -> whole ERROR line, nothing on stdout, exit 3", () => {
  const result = run(["next"], { cwd: tmpdir() });
  assert.equal(result.status, 3);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, NO_RUN_HERE_LINE);
});

test("refusal: next when the lock is held by a live process -> whole ERROR line, nothing on stdout, exit 3", () => {
  const dir = initRepo();
  writeWorkflow(dir, SOLO_WORKFLOW);
  run(["start"], { cwd: dir });
  fs.writeFileSync(path.join(dir, ".headsign", "lock"), String(process.pid));

  const result = run(["next"], { cwd: dir });
  assert.equal(result.status, 3);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    `ERROR: another \`headsign next\` is running in this repo (pid ${process.pid}); wait for it to finish, or remove .headsign/lock if it is stale.\n`,
  );
  // The lock belongs to the holder: a refused `next` must not delete it on its way out.
  assert.equal(fs.readFileSync(path.join(dir, ".headsign", "lock"), "utf8"), String(process.pid));
  fs.unlinkSync(path.join(dir, ".headsign", "lock"));
});

// Also the lock half of the early-return question: this refusal happens *under* the lock,
// after the acquire, so it is the path that proves the release is structural rather than
// remembered — nothing on it calls release itself.
test("refusal: next when the workflow no longer defines the run's phase -> whole ERROR line, exit 3, lock released, run untouched", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  const stateBefore = fs.readFileSync(path.join(dir, ".headsign", "state.json"));
  const logBefore = fs.readFileSync(path.join(dir, ".headsign", "log"));

  // Still a valid workflow — it simply no longer has the phase this run is standing on.
  writeWorkflow(
    dir,
    `
version: 0.1
name: demo
entry: verify
phases:
  verify:
    description: "Verify the thing."
    gate:
      checks:
        - run: "true"
    on_pass: "$end"
`,
  );

  const result = run(["next"], { cwd: dir });
  assert.equal(result.status, 3);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    "ERROR: workflow '.headsign/workflow.yaml' no longer defines phase 'build', which this run is currently on. " +
      "Restore that phase in the workflow file, or run `headsign abort <reason>` to end this run.\n",
  );
  assert.equal(fs.existsSync(path.join(dir, ".headsign", "lock")), false, "the lock is released on an early return too");
  assert.deepEqual(fs.readFileSync(path.join(dir, ".headsign", "state.json")), stateBefore, "state.json must be byte-identical");
  assert.deepEqual(fs.readFileSync(path.join(dir, ".headsign", "log")), logBefore, "nothing happened, so nothing is logged");
});

test("refusal: abort with no run here -> whole ERROR line, nothing on stdout, exit 3", () => {
  const result = run(["abort", "because"], { cwd: tmpdir() });
  assert.equal(result.status, 3);
  assert.equal(result.stdout, "");
  assert.equal(
    result.stderr,
    "ERROR: no run in progress to abort here. headsign uses the .headsign/ directory in the current directory and does not search parent " +
      "directories — run it from the directory that owns the workflow (usually the repo or git-worktree root).\n",
  );
});

test("refusal: abort on a run that already ended -> whole ERROR line naming the status, exit 3", () => {
  const dir = initRepo();
  writeWorkflow(dir, SOLO_WORKFLOW);
  run(["start"], { cwd: dir });
  run(["next"], { cwd: dir });

  const result = run(["abort", "too late"], { cwd: dir });
  assert.equal(result.status, 3);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "ERROR: run for workflow 'solo' is already complete; nothing to abort.\n");
});

test("refusal: claim with no run here -> whole ERROR line, nothing on stdout, exit 3", () => {
  const result = run(["claim"], { cwd: tmpdir() });
  assert.equal(result.status, 3);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, NO_RUN_HERE_LINE);
});

test("refusal: claim on a run that already ended -> whole ERROR line naming the status, exit 3", () => {
  const dir = initRepo();
  writeWorkflow(dir, SOLO_WORKFLOW);
  run(["start"], { cwd: dir });
  run(["abort", "done here"], { cwd: dir });

  const result = run(["claim"], { cwd: dir });
  assert.equal(result.status, 3);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "ERROR: run for workflow 'solo' is already aborted; nothing to claim.\n");
  assert.equal(fs.existsSync(path.join(dir, ".headsign", "tmp", "claim")), false, "a refused claim arms nothing");
});

test("refusal: status with no run here -> whole ERROR line, nothing on stdout, exit 3", () => {
  const result = run(["status"], { cwd: tmpdir() });
  assert.equal(result.status, 3);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, NO_RUN_HERE_LINE);
});

// The other half of the same move: a workflow that does not load is refused too, but through
// the other channel — render.ts's `INVALID:` block, not a one-line `ERROR:` — and both
// commands that load one have to keep that distinction after handing the errors back.
test("refusal: start and next on a workflow that does not load answer with the INVALID block, not ERROR:, and still exit 3", () => {
  const dir = initRepo();
  writeWorkflow(dir, SOLO_WORKFLOW);
  run(["start"], { cwd: dir });
  writeWorkflow(dir, "version: 0.1\nname: solo\nentry: only\nphases: {}\n");

  const next = run(["next"], { cwd: dir });
  assert.equal(next.status, 3);
  assert.equal(next.stdout, "");
  assert.match(next.stderr, /^INVALID: \.headsign\/workflow\.yaml\n/);
  assert.doesNotMatch(next.stderr, /^ERROR:/);

  // `start` loads before it looks at the run, so the still-running run here is not what it
  // answers about: the file that does not load is.
  const started = run(["start"], { cwd: dir });
  assert.equal(started.status, 3);
  assert.equal(started.stdout, "");
  assert.match(started.stderr, /^INVALID: \.headsign\/workflow\.yaml\n/);
});

// --- the stop hook and the lock ---
//
// A seam sweep asked whether a writer here must hold the lock, and the answer was that
// nothing made it. `next` holds the lock across a lap that can run a gate for seconds, these
// hooks fire whenever any turn ends in the same directory, and a hook write replaces the
// whole record — so a hook landing mid-lap erased that lap's phase transition and attempt
// increment. These three tests pin the fix from both sides.

test("stop-hook: a lock held by a live process stops the hook writing, and lets the turn end", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  const before = readState(dir);

  // A live holder — this test process itself, which is certainly alive.
  fs.writeFileSync(path.join(dir, ".headsign", "lock"), String(process.pid));

  const result = run(["stop-hook"], { cwd: dir, input: "{}" });
  assert.equal(result.status, 0, "a held lock means somebody is judging: the turn may end");
  assert.deepEqual(readState(dir), before, "not one field of the record may change");

  fs.rmSync(path.join(dir, ".headsign", "lock"));
});

test("stop-hook: a held lock leaves the pause note unconsumed, so the next turn still pauses", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  const notePath = path.join(dir, ".headsign", "tmp", "stop-note");
  fs.writeFileSync(notePath, "stepping away\n");
  fs.writeFileSync(path.join(dir, ".headsign", "lock"), String(process.pid));

  assert.equal(run(["stop-hook"], { cwd: dir, input: "{}" }).status, 0);
  assert.ok(fs.existsSync(notePath), "a one-shot note must not be spent while a lap is running");

  // With the lock gone the same note works, which is the point of not eating it.
  fs.rmSync(path.join(dir, ".headsign", "lock"));
  assert.equal(run(["stop-hook"], { cwd: dir, input: "{}" }).status, 0);
  assert.ok(!fs.existsSync(notePath), "and now it is consumed");
  assert.equal(readState(dir).stop_nudges, 0);
});

test("stop-hook: a stale lock (dead pid) is no obstacle — the hook steals it and counts", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  // 2^22 is above every default pid_max; nothing is running under it.
  fs.writeFileSync(path.join(dir, ".headsign", "lock"), "4194304");

  const result = run(["stop-hook"], { cwd: dir, input: "{}" });
  assert.equal(result.status, 2, "a crashed holder must not disable the backstop");
  assert.equal(readState(dir).stop_nudges, 1);
  assert.ok(!fs.existsSync(path.join(dir, ".headsign", "lock")), "and the lock is released again");
});

// --- the two catches that turn an unusable environment into a clean exit ---
//
// Both are fail-open promises the CLI makes and nothing exercised: ADR-0006's step 7 for the
// first, and the CLI's own "an error is a line, not a stack trace" for the second. Each is
// written against a real unusable environment rather than a stub, because what is being pinned
// is the behaviour under a filesystem/fd the process did not expect, not a branch's shape.

// Reading fd 0 does not merely return "" when stdin is unusable — it throws EBADF, which is a
// different path through readStdin than "nothing was piped".
function runWithUnreadableStdin(args: string[], cwd: string): { stdout: string; stderr: string; status: number | null } {
  // Write-only, so the child's fd 0 exists and cannot be read from.
  const writeOnly = fs.openSync(path.join(os.tmpdir(), "headsign-write-only-stdin"), "w");
  try {
    const result = spawnSync(process.execPath, [CLI, ...args], {
      cwd,
      stdio: [writeOnly, "pipe", "pipe"],
      encoding: "utf8",
      env: envWithout("CLAUDE_CODE_SESSION_ID", "HEADSIGN_OBSERVER"),
    });
    return { stdout: result.stdout, stderr: result.stderr, status: result.status };
  } finally {
    fs.closeSync(writeOnly);
  }
}

test("stop-hook: stdin that cannot be read at all fails open, on the very run that blocks when it can", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });

  // Same run, same command, same everything but fd 0 — this is the contrast that makes the
  // fail-open real rather than incidental: a hook that cannot read its input must never be the
  // reason a turn cannot end.
  const readable = run(["stop-hook"], { cwd: dir, input: "{}" });
  assert.equal(readable.status, 2, "with readable stdin this run blocks");

  const unreadable = runWithUnreadableStdin(["stop-hook"], dir);
  assert.equal(unreadable.status, 0, "with unreadable stdin the same run must pass");
  assert.equal(unreadable.stderr, "", "and say nothing — a nudge nobody can act on is noise");
});

test("subagent-stop-hook: unreadable stdin fails open too", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  const result = runWithUnreadableStdin(["subagent-stop-hook"], dir);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
});

test("an error nothing anticipated exits 3 with one line, not a stack trace", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  // A directory where state.json belongs: every read of it raises EISDIR, which no command
  // handles, so it arrives at the top-level catch — the one place that decides what an
  // unanticipated failure looks like to whoever ran the command.
  fs.mkdirSync(path.join(dir, ".headsign", "state.json"), { recursive: true });

  const result = run(["status"], { cwd: dir });
  assert.equal(result.status, 3, "3 is the CLI's refusal code — not 0, and not the gate's 1 or 2");
  assert.match(result.stderr, /^ERROR: /, "the message names itself as an error");
  assert.match(result.stderr, /EISDIR/, "and carries what actually went wrong");
  assert.equal(result.stderr.split("\n").filter((l) => l.trim().startsWith("at ")).length, 0, "no stack frames — this is for a person reading a terminal");
  assert.equal(result.stdout, "", "nothing on stdout: a caller parsing a verdict must not see one");
});

// --- `version` against src, with the build's substitution supplied at load time ---
//
// Why the preload exists at all, and what it stands in for: tests/fixtures/define-version.mjs.

function runWithVersionDefine(version: string, args: string[]): { stdout: string; stderr: string; status: number | null } {
  const preload = path.join(import.meta.dirname, "fixtures", "define-version.mjs");
  const result = spawnSync(process.execPath, ["--import", preload, CLI, ...args], {
    cwd: tmpdir(),
    encoding: "utf8",
    input: "",
    env: { ...envWithout("CLAUDE_CODE_SESSION_ID"), HEADSIGN_TEST_VERSION: version },
  });
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

test("version: a substituted version prints bare, with a newline and nothing else", () => {
  for (const args of [["version"], ["--version"]]) {
    const result = runWithVersionDefine("9.9.9", args);
    assert.equal(result.status, 0);
    // Bare, not "headsign 9.9.9": the command name already said which tool, and this is the
    // form that composes into `v=$(headsign version)`.
    assert.equal(result.stdout, "9.9.9\n", `${args[0]} must print the bare value`);
    assert.equal(result.stderr, "");
  }
});

test("version: an empty substitution refuses rather than printing a blank line", () => {
  // The same refusal tests/acceptance.test.ts pins on a deliberately mis-built bundle, reached
  // here against src — so the rule survives a change to either one alone.
  const result = runWithVersionDefine("", ["version"]);
  assert.equal(result.status, 3);
  assert.equal(result.stdout, "", "a blank line is the bug this refusal exists to prevent");
  assert.match(result.stderr, /carries no version/);
});
