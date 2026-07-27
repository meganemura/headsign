import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as stophook from "../src/stophook.ts";
import * as state from "../src/state.ts";

const NOW = "2026-07-25T09:00:00+09:00";

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "headsign-stophook-"));
}

function runningState(overrides: Partial<state.State> = {}): state.State {
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
    driver_session: null,
    driver_source: null,
    ...overrides,
  };
}

// No HEADSIGN_SESSION_ID/HEADSIGN_OBSERVER/CLAUDE_CODE_SESSION_ID of its own, so existing
// tests (written before ADR-0008) keep exercising the unchanged pre-ownership behavior
// unless a test opts in by passing its own env.
const NO_ENV: NodeJS.ProcessEnv = {};

function readLog(dir: string): string[] {
  const p = state.logPath(dir);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter((l) => l.length > 0);
}

function writeNote(dir: string, content: string): void {
  const tmpDir = path.join(dir, ".headsign", "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "stop-note"), content);
}

test("no state file and no .git ancestor -> does not block", () => {
  const dir = tmpdir();
  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });
});

test("running state at cwd -> blocks with workflow name, phase, next hint, and abort hint", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ workflow: "demo", phase: "build" }));
  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW, NO_ENV);
  assert.equal(decision.block, true);
  assert.ok(decision.message);
  assert.ok(decision.message.includes("demo"));
  assert.ok(decision.message.includes("build"));
  assert.ok(decision.message.includes("headsign next`"));
  assert.ok(decision.message.includes("headsign abort"));
});

for (const status of ["complete", "escalated", "aborted"] as const) {
  test(`status '${status}' at cwd -> does not block`, () => {
    const dir = tmpdir();
    state.writeState(dir, runningState({ status, end_reason: status === "complete" ? null : "some reason" }));
    const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW, NO_ENV);
    assert.deepEqual(decision, { block: false });
  });
}

test("stop_hook_active:true does not block and does not increment stop_nudges", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ stop_nudges: 0 }));
  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir, stop_hook_active: true }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });
  const after = state.readState(dir);
  assert.equal(after?.stop_nudges, 0);
});

test("nudge lifecycle: 1 -> 5 with final-reminder only on the 5th, then 6th call does not block", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ stop_nudges: 0 }));
  const stdin = JSON.stringify({ cwd: dir });

  for (let expected = 1; expected <= 4; expected++) {
    const result = stophook.evaluate(dir, stdin, NOW, NO_ENV);
    assert.equal(result.block, true, `nudge #${expected} should block`);
    assert.equal(state.readState(dir)?.stop_nudges, expected);
    assert.ok(!result.message?.includes("final automatic reminder"), `nudge #${expected} must not carry the final notice`);
  }

  const fifth = stophook.evaluate(dir, stdin, NOW, NO_ENV);
  assert.equal(fifth.block, true);
  assert.equal(state.readState(dir)?.stop_nudges, 5);
  assert.ok(fifth.message?.includes("final automatic reminder"));

  const sixth = stophook.evaluate(dir, stdin, NOW, NO_ENV);
  assert.deepEqual(sixth, { block: false });
  assert.equal(state.readState(dir)?.stop_nudges, 5);
});

test("non-numeric stop_nudges is treated as 0, still blocks, and rewrites it as the number 1", () => {
  const dir = tmpdir();
  const headsignDir = path.join(dir, ".headsign");
  fs.mkdirSync(headsignDir, { recursive: true });
  const corrupt = { ...runningState(), stop_nudges: "x" };
  fs.writeFileSync(state.statePath(dir), JSON.stringify(corrupt, null, 2) + "\n");

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW, NO_ENV);
  assert.equal(decision.block, true);

  const after = state.readState(dir) as unknown as { stop_nudges: unknown };
  assert.equal(typeof after.stop_nudges, "number");
  assert.equal(after.stop_nudges, 1);
});

