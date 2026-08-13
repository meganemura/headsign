import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as engine from "../src/engine.ts";
import type { Workflow, Phase } from "../src/workflow.ts";
import type { State } from "../src/state.ts";
import type { GateVerdict } from "../src/gate.ts";

function wf(phases: Record<string, Partial<Phase> & { on_pass: Phase["on_pass"] }>, entry?: string): Workflow {
  const built: Record<string, Phase> = {};
  for (const [name, p] of Object.entries(phases)) {
    built[name] = { description: name, gate: { checks: [{ run: "true" }] }, ...p } as Phase;
  }
  return { version: 0.1, name: "wf", entry: entry ?? Object.keys(phases)[0], phases: built };
}

function st(phase: string, overrides: Partial<State> = {}): State {
  return {
    workflow: "wf",
    workflow_path: ".headsign/workflow.yaml",
    status: "running",
    phase,
    attempts: {},
    total_iterations: 0,
    last_failure: null,
    end_reason: null,
    stop_nudges: 0,
    driver_agent: null,
    last_stop: null,
    last_drive: null,
    // The graph pin as a run that has just started carries it: empty rather than absent, since
    // step() and the pure functions below never reconcile it (that is the lap's job) and only
    // ever have to carry it through untouched.
    graph_fingerprint: {},
    graph_change_reported: null,
    accepted_graph_changes: 0,
    ...overrides,
  };
}

// A GateVerdict, not a GateResult: step() takes only the two arms that are answers, and the
// third (a check that produced no exit code) is refused a lap earlier — see the `next` tests
// at the end of this file.
const PASS: GateVerdict = { kind: "pass" };
const FAIL = (check = "c", run = "r", exitCode: number | "timeout" = 1): GateVerdict => ({ kind: "fail", check, run, exitCode, outputTail: "out" });

// --- transition table (ADR-0002), every row ---

test("pass routes to the on_pass phase (ADVANCE)", () => {
  const workflow = wf({ a: { on_pass: "b" }, b: { on_pass: "$end" } });
  const { state, outcome } = engine.step(workflow, st("a"), PASS);
  assert.equal(state.phase, "b");
  assert.equal(state.status, "running");
  assert.deepEqual(outcome, { kind: "ADVANCE", phase: "b", description: "b" });
});

test("pass to $end completes the workflow", () => {
  const workflow = wf({ a: { on_pass: "$end" } });
  const { state, outcome } = engine.step(workflow, st("a"), PASS);
  assert.equal(state.status, "complete");
  assert.deepEqual(outcome, { kind: "COMPLETE" });
});

test("fail defaults to retry", () => {
  const workflow = wf({ a: { on_pass: "$end" } });
  const { state, outcome } = engine.step(workflow, st("a"), FAIL("unit", "npm test", 1));
  assert.equal(state.status, "running");
  assert.equal(state.attempts.a, 1);
  assert.deepEqual(state.last_failure, {
    phase: "a", check: "unit", run: "npm test", exit_code: 1, output_tail: "out", timeout_seconds: undefined, elapsed_seconds: undefined,
  });
  assert.deepEqual(outcome, {
    kind: "RETRY",
    phase: "a",
    attempt: 1,
    maxAttempts: undefined,
    failure: { check: "unit", run: "npm test", exitCode: 1, outputTail: "out", timeoutSeconds: undefined, elapsedSeconds: undefined },
  });
});

test("fail routes to a named phase (ADVANCE with failure note); attempts of the failed phase are retained", () => {
  const workflow = wf({ review: { on_pass: "$end", on_fail: "implement" }, implement: { on_pass: "review" } });
  const { state, outcome } = engine.step(workflow, st("review", { attempts: { review: 1 } }), FAIL("lint", "eslint", 2));
  assert.equal(state.phase, "implement");
  assert.equal(state.attempts.review, 2);
  assert.deepEqual(outcome, {
    kind: "ADVANCE",
    phase: "implement",
    description: "implement",
    failure: { check: "lint", run: "eslint", exitCode: 2, outputTail: "out", timeoutSeconds: undefined, elapsedSeconds: undefined, routedTo: "implement" },
  });
});

test("fail routes to escalate", () => {
  const workflow = wf({ a: { on_pass: "$end", on_fail: "escalate" } });
  const { state, outcome } = engine.step(workflow, st("a"), FAIL());
  assert.equal(state.status, "escalated");
  assert.equal(state.end_reason, "a: gate failed (on_fail: escalate)");
  assert.deepEqual(outcome, { kind: "ESCALATE", reason: "a: gate failed (on_fail: escalate)" });
});

test("fail routes to $end (COMPLETE)", () => {
  const workflow = wf({ a: { on_pass: "$end", on_fail: "$end" } });
  const { state, outcome } = engine.step(workflow, st("a"), FAIL());
  assert.equal(state.status, "complete");
  assert.deepEqual(outcome, { kind: "COMPLETE" });
});

// Exhaustion has one destination (ADR-0014): a spent budget always asks a person.
test("exhaustion escalates", () => {
  const workflow = wf({ a: { on_pass: "$end", max_attempts: 2 } });
  const s1 = engine.step(workflow, st("a"), FAIL()).state;
  const { state, outcome } = engine.step(workflow, s1, FAIL());
  assert.equal(state.attempts.a, 2);
  assert.equal(state.status, "escalated");
  assert.deepEqual(outcome, { kind: "ESCALATE", reason: "a: max_attempts (2) exhausted" });
});

// --- attempts semantics (ADR-0004) ---

