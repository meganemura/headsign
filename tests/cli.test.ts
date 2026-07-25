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

function initRepoNoCommit(): string {
  const dir = tmpdir();
  execFileSync("git", ["init", "-q"], { cwd: dir });
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

// Multi-session ownership (ADR-0008) tests need full control over which session
// identifiers are visible to the child process — the test *runner* itself may be running
// inside a Claude Code session (CLAUDE_CODE_SESSION_ID set ambiently), which must not leak
// into a test that asserts "no identifier available" behavior.
function envWithout(...keys: string[]): NodeJS.ProcessEnv {
  const e = { ...process.env };
  for (const k of keys) delete e[k];
  return e;
}

const NO_SESSION_ENV = envWithout("CLAUDE_CODE_SESSION_ID", "HEADSIGN_SESSION_ID", "HEADSIGN_OBSERVER");
function sessionEnv(id: string): NodeJS.ProcessEnv {
  return { ...NO_SESSION_ENV, HEADSIGN_SESSION_ID: id };
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

test("a file written under .headsign/tmp/ changes the tree hash, so next re-evaluates instead of reprinting a cached (unchanged) RETRY", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });

  const first = run(["next"], { cwd: dir });
  assert.match(first.stdout, /^RETRY 1 build\n/);

  fs.writeFileSync(path.join(dir, ".headsign", "tmp", "note.txt"), "hi\n");
  const second = run(["next"], { cwd: dir });
  assert.equal(second.status, 1);
  assert.doesNotMatch(second.stdout, /\(unchanged\)/);
  assert.match(second.stdout, /^RETRY 2 build\n/); // a real (counted) evaluation, not a cache hit
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
version: 1
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
version: 1
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
version: 1
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
version: 1
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
version: 1
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
version: 1
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
version: 1
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
version: 1
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
version: 1
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
version: 1
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
version: 1
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
version: 1
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

test("log: retry/advance/complete append one line each; a cached (unchanged) re-display appends nothing", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir });
  assert.equal(readLog(dir).length, 1); // start

  run(["next"], { cwd: dir }); // real RETRY
  assert.equal(readLog(dir).length, 2);

  run(["next"], { cwd: dir }); // unchanged tree -> cached RETRY, no new line
  assert.equal(readLog(dir).length, 2);

  fs.writeFileSync(path.join(dir, "marker.txt"), "");
  run(["next"], { cwd: dir }); // real ADVANCE
  assert.equal(readLog(dir).length, 3);

  run(["next"], { cwd: dir }); // real COMPLETE
  assert.equal(readLog(dir).length, 4);

  const lines = readLog(dir);
  assert.match(lines[1], /^\S+ retry build a=1 i=1 check="/);
  assert.match(lines[2], /^\S+ advance verify a=0 i=2 from=build$/);
  assert.match(lines[3], /^\S+ complete verify a=0 i=3$/);
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

test("log: an escalate via max_total_iterations appends one escalate line", () => {
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
        - run: "false"
    on_pass: "$end"
limits:
  max_total_iterations: 1
`,
  );
  run(["start"], { cwd: dir });
  const first = run(["next"], { cwd: dir }); // real RETRY, total_iterations -> 1
  assert.equal(first.status, 1);
  const before = readLog(dir).length;

  const result = run(["next"], { cwd: dir }); // total_iterations(1) >= limit(1) -> ESCALATE, checked before the gate
  assert.equal(result.status, 2);
  assert.match(result.stdout, /^ESCALATE/);
  const lines = readLog(dir);
  assert.equal(lines.length, before + 1);
  assert.match(lines[lines.length - 1], /^\S+ escalate build a=1 i=1 reason="/);
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

// --- multi-session ownership: driver_session stamping and Stop hook owner check (ADR-0008) ---

test("start: no HEADSIGN_SESSION_ID/CLAUDE_CODE_SESSION_ID available -> driver_session is stamped null", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_SESSION_ENV });
  assert.equal(readState(dir).driver_session, null);
});

test("start: HEADSIGN_SESSION_ID stamps driver_session", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: sessionEnv("session-start") });
  assert.equal(readState(dir).driver_session, "session-start");
});

test("start: CLAUDE_CODE_SESSION_ID alone (no HEADSIGN_SESSION_ID) also stamps driver_session", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: { ...NO_SESSION_ENV, CLAUDE_CODE_SESSION_ID: "auto-detected" } });
  assert.equal(readState(dir).driver_session, "auto-detected");
});

test("next: the first positive identifier stamps driver_session under the lock (previously null)", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_SESSION_ENV });
  assert.equal(readState(dir).driver_session, null);

  run(["next"], { cwd: dir, env: sessionEnv("session-next") });
  assert.equal(readState(dir).driver_session, "session-next");
});

test("next: PENDING path stamps a new positive identifier while leaving attempts/total_iterations unchanged", () => {
  const dir = initRepo();
  writeWorkflow(dir, READY_REVIEW_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_SESSION_ENV });
  const before = readState(dir);
  assert.equal(before.driver_session, null);

  const result = run(["next"], { cwd: dir, env: sessionEnv("session-pending") });
  assert.match(result.stdout, /^PENDING review\n/);

  const after = readState(dir);
  assert.equal(after.driver_session, "session-pending", "PENDING must still stamp a positive identifier");
  assert.deepEqual(after.attempts, before.attempts);
  assert.equal(after.total_iterations, before.total_iterations);
});

test("next: no positive identifier resolved leaves an existing driver_session untouched (never orphans the run)", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: sessionEnv("session-owner") });
  assert.equal(readState(dir).driver_session, "session-owner");

  run(["next"], { cwd: dir, env: NO_SESSION_ENV }); // real RETRY, but no identifier available this time
  assert.equal(readState(dir).driver_session, "session-owner");
});

test("next: a legacy state.json missing driver_session entirely still gets stamped by the first next with a positive id", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_SESSION_ENV });
  const legacy = readState(dir) as Record<string, unknown>;
  delete legacy.driver_session;
  fs.writeFileSync(path.join(dir, ".headsign", "state.json"), JSON.stringify(legacy));

  run(["next"], { cwd: dir, env: sessionEnv("session-legacy") });
  assert.equal(readState(dir).driver_session, "session-legacy");
});

test("next: an unchanged (matching) driver_session, combined with a cached retry, writes nothing at all to state.json", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  const env = sessionEnv("session-same");
  run(["start"], { cwd: dir, env });
  run(["next"], { cwd: dir, env }); // real RETRY, stamps driver_session to session-same
  assert.equal(readState(dir).driver_session, "session-same");

  const before = fs.readFileSync(path.join(dir, ".headsign", "state.json"));
  const second = run(["next"], { cwd: dir, env }); // unchanged tree -> cached retry; same sid -> no stamp write either
  assert.match(second.stdout, /\(unchanged\)/);
  const after = fs.readFileSync(path.join(dir, ".headsign", "state.json"));
  assert.deepEqual(after, before, "same driver + cached retry must not touch state.json at all");
});

test("stop-hook: HEADSIGN_OBSERVER unconditionally passes through while running, without incrementing stop_nudges", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_SESSION_ENV });
  const result = run(["stop-hook"], { cwd: dir, input: "{}", env: { ...NO_SESSION_ENV, HEADSIGN_OBSERVER: "1" } });
  assert.equal(result.status, 0);
  assert.equal(readState(dir).stop_nudges, 0);
});

test("stop-hook: an owner mismatch (stdin session_id differs from driver_session) passes through — no write, no output, note left unconsumed", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: sessionEnv("driver-1") });
  const noteDir = path.join(dir, ".headsign", "tmp");
  fs.mkdirSync(noteDir, { recursive: true });
  fs.writeFileSync(path.join(noteDir, "stop-note"), "the driver is stepping away");

  const before = fs.readFileSync(path.join(dir, ".headsign", "state.json"));
  const result = run(["stop-hook"], { cwd: dir, input: JSON.stringify({ session_id: "observer-2" }), env: NO_SESSION_ENV });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");

  const after = fs.readFileSync(path.join(dir, ".headsign", "state.json"));
  assert.deepEqual(after, before, "an owner-mismatched stop must not write state.json at all");
  assert.ok(fs.existsSync(path.join(noteDir, "stop-note")), "a bystander's stop must not consume the driver's note");
});

test("stop-hook: a matching session_id (owner check passes) falls through to the normal nudge flow and still blocks", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: sessionEnv("driver-1") });
  const result = run(["stop-hook"], { cwd: dir, input: JSON.stringify({ session_id: "driver-1" }), env: NO_SESSION_ENV });
  assert.equal(result.status, 2);
  assert.equal(readState(dir).stop_nudges, 1);
});

test("stop-hook: a missing identifier on either side falls back to the legacy nudge (still blocks)", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);

  // Side A: driver_session is set, but the stopping session presents no identifier at all.
  run(["start"], { cwd: dir, env: sessionEnv("driver-1") });
  const noHookId = run(["stop-hook"], { cwd: dir, input: "{}", env: NO_SESSION_ENV });
  assert.equal(noHookId.status, 2, "no hook-side identifier -> owner check skipped, legacy nudge");
  assert.equal(readState(dir).stop_nudges, 1);

  // Side B: driver_session was never stamped (no identifier at start), but the stopping
  // session does present one.
  const dir2 = initRepo();
  writeWorkflow(dir2, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir2, env: NO_SESSION_ENV });
  const noDriverId = run(["stop-hook"], { cwd: dir2, input: JSON.stringify({ session_id: "some-session" }), env: NO_SESSION_ENV });
  assert.equal(noDriverId.status, 2, "no driver_session on state -> owner check skipped, legacy nudge");
  assert.equal(readState(dir2).stop_nudges, 1);
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
  run(["start"], { cwd: dir, env: NO_SESSION_ENV });
  run(["abort", "done"], { cwd: dir, env: NO_SESSION_ENV });

  const result = run(["claim"], { cwd: dir });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /^ERROR:/);
  assert.match(result.stderr, /already aborted/);
  assert.match(result.stderr, /nothing to claim/);
});

test("claim: a running run -> creates .headsign/tmp/claim, exit 0, and the output tells the caller to end its turn; state.json is untouched", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_SESSION_ENV });
  const before = fs.readFileSync(path.join(dir, ".headsign", "state.json"));

  const result = run(["claim"], { cwd: dir });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^CLAIM armed\n/);
  assert.match(result.stdout, /Now end your turn/);
  assert.equal(fs.existsSync(claimMarkerPath(dir)), true);

  const after = fs.readFileSync(path.join(dir, ".headsign", "state.json"));
  assert.deepEqual(after, before, "claim must write nothing to state.json — adoption is the Stop hook's job");
});

test("claim: a re-run (e.g. after a mistaken adoption) harmlessly re-arms the marker rather than erroring", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_SESSION_ENV });
  const first = run(["claim"], { cwd: dir });
  assert.equal(first.status, 0);
  const second = run(["claim"], { cwd: dir });
  assert.equal(second.status, 0);
  assert.equal(fs.existsSync(claimMarkerPath(dir)), true);
});

test("claim + subagent-stop-hook end-to-end: the claiming agent's own turn end seals the claim, blocking with the confirmation message", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: sessionEnv("session-alpha") });
  run(["claim"], { cwd: dir });

  const result = run(["subagent-stop-hook"], { cwd: dir, input: JSON.stringify({ agent_id: "agent-alpha" }), env: NO_SESSION_ENV });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /^Claim confirmed: this agent now drives workflow 'demo' \(phase: build\)\./);
  assert.match(result.stderr, /headsign next`/);
  assert.match(result.stderr, /headsign abort/);

  const after = readState(dir);
  assert.equal(after.driver_session, "agent-alpha");
  assert.equal(after.driver_source, "claim");
  assert.equal(after.stop_nudges, 0);
  assert.equal(fs.existsSync(claimMarkerPath(dir)), false);

  const lines = readLog(dir);
  assert.equal(lines.filter((l) => l.includes(" claimed ")).length, 1);
});