test("walk-up: finds a run at a .git-bounded root from a deep subdirectory with no state/.git of its own", () => {
  const root = tmpdir();
  fs.mkdirSync(path.join(root, ".git"));
  state.writeState(root, runningState({ workflow: "demo", phase: "build" }));
  const deepSubdir = path.join(root, "a", "b", "c");
  fs.mkdirSync(deepSubdir, { recursive: true });

  const decision = stophook.evaluate("anything", JSON.stringify({ cwd: deepSubdir }), NOW, NO_ENV);
  assert.equal(decision.block, true);
  assert.ok(decision.message?.includes(root));
  assert.ok(decision.message?.includes("cd there"));
});

test("walk-up boundary: a .git FILE stops the walk before reaching a running state further up", () => {
  const root = tmpdir();
  fs.mkdirSync(path.join(root, ".git"));
  state.writeState(root, runningState({ stop_nudges: 0 }));
  const boundaryDir = path.join(root, "a");
  fs.mkdirSync(boundaryDir, { recursive: true });
  fs.writeFileSync(path.join(boundaryDir, ".git"), "gitdir: /elsewhere");
  const deepSubdir = path.join(boundaryDir, "b", "c");
  fs.mkdirSync(deepSubdir, { recursive: true });

  const decision = stophook.evaluate("anything", JSON.stringify({ cwd: deepSubdir }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });
  assert.equal(state.readState(root)?.stop_nudges, 0);
});

test("garbage stdin fails open regardless of state at cwd", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState());
  const decision = stophook.evaluate(dir, "not json{{{", NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });
});

// --- exit-note gate (ADR-0006 revision) ---

test("note: a non-empty stop-note pauses instead of blocking — exit 0, note deleted, stop_nudges reset, one paused log line", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ workflow: "demo", phase: "build", stop_nudges: 3 }));
  writeNote(dir, "stepping away for lunch, resume after\nsecond line ignored");

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });

  const notePath = path.join(dir, ".headsign", "tmp", "stop-note");
  assert.ok(!fs.existsSync(notePath), "note must be consumed (deleted)");

  const after = state.readState(dir);
  assert.equal(after?.stop_nudges, 0);

  const lines = readLog(dir);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\S+ paused build a=0 i=0 note="stepping away for lunch, resume after"$/);
});

test("note: first line is trimmed and truncated to 120 chars", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ workflow: "demo", phase: "build" }));
  const longLine = "x".repeat(200);
  writeNote(dir, `  ${longLine}  \nsecond line`);

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });

  const lines = readLog(dir);
  assert.equal(lines.length, 1);
  const expectedFirstLine = longLine.slice(0, 120);
  assert.ok(lines[0].includes(`note="${expectedFirstLine}"`));
  assert.ok(!lines[0].includes(longLine), "the truncated note must not include the full 200-char line");
});

test("note: whitespace-only note is treated as absent — still blocks, note left alone is irrelevant since it's deleted only on pause", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ workflow: "demo", phase: "build" }));
  writeNote(dir, "   \n\t\n   ");

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW, NO_ENV);
  assert.equal(decision.block, true);
  assert.equal(state.readState(dir)?.stop_nudges, 1);
  assert.equal(readLog(dir).length, 0);
});

test("note: absent -> blocks, and the message contains both the stop-note instructions and the abort escape hatch", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ workflow: "demo", phase: "build" }));

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW, NO_ENV);
  assert.equal(decision.block, true);
  assert.ok(decision.message);
  assert.ok(decision.message.includes(".headsign/tmp/stop-note"), "must name the stop-note path");
  assert.ok(decision.message.includes("headsign abort"), "must name the abort escape hatch");
});

test("stalled: the 5th nudge appends exactly one stalled log line; later stops do not repeat it", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ workflow: "demo", phase: "build" }));
  const stdin = JSON.stringify({ cwd: dir });

  for (let i = 1; i <= 5; i++) stophook.evaluate(dir, stdin, NOW, NO_ENV);
  let lines = readLog(dir);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\S+ stalled build a=0 i=0 nudges=5$/);

  // 6th and 7th stops must fail open and must not add another stalled line.
  const sixth = stophook.evaluate(dir, stdin, NOW, NO_ENV);
  assert.deepEqual(sixth, { block: false });
  const seventh = stophook.evaluate(dir, stdin, NOW, NO_ENV);
  assert.deepEqual(seventh, { block: false });
  lines = readLog(dir);
  assert.equal(lines.length, 1, "stalled must not be repeated");
});