test("attempts accumulate per-phase across bounces and escalate on the third failure", () => {
  const workflow = wf({ implement: { on_pass: "review" }, review: { on_pass: "$end", on_fail: "implement", max_attempts: 3 } });
  let s = st("implement");
  ({ state: s } = engine.step(workflow, s, PASS));
  assert.equal(s.phase, "review");

  ({ state: s } = engine.step(workflow, s, FAIL()));
  assert.equal(s.phase, "implement");
  assert.equal(s.attempts.review, 1);

  ({ state: s } = engine.step(workflow, s, PASS));
  assert.equal(s.attempts.review, 1);

  ({ state: s } = engine.step(workflow, s, FAIL()));
  assert.equal(s.attempts.review, 2);
  assert.equal(s.status, "running");

  ({ state: s } = engine.step(workflow, s, PASS));
  const { state: finalState, outcome } = engine.step(workflow, s, FAIL());
  assert.equal(finalState.attempts.review, 3);
  assert.equal(finalState.status, "escalated");
  assert.deepEqual(outcome, { kind: "ESCALATE", reason: "review: max_attempts (3) exhausted" });
});

test("attempts are cleared only when that phase's own gate passes", () => {
  const workflow = wf({ a: { on_pass: "$end" } });
  const { state } = engine.step(workflow, st("a", { attempts: { a: 5 } }), PASS);
  assert.equal(state.attempts.a, undefined);
});

// --- iteration limit (checked before gate evaluation) ---

test("checkIterationLimit escalates once total_iterations reaches the limit", () => {
  const workflow: Workflow = { ...wf({ a: { on_pass: "$end" } }), limits: { max_total_iterations: 5 } };
  const result = engine.checkIterationLimit(workflow, st("a", { total_iterations: 5 }));
  assert.equal(result?.kind, "ESCALATE");
  assert.match(result!.reason, /^a: max_total_iterations \(5\) reached/);
});

// The whole of ADR-0017: the ceiling answers, and changes nothing. A returned state is what
// used to end the run here, so its absence from the return type is the guarantee.
test("checkIterationLimit returns an outcome only — it produces no new state", () => {
  const workflow: Workflow = { ...wf({ a: { on_pass: "$end" } }), limits: { max_total_iterations: 5 } };
  const result = engine.checkIterationLimit(workflow, st("a", { total_iterations: 5, driver_agent: "agent-1" }));
  assert.deepEqual(Object.keys(result!).sort(), ["kind", "reason"]);
});

test("the ceiling's reason names both ways forward: raising the limit where it is written, and abort", () => {
  const workflow: Workflow = { ...wf({ a: { on_pass: "$end" } }), limits: { max_total_iterations: 5 } };
  const result = engine.checkIterationLimit(workflow, st("a", { total_iterations: 5, workflow_path: ".headsign/fitness.yaml" }));
  assert.match(result!.reason, /raise limits\.max_total_iterations in \.headsign\/fitness\.yaml/);
  assert.match(result!.reason, /run `headsign next` to continue/);
  assert.match(result!.reason, /headsign abort <reason>/);
  // One line: the reason is the tail of ESCALATE's token line and of one log record.
  assert.doesNotMatch(result!.reason, /\n/);
});

test("checkIterationLimit is null below the limit or when unconfigured", () => {
  const workflow: Workflow = { ...wf({ a: { on_pass: "$end" } }), limits: { max_total_iterations: 5 } };
  assert.equal(engine.checkIterationLimit(workflow, st("a", { total_iterations: 4 })), null);
  assert.equal(engine.checkIterationLimit(wf({ a: { on_pass: "$end" } }), st("a", { total_iterations: 999 })), null);
});

// --- k-way on_pass (ADR-0011): step() reads the branch the caller already resolved ---

const ROUTED = { a: { on_pass: [{ when: "w1", to: "b" }, { when: "w2", to: "c" }, { to: "d" }] }, b: { on_pass: "$end" }, c: { on_pass: "$end" }, d: { on_pass: "$end" } };

test("a matched route sends the pass to that route's target and names the when in routedBy", () => {
  const workflow = wf(ROUTED);
  const { state, outcome } = engine.step(workflow, st("a"), PASS, { kind: "matched", to: "c", when: "w2" });
  assert.equal(state.phase, "c");
  assert.deepEqual(outcome, { kind: "ADVANCE", phase: "c", description: "c", routedBy: { when: "w2" } });
});

test("a default resolution sends the pass to the default target and marks routedBy as default", () => {
  const workflow = wf(ROUTED);
  const { state, outcome } = engine.step(workflow, st("a"), PASS, { kind: "default", to: "d" });
  assert.equal(state.phase, "d");
  assert.deepEqual(outcome, { kind: "ADVANCE", phase: "d", description: "d", routedBy: { default: true } });
});

test("a route to $end completes the workflow, same as the string form", () => {
  const workflow = wf({ a: { on_pass: [{ when: "w1", to: "b" }, { to: "$end" }] }, b: { on_pass: "$end" } });
  const { state, outcome } = engine.step(workflow, st("a"), PASS, { kind: "matched", to: "$end", when: "w1" });
  assert.equal(state.status, "complete");
  assert.deepEqual(outcome, { kind: "COMPLETE" });
});

test("a routed pass clears the phase's attempts like any other pass", () => {
  const workflow = wf(ROUTED);
  const { state } = engine.step(workflow, st("a", { attempts: { a: 2 } }), PASS, { kind: "default", to: "d" });
  assert.deepEqual(state.attempts, {});
});

test("a string on_pass ignores any resolution handed to it and adds no routedBy key", () => {
  const workflow = wf({ a: { on_pass: "b" }, b: { on_pass: "$end" } });
  const { state, outcome } = engine.step(workflow, st("a"), PASS, { kind: "matched", to: "nowhere", when: "w1" });
  assert.equal(state.phase, "b");
  assert.deepEqual(outcome, { kind: "ADVANCE", phase: "b", description: "b" });
});

