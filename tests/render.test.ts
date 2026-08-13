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

test("advance with a failure carrying elapsedSeconds adds 'in Ns' to the routed-fail clause", () => {
  const actual = render.advance("build", "Build it.", { check: "lint", run: "npm run lint", exitCode: 1, elapsedSeconds: 4.2, routedTo: "build" });
  const expected = `ADVANCE build\n--- gate failed: lint (npm run lint, exit 1 in 4.2s) → routed to build ---\n--- phase: build ---\nBuild it.\n`;
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

// --- not cleared: the report for a `clear:` entry that named a directory (engine.ts's
// clearPhaseArtifacts never removes one) ---

test("start with a not-cleared directory lists a --- not cleared: --- line after the cleared lines", () => {
  const actual = render.start("plan", "Plan the work.", ["a.txt"], ["scratch/"]);
  const expected = `START plan\n--- cleared: a.txt ---\n--- not cleared: scratch/ (a directory — \`clear:\` removes files only) ---\n--- phase: plan ---\nPlan the work.\n`;
  assert.equal(actual, expected);
});

test("start with only a not-cleared directory (no cleared files) still lists the line", () => {
  const actual = render.start("plan", "Plan the work.", [], ["scratch/"]);
  const expected = `START plan\n--- not cleared: scratch/ (a directory — \`clear:\` removes files only) ---\n--- phase: plan ---\nPlan the work.\n`;
  assert.equal(actual, expected);
});

test("start with an empty (or omitted) notCleared array has no not-cleared lines", () => {
  assert.equal(render.start("plan", "Plan the work.", ["a.txt"], []), `START plan\n--- cleared: a.txt ---\n--- phase: plan ---\nPlan the work.\n`);
  assert.equal(render.start("plan", "Plan the work.", ["a.txt"], []), render.start("plan", "Plan the work.", ["a.txt"]));
});

test("advance with a not-cleared directory: the line lands after the cleared lines and before the gate-failed line", () => {
  const actual = render.advance(
    "build",
    "Build it.",
    { check: "lint", run: "npm run lint", exitCode: 1, routedTo: "build" },
    ["artifact.txt"],
    ["scratch/"],
  );
  const expected =
    `ADVANCE build\n--- cleared: artifact.txt ---\n--- not cleared: scratch/ (a directory — \`clear:\` removes files only) ---\n` +
    `--- gate failed: lint (npm run lint, exit 1) → routed to build ---\n--- phase: build ---\nBuild it.\n`;
  assert.equal(actual, expected);
});

// --- routed: the one line a k-way on_pass adds (ADR-0011) ---

test("advance routed by a matching when quotes the command and names the destination", () => {
  const actual = render.advance("fix-bug", "Fix it.", undefined, undefined, undefined, { when: "grep -qx fix-bug .headsign/tmp/route" });
  const expected = `ADVANCE fix-bug\n--- routed: when "grep -qx fix-bug .headsign/tmp/route" → fix-bug ---\n--- phase: fix-bug ---\nFix it.\n`;
  assert.equal(actual, expected);
});

test("advance routed by the default names the destination without a command", () => {
  const actual = render.advance("implement", "Do it.", undefined, undefined, undefined, { default: true });
  const expected = `ADVANCE implement\n--- routed: default → implement ---\n--- phase: implement ---\nDo it.\n`;
  assert.equal(actual, expected);
});

test("advance with a string on_pass (no routedBy) prints exactly what it always did", () => {
  assert.equal(render.advance("build", "Build it.", undefined, undefined, undefined), render.advance("build", "Build it."));
});

test("the routed line sits where the gate-failed line sits: after the cleared block, before the phase line", () => {
  const actual = render.advance("docs", "Write it.", undefined, ["artifact.txt"], undefined, { default: true });
  const expected = `ADVANCE docs\n--- cleared: artifact.txt ---\n--- routed: default → docs ---\n--- phase: docs ---\nWrite it.\n`;
  assert.equal(actual, expected);
});

test("not cleared and routed together: not-cleared sits before the routed line too", () => {
  const actual = render.advance("docs", "Write it.", undefined, ["artifact.txt"], ["scratch/"], { default: true });
  const expected =
    `ADVANCE docs\n--- cleared: artifact.txt ---\n--- not cleared: scratch/ (a directory — \`clear:\` removes files only) ---\n` +
    `--- routed: default → docs ---\n--- phase: docs ---\nWrite it.\n`;
  assert.equal(actual, expected);
});

test("retry: an attempt with maxAttempts shows N/M", () => {
  const actual = render.retry({
    check: "tests",
    run: "npm test",
    exitCode: 1,
    phase: "build",
    attempt: 1,
    maxAttempts: 3,
    outputTail: "some output",
  });
  const expected = `RETRY 1/3 build\n--- gate failed: tests (npm test, exit 1) ---\nsome output\nFix the failure above, then run \`headsign next\` again.\n`;
  assert.equal(actual, expected);
});

test("retry: no maxAttempts shows a bare attempt number", () => {
  const actual = render.retry({
    check: "tests",
    run: "npm test",
    exitCode: 1,
    phase: "build",
    attempt: 2,
    maxAttempts: undefined,
    outputTail: "some output",
  });
  const expected = `RETRY 2 build\n--- gate failed: tests (npm test, exit 1) ---\nsome output\nFix the failure above, then run \`headsign next\` again.\n`;
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
  });
  const expected = `RETRY 2 build\n--- gate failed: tests (npm test, timed out after 5s) ---\nsome output\nFix the failure above, then run \`headsign next\` again.\n`;
  assert.equal(actual, expected);
});

