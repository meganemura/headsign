import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as gate from "../src/gate.ts";

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "headsign-gate-"));
}

// The workflow path most tests below hand in without caring what it is — they exist to test
// something else, and HEADSIGN_WORKFLOW_FILE (ADR-0033) needs some string to carry.
const WORKFLOW_PATH = ".headsign/workflow.yaml";

test("stops at the first failing check; later checks do not run", () => {
  const dir = tmpdir();
  const marker = path.join(dir, "ran-second");
  const result = gate.runGate([{ run: "exit 1" }, { run: `touch ${marker}` }], dir, WORKFLOW_PATH);
  assert.equal(result.kind, "fail");
  assert.equal(fs.existsSync(marker), false);
});

test("passes when all checks succeed", () => {
  const result = gate.runGate([{ run: "true" }, { run: "true" }], tmpdir(), WORKFLOW_PATH);
  assert.deepEqual(result, { kind: "pass" });
});

test("check name defaults to the run string; explicit name overrides it", () => {
  const dir = tmpdir();
  const withoutName = gate.runGate([{ run: "exit 3" }], dir, WORKFLOW_PATH);
  const withName = gate.runGate([{ name: "unit tests", run: "exit 3" }], dir, WORKFLOW_PATH);
  assert.equal(withoutName.kind, "fail");
  assert.equal(withName.kind, "fail");
  if (withoutName.kind === "fail") assert.equal(withoutName.check, "exit 3");
  if (withName.kind === "fail") assert.equal(withName.check, "unit tests");
});

// A check inherits headsign's own environment and nothing else headsign didn't add (ADR-0014,
// ADR-0033): variables a check needs of its own are written into its own `run:` string, in the
// shell it already runs in.
test("a check sees headsign's own environment, and a run: string can set its own variables", () => {
  const result = gate.runGate([{ run: 'test -n "$PATH" && FOO=bar; test "$FOO" = "bar"' }], tmpdir(), WORKFLOW_PATH);
  assert.equal(result.kind, "pass");
});

// A variable already in process.env still reaches the check: the regression this guards
// against is `env:` replacing the inherited environment instead of extending it. The test
// above would not catch that even though it reads `$PATH`, because the shell fabricates a
// default PATH when it is handed none (measured 2026-08-25 on macOS, where `/bin/sh` is bash
// 3.2.57: `env -i /bin/sh -c 'echo $PATH'` prints one, and so does spawnSync with `env: {}`).
// The shell behind `/bin/sh` differs by platform — this file's own reference page devotes a
// paragraph to that — so on a shell that fabricates nothing, the `$PATH` test above would
// catch the regression and this one would be the redundant of the two rather than the only.
// Either way the marker below is set from the test process and read nowhere else, so a
// replacing implementation drops it and nothing fabricates it back.
test("runGate: a variable already in process.env still reaches the check", () => {
  process.env.HEADSIGN_GATE_TEST_MARKER = "present";
  try {
    const result = gate.runGate([{ run: 'test "$HEADSIGN_GATE_TEST_MARKER" = "present"' }], tmpdir(), WORKFLOW_PATH);
    assert.deepEqual(result, { kind: "pass" });
  } finally {
    delete process.env.HEADSIGN_GATE_TEST_MARKER;
  }
});

// --- HEADSIGN_WORKFLOW_FILE: the one variable runGate, isReady and resolveRoute all add to the
// command's environment (ADR-0033) — the exact string the caller handed in, unnormalised,
// whether it is relative (a run started by name) or absolute (a run started with an absolute
// --workflow) ---

// The argument beats a variable of the same name already in the environment — ADR-0033 §5.
// Worth a test of its own at each of the three sites, because the ordering that makes it true
// is invisible: `{ ...process.env, HEADSIGN_WORKFLOW_FILE: p }` and
// `{ HEADSIGN_WORKFLOW_FILE: p, ...process.env }` agree on any run where the variable is absent
// from `process.env`, and say nothing about which one the code uses. These three set it and
// assert the argument wins, so flipping the spread at one site fails that site's test.
//
// Whether the variable is ambient without a test setting it depends on how the suite was
// started, and this repository is one of the places it IS: its own workflows run `npm test` as
// a gate check, so a self-gated run has headsign's own workflow path in `process.env` already.
// That does not change what these three assert — `withAmbientWorkflowFile` overwrites and
// restores whatever was there — but it is why the claim is about the code rather than about
// what any particular run happens to inherit.
function withAmbientWorkflowFile(value: string, body: () => void): void {
  const previous = process.env.HEADSIGN_WORKFLOW_FILE;
  process.env.HEADSIGN_WORKFLOW_FILE = value;
  try {
    body();
  } finally {
    if (previous === undefined) delete process.env.HEADSIGN_WORKFLOW_FILE;
    else process.env.HEADSIGN_WORKFLOW_FILE = previous;
  }
}