test("a failing gate never consults the route list: on_fail decides, and routedBy stays absent", () => {
  const workflow = wf({ ...ROUTED, a: { on_pass: ROUTED.a.on_pass, on_fail: "d" } });
  const { state, outcome } = engine.step(workflow, st("a"), FAIL("lint", "eslint", 2));
  assert.equal(state.phase, "d");
  assert.deepEqual(outcome, {
    kind: "ADVANCE",
    phase: "d",
    description: "d",
    failure: { check: "lint", run: "eslint", exitCode: 2, outputTail: "out", timeoutSeconds: undefined, elapsedSeconds: undefined, routedTo: "d" },
  });
});

test("a k-way pass with no resolution throws rather than guessing a destination", () => {
  const workflow = wf(ROUTED);
  assert.throws(() => engine.step(workflow, st("a"), PASS), /no resolution/);
});

// --- last_failure: written on a retry, cleared everywhere else ---
// It exists for `status` alone (nothing in step() reads it back), so what matters is that a
// failure the run has moved past can never be shown as if it were current.

const STALE: NonNullable<State["last_failure"]> = { phase: "a", check: "c", run: "r", exit_code: 1, output_tail: "o" };

test("a pass clears last_failure", () => {
  const workflow = wf({ a: { on_pass: "b" }, b: { on_pass: "$end" } });
  const { state } = engine.step(workflow, st("a", { last_failure: STALE }), PASS);
  assert.equal(state.last_failure, null);
});

test("a fail routed to another phase clears last_failure", () => {
  const workflow = wf({ a: { on_pass: "$end", on_fail: "b" }, b: { on_pass: "$end" } });
  const { state } = engine.step(workflow, st("a", { last_failure: STALE }), FAIL());
  assert.equal(state.phase, "b");
  assert.equal(state.last_failure, null);
});

test("a terminal outcome (exhaustion, on_fail: escalate, $end) clears last_failure", () => {
  const exhausting = wf({ a: { on_pass: "$end", max_attempts: 1 } });
  assert.equal(engine.step(exhausting, st("a", { last_failure: STALE }), FAIL()).state.last_failure, null);

  const escalating = wf({ a: { on_pass: "$end", on_fail: "escalate" } });
  assert.equal(engine.step(escalating, st("a", { last_failure: STALE }), FAIL()).state.last_failure, null);

  const ending = wf({ a: { on_pass: "$end", on_fail: "$end" } });
  assert.equal(engine.step(ending, st("a", { last_failure: STALE }), FAIL()).state.last_failure, null);
});

// step() carries gate.ts's elapsedSeconds through unchanged, the same way it carries every
// other CheckFailure field — no measuring, no rounding, here (that is gate.ts's job).
test("a retry carries the gate verdict's elapsedSeconds into both last_failure.elapsed_seconds and the RETRY outcome", () => {
  const workflow = wf({ a: { on_pass: "$end" } });
  const verdict: GateVerdict = { kind: "fail", check: "unit", run: "npm test", exitCode: 1, outputTail: "out", elapsedSeconds: 12.3 };
  const { state, outcome } = engine.step(workflow, st("a"), verdict);
  assert.equal(state.last_failure?.elapsed_seconds, 12.3);
  assert.equal(outcome.kind, "RETRY");
  if (outcome.kind === "RETRY") assert.equal(outcome.failure.elapsedSeconds, 12.3);
});

// --- stop_nudges loop guard (ADR-0006): step() always resets it, since it only runs on a real evaluation ---

test("step() resets stop_nudges to 0 after a real pass evaluation", () => {
  const workflow = wf({ a: { on_pass: "$end" } });
  const { state } = engine.step(workflow, st("a", { stop_nudges: 2 }), PASS);
  assert.equal(state.stop_nudges, 0);
});

test("step() resets stop_nudges to 0 after a real fail evaluation", () => {
  const workflow = wf({ a: { on_pass: "$end" } });
  const { state } = engine.step(workflow, st("a", { stop_nudges: 3 }), FAIL());
  assert.equal(state.stop_nudges, 0);
});

// --- driver_agent propagation (ADR-0010/0013): step()'s `{ ...state }` spread must carry it
// through untouched on every outcome kind. The SubagentStop adoption gate is the only writer
// of this field, and `next` runs between adoptions — a driver that a phase transition quietly
// dropped would silently hand the run back to "nobody has claimed this".

test("step() carries driver_agent through unchanged on a pass (ADVANCE)", () => {
  const workflow = wf({ a: { on_pass: "b" }, b: { on_pass: "$end" } });
  const { state } = engine.step(workflow, st("a", { driver_agent: "agent-1" }), PASS);
  assert.equal(state.driver_agent, "agent-1");
});

test("step() carries driver_agent through unchanged on a fail (RETRY)", () => {
  const workflow = wf({ a: { on_pass: "$end" } });
  const { state } = engine.step(workflow, st("a", { driver_agent: "agent-1" }), FAIL());
  assert.equal(state.driver_agent, "agent-1");
});

test("step() carries a null driver_agent through unchanged (never invents one)", () => {
  const workflow = wf({ a: { on_pass: "$end" } });
  const { state } = engine.step(workflow, st("a", { driver_agent: null }), PASS);
  assert.equal(state.driver_agent, null);
});

// The third member of this cluster — that checkIterationLimit's escalated state kept
// driver_agent — is gone with the state it asserted about (ADR-0017): the ceiling now
// returns no state, which the "produces no new state" test above covers for every field at
// once.

// --- terminal idempotency ---

