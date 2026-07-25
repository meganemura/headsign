import { test } from "node:test";
import assert from "node:assert/strict";
import * as render from "../src/render.ts";
import type { State } from "../src/state.ts";

test("start", () => {
  const actual = render.start("plan", "Plan the work.");
  const expected = `START plan\n--- phase: plan ---\nPlan the work.\n`;
  assert.equal(actual, expected);
});

test("advance without a failure has no gate-failed line", () => {
  const actual = render.advance("build", "Build it.");
  const expected = `ADVANCE build\n--- phase: build ---\nBuild it.\n`;
  assert.equal(actual, expected);
});

test("advance with a failure includes the gate-failed/routed-to line", () => {
  const actual = render.advance("build", "Build it.", { check: "lint", run: "npm run lint", exitCode: 1, routedTo: "build" });
  const expected = `ADVANCE build\n--- gate failed: lint (npm run lint, exit 1) → routed to build ---\n--- phase: build ---\nBuild it.\n`;
  assert.equal(actual, expected);
});

// --- cleared: artifact-clear announcement (start/advance) ---

test("start with cleared artifacts lists one --- cleared: --- line per path, right after the token line", () => {
  const actual = render.start("plan", "Plan the work.", ["docs/spec.md", ".headsign/tmp/verdict"]);
  const expected = `START plan\n--- cleared: docs/spec.md ---\n--- cleared: .headsign/tmp/verdict ---\n--- phase: plan ---\nPlan the work.\n`;
  assert.equal(actual, expected);
});

test("start with an empty (or omitted) cleared array has no cleared lines", () => {
  assert.equal(render.start("plan", "Plan the work.", []), `START plan\n--- phase: plan ---\nPlan the work.\n`);
  assert.equal(render.start("plan", "Plan the work.", []), render.start("plan", "Plan the work."));
});

test("advance with cleared artifacts: cleared lines land after the token line and before the gate-failed line", () => {
  const actual = render.advance("build", "Build it.", { check: "lint", run: "npm run lint", exitCode: 1, routedTo: "build" }, ["artifact.txt"]);
  const expected = `ADVANCE build\n--- cleared: artifact.txt ---\n--- gate failed: lint (npm run lint, exit 1) → routed to build ---\n--- phase: build ---\nBuild it.\n`;
  assert.equal(actual, expected);
});

test("advance with cleared artifacts and no failure", () => {
  const actual = render.advance("build", "Build it.", undefined, ["artifact.txt", "other.txt"]);
  const expected = `ADVANCE build\n--- cleared: artifact.txt ---\n--- cleared: other.txt ---\n--- phase: build ---\nBuild it.\n`;
  assert.equal(actual, expected);
});

test("retry: fresh attempt with maxAttempts shows N/M, no unchanged, no cached note", () => {
  const actual = render.retry({
    check: "tests",
    run: "npm test",
    exitCode: 1,
    phase: "build",
    attempt: 1,
    maxAttempts: 3,
    outputTail: "some output",
    cached: false,
  });
  const expected = `RETRY 1/3 build\n--- gate failed: tests (npm test, exit 1) ---\nsome output\nFix the failure above, then run \`headsign next\` again.\n`;
  assert.equal(actual, expected);
});

test("retry: no maxAttempts shows bare attempt number, fresh (not cached)", () => {
  const actual = render.retry({
    check: "tests",
    run: "npm test",
    exitCode: 1,
    phase: "build",
    attempt: 2,
    maxAttempts: undefined,
    outputTail: "some output",
    cached: false,
  });
  const expected = `RETRY 2 build\n--- gate failed: tests (npm test, exit 1) ---\nsome output\nFix the failure above, then run \`headsign next\` again.\n`;
  assert.equal(actual, expected);
});

test("retry: cached adds (unchanged) to the header and the cached note to the gate-failed line", () => {
  const actual = render.retry({
    check: "tests",
    run: "npm test",
    exitCode: 1,
    phase: "build",
    attempt: 2,
    maxAttempts: undefined,
    outputTail: "some output",
    cached: true,
  });
  const expected = `RETRY 2 build (unchanged)\n--- gate failed: tests (npm test, exit 1) [cached — tree unchanged, attempt not counted] ---\nsome output\nFix the failure above, then run \`headsign next\` again.\n`;
  assert.equal(actual, expected);
});