test("note consumption and paused logging operate on runDir, not startDir, when found via walk-up", () => {
  const root = tmpdir();
  fs.mkdirSync(path.join(root, ".git"));
  state.writeState(root, runningState({ workflow: "demo", phase: "build", stop_nudges: 2 }));
  writeNote(root, "pausing from a subdir");
  const deepSubdir = path.join(root, "a", "b");
  fs.mkdirSync(deepSubdir, { recursive: true });

  const decision = stophook.evaluate("anything", JSON.stringify({ cwd: deepSubdir }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });

  const notePath = path.join(root, ".headsign", "tmp", "stop-note");
  assert.ok(!fs.existsSync(notePath));
  assert.equal(state.readState(root)?.stop_nudges, 0);

  const lines = readLog(root);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /paused build a=0 i=0 note="pausing from a subdir"/);
});

test("walk-up block message shows the runDir-prefixed note path", () => {
  const root = tmpdir();
  fs.mkdirSync(path.join(root, ".git"));
  state.writeState(root, runningState({ workflow: "demo", phase: "build" }));
  const deepSubdir = path.join(root, "a", "b");
  fs.mkdirSync(deepSubdir, { recursive: true });

  const decision = stophook.evaluate("anything", JSON.stringify({ cwd: deepSubdir }), NOW, NO_ENV);
  assert.equal(decision.block, true);
  assert.ok(decision.message?.includes(`${root}/.headsign/tmp/stop-note`));
  assert.ok(decision.message?.includes("headsign abort"));
});

// --- multi-session ownership: observer opt-out and owner check (ADR-0008) ---

test("HEADSIGN_OBSERVER set -> unconditional pass-through even while running with no owner mismatch at all", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ stop_nudges: 2 }));
  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir, session_id: "driver-1" }), NOW, { HEADSIGN_OBSERVER: "1" });
  assert.deepEqual(decision, { block: false });
  assert.equal(state.readState(dir)?.stop_nudges, 2, "observer pass-through must not touch state");
});

test("HEADSIGN_OBSERVER set -> pass-through even ahead of malformed stdin (checked before parsing)", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState());
  const decision = stophook.evaluate(dir, "not json{{{", NOW, { HEADSIGN_OBSERVER: "1" });
  assert.deepEqual(decision, { block: false });
});

test("owner mismatch (both identifiers present, different) -> pass-through: no state write, no output", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ stop_nudges: 2, driver_session: "driver-1" }));
  const before = fs.readFileSync(state.statePath(dir));

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir, session_id: "observer-2" }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });

  const after = fs.readFileSync(state.statePath(dir));
  assert.deepEqual(after, before, "an owner-mismatched stop must not write state.json at all");
});

test("owner mismatch takes priority over the stop-note gate: a bystander's stop must not consume the driver's note", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_session: "driver-1" }));
  writeNote(dir, "the driver is stepping away");

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir, session_id: "observer-2" }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });

  const notePath = path.join(dir, ".headsign", "tmp", "stop-note");
  assert.ok(fs.existsSync(notePath), "the note must remain unconsumed by a bystander's stop");
  assert.equal(readLog(dir).length, 0, "no paused (or any other) log line for a bystander's pass-through");
});

test("owner match (both identifiers present, equal) -> falls through to the normal nudge flow (still blocks)", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_session: "driver-1" }));
  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir, session_id: "driver-1" }), NOW, NO_ENV);
  assert.equal(decision.block, true);
  assert.equal(state.readState(dir)?.stop_nudges, 1);
});

test("hook session id missing (no stdin session_id, no env HEADSIGN_SESSION_ID) -> owner check skipped, legacy nudge behavior", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_session: "driver-1" }));
  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW, NO_ENV);
  assert.equal(decision.block, true);
  assert.equal(state.readState(dir)?.stop_nudges, 1);
});

test("driver_session missing on state (legacy state.json / never stamped) -> owner check skipped, legacy nudge behavior", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_session: null }));
  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir, session_id: "some-session" }), NOW, NO_ENV);
  assert.equal(decision.block, true);
  assert.equal(state.readState(dir)?.stop_nudges, 1);
});