// --- elapsedSeconds: the clause() field that names how long the failing check actually ran ---

test("retry: elapsedSeconds present adds 'in Ns' after the exit code", () => {
  const actual = render.retry({
    check: "tests",
    run: "npm test",
    exitCode: 1,
    elapsedSeconds: 12.3,
    phase: "build",
    attempt: 1,
    maxAttempts: 3,
    outputTail: "some output",
  });
  const expected = `RETRY 1/3 build\n--- gate failed: tests (npm test, exit 1 in 12.3s) ---\nsome output\nFix the failure above, then run \`headsign next\` again.\n`;
  assert.equal(actual, expected);
});

// The timeout arm never gains an 'in Ns' clause, even when elapsedSeconds is present (gate.ts
// sets it there too, close to timeoutSeconds): "timed out after 5s" already states the
// duration, so a second number on the same clause would only invite the reader to ask why the
// two differ, when the answer is "they don't, meaningfully".
test("retry: elapsedSeconds is ignored on the timeout arm — 'timed out after Ns' already says the duration", () => {
  const actual = render.retry({
    check: "tests",
    run: "npm test",
    exitCode: "timeout",
    timeoutSeconds: 5,
    elapsedSeconds: 5.0,
    phase: "build",
    attempt: 2,
    maxAttempts: undefined,
    outputTail: "some output",
  });
  const expected = `RETRY 2 build\n--- gate failed: tests (npm test, timed out after 5s) ---\nsome output\nFix the failure above, then run \`headsign next\` again.\n`;
  assert.equal(actual, expected);
});

// --- repeats: the same-failure-in-a-row line (2026-08-13) ---

test("retry: repeats explicitly 1 prints byte-identical to omitting it entirely — a first failure changes nothing", () => {
  const withOne = render.retry({
    check: "tests",
    run: "npm test",
    exitCode: 1,
    phase: "build",
    attempt: 1,
    maxAttempts: 3,
    outputTail: "some output",
    repeats: 1,
  });
  const withoutField = render.retry({
    check: "tests",
    run: "npm test",
    exitCode: 1,
    phase: "build",
    attempt: 1,
    maxAttempts: 3,
    outputTail: "some output",
  });
  assert.equal(withOne, withoutField);
  assert.equal(withOne, `RETRY 1/3 build\n--- gate failed: tests (npm test, exit 1) ---\nsome output\nFix the failure above, then run \`headsign next\` again.\n`);
});

test("retry: repeats 2 adds one line after the gate-failed line and replaces the closing sentence", () => {
  const actual = render.retry({
    check: "tests",
    run: "npm test",
    exitCode: 1,
    phase: "build",
    attempt: 2,
    maxAttempts: 3,
    outputTail: "some output",
    repeats: 2,
  });
  const expected =
    `RETRY 2/3 build\n` +
    `--- gate failed: tests (npm test, exit 1) ---\n` +
    `--- same check, same exit code, same output as last time — 2 in a row ---\n` +
    `some output\n` +
    "This check produced exactly what it produced last time. If you changed something since, this check is not reading it; " +
    "if you did not, work out whether this gate can pass at all before spending the rest of your attempts.\n";
  assert.equal(actual, expected);
});

