import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";

const CLI = path.join(import.meta.dirname, "..", "src", "cli.ts");

function run(args: string[], opts: { cwd: string; input?: string; env?: NodeJS.ProcessEnv }): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd: opts.cwd, encoding: "utf8", input: opts.input ?? "", env: opts.env ?? process.env });
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

const NO_OBSERVER_ENV = envWithout("HEADSIGN_OBSERVER");

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
  assert.match(second.stdout, /^ESCALATE build: max_attempts \(2\) exhausted\n/);
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

test("log: start truncates/creates the log with exactly one start line naming the workflow", () => {
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

test("log: a second start truncates the previous run's log rather than appending to it", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  run(["abort", "done"], { cwd: dir });
  assert.ok(readLog(dir).length >= 2);

  run(["start"], { cwd: dir });
  assert.equal(readLog(dir).length, 1);
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

test("stop-hook: the 5th nudge appends exactly one stalled log line; later stops do not repeat it", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });

  for (let i = 1; i <= 5; i++) run(["stop-hook"], { cwd: dir, input: "{}" });
  let stalledLines = readLog(dir).filter((l) => l.includes(" stalled "));
  assert.equal(stalledLines.length, 1);
  assert.match(stalledLines[0], /stalled build a=0 i=0 nudges=5/);

  run(["stop-hook"], { cwd: dir, input: "{}" });
  run(["stop-hook"], { cwd: dir, input: "{}" });
  stalledLines = readLog(dir).filter((l) => l.includes(" stalled "));
  assert.equal(stalledLines.length, 1, "stalled must not be repeated on later stops");
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
  assert.match(result.stdout, /driver: a delegated agent\n$/);
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
  assert.equal(before.stdout, `RUNNING build (attempt 0/3)\nworkflow: demo\ndriver: not delegated yet — no agent has claimed this run\n`);

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

test("status: an unreadable workflow.yaml degrades the attempt display to n/? without erroring", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  fs.rmSync(path.join(dir, ".headsign", "workflow.yaml"));

  const result = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^RUNNING build \(attempt 0\/\?\)\n/);
  assert.match(result.stdout, /^workflow: demo$/m, "the workflow name comes from state.json, not the (now-missing) workflow.yaml");
});

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
  assert.match(result.stdout, /^RUNNING build \(attempt 0\/\?\)\n/);
});

test("status: a matching last_failure renders a last-failure block with the failing check and output tail", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_OBSERVER_ENV });
  run(["next"], { cwd: dir, env: NO_OBSERVER_ENV }); // real RETRY -> last_failure set for phase "build"

  const result = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.match(result.stdout, /--- last failure: marker exists \(test -f marker\.txt, exit 1\) ---\n/);
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
  assert.match(before.stdout, /driver: not delegated yet — no agent has claimed this run\n$/);

  // A `claim` on its own is only the first beat: nothing is sealed until the claiming
  // agent's own turn end, so the line must not change yet.
  run(["claim"], { cwd: dir });
  const armed = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.match(armed.stdout, /driver: not delegated yet — no agent has claimed this run\n$/);

  run(["subagent-stop-hook"], { cwd: dir, input: JSON.stringify({ agent_id: "agent-alpha" }), env: NO_OBSERVER_ENV });
  const after = run(["status"], { cwd: dir, env: NO_OBSERVER_ENV });
  assert.match(after.stdout, /driver: a delegated agent\n$/);
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
  assert.match(result.stdout, /driver: not delegated yet — no agent has claimed this run\n$/);
  assert.doesNotMatch(result.stdout, /session-mine/);
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
  assert.equal(result.stderr, "");
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
  assert.match(result.stderr, /on_pass 'nowhere' does not name a defined phase/);
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