test("driver_session present as a non-string legacy value -> treated as absent, owner check skipped", () => {
  const dir = tmpdir();
  fs.mkdirSync(path.join(dir, ".headsign"), { recursive: true });
  const corrupt = { ...runningState(), driver_session: 12345 };
  fs.writeFileSync(state.statePath(dir), JSON.stringify(corrupt, null, 2) + "\n");
  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir, session_id: "some-session" }), NOW, NO_ENV);
  assert.equal(decision.block, true);
});

test("hook session id falls back to env HEADSIGN_SESSION_ID when stdin has no session_id, and the owner check still fires on mismatch", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_session: "driver-1" }));
  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW, { HEADSIGN_SESSION_ID: "observer-2" });
  assert.deepEqual(decision, { block: false });
  assert.equal(state.readState(dir)?.stop_nudges, 0, "must not have incremented — the mismatch pass-through, not a legacy nudge");
});

test("stdin session_id wins over env HEADSIGN_SESSION_ID when both are present", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_session: "driver-1" }));
  // stdin says the driver itself; env (irrelevant here, stdin wins) says someone else —
  // if env won this would wrongly pass through instead of nudging.
  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir, session_id: "driver-1" }), NOW, { HEADSIGN_SESSION_ID: "observer-2" });
  assert.equal(decision.block, true);
});

test("a blank stdin session_id (whitespace only) is treated as absent, falling back to env HEADSIGN_SESSION_ID", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_session: "driver-1" }));
  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir, session_id: "   " }), NOW, { HEADSIGN_SESSION_ID: "observer-2" });
  assert.deepEqual(decision, { block: false });
});

// --- Stop and the claim marker: the regression ADR-0010 exists to prevent ---

function writeClaimMarker(dir: string): void {
  const tmpDir = path.join(dir, ".headsign", "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "claim"), "");
}

function claimMarkerPath(dir: string): string {
  return path.join(dir, ".headsign", "tmp", "claim");
}

test("Stop: a claim marker is neither adopted nor consumed — the marker survives untouched and the driver is not stamped", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_session: "session-alpha", driver_source: "env", stop_nudges: 0 }));
  writeClaimMarker(dir);

  // Under ADR-0009 this stop would have sealed session-alpha as the driver, stealing the
  // seat a delegated agent had just asked for. ADR-0010: Stop must not look at the marker.
  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir, session_id: "session-alpha" }), NOW, NO_ENV);
  assert.equal(decision.block, true, "falls through to the ordinary nudge flow for this run's own session driver");

  assert.ok(fs.existsSync(claimMarkerPath(dir)), "the claim marker must survive a Stop untouched — only SubagentStop may consume it");
  const after = state.readState(dir);
  assert.equal(after?.driver_session, "session-alpha", "no adoption: the driver is unchanged");
  assert.equal(after?.driver_source, "env");
  assert.equal(after?.stop_nudges, 1, "the ordinary loop-guard nudge still applies");
  assert.equal(readLog(dir).filter((l) => l.includes(" claimed ")).length, 0, "Stop must never log a claimed line");
});

test("Stop: a claim marker on a run with no driver at all is still ignored (no adoption of an unowned run)", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_session: null, driver_source: null }));
  writeClaimMarker(dir);

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir, session_id: "session-alpha" }), NOW, NO_ENV);
  assert.equal(decision.block, true);
  assert.ok(fs.existsSync(claimMarkerPath(dir)));
  const after = state.readState(dir);
  assert.equal(after?.driver_session, null);
  assert.equal(after?.driver_source, null);
});

test("Stop: driver_source \"claim\" always passes through — no state write, whatever session_id the stop carries", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_session: "agent-alpha", driver_source: "claim", stop_nudges: 2 }));
  const before = fs.readFileSync(state.statePath(dir));

  // Even a session_id that happens to equal the recorded agent id must not block: the two
  // are different identifier spaces, and Stop can never be the claimed agent's own turn end.
  for (const sid of ["session-alpha", "agent-alpha"]) {
    const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir, session_id: sid }), NOW, NO_ENV);
    assert.deepEqual(decision, { block: false }, `session_id ${sid} must pass through on a claim-driven run`);
  }
  assert.deepEqual(fs.readFileSync(state.statePath(dir)), before, "a claim-driven run must not be written by any Stop");
});