const OURS = ".headsign/mine.yaml";
const THEIRS = "/somewhere/else.yaml";

test("runGate: the workflow path argument beats one already in the environment", () => {
  withAmbientWorkflowFile(THEIRS, () => {
    const result = gate.runGate([{ run: `test "$HEADSIGN_WORKFLOW_FILE" = "${OURS}"` }], tmpdir(), OURS);
    assert.equal(result.kind, "pass");
  });
});

test("isReady: the workflow path argument beats one already in the environment", () => {
  withAmbientWorkflowFile(THEIRS, () => {
    assert.deepEqual(gate.isReady(`test "$HEADSIGN_WORKFLOW_FILE" = "${OURS}"`, tmpdir(), OURS), { kind: "ready" });
  });
});

test("resolveRoute: the workflow path argument beats one already in the environment", () => {
  withAmbientWorkflowFile(THEIRS, () => {
    const routes = [{ when: `test "$HEADSIGN_WORKFLOW_FILE" = "${OURS}"`, to: "matched" }, { to: "fallback" }];
    assert.deepEqual(gate.resolveRoute(routes, tmpdir(), OURS), { kind: "matched", to: "matched", when: `test "$HEADSIGN_WORKFLOW_FILE" = "${OURS}"` });
  });
});

test("runGate: HEADSIGN_WORKFLOW_FILE carries the given path unchanged, relative or absolute", () => {
  const dir = tmpdir();
  for (const p of [".headsign/workflow.yaml", "/abs/does/not/need/to/exist/workflow.yaml"]) {
    const result = gate.runGate([{ run: `test "$HEADSIGN_WORKFLOW_FILE" = "${p}"` }], dir, p);
    assert.deepEqual(result, { kind: "pass" });
  }
});

// --- output: what a check's stdout and stderr become on the record ---

test("output tail is truncated at 4000 chars with a marker", () => {
  const run = `node -e "process.stdout.write('x'.repeat(5000))" && exit 1`;
  const result = gate.runGate([{ run }], tmpdir(), WORKFLOW_PATH);
  assert.equal(result.kind, "fail");
  if (result.kind === "fail") {
    assert.ok(result.outputTail.startsWith("… (output truncated)\n"));
    assert.equal(result.outputTail.length, "… (output truncated)\n".length + 4000);
  }
});

test("empty output renders as (no output)", () => {
  const result = gate.runGate([{ run: "exit 1" }], tmpdir(), WORKFLOW_PATH);
  assert.equal(result.kind, "fail");
  if (result.kind === "fail") assert.equal(result.outputTail, "(no output)");
});

test("large output from a passing check is not misreported as a failure", () => {
  const run = `node -e "process.stdout.write('x'.repeat(2_000_000))" && exit 0`;
  const result = gate.runGate([{ run }], tmpdir(), WORKFLOW_PATH);
  assert.deepEqual(result, { kind: "pass" });
});

// --- a timeout: the arm that looks like an unrunnable check and is not ---

// A timeout stays a FAIL, deliberately, next to the unrunnable tests below that look almost
// like it: the command ran, and the limit it ran past is one the workflow author wrote. Only
// "headsign never got an exit code at all" is unrunnable — this is the regression guard for
// that line.
test("timeout is reported as a failure with a timeout marker, not as an unrunnable check", () => {
  const result = gate.runGate([{ run: "sleep 5", timeout: 0.2 }], tmpdir(), WORKFLOW_PATH);
  assert.equal(result.kind, "fail");
  if (result.kind === "fail") {
    assert.equal(result.exitCode, "timeout");
    assert.equal(result.timeoutSeconds, 0.2);
  }
});