test("terminalOutcome reprints complete/escalated/aborted", () => {
  assert.deepEqual(engine.terminalOutcome(st("a", { status: "complete" })), { kind: "COMPLETE" });
  assert.deepEqual(engine.terminalOutcome(st("a", { status: "escalated", end_reason: "boom" })), { kind: "ESCALATE", reason: "boom" });
  assert.deepEqual(engine.terminalOutcome(st("a", { status: "aborted", end_reason: "stop" })), { kind: "ABORT", reason: "stop" });
});

// --- preconditions: the three entry points are total ---
//
// Every one of these was, until now, a plausible wrong answer rather than a complaint —
// and every one was unreachable only because cli.ts checks the run's status first and
// loads only validated workflows. The guard's whole point is that the reason they were
// unreachable lived in another file.

test("terminalOutcome refuses a run that is still running (it used to answer ABORT)", () => {
  assert.throws(
    () => engine.terminalOutcome(st("a", { status: "running" })),
    /terminalOutcome: run is still running/,
  );
});

test("step refuses a run that has already ended (it used to judge it again)", () => {
  const workflow = wf({ a: { on_pass: "$end" } });
  for (const status of ["complete", "escalated", "aborted"] as const) {
    assert.throws(() => engine.step(workflow, st("a", { status }), FAIL()), new RegExp(`step: run is already ${status}`));
  }
});

test("checkIterationLimit refuses a run that has already ended", () => {
  // It would otherwise say "the run is still open: raise limits.max_total_iterations …"
  // about a run that finished — a false sentence offered as guidance.
  const workflow = { ...wf({ a: { on_pass: "$end" } }), limits: { max_total_iterations: 1 } };
  assert.throws(
    () => engine.checkIterationLimit(workflow, st("a", { status: "complete", total_iterations: 5 })),
    /checkIterationLimit: run is already complete; ask terminalOutcome instead/,
  );
});

test("step names the workflow and the destination when a pass routes to no phase", () => {
  const workflow = wf({ a: { on_pass: "ghost" } });
  assert.throws(
    () => engine.step(workflow, st("a"), PASS),
    /step: destination 'ghost' does not name a phase in workflow 'wf'/,
  );
});

test("step names the destination when a failure route names no phase", () => {
  const workflow = wf({ a: { on_pass: "$end", on_fail: "ghost" } });
  assert.throws(
    () => engine.step(workflow, st("a"), FAIL()),
    /step: destination 'ghost' does not name a phase in workflow 'wf'/,
  );
});

test("the guards leave every normal answer untouched", () => {
  const workflow = { ...wf({ a: { on_pass: "b" }, b: { on_pass: "$end" } }), limits: { max_total_iterations: 9 } };
  assert.equal(engine.checkIterationLimit(workflow, st("a")), null);
  assert.deepEqual(engine.terminalOutcome(st("a", { status: "complete" })), { kind: "COMPLETE" });
  assert.equal(engine.step(workflow, st("a"), PASS).outcome.kind, "ADVANCE");
});

// --- a lap that got no verdict: `next` refuses, and leaves the run byte-for-byte alone ---
//
// The only tests in this file that touch a filesystem, and they have to: the claim is about
// what a whole lap did NOT write, which step() alone cannot show. Both shell failures below
// are real, reproduced the two ways this runner can be made to produce no exit code on demand:
//   - a check whose output floods past maxBuffer (`yes`) — spawnSync kills it: ENOBUFS.
//   - a probe whose command string is bigger than the kernel's argument limit — execve never
//     starts it: E2BIG. (isReady discards output, so ENOBUFS cannot reach that path.)
// A nonexistent cwd, which gate.test.ts uses, is not available here: `next` reads the run
// record out of that same directory, so a missing one never reaches a gate at all.

const START_TIME = "2026-07-29T12:00:00+09:00";
const LAP_TIME = "2026-07-29T12:00:01+09:00";

// No CLAUDE_CODE_SESSION_ID, so `start`/`next` below never stamp `last_drive` — deliberate for
// every test in this section, which is about what a lap writes to the REST of state.json and
// asserts byte-for-byte equality against it. A dedicated last_drive-stamping test using an
// env that does carry the variable lives with the rest of the ADR-0027 tests further down.
const NO_ENV: NodeJS.ProcessEnv = {};

function startedRun(workflowYaml: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "headsign-engine-"));
  fs.mkdirSync(path.join(dir, ".headsign"));
  // Absolute: engine.start hands the path to workflow.load as given, and these tests run in
  // the repo's own cwd rather than the run's.
  const workflowPath = path.join(dir, ".headsign", "workflow.yaml");
  fs.writeFileSync(workflowPath, workflowYaml);
  assert.equal(engine.start(dir, workflowPath, START_TIME, NO_ENV).result.kind, "STARTED");
  return dir;
}

function snapshot(dir: string): { state: Buffer; log: Buffer } {
  return {
    state: fs.readFileSync(path.join(dir, ".headsign", "state.json")),
    log: fs.readFileSync(path.join(dir, ".headsign", "log")),
  };
}

test("a gate check that produced no exit code refuses the lap: nothing written, nothing counted", () => {
  const dir = startedRun(`
version: 0.1
name: floods
entry: build
phases:
  build:
    description: "Build."
    gate:
      checks:
        - name: "unit tests"
          run: "yes"
    on_pass: "$end"
    max_attempts: 2
`);
  const before = snapshot(dir);

  const result = engine.next(dir, LAP_TIME, NO_ENV);
  assert.equal(result.kind, "REFUSED");
  if (result.kind === "REFUSED") {
    assert.match(result.message, /^phase 'build': could not run the gate check 'unit tests' \(`yes`\) — ENOBUFS\./);
    assert.match(result.message, /the run has not moved and no attempt was spent/);
    assert.match(result.message, /Fix that command in '.*\/\.headsign\/workflow\.yaml'/);
  }

  const after = snapshot(dir);
  assert.deepEqual(after.state, before.state, "state.json must be byte-identical: no attempt, no iteration, no phase change");
  assert.deepEqual(after.log, before.log, "no transition happened, so nothing is logged");
  assert.equal(fs.existsSync(path.join(dir, ".headsign", "lock")), false, "the lock is released before returning");
});

