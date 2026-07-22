import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";

const CLI = path.join(import.meta.dirname, "..", "src", "cli.ts");

function run(args: string[], opts: { cwd: string; input?: string }): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd: opts.cwd, encoding: "utf8", input: opts.input ?? "" });
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

function initRepoNoCommit(): string {
  const dir = tmpdir();
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

function writeWorkflow(dir: string, yaml: string): void {
  fs.mkdirSync(path.join(dir, ".headsign"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".headsign", "workflow.yaml"), yaml);
}

function readState(dir: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(dir, ".headsign", "state.json"), "utf8"));
}

const TWO_PHASE_WORKFLOW = `
version: 1
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

test("cached RETRY on an unchanged tree does not count an attempt", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  run(["next"], { cwd: dir });
  assert.equal((readState(dir).attempts as Record<string, number>).build, 1);

  const second = run(["next"], { cwd: dir });
  assert.equal(second.status, 1);
  assert.match(second.stdout, /^RETRY 1 build \(unchanged\)\n/);
  assert.equal((readState(dir).attempts as Record<string, number>).build, 1);
});

test("start refuses to clobber a running workflow", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  const second = run(["start"], { cwd: dir });
  assert.equal(second.status, 3);
  assert.match(second.stderr, /^ERROR:/);
});

test("next in a commit-less git repo does not leak git's raw `fatal:` stderr", () => {
  const dir = initRepoNoCommit();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  const startResult = run(["start"], { cwd: dir });
  assert.equal(startResult.status, 0);

  const result = run(["next"], { cwd: dir });
  assert.doesNotMatch(result.stderr, /fatal:/);
});

test("abort on an already-terminal (escalated) run names the actual status instead of claiming no run is in progress", () => {
  const dir = initRepo();
  writeWorkflow(
    dir,
    `
version: 1
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
version: 1
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

// --- nested project: cwd is a subdirectory of a larger git repo (L1 regression) ---

test("nested project (cwd inside a larger git repo): fixing a gate-grepped file's content is picked up, not cached as (unchanged)", () => {
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
version: 1
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

  fs.writeFileSync(path.join(projectDir, "notes.txt"), "TODO: fix this\n"); // dirty, status "M"
  const first = run(["next"], { cwd: projectDir });
  assert.equal(first.status, 1);
  assert.match(first.stdout, /^RETRY 1 build\n/);

  const second = run(["next"], { cwd: projectDir }); // unchanged -> cached
  assert.equal(second.status, 1);
  assert.match(second.stdout, /^RETRY 1 build \(unchanged\)\n/);

  fs.writeFileSync(path.join(projectDir, "notes.txt"), "done, no more work\n"); // still "M", content fixed
  const third = run(["next"], { cwd: projectDir });
  assert.doesNotMatch(third.stdout, /\(unchanged\)/);
  assert.match(third.stdout, /^COMPLETE\n/);
  assert.equal(third.status, 0);
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
  // the steal-readback/owner-only-release hardening from FIX-B. A plain (non-git)
  // tmpdir is used deliberately: it makes treehash.treeHash() return null, which
  // disables the tree-hash RETRY cache entirely (ADR-0004) — otherwise a process that
  // wins the lock after the tree-hash cache is already primed with a matching failure
  // would exit 1 without touching attempts/total_iterations, which would break the
  // invariant below for reasons unrelated to the lock.
  //
  // Verified by temporarily reverting FIX-A: without it, this test fails intermittently
  // (attempts/total_iterations end up less than the number of processes that reported a
  // real RETRY) because a late acquirer overwrites an earlier writer's increment; with
  // FIX-A restored it is reliably green.
  const dir = tmpdir();
  writeWorkflow(
    dir,
    `
version: 1
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

test("start ensures .headsign/.gitignore contains both state.json and lock, one entry per line", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  const lines = fs
    .readFileSync(path.join(dir, ".headsign", ".gitignore"), "utf8")
    .split("\n")
    .map((l) => l.trim());
  assert.ok(lines.includes("state.json"));
  assert.ok(lines.includes("lock"));
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
version: 1
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

test("stop-hook: each block increments stop_nudges in state.json; the guard trips on the 4th consecutive stop", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  assert.equal(readState(dir).stop_nudges, 0);

  for (let expected = 1; expected <= 3; expected++) {
    const result = run(["stop-hook"], { cwd: dir, input: "{}" });
    assert.equal(result.status, 2, `stop #${expected} should still block`);
    assert.equal(readState(dir).stop_nudges, expected);
  }

  // A 4th consecutive stop, with no real `next` evaluation in between, trips the loop guard.
  const fourth = run(["stop-hook"], { cwd: dir, input: "{}" });
  assert.equal(fourth.status, 0);
  assert.equal(readState(dir).stop_nudges, 3); // guard fires without incrementing further
});

test("stop-hook: a non-numeric stop_nudges in state.json is treated as 0 (not an infinite block), and the 3rd block warns it's the final automatic reminder", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  const statePath = path.join(dir, ".headsign", "state.json");
  fs.writeFileSync(statePath, JSON.stringify({ ...readState(dir), stop_nudges: "x" }));

  const first = run(["stop-hook"], { cwd: dir, input: "{}" });
  assert.equal(first.status, 2, "still blocks despite the corrupt starting value");
  assert.equal(readState(dir).stop_nudges, 1);
  assert.equal(typeof readState(dir).stop_nudges, "number", "the bad value is replaced with a clean number");

  const second = run(["stop-hook"], { cwd: dir, input: "{}" });
  assert.equal(second.status, 2);
  assert.equal(readState(dir).stop_nudges, 2);

  const third = run(["stop-hook"], { cwd: dir, input: "{}" });
  assert.equal(third.status, 2);
  assert.equal(readState(dir).stop_nudges, 3);
  assert.match(third.stderr, /final automatic reminder/);

  const fourth = run(["stop-hook"], { cwd: dir, input: "{}" });
  assert.equal(fourth.status, 0, "fail-open reached despite the corrupt starting value");
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