// --- elapsedSeconds: how long the check actually ran, timed by a monotonic clock (not the
// record's existing timeout_seconds, which is the LIMIT, not a measurement) ---

test("elapsedSeconds: an ordinary failure reports a number with the sleep it waited for as a lower bound (the upper bound is environment noise, so it is not asserted)", () => {
  const result = gate.runGate([{ run: "sleep 0.3 && exit 1" }], tmpdir(), WORKFLOW_PATH);
  assert.equal(result.kind, "fail");
  if (result.kind === "fail") {
    assert.equal(typeof result.elapsedSeconds, "number");
    assert.ok((result.elapsedSeconds as number) >= 0.3, `expected >= 0.3, got ${result.elapsedSeconds}`);
  }
});

test("elapsedSeconds: a timed-out check also has one, close to the limit it ran past", () => {
  const result = gate.runGate([{ run: "sleep 5", timeout: 0.2 }], tmpdir(), WORKFLOW_PATH);
  assert.equal(result.kind, "fail");
  if (result.kind === "fail") {
    assert.equal(typeof result.elapsedSeconds, "number");
    assert.ok((result.elapsedSeconds as number) >= 0.2, `expected >= 0.2, got ${result.elapsedSeconds}`);
  }
});

test("elapsedSeconds: an unrunnable check carries none — the command never answered, so there is no interval to report", () => {
  // Same trick as the unrunnable tests below: a nonexistent cwd stops /bin/sh from starting.
  const brokenCwd = path.join(tmpdir(), "does-not-exist");
  const result = gate.runGate([{ run: "false" }], brokenCwd, WORKFLOW_PATH);
  assert.equal(result.kind, "unrunnable");
  if (result.kind === "unrunnable") assert.equal("elapsedSeconds" in result, false);
});

// --- a check that could not be run at all: the third result, not a failure ---

test("a check that cannot be launched is unrunnable, naming the check and the errno", () => {
  // Same trick the isReady and resolveRoute spawn-error tests use: a nonexistent cwd stops
  // /bin/sh from starting at all (spawnSync sets result.error), which is a different event
  // from the shell running and exiting nonzero. `false` would be a plain fail if it ever ran,
  // so a mislabelled result can't hide behind a command that fails anyway.
  const brokenCwd = path.join(tmpdir(), "does-not-exist");
  const result = gate.runGate([{ name: "unit tests", run: "false" }], brokenCwd, WORKFLOW_PATH);
  assert.equal(result.kind, "unrunnable");
  if (result.kind === "unrunnable") {
    assert.equal(result.check, "unit tests");
    assert.equal(result.run, "false");
    assert.equal(result.reason, "ENOENT");
  }
});

// --- checksTotal/checksRun/notRunChecks: what a stopped-early lap never got to ---

test("a failure partway through a gate reports how many checks ran and names the ones that didn't", () => {
  const result = gate.runGate([{ run: "true" }, { name: "lint", run: "exit 1" }, { name: "unit tests", run: "true" }], tmpdir(), WORKFLOW_PATH);
  assert.equal(result.kind, "fail");
  if (result.kind === "fail") {
    assert.equal(result.checksTotal, 3);
    assert.equal(result.checksRun, 2);
    assert.deepEqual(result.notRunChecks, ["unit tests"]);
  }
});

test("a failure on the last check leaves nothing not run", () => {
  const result = gate.runGate([{ run: "true" }, { run: "true" }, { name: "lint", run: "exit 1" }], tmpdir(), WORKFLOW_PATH);
  assert.equal(result.kind, "fail");
  if (result.kind === "fail") {
    assert.equal(result.checksTotal, 3);
    assert.equal(result.checksRun, 3);
    assert.deepEqual(result.notRunChecks, []);
  }
});

test("more than one not-run check is named in gate order, run: standing in for a check with no name:", () => {
  const result = gate.runGate([{ name: "first", run: "exit 1" }, { name: "second", run: "true" }, { run: "echo third" }], tmpdir(), WORKFLOW_PATH);
  assert.equal(result.kind, "fail");
  if (result.kind === "fail") {
    assert.equal(result.checksTotal, 3);
    assert.equal(result.checksRun, 1);
    assert.deepEqual(result.notRunChecks, ["second", "echo third"]);
  }
});