test("claim + stop-hook end-to-end: an enclosing session's stop does NOT seal the claim — the marker survives for the claiming agent's own turn end", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: sessionEnv("session-alpha") });
  run(["claim"], { cwd: dir });

  // The regression ADR-0010 exists to prevent: under ADR-0009 this stop stole the driver
  // seat that a delegated agent had just asked for, simply by stopping first.
  const stolen = run(["stop-hook"], { cwd: dir, input: JSON.stringify({ session_id: "session-alpha" }), env: NO_SESSION_ENV });
  assert.equal(stolen.status, 2, "the session is still nudged as this run's own env-stamped driver");
  assert.doesNotMatch(stolen.stderr, /Claim confirmed/);
  assert.equal(readState(dir).driver_session, "session-alpha");
  assert.equal(readState(dir).driver_source, "env");
  assert.equal(fs.existsSync(claimMarkerPath(dir)), true, "the marker must still be armed");

  // ...and the claiming agent then gets it, as asked.
  const sealed = run(["subagent-stop-hook"], { cwd: dir, input: JSON.stringify({ agent_id: "agent-alpha" }), env: NO_SESSION_ENV });
  assert.equal(sealed.status, 2);
  assert.match(sealed.stderr, /^Claim confirmed/);
  assert.equal(readState(dir).driver_session, "agent-alpha");
  assert.equal(readState(dir).driver_source, "claim");
});