test("a readiness probe that produced no exit code refuses the lap too — it is neither ready nor not-ready", () => {
  // Larger than ARG_MAX on macOS and than MAX_ARG_STRLEN (128 KiB) on Linux, so execve
  // refuses the command outright on both. Asserted with `ok` rather than `match` so a
  // failure prints this sentence instead of a megabyte and a half of the probe.
  const oversizedProbe = "x".repeat(1_500_000);
  const dir = startedRun(`
version: 0.1
name: probe-too-big
entry: review
phases:
  review:
    description: "Review."
    ready: "${oversizedProbe}"
    gate:
      checks:
        - run: "true"
    on_pass: "$end"
`);
  const before = snapshot(dir);

  const result = engine.next(dir, LAP_TIME, NO_ENV);
  assert.equal(result.kind, "REFUSED");
  if (result.kind === "REFUSED") {
    assert.ok(result.message.startsWith("phase 'review': could not run the readiness probe `x"), "names the phase and the probe");
    assert.ok(result.message.includes("` — E2BIG. "), "names why it could not run");
    assert.ok(result.message.includes("the run has not moved and no attempt was spent"), "says the run did not move");
    assert.ok(result.message.includes("Fix that command in '"), "names the file to fix it in");
  }

  const after = snapshot(dir);
  assert.deepEqual(after.state, before.state, "state.json must be byte-identical: a refused probe is not a PENDING and not an attempt");
  assert.deepEqual(after.log, before.log, "no transition happened, so nothing is logged");
  assert.equal(fs.existsSync(path.join(dir, ".headsign", "lock")), false, "the lock is released before returning");
});

// A real lap (gate.ts actually spawns the check), so this is the whole path: gate.ts measures
// it, engine.ts's `next` writes it into state.json's last_failure.elapsed_seconds, and
// engine.ts's `status` reads it back out as StatusFailure.elapsedSeconds — the SAVED half and
// the RESTORED half of the field, both real I/O, neither a step() fixture.
test("a real gate failure's elapsedSeconds is saved to state.json and comes back out of status()", () => {
  const dir = startedRun(`
version: 0.1
name: demo
entry: build
phases:
  build:
    description: "Build."
    gate:
      checks:
        - run: "sleep 0.2 && exit 1"
    on_pass: "$end"
`);

  const result = engine.next(dir, LAP_TIME, NO_ENV);
  assert.equal(result.kind, "ANSWERED");
  if (result.kind === "ANSWERED") assert.equal(result.outcome.kind, "RETRY");

  const saved = (JSON.parse(fs.readFileSync(path.join(dir, ".headsign", "state.json"), "utf8")) as { last_failure: { elapsed_seconds: unknown } }).last_failure
    .elapsed_seconds;
  assert.equal(typeof saved, "number");
  assert.ok((saved as number) >= 0.2, `expected >= 0.2, got ${saved}`);

  const status = engine.status(dir, NO_ENV);
  assert.equal(status.kind, "RUNNING");
  if (status.kind === "RUNNING") assert.equal(status.lastFailure?.elapsedSeconds, saved, "restored verbatim, the same number status() reads off the record");
});

// --- clear: what clearPhaseArtifacts (engine.ts) reports, on a real filesystem ---
//
// The split is statSync's, not rmSync's: a non-empty file is removed and reported in `cleared`;
// anything statSync finds that is not a file — a directory, here — is left standing (rmSync's
// EISDIR is still swallowed, same as before this change) and reported in `notCleared` instead
// of the silence the old behaviour left. An empty file and a path that never existed keep the
// meaning they already had: neither list mentions them.

test("start: a non-empty file clears, a directory does not (and stays on disk) — an empty file and a missing path say nothing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "headsign-engine-"));
  fs.mkdirSync(path.join(dir, ".headsign"));
  fs.writeFileSync(path.join(dir, "artifact.txt"), "leftover\n");
  fs.writeFileSync(path.join(dir, "empty.txt"), "");
  fs.mkdirSync(path.join(dir, "scratch-dir"));
  const workflowPath = path.join(dir, ".headsign", "workflow.yaml");
  fs.writeFileSync(
    workflowPath,
    `
version: 0.1
name: demo
entry: build
phases:
  build:
    description: "Build."
    clear: [artifact.txt, empty.txt, missing.txt, scratch-dir]
    gate:
      checks:
        - run: "true"
    on_pass: "$end"
`,
  );

  const result = engine.start(dir, workflowPath, START_TIME, NO_ENV);
  assert.equal(result.result.kind, "STARTED");
  if (result.result.kind !== "STARTED") return;
  assert.deepEqual(result.result.cleared, ["artifact.txt"]);
  assert.deepEqual(result.result.notCleared, ["scratch-dir"]);
  assert.equal(fs.existsSync(path.join(dir, "artifact.txt")), false, "the non-empty file is gone");
  assert.equal(fs.existsSync(path.join(dir, "scratch-dir")), true, "the directory is left standing — clear: never removes directories");
});