test("an unrunnable check stops the gate where it is: later checks do not run", () => {
  const dir = tmpdir();
  const brokenCwd = path.join(dir, "does-not-exist");
  const marker = path.join(dir, "ran-second");
  const result = gate.runGate([{ run: "true" }, { run: `touch ${marker}` }], brokenCwd, WORKFLOW_PATH);
  assert.equal(result.kind, "unrunnable");
  assert.equal(fs.existsSync(marker), false);
});

// --- onProgress: what runGate reports live, and to whom (ADR-0032) ---

test("onProgress: reports the gate's size first, then one call per passing check, 1-based, outcome 'passed'", () => {
  const calls: gate.GateProgress[] = [];
  const result = gate.runGate([{ name: "first", run: "true" }, { run: "true" }], tmpdir(), WORKFLOW_PATH, (p) => calls.push(p));
  assert.deepEqual(result, { kind: "pass" });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], { kind: "gate", total: 2 });
  assert.equal(calls[1]?.kind, "check");
  if (calls[1]?.kind === "check") {
    assert.equal(calls[1].index, 1);
    assert.equal(calls[1].total, 2);
    assert.equal(calls[1].name, "first");
    assert.equal(calls[1].outcome, "passed");
    assert.equal(typeof calls[1].elapsedSeconds, "number");
    // Neither check declares its own `timeout:`, so both report gate.ts's default.
    assert.equal(calls[1].timeoutSeconds, 120);
  }
  assert.equal(calls[2]?.kind, "check");
  if (calls[2]?.kind === "check") {
    assert.equal(calls[2].index, 2);
    assert.equal(calls[2].total, 2);
    // No `name:` on this check, so the same run-string fallback checkName gives everywhere else.
    assert.equal(calls[2].name, "true");
    assert.equal(calls[2].outcome, "passed");
    assert.equal(calls[2].timeoutSeconds, 120);
  }
});

// A failing check gets a `check` call too, not only a passing one (ADR-0032 §3): stdout reports
// a failing check in full only on some paths (a plain RETRY, a fail-routed ADVANCE) and not on
// the three that end the run (max_attempts exhaustion, on_fail: escalate, on_fail: $end), all of
// which null last_failure and print no check name at all — so the progress line cannot be
// conditional on which of those a failure will take.
test("onProgress: an ordinary failing check gets a `check` call with outcome 'failed', and nothing fires for the check the failure stopped the loop before", () => {
  const calls: gate.GateProgress[] = [];
  const result = gate.runGate([{ run: "true" }, { name: "lint", run: "exit 1" }, { run: "true" }], tmpdir(), WORKFLOW_PATH, (p) => calls.push(p));
  assert.equal(result.kind, "fail");
  // The gate-size call, one check call for the first (passing) check, and one for the second
  // (failing) check — nothing for the third, which the failure stopped the loop before.
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], { kind: "gate", total: 3 });
  assert.equal(calls[1]?.kind, "check");
  if (calls[1]?.kind === "check") assert.equal(calls[1].outcome, "passed");
  assert.equal(calls[2]?.kind, "check");
  if (calls[2]?.kind === "check") {
    assert.equal(calls[2].index, 2);
    assert.equal(calls[2].total, 3);
    assert.equal(calls[2].name, "lint");
    assert.equal(calls[2].outcome, "failed");
    assert.equal(typeof calls[2].elapsedSeconds, "number");
    // No `timeout:` on this check, so the call reports gate.ts's default. The field's PRESENCE
    // needs no test — `GateProgress`'s check arm declares it required, so an arm that stopped
    // sending it fails to compile. What no type can check is the VALUE: an arm passing the
    // default where the check declared its own, or the other way round, compiles perfectly.
    // That is what this pins on the failing arm, and what the timeout case below pins on its
    // own by asserting a declared 0.2 rather than the default.
    assert.equal(calls[2].timeoutSeconds, 120);
  }
});