test("stickiness: once adopted via claim, next's ordinary env-derived auto-stamp does not overwrite the driver", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: sessionEnv("session-alpha") });
  run(["claim"], { cwd: dir });
  run(["subagent-stop-hook"], { cwd: dir, input: JSON.stringify({ agent_id: "agent-alpha" }), env: NO_SESSION_ENV });
  assert.equal(readState(dir).driver_session, "agent-alpha");
  assert.equal(readState(dir).driver_source, "claim");

  // A completely different session id calls `next` — under the old (pre-claim) stamping
  // rule this would silently overwrite the driver; claim's stickiness must prevent that.
  run(["next"], { cwd: dir, env: sessionEnv("session-beta") });
  const after = readState(dir);
  assert.equal(after.driver_session, "agent-alpha", "the claimed driver must survive an unrelated session's next");
  assert.equal(after.driver_source, "claim");
});

test("a claim-driven run never blocks an enclosing session's stop again: driver_source \"claim\" passes stop-hook through untouched", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: sessionEnv("session-alpha") });
  run(["claim"], { cwd: dir });
  run(["subagent-stop-hook"], { cwd: dir, input: JSON.stringify({ agent_id: "agent-alpha" }), env: NO_SESSION_ENV });
  const before = fs.readFileSync(path.join(dir, ".headsign", "state.json"));

  const result = run(["stop-hook"], { cwd: dir, input: JSON.stringify({ session_id: "session-alpha" }), env: NO_SESSION_ENV });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.deepEqual(fs.readFileSync(path.join(dir, ".headsign", "state.json")), before);
});