test("next (ADVANCE): the destination phase's directory clear entry comes back as notCleared, same as at start", () => {
  const dir = startedRun(`
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
    clear: [scratch-dir]
    gate:
      checks:
        - run: "true"
    on_pass: "$end"
`);
  fs.mkdirSync(path.join(dir, "scratch-dir"));

  const result = engine.next(dir, LAP_TIME, NO_ENV);
  assert.equal(result.kind, "ANSWERED");
  if (result.kind !== "ANSWERED") return;
  assert.equal(result.outcome.kind, "ADVANCE");
  assert.deepEqual(result.cleared, []);
  assert.deepEqual(result.notCleared, ["scratch-dir"]);
  assert.equal(fs.existsSync(path.join(dir, "scratch-dir")), true, "the directory survives — clear: never removes directories");
});

// --- the graph pin: a lap notices when its own rules moved under it ---
//
// Whole laps again, and again they have to be: the claim is about what a lap wrote, in which
// order, and whether the gate downstream of the check ran at all — none of which step() can
// show on its own. Every test below edits the workflow file mid-run, which is a thing headsign
// deliberately allows (ADR-0016 §5, ADR-0017); what is under test is that the edit is
// reported, counted and then obeyed, never refused.

function writeWorkflowFile(dir: string, yaml: string): void {
  fs.writeFileSync(path.join(dir, ".headsign", "workflow.yaml"), yaml);
}

function runState(dir: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(dir, ".headsign", "state.json"), "utf8"));
}

function graphLogLines(dir: string): string[] {
  return fs
    .readFileSync(path.join(dir, ".headsign", "log"), "utf8")
    .split("\n")
    .filter((line) => line.includes(" graph-changed "));
}

// `next` and then the answer, with the two non-answers (a refusal, an invalid workflow) turned
// into a test failure that names what came back instead.
function lap(dir: string): engine.Outcome {
  const result = engine.next(dir, LAP_TIME, NO_ENV);
  if (result.kind !== "ANSWERED") assert.fail(`expected an answered lap, got ${result.kind}: ${JSON.stringify(result)}`);
  return result.outcome;
}

// `implement`'s gate is a file check so a lap can be made to fail (RETRY, stays put) or pass
// (ADVANCE) on demand, and `review` is downstream so reachability can be narrowed by simply
// letting the run advance.
function pinnedWorkflow(opts: { implementGate?: string; reviewAttempts?: number; ceiling?: number } = {}): string {
  const attempts = opts.reviewAttempts === undefined ? "" : `    max_attempts: ${opts.reviewAttempts}\n`;
  const ceiling = opts.ceiling === undefined ? "" : `limits:\n  max_total_iterations: ${opts.ceiling}\n`;
  return (
    `version: 0.1\n` +
    `name: pinned\n` +
    `entry: implement\n` +
    `phases:\n` +
    `  implement:\n` +
    `    description: "Implement."\n` +
    `    gate:\n` +
    `      checks:\n` +
    `        - name: "marker"\n` +
    `          run: "${opts.implementGate ?? "test -f marker.txt"}"\n` +
    `    on_pass: review\n` +
    `  review:\n` +
    `    description: "Review."\n` +
    `    gate:\n` +
    `      checks:\n` +
    `        - run: "true"\n` +
    `    on_pass: "$end"\n` +
    attempts +
    ceiling
  );
}

test("graph pin: a lap that changed nothing leaves the pin alone and writes no graph-changed line", () => {
  const dir = startedRun(pinnedWorkflow());
  const before = runState(dir).graph_fingerprint;

  assert.equal(lap(dir).kind, "RETRY");

  const after = runState(dir);
  assert.deepEqual(after.graph_fingerprint, before, "an untouched workflow must not move the pin");
  assert.equal(after.graph_change_reported, null);
  assert.equal(after.accepted_graph_changes, 0);
  assert.deepEqual(graphLogLines(dir), []);
});

// The heart of it: the run is NOT ended, nothing is counted, and the only thing written is the
// marker — so the next thing the person does decides what this was.
test("graph pin: rewriting the current phase's gate escalates without ending the run or counting anything", () => {
  const dir = startedRun(pinnedWorkflow());
  const before = runState(dir);
  writeWorkflowFile(dir, pinnedWorkflow({ implementGate: "true" }));

  const outcome = lap(dir);
  assert.equal(outcome.kind, "ESCALATE");
  if (outcome.kind === "ESCALATE") {
    assert.equal(
      outcome.reason,
      `implement: the workflow's rules changed under this run (phase 'implement') — the run is still open and nothing was counted: ` +
        `restore '${path.join(dir, ".headsign", "workflow.yaml")}' to what this run has been running, or run \`headsign next\` again to accept the change and continue. ` +
        "An accepted change is counted and reported at COMPLETE.",
    );
    // One line, like the ceiling's reason: it is the tail of ESCALATE's token line.
    assert.doesNotMatch(outcome.reason, /\n/);
  }

  const after = runState(dir);
  assert.equal(after.status, "running", "the run stays open — this is a question, not an ending");
  assert.equal(after.phase, before.phase);
  assert.equal(after.total_iterations, before.total_iterations, "the changed gate was not run, so no iteration was spent");
  assert.deepEqual(after.attempts, before.attempts);
  assert.equal(after.accepted_graph_changes, 0, "nothing is counted until it is accepted");
  assert.match(after.graph_change_reported as string, /^[0-9a-f]{64}$/);
  assert.deepEqual(after.graph_fingerprint, before.graph_fingerprint, "the pin stays on the rules this run has been running");
  assert.deepEqual(graphLogLines(dir), [`${LAP_TIME} graph-changed implement a=0 i=0 state=reported phases=implement`]);
});