// A timeout still routes as an ordinary failure — ADR-0021 §4's reading is untouched — but this
// call's own word is `timed out`, not `failed`: ADR-0032 §3 gives it one of its own because this
// line is the only report a run-ending failure gets on some paths, and blurring the two there
// would read as an ordinary failure that happened to take two minutes.
test("onProgress: a timed-out check gets a `check` call with outcome 'timed out', not 'failed'", () => {
  const calls: gate.GateProgress[] = [];
  const result = gate.runGate([{ run: "sleep 5", timeout: 0.2 }], tmpdir(), WORKFLOW_PATH, (p) => calls.push(p));
  assert.equal(result.kind, "fail");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], { kind: "gate", total: 1 });
  assert.equal(calls[1]?.kind, "check");
  if (calls[1]?.kind === "check") {
    assert.equal(calls[1].index, 1);
    assert.equal(calls[1].total, 1);
    assert.equal(calls[1].outcome, "timed out");
    // This check declared its own `timeout:`, so the call reports that, not the default.
    assert.equal(calls[1].timeoutSeconds, 0.2);
  }
});

// An unrunnable check produced no exit code, so it gets no `check` call — the refusal that ends
// the lap on it already names the check and the command (ADR-0032 §3).
test("onProgress: an unrunnable check gets no `check` call — only the gate-size call fires", () => {
  const calls: gate.GateProgress[] = [];
  const brokenCwd = path.join(tmpdir(), "does-not-exist");
  const result = gate.runGate([{ run: "false" }], brokenCwd, WORKFLOW_PATH, (p) => calls.push(p));
  assert.equal(result.kind, "unrunnable");
  assert.deepEqual(calls, [{ kind: "gate", total: 1 }]);
});

test("onProgress: with no sink given, runGate behaves exactly as it always did", () => {
  const withSink = gate.runGate([{ run: "true" }, { name: "lint", run: "exit 1" }], tmpdir(), WORKFLOW_PATH, () => {});
  const withoutSink = gate.runGate([{ run: "true" }, { name: "lint", run: "exit 1" }], tmpdir(), WORKFLOW_PATH);
  assert.equal(withSink.kind, "fail");
  assert.equal(withoutSink.kind, "fail");
  if (withSink.kind === "fail" && withoutSink.kind === "fail") {
    assert.equal(withSink.check, withoutSink.check);
    assert.equal(withSink.exitCode, withoutSink.exitCode);
  }
});

// --- isReady: the `ready:` readiness probe ---

test("isReady: exit 0 means ready", () => {
  assert.deepEqual(gate.isReady("true", tmpdir(), WORKFLOW_PATH), { kind: "ready" });
});

test("isReady: nonzero exit means not ready", () => {
  assert.deepEqual(gate.isReady("false", tmpdir(), WORKFLOW_PATH), { kind: "not-ready" });
});

test("isReady: runs in the given cwd, like runGate", () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, "marker"), "");
  assert.deepEqual(gate.isReady("test -f marker", dir, WORKFLOW_PATH), { kind: "ready" });
  assert.deepEqual(gate.isReady("test -f nope", dir, WORKFLOW_PATH), { kind: "not-ready" });
});

test("isReady: a probe that cannot be launched at all is unrunnable, not a guess in either direction", () => {
  // A nonexistent cwd makes spawnSync fail to launch /bin/sh at all (result.error set), as
  // distinct from the shell running and exiting nonzero — use a command that would report
  // "not ready" if it ever ran, so a mislabelled result can't hide behind a truthful one.
  // This used to answer "ready", which handed the phase to a gate on the strength of a
  // question nobody managed to ask; the caller now refuses instead.
  const brokenCwd = path.join(tmpdir(), "does-not-exist");
  assert.deepEqual(gate.isReady("false", brokenCwd, WORKFLOW_PATH), { kind: "unrunnable", reason: "ENOENT" });
});

test("isReady: a variable already in process.env still reaches the probe", () => {
  process.env.HEADSIGN_GATE_TEST_MARKER = "present";
  try {
    assert.deepEqual(gate.isReady('test "$HEADSIGN_GATE_TEST_MARKER" = "present"', tmpdir(), WORKFLOW_PATH), { kind: "ready" });
  } finally {
    delete process.env.HEADSIGN_GATE_TEST_MARKER;
  }
});

test("isReady: HEADSIGN_WORKFLOW_FILE carries the given path unchanged, relative or absolute", () => {
  const dir = tmpdir();
  for (const p of [".headsign/workflow.yaml", "/abs/does/not/need/to/exist/workflow.yaml"]) {
    assert.deepEqual(gate.isReady(`test "$HEADSIGN_WORKFLOW_FILE" = "${p}"`, dir, p), { kind: "ready" });
  }
});