test("retry: repeats 2 never asserts the gate cannot pass", () => {
  const actual = render.retry({
    check: "tests",
    run: "npm test",
    exitCode: 1,
    phase: "build",
    attempt: 2,
    maxAttempts: 3,
    outputTail: "some output",
    repeats: 2,
  });
  assert.doesNotMatch(actual, /cannot pass|can't pass|this gate will not/i);
});

test("complete", () => {
  const actual = render.complete("demo");
  const expected = `COMPLETE\nWorkflow 'demo' finished.\n`;
  assert.equal(actual, expected);
});

// The count rides on COMPLETE because `.headsign/log` is gitignored: a run that loosened its
// own gate and then finished must say so somewhere a pull-request reviewer will actually look.
test("complete: a run that accepted no changes to its own rules prints exactly what it always printed", () => {
  const unchanged = `COMPLETE\nWorkflow 'demo' finished.\n`;
  assert.equal(render.complete("demo"), unchanged);
  assert.equal(render.complete("demo", 0), unchanged);
  assert.equal(render.complete("demo", 0), render.complete("demo"));
});

test("complete: one accepted change adds one line, in the singular", () => {
  assert.equal(render.complete("demo", 1), `COMPLETE\nWorkflow 'demo' finished.\nThis run accepted 1 change to its own workflow rules while it was running.\n`);
});

test("complete: more than one accepted change is plural", () => {
  assert.equal(render.complete("demo", 2), `COMPLETE\nWorkflow 'demo' finished.\nThis run accepted 2 changes to its own workflow rules while it was running.\n`);
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

test("claim: first line is the CLAIM token, and the body explains the two-beat handshake and the re-claim advice", () => {
  const actual = render.claim();
  const expected =
    "CLAIM armed\n" +
    "Now end your turn. Sealing happens on this agent's own turn end, which is the only\n" +
    "moment headsign can learn which delegated agent you are. The hook confirms it in its\n" +
    "message; do not run `headsign next` before you see that confirmation.\n" +
    "If the wrong agent gets adopted, run `headsign claim` again from the right one: that\n" +
    "re-arms the marker, though another agent naming itself first can take it again.\n" +
    "Re-claim until the confirmation names the agent you meant.\n";
  assert.equal(actual, expected);
  assert.match(actual, /^CLAIM /);
  // The re-claim advice must never promise the retry lands: the adoption gate seats
  // whoever names itself first under an armed marker, so a re-claim is a fresh entry into
  // the same race (ADR-0010's named weakness), not a correction that is guaranteed to stick.
  assert.doesNotMatch(actual, /always wins/);
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

test("validateWarnings uses its own header so a warning can never read as an INVALID verdict", () => {
  const actual = render.validateWarnings(".headsign/workflow.yaml", ["phase 'draft' is unreachable from entry 'plan'"]);
  const expected = `WARNING: .headsign/workflow.yaml\n- phase 'draft' is unreachable from entry 'plan'\n`;
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
    workflowName: "demo", lastFailure: null, driver: "a delegated agent",
  });
  const expected = `RUNNING build (attempt 1/3)\nworkflow: demo\ndriver: a delegated agent\n`;
  assert.equal(actual, expected);
});

test("statusRunning: max_attempts undefined (unlimited) -> bare attempt number", () => {
  const actual = render.statusRunning({
    phase: "build", attempt: 2, maxAttempts: undefined, attemptUnknown: false,
    workflowName: "demo", lastFailure: null, driver: "not delegated yet — no agent has claimed this run",
  });
  const expected = `RUNNING build (attempt 2)\nworkflow: demo\ndriver: not delegated yet — no agent has claimed this run\n`;
  assert.equal(actual, expected);
});

test("statusRunning: attemptUnknown (workflow unreadable or phase missing) -> n/?", () => {
  const actual = render.statusRunning({
    phase: "build", attempt: 4, maxAttempts: 3, attemptUnknown: true,
    workflowName: "demo", lastFailure: null, driver: "a delegated agent",
  });
  const expected = `RUNNING build (attempt 4/?)\nworkflow: demo\ndriver: a delegated agent\n`;
  assert.equal(actual, expected);
});

test("statusRunning: a last-failure block lands between the workflow line and the driver line, matching retry's failure clause", () => {
  const actual = render.statusRunning({
    phase: "build", attempt: 1, maxAttempts: 3, attemptUnknown: false,
    workflowName: "demo",
    lastFailure: { check: "tests", run: "npm test", exitCode: 1, outputTail: "some output" },
    driver: "a delegated agent",
  });
  const expected = `RUNNING build (attempt 1/3)\nworkflow: demo\n--- last failure: tests (npm test, exit 1) ---\nsome output\ndriver: a delegated agent\n`;
  assert.equal(actual, expected);
});

test("statusRunning: a timeout last failure renders the timed-out clause, same as retry", () => {
  const actual = render.statusRunning({
    phase: "build", attempt: 1, maxAttempts: 3, attemptUnknown: false,
    workflowName: "demo",
    lastFailure: { check: "tests", run: "npm test", exitCode: "timeout", timeoutSeconds: 5, outputTail: "some output" },
    driver: "a delegated agent",
  });
  const expected = `RUNNING build (attempt 1/3)\nworkflow: demo\n--- last failure: tests (npm test, timed out after 5s) ---\nsome output\ndriver: a delegated agent\n`;
  assert.equal(actual, expected);
});

test("statusRunning: a last failure carrying elapsedSeconds adds 'in Ns' to the exit clause", () => {
  const actual = render.statusRunning({
    phase: "build", attempt: 1, maxAttempts: 3, attemptUnknown: false,
    workflowName: "demo",
    lastFailure: { check: "tests", run: "npm test", exitCode: 1, elapsedSeconds: 7.5, outputTail: "some output" },
    driver: "a delegated agent",
  });
  const expected = `RUNNING build (attempt 1/3)\nworkflow: demo\n--- last failure: tests (npm test, exit 1 in 7.5s) ---\nsome output\ndriver: a delegated agent\n`;
  assert.equal(actual, expected);
});

test("statusRunning: driver values are printed verbatim as one of the two fixed strings, never an identifier", () => {
  for (const driver of ["a delegated agent", "not delegated yet — no agent has claimed this run"] as const) {
    const actual = render.statusRunning({ phase: "build", attempt: 0, attemptUnknown: false, workflowName: "demo", driver });
    assert.match(actual, new RegExp(`driver: ${driver}\\n$`));
  }
});

// The driver line reports whether the run was claimed, never who is reading it. Pinned
// verbatim because the tempting shorter wordings ("this session", "you") are exactly the
// claim ADR-0013 says the CLI cannot make: it has no agent id of its own to compare.
test("statusRunning: neither driver value makes a claim about who is reading the status", () => {
  for (const driver of ["a delegated agent", "not delegated yet — no agent has claimed this run"] as const) {
    const actual = render.statusRunning({
      phase: "build", attempt: 1, maxAttempts: 3, attemptUnknown: false,
      workflowName: "demo", lastFailure: null, driver,
    });
    assert.doesNotMatch(actual, /this session/);
    assert.doesNotMatch(actual, /another session/);
  }
});

// --- status: the graph pin, said only when there is something to say ---

test("statusRunning: a run whose rules never moved under it prints byte-identical output to before the pin existed", () => {
  const base = { phase: "build", attempt: 1, maxAttempts: 3, attemptUnknown: false, workflowName: "demo", lastFailure: null } as const;
  const expected = `RUNNING build (attempt 1/3)\nworkflow: demo\ndriver: a delegated agent\n`;
  assert.equal(render.statusRunning({ ...base, driver: "a delegated agent" }), expected);
  assert.equal(render.statusRunning({ ...base, driver: "a delegated agent", acceptedGraphChanges: 0, graphChangeReported: false }), expected);
});

test("statusRunning: accepted changes are one line after the driver line, singular for one", () => {
  const base = { phase: "build", attempt: 1, attemptUnknown: false, workflowName: "demo", driver: "a delegated agent" } as const;
  assert.equal(
    render.statusRunning({ ...base, acceptedGraphChanges: 1 }),
    `RUNNING build (attempt 1)\nworkflow: demo\ndriver: a delegated agent\ngraph: 1 accepted change to the workflow's rules during this run\n`,
  );
  assert.equal(
    render.statusRunning({ ...base, acceptedGraphChanges: 2 }),
    `RUNNING build (attempt 1)\nworkflow: demo\ndriver: a delegated agent\ngraph: 2 accepted changes to the workflow's rules during this run\n`,
  );
});

// The standing question, and it has to name both answers: a reader who is only told the file
// changed cannot tell that running `next` again is what accepts it.
test("statusRunning: a reported-but-unaccepted change names both ways out", () => {
  const actual = render.statusRunning({
    phase: "build", attempt: 1, attemptUnknown: false, workflowName: "demo",
    driver: "a delegated agent", graphChangeReported: true,
  });
  assert.equal(
    actual,
    "RUNNING build (attempt 1)\nworkflow: demo\ndriver: a delegated agent\n" +
      "graph: changed since this run accepted it — restore the file, or `headsign next` to accept\n",
  );
});

test("statusRunning: history first, then the outstanding question", () => {
  const actual = render.statusRunning({
    phase: "build", attempt: 1, attemptUnknown: false, workflowName: "demo",
    driver: "a delegated agent", acceptedGraphChanges: 2, graphChangeReported: true,
  });
  assert.equal(
    actual,
    "RUNNING build (attempt 1)\nworkflow: demo\ndriver: a delegated agent\n" +
      "graph: 2 accepted changes to the workflow's rules during this run\n" +
      "graph: changed since this run accepted it — restore the file, or `headsign next` to accept\n",
  );
});

// --- status: what happened at the last stop, and whether the caller has opted out ---
//
// The two lines that answer the question `driver:` cannot reach: was the previous turn end held,
// and if not, why not. Both are conditional, so a run nobody has stopped yet says nothing.

test("statusRunning: each disposition prints its own last-stop line, verbatim", () => {
  const base = { phase: "decide", attempt: 0, attemptUnknown: false, workflowName: "design-grilling", lastFailure: null, driver: "not delegated yet — no agent has claimed this run" } as const;
  const head = `RUNNING decide (attempt 0)\nworkflow: design-grilling\ndriver: not delegated yet — no agent has claimed this run\n`;
  const at = "2026-07-30T23:06:51+09:00";

  assert.equal(
    render.statusRunning({ ...base, lastStop: { disposition: "nudged", at } }),
    `${head}last stop: held, and pointed back to headsign next — at ${at}\n`,
  );
  assert.equal(
    render.statusRunning({ ...base, lastStop: { disposition: "unheld", at } }),
    `${head}last stop: not held — Claude Code had already resumed the turn (stop_hook_active) — at ${at}\n`,
  );
  // The second cause of `unheld`, pinned beside the first: these two are the only sentences in
  // this map a reader has to tell apart, so a change to either has to be a deliberate one.
  assert.equal(
    render.statusRunning({ ...base, lastStop: { disposition: "unheld", at, cause: "CLAUDE_PROJECT_DIR" } }),
    `${head}last stop: not held — the session was not standing in the run's tree (CLAUDE_PROJECT_DIR) — at ${at}\n`,
  );
  assert.equal(
    render.statusRunning({ ...base, lastStop: { disposition: "paused", at } }),
    `${head}last stop: paused by a note — at ${at}\n`,
  );
  assert.equal(
    render.statusRunning({ ...base, lastStop: { disposition: "stalled", at } }),
    `${head}last stop: not held — the nudge cap is spent — at ${at}\n`,
  );
});

// The stored value carries its own offset, and this module reads no clock and cannot know the
// reader's timezone: reformatting it — or truncating it to a bare wall clock, which is what the
// original report asked for — would be inventing a fact the writer did not record.
test("statusRunning: the last stop's timestamp is printed exactly as stored, offset and all", () => {
  const actual = render.statusRunning({
    phase: "build", attempt: 1, attemptUnknown: false, workflowName: "demo",
    driver: "a delegated agent", lastStop: { disposition: "unheld", at: "2026-01-02T03:04:05-05:00" },
  });
  assert.match(actual, /last stop: .* — at 2026-01-02T03:04:05-05:00\n/);
});

test("statusRunning: the last-stop line lands after the driver line and before the graph lines", () => {
  const actual = render.statusRunning({
    phase: "build", attempt: 1, attemptUnknown: false, workflowName: "demo",
    driver: "a delegated agent", lastStop: { disposition: "nudged", at: "T" },
    acceptedGraphChanges: 1, graphChangeReported: true,
  });
  assert.equal(
    actual,
    "RUNNING build (attempt 1)\nworkflow: demo\ndriver: a delegated agent\n" +
      "last stop: held, and pointed back to headsign next — at T\n" +
      "graph: 1 accepted change to the workflow's rules during this run\n" +
      "graph: changed since this run accepted it — restore the file, or `headsign next` to accept\n",
  );
});

test("statusRunning: a run on which no stop has been processed prints byte-identical output to before either line existed", () => {
  const base = { phase: "build", attempt: 1, maxAttempts: 3, attemptUnknown: false, workflowName: "demo", lastFailure: null, driver: "a delegated agent" } as const;
  const expected = `RUNNING build (attempt 1/3)\nworkflow: demo\ndriver: a delegated agent\n`;
  assert.equal(render.statusRunning(base), expected);
  assert.equal(render.statusRunning({ ...base, lastStop: undefined, observer: undefined }), expected);
  assert.equal(render.statusRunning({ ...base, observer: false }), expected, "an opted-in caller says nothing about the switch");
});

// The one quiet-ending cause a caller can answer about itself. Printed last because it is the
// only line here that is about the caller rather than the run.
test("statusRunning: the observer line prints only when the switch is set, and prints last", () => {
  const base = { phase: "build", attempt: 1, attemptUnknown: false, workflowName: "demo", driver: "a delegated agent" } as const;
  assert.equal(
    render.statusRunning({ ...base, observer: true }),
    "RUNNING build (attempt 1)\nworkflow: demo\ndriver: a delegated agent\n" +
      "observer: HEADSIGN_OBSERVER is set here — turn ends from this environment are never held\n",
  );
  assert.equal(
    render.statusRunning({ ...base, lastStop: { disposition: "unheld", at: "T" }, acceptedGraphChanges: 2, observer: true }),
    "RUNNING build (attempt 1)\nworkflow: demo\ndriver: a delegated agent\n" +
      "last stop: not held — Claude Code had already resumed the turn (stop_hook_active) — at T\n" +
      "graph: 2 accepted changes to the workflow's rules during this run\n" +
      "observer: HEADSIGN_OBSERVER is set here — turn ends from this environment are never held\n",
  );
});

// The vocabulary rule for both lines: they say what HEADSIGN did with the turn, and name the
// upstream field only as the identifier it is. Neither may describe what any platform
// documentation currently says about that field — a published claim about somebody else's docs
// rots silently (ADR-0006's dated line about this very field is the example).
test("statusRunning: the unheld wording names the field and claims nothing about upstream documentation", () => {
  const actual = render.statusRunning({
    phase: "build", attempt: 1, attemptUnknown: false, workflowName: "demo",
    driver: "a delegated agent", lastStop: { disposition: "unheld", at: "T" },
  });
  assert.match(actual, /\(stop_hook_active\)/);
  assert.doesNotMatch(actual, /documented|undocumented/);
  assert.doesNotMatch(actual, /loop guard/, "the loop guard is headsign's own stop_nudges, not Claude Code's flag");
});

// ADR-0026: `unheld` now has two possible causes, and the whole point of carrying `cause` is
// that a reader can tell them apart on sight without opening the log.
test("statusRunning: an unheld record explicitly caused by CLAUDE_PROJECT_DIR prints a sentence distinct from the stop_hook_active one", () => {
  const stopHookActive = render.statusRunning({
    phase: "build", attempt: 1, attemptUnknown: false, workflowName: "demo",
    driver: "a delegated agent", lastStop: { disposition: "unheld", at: "T", cause: "stop_hook_active" },
  });
  const claudeProjectDir = render.statusRunning({
    phase: "build", attempt: 1, attemptUnknown: false, workflowName: "demo",
    driver: "a delegated agent", lastStop: { disposition: "unheld", at: "T", cause: "CLAUDE_PROJECT_DIR" },
  });
  assert.match(stopHookActive, /\(stop_hook_active\)/);
  assert.match(claudeProjectDir, /\(CLAUDE_PROJECT_DIR\)/);
  assert.notEqual(stopHookActive, claudeProjectDir, "the two causes must print different last-stop sentences");
});

// An explicit `cause: "stop_hook_active"` and an absent `cause` must read identically: the
// default is what a pre-this-field record (or a reader that dropped the key) falls back to,
// and it has to fall back to unheld's one and only historical cause, not to an empty phrase.
test("statusRunning: an unheld record with no cause at all reads the same as one explicitly caused by stop_hook_active", () => {
  const explicit = render.statusRunning({
    phase: "build", attempt: 1, attemptUnknown: false, workflowName: "demo",
    driver: "a delegated agent", lastStop: { disposition: "unheld", at: "T", cause: "stop_hook_active" },
  });
  const absent = render.statusRunning({
    phase: "build", attempt: 1, attemptUnknown: false, workflowName: "demo",
    driver: "a delegated agent", lastStop: { disposition: "unheld", at: "T" },
  });
  assert.equal(explicit, absent);
});

// --- status: the current phase's instruction, in the same block `next`/`start` use ---

test("statusRunning: description present -> the phase block lands last, same shape as start/next", () => {
  const actual = render.statusRunning({
    phase: "build", attempt: 1, maxAttempts: 3, attemptUnknown: false,
    workflowName: "demo", driver: "a delegated agent", description: "Build the thing.",
  });
  const expected = `RUNNING build (attempt 1/3)\nworkflow: demo\ndriver: a delegated agent\n--- phase: build ---\nBuild the thing.\n`;
  assert.equal(actual, expected);
});

test("statusRunning: description omitted -> byte-identical to before the phase block existed", () => {
  const actual = render.statusRunning({
    phase: "build", attempt: 1, maxAttempts: 3, attemptUnknown: false,
    workflowName: "demo", driver: "a delegated agent",
  });
  const expected = `RUNNING build (attempt 1/3)\nworkflow: demo\ndriver: a delegated agent\n`;
  assert.equal(actual, expected);
});

test("statusRunning: the phase block lands after every other conditional line, not between them", () => {
  const actual = render.statusRunning({
    phase: "build", attempt: 1, attemptUnknown: false, workflowName: "demo", driver: "a delegated agent",
    lastStop: { disposition: "nudged", at: "T" }, acceptedGraphChanges: 1, observer: true,
    description: "Build the thing.",
  });
  assert.match(actual, /observer: HEADSIGN_OBSERVER is set here — turn ends from this environment are never held\n--- phase: build ---\nBuild the thing\.\n$/);
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
    last_failure: null,
    end_reason: null,
    stop_nudges: 0,
    driver_agent: null,
    last_stop: null,
    last_drive: null,
    graph_fingerprint: {},
    graph_change_reported: null,
    accepted_graph_changes: 0,
    ...overrides,
  };
}

test("logLine: start", () => {
  const line = render.logLine("2026-07-23T00:00:00.000Z", { kind: "START", workflow: "demo" }, baseState({ phase: "plan" }));
  assert.equal(line, `2026-07-23T00:00:00.000Z start plan a=0 i=0 workflow=demo\n`);
});

test("logLine: retry", () => {
  const outcome = {
    kind: "RETRY" as const,
    phase: "build",
    attempt: 1,
    maxAttempts: 3,
    failure: { check: "tests", run: "npm test", exitCode: 1, outputTail: "x" },
    repeats: 1,
  };
  const line = render.logLine("ts", outcome, baseState({ phase: "build", attempts: { build: 1 }, total_iterations: 1 }));
  assert.equal(line, `ts retry build a=1 i=1 check="tests" exit=1\n`);
});

test("logLine: retry with a timeout exit code", () => {
  const outcome = {
    kind: "RETRY" as const,
    phase: "build",
    attempt: 2,
    failure: { check: "tests", run: "npm test", exitCode: "timeout" as const, outputTail: "x", timeoutSeconds: 5 },
    repeats: 1,
  };
  const line = render.logLine("ts", outcome, baseState({ phase: "build", attempts: { build: 2 }, total_iterations: 4 }));
  assert.equal(line, `ts retry build a=2 i=4 check="tests" exit=timeout\n`);
});

test("logLine: retry with elapsedSeconds appends dur= after exit=, the existing fields unchanged", () => {
  const outcome = {
    kind: "RETRY" as const,
    phase: "build",
    attempt: 1,
    maxAttempts: 3,
    failure: { check: "tests", run: "npm test", exitCode: 1, outputTail: "x", elapsedSeconds: 12.3 },
    repeats: 1,
  };
  const line = render.logLine("ts", outcome, baseState({ phase: "build", attempts: { build: 1 }, total_iterations: 1 }));
  assert.equal(line, `ts retry build a=1 i=1 check="tests" exit=1 dur=12.3s\n`);
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

test("logLine: fail-routed advance with elapsedSeconds appends dur= after exit=", () => {
  const outcome = {
    kind: "ADVANCE" as const,
    phase: "implement",
    description: "Implement.",
    failure: { check: "review approved", run: "grep -qx APPROVED verdict", exitCode: 1, outputTail: "x", elapsedSeconds: 0.4, routedTo: "implement" },
  };
  const line = render.logLine("ts", outcome, baseState({ phase: "implement", attempts: { review: 1 }, total_iterations: 3 }), "review");
  assert.equal(line, `ts advance implement a=0 i=3 from=review routed-fail check="review approved" exit=1 dur=0.4s\n`);
});

test("logLine: routed advance records which when answered", () => {
  const outcome = { kind: "ADVANCE" as const, phase: "fix-bug", description: "Fix.", routedBy: { when: "grep -qx fix-bug .headsign/tmp/route" } };
  const line = render.logLine("ts", outcome, baseState({ phase: "fix-bug", total_iterations: 2 }), "classify");
  assert.equal(line, `ts advance fix-bug a=0 i=2 from=classify routed-when="grep -qx fix-bug .headsign/tmp/route"\n`);
});

test("logLine: an advance that fell through to the default says so", () => {
  const outcome = { kind: "ADVANCE" as const, phase: "implement", description: "Do.", routedBy: { default: true as const } };
  const line = render.logLine("ts", outcome, baseState({ phase: "implement", total_iterations: 3 }), "classify");
  assert.equal(line, `ts advance implement a=0 i=3 from=classify routed-default\n`);
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

// The ceiling gets its own word (ADR-0017): it prints as ESCALATE but ends nothing, and a
// reader of the log must be able to tell it from the two escalations that do end a run.
test("logLine: ceiling has its own event word and carries the reason like an ending does", () => {
  const reason = "build: max_total_iterations (5) reached — the run is still open: raise it and run `headsign next`";
  const line = render.logLine("ts", { kind: "CEILING", reason }, baseState({ phase: "build", attempts: { build: 1 }, total_iterations: 5 }));
  assert.equal(line, `ts ceiling build a=1 i=5 reason="${reason}"\n`);
  assert.doesNotMatch(line, /escalate/);
});

// One event word for both dispositions (a reader following a run greps `graph-changed` once),
// and the keys unquoted because they are identifiers rather than free text.
test("logLine: graph-changed names the disposition and every key that moved", () => {
  const line = render.logLine("ts", { kind: "GRAPH_CHANGED", disposition: "reported", keys: ["implement", "review"] }, baseState({ phase: "review", attempts: { review: 1 }, total_iterations: 7 }));
  assert.equal(line, `ts graph-changed review a=1 i=7 state=reported phases=implement,review\n`);
});

test("logLine: an accepted ceiling change is the same line with a different disposition", () => {
  const line = render.logLine("ts", { kind: "GRAPH_CHANGED", disposition: "accepted", keys: ["$limits"] }, baseState({ phase: "review", attempts: { review: 1 }, total_iterations: 7 }));
  assert.equal(line, `ts graph-changed review a=1 i=7 state=accepted phases=$limits\n`);
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

// --- logLine: the Stop-boundary events (ADR-0006/0009; stophook.ts is the caller) ---

test("logLine: paused carries the note's first line", () => {
  const line = render.logLine("ts", { kind: "PAUSED", note: "stepping away for lunch" }, baseState({ phase: "build" }));
  assert.equal(line, `ts paused build a=0 i=0 note="stepping away for lunch"\n`);
});

test("logLine: paused reflects the resulting state's attempts/iterations", () => {
  const line = render.logLine("ts", { kind: "PAUSED", note: "brb" }, baseState({ phase: "review", attempts: { review: 2 }, total_iterations: 6 }));
  assert.equal(line, `ts paused review a=2 i=6 note="brb"\n`);
});

// The whole line, to the byte. The detail key is the one `stalled` already uses for the same
// quantity: one key, one meaning, so counting the holds a run has spent is one grep.
test("logLine: held carries the nudge count under the same key stalled uses", () => {
  const line = render.logLine("2026-07-31T17:10:04+09:00", { kind: "HELD", nudges: 3 }, baseState({ phase: "implement", total_iterations: 48 }));
  assert.equal(line, `2026-07-31T17:10:04+09:00 held implement a=0 i=48 nudges=3\n`);
});

test("logLine: held reflects the resulting state's phase, attempts and iterations like every other event", () => {
  const line = render.logLine("ts", { kind: "HELD", nudges: 1 }, baseState({ phase: "review", attempts: { review: 2 }, total_iterations: 6 }));
  assert.equal(line, `ts held review a=2 i=6 nudges=1\n`);
});

test("logLine: stalled names the fixed nudges=5 cap", () => {
  const line = render.logLine("ts", { kind: "STALLED" }, baseState({ phase: "build", total_iterations: 5 }));
  assert.equal(line, `ts stalled build a=0 i=5 nudges=5\n`);
});

test("logLine: claimed has no detail — the adopted agent id must never appear in the log line", () => {
  const line = render.logLine("ts", { kind: "CLAIMED" }, baseState({ phase: "build", driver_agent: "agent-abc" }));
  assert.equal(line, `ts claimed build a=0 i=0\n`);
  assert.doesNotMatch(line, /agent-abc/);
});

// The whole line, to the byte, because every part of it is load-bearing: the event word is
// headsign's own (`unheld`, never `pass` — that is what a GATE does here), and the detail names
// the upstream field BARE, by this file's rule that quotes mean free text and bare means
// identifier. `stop_hook_active` is the one token common to the log line, headsign's source, the
// hook payload a person can print, and whatever upstream documentation exists.
test("logLine: unheld names the already-continuing flag as a bare identifier, never quoted", () => {
  const line = render.logLine("2026-07-30T23:06:51+09:00", { kind: "UNHELD", cause: "stop_hook_active" }, baseState({ phase: "decide", total_iterations: 21 }));
  assert.equal(line, `2026-07-30T23:06:51+09:00 unheld decide a=0 i=21 by=stop_hook_active\n`);
  assert.doesNotMatch(line, /"/, "the detail is an identifier, so it carries no quotes");
  assert.doesNotMatch(line, / pass /, "`pass` is this codebase's word for a gate succeeding and must not name this event");
});

test("logLine: unheld reflects the resulting state's phase, attempts and iterations like every other event", () => {
  const line = render.logLine("ts", { kind: "UNHELD", cause: "stop_hook_active" }, baseState({ phase: "review", attempts: { review: 2 }, total_iterations: 6 }));
  assert.equal(line, `ts unheld review a=2 i=6 by=stop_hook_active\n`);
});

// ADR-0026's second cause: the second starting point (CLAUDE_PROJECT_DIR) found the run the
// cwd walk missed. Same event word, same bare-identifier rule, different upstream token named
// verbatim — the whole reason `cause` exists is so this line and the `stop_hook_active` line
// above are told apart on sight.
test("logLine: unheld names CLAUDE_PROJECT_DIR verbatim when that is the cause, distinct from stop_hook_active", () => {
  const line = render.logLine("ts", { kind: "UNHELD", cause: "CLAUDE_PROJECT_DIR" }, baseState({ phase: "decide", total_iterations: 3 }));
  assert.equal(line, `ts unheld decide a=0 i=3 by=CLAUDE_PROJECT_DIR\n`);
});