test("retry: timeout exit code renders the timed-out clause", () => {
  const actual = render.retry({
    check: "tests",
    run: "npm test",
    exitCode: "timeout",
    timeoutSeconds: 5,
    phase: "build",
    attempt: 2,
    maxAttempts: undefined,
    outputTail: "some output",
    cached: false,
  });
  const expected = `RETRY 2 build\n--- gate failed: tests (npm test, timed out after 5s) ---\nsome output\nFix the failure above, then run \`headsign next\` again.\n`;
  assert.equal(actual, expected);
});

test("complete", () => {
  const actual = render.complete("demo");
  const expected = `COMPLETE\nWorkflow 'demo' finished.\n`;
  assert.equal(actual, expected);
});

test("escalate", () => {
  const actual = render.escalate("build: max_attempts (3) exhausted");
  const expected = `ESCALATE build: max_attempts (3) exhausted\nHuman judgment needed. Report the situation to the user and ask for instructions.\n`;
  assert.equal(actual, expected);
});

test("abort with a reason", () => {
  const actual = render.abort("user requested stop");
  const expected = `ABORT user requested stop\nWorkflow aborted. Report to the user.\n`;
  assert.equal(actual, expected);
});

test("abort with an empty reason falls back to '(no reason given)'", () => {
  const actual = render.abort("");
  const expected = `ABORT (no reason given)\nWorkflow aborted. Report to the user.\n`;
  assert.equal(actual, expected);
});

// --- claim: the driver-adoption handshake (ADR-0009, re-homed onto SubagentStop by ADR-0010) ---

test("claim: first line is the CLAIM token, and the body explains the two-beat handshake and re-claim self-repair", () => {
  const actual = render.claim();
  const expected =
    "CLAIM armed\n" +
    "Now end your turn. Sealing happens on this agent's own turn end, which is the only\n" +
    "moment headsign can learn which delegated agent you are. The hook confirms it in its\n" +
    "message; do not run `headsign next` before you see that confirmation.\n" +
    "If the wrong agent gets adopted, run `headsign claim` again from the right one — a new\n" +
    "claim always wins.\n";
  assert.equal(actual, expected);
  assert.match(actual, /^CLAIM /);
});