// --- resolveRoute: which branch of a k-way on_pass answers (ADR-0011) ---

test("resolveRoute: the first matching when wins", () => {
  const resolution = gate.resolveRoute(
    [
      { when: "false", to: "a" },
      { when: "true", to: "b" },
      { when: "true", to: "c" },
      { to: "fallback" },
    ],
    tmpdir(),
    WORKFLOW_PATH,
  );
  assert.deepEqual(resolution, { kind: "matched", to: "b", when: "true" });
});

test("resolveRoute: no match falls to the entry without a when", () => {
  const resolution = gate.resolveRoute([{ when: "false", to: "a" }, { to: "fallback" }], tmpdir(), WORKFLOW_PATH);
  assert.deepEqual(resolution, { kind: "default", to: "fallback" });
});

test("resolveRoute: entries after the first match are not evaluated", () => {
  const dir = tmpdir();
  const marker = path.join(dir, "ran-later");
  gate.resolveRoute([{ when: "true", to: "a" }, { when: `touch ${marker}`, to: "b" }, { to: "fallback" }], dir, WORKFLOW_PATH);
  assert.equal(fs.existsSync(marker), false);
});

test("resolveRoute: predicates run in the given cwd, like runGate", () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, "marker"), "");
  assert.deepEqual(gate.resolveRoute([{ when: "test -f marker", to: "a" }, { to: "b" }], dir, WORKFLOW_PATH), {
    kind: "matched",
    to: "a",
    when: "test -f marker",
  });
});

test("resolveRoute: a timed-out predicate is an error, not a fall-through to the default", () => {
  const resolution = gate.resolveRoute([{ when: "sleep 5", to: "a", timeout: 0.2 }, { to: "fallback" }], tmpdir(), WORKFLOW_PATH);
  assert.deepEqual(resolution, { kind: "error", when: "sleep 5", reason: "timed out after 0.2s" });
});

test("resolveRoute: a predicate that cannot be launched at all is an error", () => {
  // Same trick as the isReady spawn-error test: a nonexistent cwd stops /bin/sh from
  // starting, which is not the same event as the shell running and exiting nonzero.
  const brokenCwd = path.join(tmpdir(), "does-not-exist");
  const resolution = gate.resolveRoute([{ when: "true", to: "a" }, { to: "fallback" }], brokenCwd, WORKFLOW_PATH);
  assert.equal(resolution.kind, "error");
  if (resolution.kind === "error") assert.equal(resolution.when, "true");
});

test("resolveRoute: a route list with no default entry is an error rather than a silent no-answer", () => {
  const resolution = gate.resolveRoute([{ when: "false", to: "a" }], tmpdir(), WORKFLOW_PATH);
  assert.equal(resolution.kind, "error");
});

test("resolveRoute: a variable already in process.env still reaches the predicate", () => {
  process.env.HEADSIGN_GATE_TEST_MARKER = "present";
  try {
    const resolution = gate.resolveRoute(
      [{ when: 'test "$HEADSIGN_GATE_TEST_MARKER" = "present"', to: "a" }, { to: "fallback" }],
      tmpdir(),
      WORKFLOW_PATH,
    );
    assert.deepEqual(resolution, { kind: "matched", to: "a", when: 'test "$HEADSIGN_GATE_TEST_MARKER" = "present"' });
  } finally {
    delete process.env.HEADSIGN_GATE_TEST_MARKER;
  }
});

test("resolveRoute: HEADSIGN_WORKFLOW_FILE carries the given path unchanged, relative or absolute", () => {
  const dir = tmpdir();
  for (const p of [".headsign/workflow.yaml", "/abs/does/not/need/to/exist/workflow.yaml"]) {
    const resolution = gate.resolveRoute([{ when: `test "$HEADSIGN_WORKFLOW_FILE" = "${p}"`, to: "a" }, { to: "fallback" }], dir, p);
    assert.deepEqual(resolution, { kind: "matched", to: "a", when: `test "$HEADSIGN_WORKFLOW_FILE" = "${p}"` });
  }
});
