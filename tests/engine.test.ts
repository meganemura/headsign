import { test } from "node:test";
import assert from "node:assert/strict";
import * as engine from "../src/engine.ts";
import type { Workflow, Phase } from "../src/workflow.ts";
import type { State } from "../src/state.ts";
import type { GateResult } from "../src/gate.ts";

function wf(phases: Record<string, Partial<Phase> & { on_pass: string }>, entry?: string): Workflow {
  const built: Record<string, Phase> = {};
  for (const [name, p] of Object.entries(phases)) {
    built[name] = { description: name, gate: { checks: [{ run: "true" }] }, ...p } as Phase;
  }
  return { version: 1, name: "wf", entry: entry ?? Object.keys(phases)[0], phases: built };
}

function st(phase: string, overrides: Partial<State> = {}): State {
  return {
    version: 1,
    workflow: "wf",
    workflow_path: ".headsign/workflow.yaml",
    status: "running",
    phase,
    attempts: {},
    total_iterations: 0,
    last_eval: null,
    history: [],
    end_reason: null,
    stop_nudges: 0,
    ...overrides,
  };
}

const PASS: GateResult = { pass: true };
const FAIL = (check = "c", run = "r", exitCode: number | "timeout" = 1): GateResult => ({ pass: false, check, run, exitCode, outputTail: "out" });

// --- transition table (ADR-0002), every row ---

test("pass routes to the on_pass phase (ADVANCE)", () => {
  const workflow = wf({ a: { on_pass: "b" }, b: { on_pass: "$end" } });
  const { state, outcome } = engine.step(workflow, st("a"), PASS, "hash1", "t1");
  assert.equal(state.phase, "b");
  assert.equal(state.status, "running");
  assert.deepEqual(outcome, { kind: "ADVANCE", phase: "b", description: "b" });
  assert.deepEqual(state.history, [{ phase: "a", result: "pass", at: "t1" }]);
});

test("pass to $end completes the workflow", () => {
  const workflow = wf({ a: { on_pass: "$end" } });
  const { state, outcome } = engine.step(workflow, st("a"), PASS, null, "t1");
  assert.equal(state.status, "complete");
  assert.deepEqual(outcome, { kind: "COMPLETE" });
});

test("fail defaults to retry", () => {
  const workflow = wf({ a: { on_pass: "$end" } });
  const { state, outcome } = engine.step(workflow, st("a"), FAIL("unit", "npm test", 1), "hashX", "t1");
  assert.equal(state.status, "running");
  assert.equal(state.attempts.a, 1);
  assert.equal(state.last_eval?.tree_hash, "hashX");
  assert.deepEqual(outcome, {
    kind: "RETRY",
    phase: "a",
    attempt: 1,
    maxAttempts: undefined,
    failure: { check: "unit", run: "npm test", exitCode: 1, outputTail: "out", timeoutSeconds: undefined },
    cached: false,
  });
});

test("fail routes to a named phase (ADVANCE with failure note); attempts of the failed phase are retained", () => {
  const workflow = wf({ review: { on_pass: "$end", on_fail: "implement" }, implement: { on_pass: "review" } });
  const { state, outcome } = engine.step(workflow, st("review", { attempts: { review: 1 } }), FAIL("lint", "eslint", 2), null, "t1");
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
  const { state, outcome } = engine.step(workflow, st("a"), FAIL(), null, "t1");
  assert.equal(state.status, "escalated");
  assert.equal(state.end_reason, "a: gate failed (on_fail: escalate)");
  assert.deepEqual(outcome, { kind: "ESCALATE", reason: "a: gate failed (on_fail: escalate)" });
});

test("fail routes to abort", () => {
  const workflow = wf({ a: { on_pass: "$end", on_fail: "abort" } });
  const { state, outcome } = engine.step(workflow, st("a"), FAIL(), null, "t1");
  assert.equal(state.status, "aborted");
  assert.deepEqual(outcome, { kind: "ABORT", reason: "a: gate failed (on_fail: abort)" });
});

test("fail routes to $end (COMPLETE)", () => {
  const workflow = wf({ a: { on_pass: "$end", on_fail: "$end" } });
  const { state, outcome } = engine.step(workflow, st("a"), FAIL(), null, "t1");
  assert.equal(state.status, "complete");
  assert.deepEqual(outcome, { kind: "COMPLETE" });
});

test("exhaustion escalates by default", () => {
  const workflow = wf({ a: { on_pass: "$end", max_attempts: 2 } });
  const s1 = engine.step(workflow, st("a"), FAIL(), null, "t1").state;
  const { state, outcome } = engine.step(workflow, s1, FAIL(), null, "t2");
  assert.equal(state.attempts.a, 2);
  assert.equal(state.status, "escalated");
  assert.deepEqual(outcome, { kind: "ESCALATE", reason: "a: max_attempts (2) exhausted" });
});

test("exhaustion aborts when on_exhausted: abort", () => {
  const workflow = wf({ a: { on_pass: "$end", max_attempts: 1, on_exhausted: "abort" } });
  const { state, outcome } = engine.step(workflow, st("a"), FAIL(), null, "t1");
  assert.equal(state.status, "aborted");
  assert.deepEqual(outcome, { kind: "ABORT", reason: "a: max_attempts (1) exhausted" });
});

// --- attempts semantics (ADR-0004) ---

