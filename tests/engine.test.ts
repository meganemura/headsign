import { test } from "node:test";
import assert from "node:assert/strict";
import * as engine from "../src/engine.ts";
import type { Workflow, Phase } from "../src/workflow.ts";
import type { State } from "../src/state.ts";
import type { GateResult } from "../src/gate.ts";

function wf(phases: Record<string, Partial<Phase> & { on_pass: Phase["on_pass"] }>, entry?: string): Workflow {
  const built: Record<string, Phase> = {};
  for (const [name, p] of Object.entries(phases)) {
    built[name] = { description: name, gate: { checks: [{ run: "true" }] }, ...p } as Phase;
  }
  return { version: 1, name: "wf", entry: entry ?? Object.keys(phases)[0], phases: built };
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
    ...overrides,
  };
}

const PASS: GateResult = { pass: true };
const FAIL = (check = "c", run = "r", exitCode: number | "timeout" = 1): GateResult => ({ pass: false, check, run, exitCode, outputTail: "out" });

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
    phase: "a", check: "unit", run: "npm test", exit_code: 1, output_tail: "out", timeout_seconds: undefined,
  });
  assert.deepEqual(outcome, {
    kind: "RETRY",
    phase: "a",
    attempt: 1,
    maxAttempts: undefined,
    failure: { check: "unit", run: "npm test", exitCode: 1, outputTail: "out", timeoutSeconds: undefined },
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
    failure: { check: "lint", run: "eslint", exitCode: 2, outputTail: "out", timeoutSeconds: undefined, routedTo: "implement" },
  });
});

test("fail routes to escalate", () => {
  const workflow = wf({ a: { on_pass: "$end", on_fail: "escalate" } });
  const { state, outcome } = engine.step(workflow, st("a"), FAIL());
  assert.equal(state.status, "escalated");
  assert.equal(state.end_reason, "a: gate failed (on_fail: escalate)");
  assert.deepEqual(outcome, { kind: "ESCALATE", reason: "a: gate failed (on_fail: escalate)" });
});

test("fail routes to abort", () => {
  const workflow = wf({ a: { on_pass: "$end", on_fail: "abort" } });
  const { state, outcome } = engine.step(workflow, st("a"), FAIL());
  assert.equal(state.status, "aborted");
  assert.deepEqual(outcome, { kind: "ABORT", reason: "a: gate failed (on_fail: abort)" });
});

test("fail routes to $end (COMPLETE)", () => {
  const workflow = wf({ a: { on_pass: "$end", on_fail: "$end" } });
  const { state, outcome } = engine.step(workflow, st("a"), FAIL());
  assert.equal(state.status, "complete");
  assert.deepEqual(outcome, { kind: "COMPLETE" });
});

test("exhaustion escalates by default", () => {
  const workflow = wf({ a: { on_pass: "$end", max_attempts: 2 } });
  const s1 = engine.step(workflow, st("a"), FAIL()).state;
  const { state, outcome } = engine.step(workflow, s1, FAIL());
  assert.equal(state.attempts.a, 2);
  assert.equal(state.status, "escalated");
  assert.deepEqual(outcome, { kind: "ESCALATE", reason: "a: max_attempts (2) exhausted" });
});

test("exhaustion aborts when on_exhausted: abort", () => {
  const workflow = wf({ a: { on_pass: "$end", max_attempts: 1, on_exhausted: "abort" } });
  const { state, outcome } = engine.step(workflow, st("a"), FAIL());
  assert.equal(state.status, "aborted");
  assert.deepEqual(outcome, { kind: "ABORT", reason: "a: max_attempts (1) exhausted" });
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
  assert.equal(result?.state.status, "escalated");
  assert.equal(result?.state.end_reason, "a: max_total_iterations (5) reached");
  assert.deepEqual(result?.outcome, { kind: "ESCALATE", reason: "a: max_total_iterations (5) reached" });
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
    failure: { check: "lint", run: "eslint", exitCode: 2, outputTail: "out", timeoutSeconds: undefined, routedTo: "d" },
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

test("checkIterationLimit's escalated state carries driver_agent through unchanged", () => {
  const workflow: Workflow = { ...wf({ a: { on_pass: "$end" } }), limits: { max_total_iterations: 5 } };
  const result = engine.checkIterationLimit(workflow, st("a", { total_iterations: 5, driver_agent: "agent-1" }));
  assert.equal(result?.state.driver_agent, "agent-1");
});

// --- terminal idempotency ---

test("terminalOutcome reprints complete/escalated/aborted", () => {
  assert.deepEqual(engine.terminalOutcome(st("a", { status: "complete" })), { kind: "COMPLETE" });
  assert.deepEqual(engine.terminalOutcome(st("a", { status: "escalated", end_reason: "boom" })), { kind: "ESCALATE", reason: "boom" });
  assert.deepEqual(engine.terminalOutcome(st("a", { status: "aborted", end_reason: "stop" })), { kind: "ABORT", reason: "stop" });
});