test("stickiness only applies to driver_source \"claim\": an ordinary env-stamped driver is still overwritten by the next positive identifier", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: sessionEnv("driver-a") });
  assert.equal(readState(dir).driver_source, "env");

  run(["next"], { cwd: dir, env: sessionEnv("driver-b") });
  const after = readState(dir);
  assert.equal(after.driver_session, "driver-b", "a plain env-sourced driver is not sticky");
  assert.equal(after.driver_source, "env");
});

test("re-claim re-adopts: a second claim, sealed by the right agent's turn end, overrides a previous mistaken adoption", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_SESSION_ENV });

  run(["claim"], { cwd: dir });
  run(["subagent-stop-hook"], { cwd: dir, input: JSON.stringify({ agent_id: "agent-beta" }), env: NO_SESSION_ENV });
  assert.equal(readState(dir).driver_session, "agent-beta");

  // The right agent notices the mistake and re-claims. Unlike ADR-0009's version of this
  // handshake, the retry converges on the right answer: that agent's own turn end always
  // fires SubagentStop.
  run(["claim"], { cwd: dir });
  const result = run(["subagent-stop-hook"], { cwd: dir, input: JSON.stringify({ agent_id: "agent-alpha" }), env: NO_SESSION_ENV });
  assert.equal(result.status, 2);
  const after = readState(dir);
  assert.equal(after.driver_session, "agent-alpha", "a new claim always wins");
  assert.equal(after.driver_source, "claim");
});