test("Stop: driver_source \"claim\" passes through ahead of the stop-note gate — a session's stop must not consume the claimed agent's note", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_session: "agent-alpha", driver_source: "claim" }));
  writeNote(dir, "the delegated agent is stepping away");

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir, session_id: "agent-alpha" }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });
  assert.ok(fs.existsSync(path.join(dir, ".headsign", "tmp", "stop-note")), "the note must remain for the claimed agent's own SubagentStop");
  assert.equal(readLog(dir).length, 0);
});

// --- SubagentStop: sealing and backstopping a delegated agent (ADR-0010) ---

function subagentStdin(o: { dir?: string; agentId?: string; stopHookActive?: boolean }): string {
  const payload: Record<string, unknown> = {};
  if (o.dir !== undefined) payload.cwd = o.dir;
  if (o.agentId !== undefined) payload.agent_id = o.agentId;
  if (o.stopHookActive !== undefined) payload.stop_hook_active = o.stopHookActive;
  return JSON.stringify(payload);
}

test("SubagentStop adoption: a claim marker plus an agent_id seals that agent — driver_session/driver_source/stop_nudges stamped, marker consumed, one claimed log line, block=true with the confirmation", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ workflow: "demo", phase: "build", driver_session: "session-alpha", driver_source: "env", stop_nudges: 3 }));
  writeClaimMarker(dir);

  const decision = stophook.evaluateSubagent(dir, subagentStdin({ dir, agentId: "agent-alpha" }), NOW, NO_ENV);
  assert.equal(decision.block, true);
  assert.ok(decision.message);
  assert.match(decision.message, /^Claim confirmed: this agent now drives workflow 'demo' \(phase: build\)\./);
  assert.match(decision.message, /headsign next`/);
  assert.match(decision.message, /headsign abort/);
  assert.match(decision.message, /\.headsign\/tmp\/stop-note/);
  assert.doesNotMatch(decision.message, /agent-alpha/, "the adopted agent id must never appear in the hook's own message");

  const after = state.readState(dir);
  assert.equal(after?.driver_session, "agent-alpha");
  assert.equal(after?.driver_source, "claim");
  assert.equal(after?.stop_nudges, 0);

  assert.ok(!fs.existsSync(claimMarkerPath(dir)), "the claim marker must be consumed");

  const lines = readLog(dir);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\S+ claimed build a=0 i=0$/);
  assert.doesNotMatch(lines[0], /agent-alpha/, "the log line must never carry the adopted agent id");
});

test("SubagentStop adoption: a surrounding agent_id is trimmed before it is sealed", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState());
  writeClaimMarker(dir);

  const decision = stophook.evaluateSubagent(dir, subagentStdin({ dir, agentId: "  agent-alpha  " }), NOW, NO_ENV);
  assert.equal(decision.block, true);
  assert.equal(state.readState(dir)?.driver_session, "agent-alpha");
});

test("SubagentStop adoption: a claim marker with no agent_id leaves the marker in place and changes nothing", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_session: "session-alpha", driver_source: "env", stop_nudges: 1 }));
  writeClaimMarker(dir);
  const before = fs.readFileSync(state.statePath(dir));

  const decision = stophook.evaluateSubagent(dir, subagentStdin({ dir }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false }, "an unnameable subagent stop on a session-driven run just passes through");
  assert.ok(fs.existsSync(claimMarkerPath(dir)), "the marker waits for a later, identifiable subagent stop");
  assert.deepEqual(fs.readFileSync(state.statePath(dir)), before, "no adoption, no nudge, no state write");
  assert.equal(readLog(dir).length, 0);
});

test("SubagentStop adoption: a blank (whitespace-only) agent_id counts as no agent_id", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_session: "session-alpha", driver_source: "env" }));
  writeClaimMarker(dir);

  const decision = stophook.evaluateSubagent(dir, subagentStdin({ dir, agentId: "   " }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });
  assert.ok(fs.existsSync(claimMarkerPath(dir)));
  assert.equal(state.readState(dir)?.driver_source, "env");
});

test("SubagentStop adoption: env session identifiers are never used as a fallback for agent_id — only the payload can name an agent", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_session: null, driver_source: null }));
  writeClaimMarker(dir);

  const decision = stophook.evaluateSubagent(dir, subagentStdin({ dir }), NOW, { HEADSIGN_SESSION_ID: "session-alpha" });
  assert.deepEqual(decision, { block: false });
  assert.ok(fs.existsSync(claimMarkerPath(dir)), "an env session id must not seal a claim");
  assert.equal(state.readState(dir)?.driver_session, null);
});

test("SubagentStop adoption gate runs BEFORE the owner comparison: an agent that mismatches the old driver is adopted, not passed through as a bystander", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_session: "agent-beta", driver_source: "claim" }));
  writeClaimMarker(dir);

  const decision = stophook.evaluateSubagent(dir, subagentStdin({ dir, agentId: "agent-alpha" }), NOW, NO_ENV);
  assert.equal(decision.block, true, "adopted, not passed through as a mismatched bystander");
  const after = state.readState(dir);
  assert.equal(after?.driver_session, "agent-alpha");
  assert.equal(after?.driver_source, "claim");
});

test("SubagentStop adoption: re-claim re-arms, and the next agent to name itself replaces a previous mistaken adoption", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_session: "session-alpha", driver_source: "env" }));
  writeClaimMarker(dir);

  const first = stophook.evaluateSubagent(dir, subagentStdin({ dir, agentId: "agent-beta" }), NOW, NO_ENV);
  assert.equal(first.block, true);
  assert.equal(state.readState(dir)?.driver_session, "agent-beta");

  writeClaimMarker(dir);
  const second = stophook.evaluateSubagent(dir, subagentStdin({ dir, agentId: "agent-alpha" }), NOW, NO_ENV);
  assert.equal(second.block, true);
  const after = state.readState(dir);
  assert.equal(after?.driver_session, "agent-alpha", "the later adoption replaces the earlier one");
  assert.equal(after?.driver_source, "claim");
  assert.equal(readLog(dir).filter((l) => l.includes(" claimed ")).length, 2, "each successful adoption logs its own claimed line");
});

test("SubagentStop owner check: the recorded claim driver's own turn end blocks and increments stop_nudges", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ workflow: "demo", phase: "build", driver_session: "agent-alpha", driver_source: "claim", stop_nudges: 0 }));

  const decision = stophook.evaluateSubagent(dir, subagentStdin({ dir, agentId: "agent-alpha" }), NOW, NO_ENV);
  assert.equal(decision.block, true);
  assert.match(decision.message ?? "", /headsign workflow 'demo' is still running \(phase: build\)\./);
  assert.match(decision.message ?? "", /headsign next`/);
  assert.match(decision.message ?? "", /headsign abort/);
  assert.equal(state.readState(dir)?.stop_nudges, 1);
});