test("graph pin: asking again accepts the change, counts it once, and runs the NEW gate in that same lap", () => {
  const dir = startedRun(pinnedWorkflow());
  const pinBefore = runState(dir).graph_fingerprint as Record<string, string>;
  writeWorkflowFile(dir, pinnedWorkflow({ implementGate: "true" }));
  assert.equal(lap(dir).kind, "ESCALATE");

  // The accepted gate is `true`, so a lap that actually ran it advances — which is how this
  // test can tell acceptance from a second report.
  assert.equal(lap(dir).kind, "ADVANCE");

  const after = runState(dir);
  assert.equal(after.accepted_graph_changes, 1);
  assert.equal(after.graph_change_reported, null, "the marker is spent by the acceptance");
  assert.equal(after.total_iterations, 1, "the gate really ran in the accepting lap");
  assert.notEqual((after.graph_fingerprint as Record<string, string>).implement, pinBefore.implement, "the pin moved onto the accepted rules");
  assert.deepEqual(graphLogLines(dir).map((l) => l.split(" ").slice(-2).join(" ")), [
    "state=reported phases=implement",
    "state=accepted phases=implement",
  ]);
});

// The reason restoring must cost nothing: it is the most correct response to the report, and a
// design that counted it would punish it. (Updating the pin at report time is what would make
// the restore look like a second change — see reconcileGraphPin.)
test("graph pin: putting the file back after a report is free and silent", () => {
  const dir = startedRun(pinnedWorkflow());
  writeWorkflowFile(dir, pinnedWorkflow({ implementGate: "true" }));
  assert.equal(lap(dir).kind, "ESCALATE");

  writeWorkflowFile(dir, pinnedWorkflow());
  assert.equal(lap(dir).kind, "RETRY", "the restored gate ran and answered, exactly as if nothing had happened");

  const after = runState(dir);
  assert.equal(after.accepted_graph_changes, 0, "a change that was undone was never accepted");
  assert.equal(after.graph_change_reported, null, "the marker goes when the difference goes");
  assert.equal(graphLogLines(dir).length, 1, "the restore adds no line of its own");
});

// Why the marker is a digest and not a flag: a second edit made after the report must not ride
// in on the first one's acknowledgement.
test("graph pin: a further edit after a report is reported again, naming every key that has moved", () => {
  const dir = startedRun(pinnedWorkflow());
  writeWorkflowFile(dir, pinnedWorkflow({ implementGate: "true" }));
  assert.equal(lap(dir).kind, "ESCALATE");
  const firstMarker = runState(dir).graph_change_reported;

  writeWorkflowFile(dir, pinnedWorkflow({ implementGate: "true", reviewAttempts: 3 }));
  const outcome = lap(dir);
  assert.equal(outcome.kind, "ESCALATE");
  if (outcome.kind === "ESCALATE") assert.match(outcome.reason, /\(phases 'implement', 'review'\)/);

  const after = runState(dir);
  assert.equal(after.accepted_graph_changes, 0);
  assert.notEqual(after.graph_change_reported, firstMarker, "a new difference is a new question");
  assert.deepEqual(graphLogLines(dir).map((l) => l.split(" ").slice(-2).join(" ")), [
    "state=reported phases=implement",
    "state=reported phases=implement,review",
  ]);
});

// ADR-0016 §5 in one test: a run only depends on the phases it has not entered yet, so
// rewriting one it has walked past is the ordinary way a workflow improves itself mid-run.
test("graph pin: rewriting a phase the run can no longer reach is not a change to its rules", () => {
  const dir = startedRun(pinnedWorkflow());
  fs.writeFileSync(path.join(dir, "marker.txt"), "");
  assert.equal(lap(dir).kind, "ADVANCE");

  writeWorkflowFile(dir, pinnedWorkflow({ implementGate: "false" }));
  assert.equal(lap(dir).kind, "COMPLETE", "review's own gate decided this lap, with nothing to report");

  const after = runState(dir);
  assert.equal(after.accepted_graph_changes, 0);
  assert.equal(after.graph_change_reported, null);
  assert.deepEqual(graphLogLines(dir), []);
});

// Raising the ceiling is not asked about twice (ADR-0017): the ESCALATE a person just read WAS
// the beat where they decided this run may keep going.
test("graph pin: a limits-only change is accepted on the spot — no report, and the lap carries on", () => {
  const dir = startedRun(pinnedWorkflow({ ceiling: 5 }));
  assert.equal(lap(dir).kind, "RETRY");

  writeWorkflowFile(dir, pinnedWorkflow({ ceiling: 6 }));
  assert.equal(lap(dir).kind, "RETRY", "the gate ran in the same lap that accepted the new ceiling");

  const after = runState(dir);
  assert.equal(after.accepted_graph_changes, 1, "accepted without being asked, but never uncounted");
  assert.equal(after.graph_change_reported, null);
  assert.equal(after.total_iterations, 2);
  // a=1 i=1, not the 2/2 the lap ends on: a log line reports the state right after the event it
  // describes, and the event here is the acceptance, which spends no attempt and no iteration.
  // The gate that then ran in the same lap gets its own line.
  assert.deepEqual(graphLogLines(dir), [`${LAP_TIME} graph-changed implement a=1 i=1 state=accepted phases=$limits`]);
});

// The documented way out of the wall, end to end: it has to stay ONE lap, or the pin has made
// ADR-0017's own advice cost twice what it says it costs.
test("graph pin: raising the ceiling at the wall resumes the run in a single lap", () => {
  const dir = startedRun(pinnedWorkflow({ ceiling: 1 }));
  assert.equal(lap(dir).kind, "RETRY");
  const atTheWall = lap(dir);
  assert.equal(atTheWall.kind, "ESCALATE");
  if (atTheWall.kind === "ESCALATE") assert.match(atTheWall.reason, /max_total_iterations \(1\) reached/);

  writeWorkflowFile(dir, pinnedWorkflow({ ceiling: 5 }));
  assert.equal(lap(dir).kind, "RETRY", "one `next` after raising the limit runs the gate — no stop in between");
  assert.equal(runState(dir).total_iterations, 2);
});