test("claim: the text names the sealing moment as this agent's own turn end and tells the caller to wait for the confirmation before `next`", () => {
  const actual = render.claim();
  assert.match(actual, /this agent's own turn end/);
  assert.match(actual, /do not run `headsign next` before you see that confirmation/);
  // The pre-ADR-0010 promise ("whoever stops next gets it") must be gone: it described the
  // exact mis-adoption this revision removes.
  assert.doesNotMatch(actual, /next session to stop/);
});

test("validateOk", () => {
  const actual = render.validateOk("demo", 3);
  const expected = `OK: workflow 'demo' (3 phases)\n`;
  assert.equal(actual, expected);
});

test("validateFail lists each error as a bullet line after the header", () => {
  const actual = render.validateFail(".headsign/workflow.yaml", ["entry phase 'x' not defined", "phase 'y': circular on_fail"]);
  const expected = `INVALID: .headsign/workflow.yaml\n- entry phase 'x' not defined\n- phase 'y': circular on_fail\n`;
  assert.equal(actual, expected);
});

// --- pending: the ready-probe token ---

test("pending", () => {
  const actual = render.pending("review", "Have a reviewer subagent report a verdict.", "test -f .headsign/tmp/verdict");
  const expected =
    `PENDING review\n` +
    `--- not ready yet — no attempt counted (readiness: test -f .headsign/tmp/verdict) ---\n` +
    `--- phase: review ---\nHave a reviewer subagent report a verdict.\n` +
    "This is not a failure. Do the work above so the gate can run, then run `headsign next` again.\n";
  assert.equal(actual, expected);
});

// --- status: the read-only observation window (ADR-0002/0008) ---

test("statusRunning: max_attempts defined -> n/max, no last-failure block", () => {
  const actual = render.statusRunning({
    phase: "build", attempt: 1, maxAttempts: 3, attemptUnknown: false,
    workflowName: "demo", lastFailure: null, driver: "this session",
  });
  const expected = `RUNNING build (attempt 1/3)\nworkflow: demo\ndriver: this session\n`;
  assert.equal(actual, expected);
});

test("statusRunning: max_attempts undefined (unlimited) -> bare attempt number", () => {
  const actual = render.statusRunning({
    phase: "build", attempt: 2, maxAttempts: undefined, attemptUnknown: false,
    workflowName: "demo", lastFailure: null, driver: "unknown",
  });
  const expected = `RUNNING build (attempt 2)\nworkflow: demo\ndriver: unknown\n`;
  assert.equal(actual, expected);
});

test("statusRunning: attemptUnknown (workflow unreadable or phase missing) -> n/?", () => {
  const actual = render.statusRunning({
    phase: "build", attempt: 4, maxAttempts: 3, attemptUnknown: true,
    workflowName: "demo", lastFailure: null, driver: "another session",
  });
  const expected = `RUNNING build (attempt 4/?)\nworkflow: demo\ndriver: another session\n`;
  assert.equal(actual, expected);
});

test("statusRunning: a last-failure block lands between the workflow line and the driver line, matching retry's failure clause", () => {
  const actual = render.statusRunning({
    phase: "build", attempt: 1, maxAttempts: 3, attemptUnknown: false,
    workflowName: "demo",
    lastFailure: { check: "tests", run: "npm test", exitCode: 1, outputTail: "some output" },
    driver: "this session",
  });
  const expected = `RUNNING build (attempt 1/3)\nworkflow: demo\n--- last failure: tests (npm test, exit 1) ---\nsome output\ndriver: this session\n`;
  assert.equal(actual, expected);
});

test("statusRunning: a timeout last failure renders the timed-out clause, same as retry", () => {
  const actual = render.statusRunning({
    phase: "build", attempt: 1, maxAttempts: 3, attemptUnknown: false,
    workflowName: "demo",
    lastFailure: { check: "tests", run: "npm test", exitCode: "timeout", timeoutSeconds: 5, outputTail: "some output" },
    driver: "this session",
  });
  const expected = `RUNNING build (attempt 1/3)\nworkflow: demo\n--- last failure: tests (npm test, timed out after 5s) ---\nsome output\ndriver: this session\n`;
  assert.equal(actual, expected);
});

test("statusRunning: driver values are printed verbatim as one of the four fixed strings, never a session id", () => {
  for (const driver of ["this session", "another session", "unknown", "a delegated agent"] as const) {
    const actual = render.statusRunning({ phase: "build", attempt: 0, attemptUnknown: false, workflowName: "demo", driver });
    assert.match(actual, new RegExp(`driver: ${driver}\\n$`));
  }
});

test("statusTerminal: complete has no reason line", () => {
  const actual = render.statusTerminal("complete", "demo", null);
  assert.equal(actual, `COMPLETE\nworkflow: demo\n`);
});

test("statusTerminal: escalated with a reason", () => {
  const actual = render.statusTerminal("escalated", "demo", "build: max_attempts (3) exhausted");
  assert.equal(actual, `ESCALATED\nworkflow: demo\nreason: build: max_attempts (3) exhausted\n`);
});

test("statusTerminal: aborted with a reason", () => {
  const actual = render.statusTerminal("aborted", "demo", "changed my mind");
  assert.equal(actual, `ABORTED\nworkflow: demo\nreason: changed my mind\n`);
});

test("statusTerminal: a null or empty-string reason omits the reason line", () => {
  assert.equal(render.statusTerminal("aborted", "demo", null), `ABORTED\nworkflow: demo\n`);
  assert.equal(render.statusTerminal("aborted", "demo", ""), `ABORTED\nworkflow: demo\n`);
});

// --- logLine: .headsign/log line formatting ---

function baseState(overrides: Partial<State> = {}): State {
  return {
    workflow: "demo",
    workflow_path: ".headsign/workflow.yaml",
    status: "running",
    phase: "build",
    attempts: {},
    total_iterations: 0,
    last_eval: null,
    end_reason: null,
    stop_nudges: 0,
    driver_session: null,
    driver_source: null,
    ...overrides,
  };
}

test("logLine: start", () => {
  const line = render.logLine("2026-07-23T00:00:00.000Z", { kind: "START", workflow: "demo" }, baseState({ phase: "plan" }));
  assert.equal(line, `2026-07-23T00:00:00.000Z start plan a=0 i=0 workflow=demo\n`);
});

test("logLine: retry", () => {
  const outcome = { kind: "RETRY" as const, phase: "build", attempt: 1, maxAttempts: 3, failure: { check: "tests", run: "npm test", exitCode: 1, outputTail: "x" }, cached: false };
  const line = render.logLine("ts", outcome, baseState({ phase: "build", attempts: { build: 1 }, total_iterations: 1 }));
  assert.equal(line, `ts retry build a=1 i=1 check="tests" exit=1\n`);
});

test("logLine: retry with a timeout exit code", () => {
  const outcome = { kind: "RETRY" as const, phase: "build", attempt: 2, failure: { check: "tests", run: "npm test", exitCode: "timeout" as const, outputTail: "x", timeoutSeconds: 5 }, cached: false };
  const line = render.logLine("ts", outcome, baseState({ phase: "build", attempts: { build: 2 }, total_iterations: 4 }));
  assert.equal(line, `ts retry build a=2 i=4 check="tests" exit=timeout\n`);
});

test("logLine: pass advance", () => {
  const outcome = { kind: "ADVANCE" as const, phase: "review", description: "Review." };
  const line = render.logLine("ts", outcome, baseState({ phase: "review", total_iterations: 2 }), "implement");
  assert.equal(line, `ts advance review a=0 i=2 from=implement\n`);
});

test("logLine: fail-routed advance names both the origin phase and the failing check", () => {
  const outcome = {
    kind: "ADVANCE" as const,
    phase: "implement",
    description: "Implement.",
    failure: { check: "review approved", run: "grep -qx APPROVED verdict", exitCode: 1, outputTail: "x", routedTo: "implement" },
  };
  const line = render.logLine("ts", outcome, baseState({ phase: "implement", attempts: { review: 1 }, total_iterations: 3 }), "review");
  assert.equal(line, `ts advance implement a=0 i=3 from=review routed-fail check="review approved" exit=1\n`);
});

test("logLine: complete", () => {
  const line = render.logLine("ts", { kind: "COMPLETE" }, baseState({ phase: "review", total_iterations: 5 }));
  assert.equal(line, `ts complete review a=0 i=5\n`);
});

test("logLine: escalate", () => {
  const outcome = { kind: "ESCALATE" as const, reason: "build: max_attempts (3) exhausted" };
  const line = render.logLine("ts", outcome, baseState({ phase: "build", attempts: { build: 3 }, total_iterations: 3 }));
  assert.equal(line, `ts escalate build a=3 i=3 reason="build: max_attempts (3) exhausted"\n`);
});

test("logLine: abort", () => {
  const outcome = { kind: "ABORT" as const, reason: "changed my mind" };
  const line = render.logLine("ts", outcome, baseState({ phase: "build", total_iterations: 2 }));
  assert.equal(line, `ts abort build a=0 i=2 reason="changed my mind"\n`);
});

test("logLine: PENDING is never a valid event to log (defensive — cli.ts must never call this)", () => {
  const outcome = { kind: "PENDING" as const, phase: "review", ready: "test -f verdict" };
  assert.throws(() => render.logLine("ts", outcome, baseState({ phase: "review" })));
});

// --- logLine: the three Stop-boundary events (ADR-0006/0009; stophook.ts is the caller) ---

test("logLine: paused carries the note's first line", () => {
  const line = render.logLine("ts", { kind: "PAUSED", note: "stepping away for lunch" }, baseState({ phase: "build" }));
  assert.equal(line, `ts paused build a=0 i=0 note="stepping away for lunch"\n`);
});

test("logLine: paused reflects the resulting state's attempts/iterations", () => {
  const line = render.logLine("ts", { kind: "PAUSED", note: "brb" }, baseState({ phase: "review", attempts: { review: 2 }, total_iterations: 6 }));
  assert.equal(line, `ts paused review a=2 i=6 note="brb"\n`);
});

test("logLine: stalled names the fixed nudges=5 cap", () => {
  const line = render.logLine("ts", { kind: "STALLED" }, baseState({ phase: "build", total_iterations: 5 }));
  assert.equal(line, `ts stalled build a=0 i=5 nudges=5\n`);
});

test("logLine: claimed has no detail — the adopted session id must never appear in the log line", () => {
  const line = render.logLine("ts", { kind: "CLAIMED" }, baseState({ phase: "build", driver_session: "session-abc", driver_source: "claim" }));
  assert.equal(line, `ts claimed build a=0 i=0\n`);
  assert.doesNotMatch(line, /session-abc/);
});
