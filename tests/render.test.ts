import { test } from "node:test";
import assert from "node:assert/strict";
import * as render from "../src/render.ts";

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