test("subagent-stop-hook: reads stdin and exits 0 when the stopping agent is not this run's driver", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: sessionEnv("session-alpha") });

  // A session-driven run: an unrelated subagent stopping under it must never be trapped.
  const result = run(["subagent-stop-hook"], { cwd: dir, input: JSON.stringify({ agent_id: "agent-alpha" }), env: NO_SESSION_ENV });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.equal(readState(dir).stop_nudges, 0);
});

test("subagent-stop-hook: the driving agent's own turn end exits 2 with the nudge on stderr and increments stop_nudges", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_SESSION_ENV });
  run(["claim"], { cwd: dir });
  run(["subagent-stop-hook"], { cwd: dir, input: JSON.stringify({ agent_id: "agent-alpha" }), env: NO_SESSION_ENV });

  const result = run(["subagent-stop-hook"], { cwd: dir, input: JSON.stringify({ agent_id: "agent-alpha" }), env: NO_SESSION_ENV });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /headsign workflow 'demo' is still running \(phase: build\)\./);
  assert.equal(readState(dir).stop_nudges, 1);
});

test("subagent-stop-hook: no run here, and no stdin at all, exit 0 (fail open)", () => {
  const noRun = run(["subagent-stop-hook"], { cwd: tmpdir(), input: JSON.stringify({ agent_id: "agent-alpha" }) });
  assert.equal(noRun.status, 0);

  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_SESSION_ENV });
  const noStdin = run(["subagent-stop-hook"], { cwd: dir, env: NO_SESSION_ENV });
  assert.equal(noStdin.status, 0);
});

test("status: driver_source \"claim\" reports driver: a delegated agent, not this/another session", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: sessionEnv("session-alpha") });
  run(["claim"], { cwd: dir });
  run(["subagent-stop-hook"], { cwd: dir, input: JSON.stringify({ agent_id: "agent-alpha" }), env: NO_SESSION_ENV });

  // Even when the status-invoking session's own env id happens to equal the recorded
  // driver, the delegated-agent phrasing is reported — the CLI can't resolve an agent id,
  // so it must not fall back to a this/another judgment it has no basis for.
  const result = run(["status"], { cwd: dir, env: sessionEnv("agent-alpha") });
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
version: 1
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
  run(["start"], { cwd: dir, env: NO_SESSION_ENV });
  const before = run(["status"], { cwd: dir, env: NO_SESSION_ENV });
  assert.equal(before.status, 0);
  assert.equal(before.stdout, `RUNNING build (attempt 0/3)\nworkflow: demo\ndriver: unknown\n`);

  run(["next"], { cwd: dir, env: NO_SESSION_ENV }); // real RETRY -> attempts.build = 1
  const after = run(["status"], { cwd: dir, env: NO_SESSION_ENV });
  assert.equal(after.status, 0);
  assert.match(after.stdout, /^RUNNING build \(attempt 1\/3\)\n/);
});

test("status: no max_attempts on the phase -> bare attempt number (no slash)", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW); // build has no max_attempts
  run(["start"], { cwd: dir, env: NO_SESSION_ENV });
  const result = run(["status"], { cwd: dir, env: NO_SESSION_ENV });
  assert.match(result.stdout, /^RUNNING build \(attempt 0\)\n/);
});

test("status: an unreadable workflow.yaml degrades the attempt display to n/? without erroring", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_SESSION_ENV });
  fs.rmSync(path.join(dir, ".headsign", "workflow.yaml"));

  const result = run(["status"], { cwd: dir, env: NO_SESSION_ENV });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^RUNNING build \(attempt 0\/\?\)\n/);
  assert.match(result.stdout, /^workflow: demo$/m, "the workflow name comes from state.json, not the (now-missing) workflow.yaml");
});