test("attempts accumulate per-phase across bounces and escalate on the third failure", () => {
  const workflow = wf({ implement: { on_pass: "review" }, review: { on_pass: "$end", on_fail: "implement", max_attempts: 3 } });
  let s = st("implement");
  ({ state: s } = engine.step(workflow, s, PASS, null, "t1"));
  assert.equal(s.phase, "review");

  ({ state: s } = engine.step(workflow, s, FAIL(), null, "t2"));
  assert.equal(s.phase, "implement");
  assert.equal(s.attempts.review, 1);

  ({ state: s } = engine.step(workflow, s, PASS, null, "t3"));
  assert.equal(s.attempts.review, 1);

  ({ state: s } = engine.step(workflow, s, FAIL(), null, "t4"));
  assert.equal(s.attempts.review, 2);
  assert.equal(s.status, "running");

  ({ state: s } = engine.step(workflow, s, PASS, null, "t5"));
  const { state: finalState, outcome } = engine.step(workflow, s, FAIL(), null, "t6");
  assert.equal(finalState.attempts.review, 3);
  assert.equal(finalState.status, "escalated");
  assert.deepEqual(outcome, { kind: "ESCALATE", reason: "review: max_attempts (3) exhausted" });
});

test("attempts are cleared only when that phase's own gate passes", () => {
  const workflow = wf({ a: { on_pass: "$end" } });
  const { state } = engine.step(workflow, st("a", { attempts: { a: 5 } }), PASS, null, "t1");
  assert.equal(state.attempts.a, undefined);
});

// --- iteration limit (checked before gate evaluation) ---

test("checkIterationLimit escalates once total_iterations reaches the limit", () => {
  const workflow: Workflow = { ...wf({ a: { on_pass: "$end" } }), limits: { max_total_iterations: 5 } };
  const result = engine.checkIterationLimit(workflow, st("a", { total_iterations: 5 }));
  assert.equal(result?.state.status, "escalated");
  assert.equal(result?.state.end_reason, "max_total_iterations (5) reached");
  assert.deepEqual(result?.outcome, { kind: "ESCALATE", reason: "max_total_iterations (5) reached" });
});

test("checkIterationLimit is null below the limit or when unconfigured", () => {
  const workflow: Workflow = { ...wf({ a: { on_pass: "$end" } }), limits: { max_total_iterations: 5 } };
  assert.equal(engine.checkIterationLimit(workflow, st("a", { total_iterations: 4 })), null);
  assert.equal(engine.checkIterationLimit(wf({ a: { on_pass: "$end" } }), st("a", { total_iterations: 999 })), null);
});

// --- shouldUseCache / cachedRetry (ADR-0004) ---

test("shouldUseCache matches only on same phase + fail + equal non-null hash", () => {
  const failEval = { phase: "a", result: "fail" as const, tree_hash: "h1", check: "c", run: "r", exit_code: 1, output_tail: "o" };
  assert.equal(engine.shouldUseCache(st("a", { last_eval: failEval }), "h1"), true);
  assert.equal(engine.shouldUseCache(st("b", { last_eval: failEval }), "h1"), false);
  assert.equal(engine.shouldUseCache(st("a", { last_eval: failEval }), "h2"), false);
  assert.equal(engine.shouldUseCache(st("a", { last_eval: failEval }), null), false);
  assert.equal(engine.shouldUseCache(st("a", { last_eval: null }), "h1"), false);
});

test("cachedRetry reconstructs a RETRY outcome from last_eval", () => {
  const workflow = wf({ a: { on_pass: "$end", max_attempts: 3 } });
  const failEval = { phase: "a", result: "fail" as const, tree_hash: "h1", check: "c", run: "r", exit_code: 1, output_tail: "o" };
  const outcome = engine.cachedRetry(workflow, st("a", { attempts: { a: 1 }, last_eval: failEval }));
  assert.deepEqual(outcome, {
    kind: "RETRY",
    phase: "a",
    attempt: 1,
    maxAttempts: 3,
    failure: { check: "c", run: "r", exitCode: 1, timeoutSeconds: undefined, outputTail: "o" },
    cached: true,
  });
});

// --- stop_nudges loop guard (ADR-0006): step() always resets it, since it only runs on a real evaluation ---

test("step() resets stop_nudges to 0 after a real pass evaluation", () => {
  const workflow = wf({ a: { on_pass: "$end" } });
  const { state } = engine.step(workflow, st("a", { stop_nudges: 2 }), PASS, null, "t1");
  assert.equal(state.stop_nudges, 0);
});

test("step() resets stop_nudges to 0 after a real fail evaluation", () => {
  const workflow = wf({ a: { on_pass: "$end" } });
  const { state } = engine.step(workflow, st("a", { stop_nudges: 3 }), FAIL(), null, "t1");
  assert.equal(state.stop_nudges, 0);
});

// --- terminal idempotency ---

test("terminalOutcome reprints complete/escalated/aborted", () => {
  assert.deepEqual(engine.terminalOutcome(st("a", { status: "complete" })), { kind: "COMPLETE" });
  assert.deepEqual(engine.terminalOutcome(st("a", { status: "escalated", end_reason: "boom" })), { kind: "ESCALATE", reason: "boom" });
  assert.deepEqual(engine.terminalOutcome(st("a", { status: "aborted", end_reason: "stop" })), { kind: "ABORT", reason: "stop" });
});