test("SubagentStop owner check: a different agent's turn end passes through — no state write, no output", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_session: "agent-alpha", driver_source: "claim", stop_nudges: 2 }));
  const before = fs.readFileSync(state.statePath(dir));

  const decision = stophook.evaluateSubagent(dir, subagentStdin({ dir, agentId: "agent-beta" }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });
  assert.deepEqual(fs.readFileSync(state.statePath(dir)), before, "an unrelated subagent's stop must not write state.json at all");
});

test("SubagentStop owner check: a session-driven run (driver_source \"env\") passes through — a subagent under it is not the driver", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_session: "session-alpha", driver_source: "env", stop_nudges: 2 }));
  const before = fs.readFileSync(state.statePath(dir));

  const decision = stophook.evaluateSubagent(dir, subagentStdin({ dir, agentId: "agent-alpha" }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });
  assert.deepEqual(fs.readFileSync(state.statePath(dir)), before);
});

test("SubagentStop owner check: an unclaimed run (driver_source null) passes through too", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_session: null, driver_source: null, stop_nudges: 0 }));

  const decision = stophook.evaluateSubagent(dir, subagentStdin({ dir, agentId: "agent-alpha" }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });
  assert.equal(state.readState(dir)?.stop_nudges, 0);
});

test("SubagentStop owner check: a claim-driven run whose subagent stop carries no agent_id passes through untouched — only a positive match may block", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_session: "agent-alpha", driver_source: "claim", stop_nudges: 0 }));

  const decision = stophook.evaluateSubagent(dir, subagentStdin({ dir }), NOW, NO_ENV);
  assert.equal(decision.block, false);
  assert.equal(state.readState(dir)?.stop_nudges, 0, "a stop that cannot name itself must never be nudged into someone else's run");
});