test("status: current phase no longer defined in a (readable) workflow.yaml also degrades to n/?", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_SESSION_ENV }); // state.phase = "build"
  writeWorkflow(
    dir,
    `
version: 1
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

  const result = run(["status"], { cwd: dir, env: NO_SESSION_ENV });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^RUNNING build \(attempt 0\/\?\)\n/);
});

test("status: a matching last_eval renders a last-failure block with the failing check and output tail", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_SESSION_ENV });
  run(["next"], { cwd: dir, env: NO_SESSION_ENV }); // real RETRY -> last_eval set for phase "build"

  const result = run(["status"], { cwd: dir, env: NO_SESSION_ENV });
  assert.match(result.stdout, /--- last failure: marker exists \(test -f marker\.txt, exit 1\) ---\n/);
});

test("status: a last_eval belonging to a different (stale) phase than the current one is not shown", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_SESSION_ENV });
  run(["next"], { cwd: dir, env: NO_SESSION_ENV }); // last_eval.phase = "build", state.phase = "build"

  // Not reachable via the normal engine flow (see engine.ts: last_eval is always cleared
  // on any phase change) — simulates a hand-edited/legacy state.json to pin the defensive
  // guard against misreading a stale failure as current.
  const st = readState(dir) as Record<string, unknown>;
  st.phase = "verify";
  fs.writeFileSync(path.join(dir, ".headsign", "state.json"), JSON.stringify(st));

  const result = run(["status"], { cwd: dir, env: NO_SESSION_ENV });
  assert.doesNotMatch(result.stdout, /last failure/);
});

test("status: driver line reflects match/mismatch/unknown against driver_session, and never prints either raw session id", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: sessionEnv("session-mine") });

  const same = run(["status"], { cwd: dir, env: sessionEnv("session-mine") });
  assert.match(same.stdout, /driver: this session\n$/);
  assert.doesNotMatch(same.stdout, /session-mine/);

  const other = run(["status"], { cwd: dir, env: sessionEnv("session-theirs") });
  assert.match(other.stdout, /driver: another session\n$/);
  assert.doesNotMatch(other.stdout, /session-mine/);
  assert.doesNotMatch(other.stdout, /session-theirs/);

  const noId = run(["status"], { cwd: dir, env: NO_SESSION_ENV });
  assert.match(noId.stdout, /driver: unknown\n$/);
});

test("status: complete -> COMPLETE token, workflow line, no reason line, exit 0", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_SESSION_ENV });
  fs.writeFileSync(path.join(dir, "marker.txt"), "");
  run(["next"], { cwd: dir, env: NO_SESSION_ENV }); // ADVANCE
  run(["next"], { cwd: dir, env: NO_SESSION_ENV }); // COMPLETE

  const result = run(["status"], { cwd: dir, env: NO_SESSION_ENV });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, `COMPLETE\nworkflow: demo\n`);
});

test("status: escalated -> ESCALATED token with reason line, exit 0 (not next's exit 2)", () => {
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
  run(["start"], { cwd: dir, env: NO_SESSION_ENV });
  run(["next"], { cwd: dir, env: NO_SESSION_ENV }); // ESCALATE

  const result = run(["status"], { cwd: dir, env: NO_SESSION_ENV });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /^ESCALATED\nworkflow: demo\nreason: /);
});

test("status: aborted -> ABORTED token with reason line, exit 0", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_SESSION_ENV });
  run(["abort", "changed", "my", "mind"], { cwd: dir, env: NO_SESSION_ENV });

  const result = run(["status"], { cwd: dir, env: NO_SESSION_ENV });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, `ABORTED\nworkflow: demo\nreason: changed my mind\n`);
});

test("status: read-only — state.json bytes are identical before and after, and it never acquires the lock", () => {
  const dir = initRepo();
  writeWorkflow(dir, TWO_PHASE_WORKFLOW);
  run(["start"], { cwd: dir, env: NO_SESSION_ENV });
  run(["next"], { cwd: dir, env: NO_SESSION_ENV }); // real RETRY, gives status something to show

  const before = fs.readFileSync(path.join(dir, ".headsign", "state.json"));
  const result = run(["status"], { cwd: dir, env: NO_SESSION_ENV });
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
version: 1
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
  run(["start"], { cwd: dir, env: NO_SESSION_ENV });

  const result = run(["status"], { cwd: dir, env: NO_SESSION_ENV });
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