// The transitional half of the tolerance state.ts describes: a run already in progress when
// these fields shipped has none of them, and a run that never pinned anything cannot have had
// its rules changed under it.
test("graph pin: a state.json from before the pin existed is adopted in silence", () => {
  const dir = startedRun(pinnedWorkflow());
  const legacy = runState(dir);
  delete legacy.graph_fingerprint;
  delete legacy.graph_change_reported;
  delete legacy.accepted_graph_changes;
  fs.writeFileSync(path.join(dir, ".headsign", "state.json"), JSON.stringify(legacy, null, 2) + "\n");

  writeWorkflowFile(dir, pinnedWorkflow({ implementGate: "true" }));
  assert.equal(lap(dir).kind, "ADVANCE", "no report: there was no pin for the edit to contradict");

  const after = runState(dir);
  assert.equal(after.accepted_graph_changes, 0, "nothing was accepted, because nothing was reported");
  assert.equal(after.graph_change_reported, null);
  assert.ok(after.graph_fingerprint, "the lap leaves the run pinned from here on");
  assert.deepEqual(graphLogLines(dir), []);
});

// COMPLETE is where the count reaches a person who was not watching: `.headsign/log` is
// gitignored, so this line is the only one a pull-request reviewer can see.
test("graph pin: an accepted change is carried all the way to COMPLETE, and a run without one carries nothing", () => {
  const dir = startedRun(pinnedWorkflow());
  writeWorkflowFile(dir, pinnedWorkflow({ implementGate: "true" }));
  assert.equal(lap(dir).kind, "ESCALATE");
  assert.equal(lap(dir).kind, "ADVANCE");
  assert.deepEqual(lap(dir), { kind: "COMPLETE", acceptedGraphChanges: 1 });
  // A reprint of a finished run says the same thing: asking twice must not lose the fact.
  assert.deepEqual(lap(dir), { kind: "COMPLETE", acceptedGraphChanges: 1 });

  const untouched = startedRun(pinnedWorkflow({ implementGate: "true" }));
  assert.equal(lap(untouched).kind, "ADVANCE");
  assert.deepEqual(lap(untouched), { kind: "COMPLETE" }, "no key at all, so the output is byte-identical to what it always was");
});

// --- ADR-0027: last_drive, the session that most recently drove this run ---
//
// `start` and `next` compute the stamp through the same private helper (`driveStamp`), so
// these tests exercise it through both entry points rather than in isolation. PENDING and the
// global ceiling — the two `next` paths that write no other part of state.json — are tested
// through the CLI in cli.test.ts, alongside the rest of `status`'s `last moved:` line; what
// belongs here is the plain shape: what gets written, and with which env's session.

const SOLO_WORKFLOW = `
version: 0.1
name: solo
entry: a
phases:
  a:
    description: "A."
    gate:
      checks:
        - run: "true"
    on_pass: "$end"
`;

function freshWorkflowDir(yaml: string): { dir: string; workflowPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "headsign-engine-"));
  fs.mkdirSync(path.join(dir, ".headsign"));
  const workflowPath = path.join(dir, ".headsign", "workflow.yaml");
  fs.writeFileSync(workflowPath, yaml);
  return { dir, workflowPath };
}

test("start: a resolvable CLAUDE_CODE_SESSION_ID is stamped into last_drive, at start's own nowIso", () => {
  const { dir, workflowPath } = freshWorkflowDir(SOLO_WORKFLOW);
  const result = engine.start(dir, workflowPath, START_TIME, { CLAUDE_CODE_SESSION_ID: "session-alpha" });
  assert.equal(result.result.kind, "STARTED");
  assert.deepEqual(runState(dir).last_drive, { session: "session-alpha", at: START_TIME });
});

test("start: no CLAUDE_CODE_SESSION_ID in the env it is handed -> last_drive is null", () => {
  const { dir, workflowPath } = freshWorkflowDir(SOLO_WORKFLOW);
  const result = engine.start(dir, workflowPath, START_TIME, NO_ENV);
  assert.equal(result.result.kind, "STARTED");
  assert.equal(runState(dir).last_drive, null);
});

test("next: re-stamps last_drive with the CALLING env's own session and the lap's own nowIso, every real evaluation", () => {
  const { dir, workflowPath } = freshWorkflowDir(SOLO_WORKFLOW);
  engine.start(dir, workflowPath, START_TIME, { CLAUDE_CODE_SESSION_ID: "session-alpha" });

  const result = engine.next(dir, LAP_TIME, { CLAUDE_CODE_SESSION_ID: "session-beta" });
  assert.equal(result.kind, "ANSWERED");
  assert.deepEqual(runState(dir).last_drive, { session: "session-beta", at: LAP_TIME }, "the session that ran THIS lap, and when it ran, replace the old stamp");
});

// The safe direction (ADR-0027 §5): an unresolvable session on `next` is itself a real "who
// drove this" answer — nobody Claude Code can name — and a stale name left behind would keep
// a backstop pointed at a party no longer moving the run. Clearing, not keeping, is correct.
test("next: a stamped run, called with an env carrying no session id, has last_drive reset to null", () => {
  const { dir, workflowPath } = freshWorkflowDir(SOLO_WORKFLOW);
  engine.start(dir, workflowPath, START_TIME, { CLAUDE_CODE_SESSION_ID: "session-alpha" });
  assert.deepEqual(runState(dir).last_drive, { session: "session-alpha", at: START_TIME });

  const result = engine.next(dir, LAP_TIME, NO_ENV);
  assert.equal(result.kind, "ANSWERED");
  assert.equal(runState(dir).last_drive, null);
});