test("SubagentStop: a non-empty stop-note pauses instead of blocking — note deleted, stop_nudges reset, one paused log line", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_session: "agent-alpha", driver_source: "claim", stop_nudges: 3 }));
  writeNote(dir, "handing back to the human\nsecond line ignored");

  const decision = stophook.evaluateSubagent(dir, subagentStdin({ dir, agentId: "agent-alpha" }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });
  assert.ok(!fs.existsSync(path.join(dir, ".headsign", "tmp", "stop-note")), "note must be consumed (deleted)");
  assert.equal(state.readState(dir)?.stop_nudges, 0);

  const lines = readLog(dir);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\S+ paused build a=0 i=0 note="handing back to the human"$/);
});

test("SubagentStop: an unrelated agent's stop must not consume the driving agent's stop-note", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_session: "agent-alpha", driver_source: "claim" }));
  writeNote(dir, "the driving agent is stepping away");

  const decision = stophook.evaluateSubagent(dir, subagentStdin({ dir, agentId: "agent-beta" }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });
  assert.ok(fs.existsSync(path.join(dir, ".headsign", "tmp", "stop-note")));
  assert.equal(readLog(dir).length, 0);
});

test("SubagentStop: HEADSIGN_OBSERVER set -> unconditional pass-through, even ahead of malformed stdin", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_session: "agent-alpha", driver_source: "claim", stop_nudges: 2 }));

  const parsed = stophook.evaluateSubagent(dir, subagentStdin({ dir, agentId: "agent-alpha" }), NOW, { HEADSIGN_OBSERVER: "1" });
  assert.deepEqual(parsed, { block: false });
  const garbage = stophook.evaluateSubagent(dir, "not json{{{", NOW, { HEADSIGN_OBSERVER: "1" });
  assert.deepEqual(garbage, { block: false });
  assert.equal(state.readState(dir)?.stop_nudges, 2, "observer pass-through must not touch state");
});

test("SubagentStop: stop_hook_active true short-circuits even for the driving agent, and does not increment stop_nudges", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_session: "agent-alpha", driver_source: "claim", stop_nudges: 0 }));
  writeClaimMarker(dir);

  const decision = stophook.evaluateSubagent(dir, subagentStdin({ dir, agentId: "agent-alpha", stopHookActive: true }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });
  assert.equal(state.readState(dir)?.stop_nudges, 0);
  assert.ok(fs.existsSync(claimMarkerPath(dir)), "an already-unblocked stop must not seal a claim either");
});

for (const status of ["complete", "escalated", "aborted"] as const) {
  test(`SubagentStop: status '${status}' -> pass-through, and no adoption even with a claim marker armed`, () => {
    const dir = tmpdir();
    state.writeState(dir, runningState({ status, driver_source: "claim", driver_session: "agent-alpha", end_reason: status === "complete" ? null : "some reason" }));
    writeClaimMarker(dir);

    const decision = stophook.evaluateSubagent(dir, subagentStdin({ dir, agentId: "agent-alpha" }), NOW, NO_ENV);
    assert.deepEqual(decision, { block: false });
    assert.ok(fs.existsSync(claimMarkerPath(dir)));
  });
}

test("SubagentStop: no run reachable from here -> pass-through", () => {
  const dir = tmpdir();
  const decision = stophook.evaluateSubagent(dir, subagentStdin({ dir, agentId: "agent-alpha" }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });
});

test("SubagentStop: garbage stdin fails open regardless of state at cwd", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_session: "agent-alpha", driver_source: "claim" }));
  const decision = stophook.evaluateSubagent(dir, "not json{{{", NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });
});

test("SubagentStop: nudge lifecycle 1 -> 5 with the final reminder only on the 5th, one stalled line, then pass-through", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_session: "agent-alpha", driver_source: "claim", stop_nudges: 0 }));
  const stdin = subagentStdin({ dir, agentId: "agent-alpha" });

  for (let expected = 1; expected <= 4; expected++) {
    const result = stophook.evaluateSubagent(dir, stdin, NOW, NO_ENV);
    assert.equal(result.block, true, `nudge #${expected} should block`);
    assert.equal(state.readState(dir)?.stop_nudges, expected);
    assert.ok(!result.message?.includes("final automatic reminder"), `nudge #${expected} must not carry the final notice`);
  }

  const fifth = stophook.evaluateSubagent(dir, stdin, NOW, NO_ENV);
  assert.equal(fifth.block, true);
  assert.ok(fifth.message?.includes("final automatic reminder"));
  let lines = readLog(dir);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\S+ stalled build a=0 i=0 nudges=5$/);

  const sixth = stophook.evaluateSubagent(dir, stdin, NOW, NO_ENV);
  assert.deepEqual(sixth, { block: false });
  const seventh = stophook.evaluateSubagent(dir, stdin, NOW, NO_ENV);
  assert.deepEqual(seventh, { block: false });
  lines = readLog(dir);
  assert.equal(lines.length, 1, "stalled must not be repeated");
  assert.equal(state.readState(dir)?.stop_nudges, 5);
});

test("SubagentStop: walk-up finds the run at the .git-bounded root, and both the adoption and nudge messages carry the cd instruction and the runDir-prefixed note path", () => {
  const root = tmpdir();
  fs.mkdirSync(path.join(root, ".git"));
  state.writeState(root, runningState({ workflow: "demo", phase: "build" }));
  writeClaimMarker(root);
  const deepSubdir = path.join(root, "a", "b", "c");
  fs.mkdirSync(deepSubdir, { recursive: true });

  const adopted = stophook.evaluateSubagent("anything", subagentStdin({ dir: deepSubdir, agentId: "agent-alpha" }), NOW, NO_ENV);
  assert.equal(adopted.block, true);
  assert.ok(adopted.message?.includes(`${root}/.headsign/tmp/stop-note`));
  // An agent seated from a subdirectory needs the same cd guidance the nudge carries:
  // `next` is cwd-only, so "run headsign next" alone would send it at a directory with no run.
  assert.ok(adopted.message?.includes("cd there"), "adoption from a subdirectory must say where to cd");
  assert.ok(adopted.message?.includes(root));
  assert.equal(state.readState(root)?.driver_session, "agent-alpha");

  const nudged = stophook.evaluateSubagent("anything", subagentStdin({ dir: deepSubdir, agentId: "agent-alpha" }), NOW, NO_ENV);
  assert.equal(nudged.block, true);
  assert.ok(nudged.message?.includes(root));
  assert.ok(nudged.message?.includes("cd there"));
  assert.ok(nudged.message?.includes(`${root}/.headsign/tmp/stop-note`));
  assert.equal(state.readState(root)?.stop_nudges, 1);
});

test("SubagentStop: walk-up boundary — a .git FILE stops the walk before reaching a running state further up", () => {
  const root = tmpdir();
  fs.mkdirSync(path.join(root, ".git"));
  state.writeState(root, runningState({ driver_session: "agent-alpha", driver_source: "claim", stop_nudges: 0 }));
  const boundaryDir = path.join(root, "a");
  fs.mkdirSync(boundaryDir, { recursive: true });
  fs.writeFileSync(path.join(boundaryDir, ".git"), "gitdir: /elsewhere");
  const deepSubdir = path.join(boundaryDir, "b", "c");
  fs.mkdirSync(deepSubdir, { recursive: true });

  const decision = stophook.evaluateSubagent("anything", subagentStdin({ dir: deepSubdir, agentId: "agent-alpha" }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });
  assert.equal(state.readState(root)?.stop_nudges, 0);
});
