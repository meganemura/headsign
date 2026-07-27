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
    driver_agent: null,
    ...overrides,
  };
}

// No HEADSIGN_OBSERVER of its own, so every test exercises the ordinary (non-opted-out)
// path unless it opts in by passing its own env.
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

// --- Stop's ownership rule: observer opt-out, and a claimed run is never this stop's
// (ADR-0008's opt-out, ADR-0013's claim-only identity) ---

test("HEADSIGN_OBSERVER set -> unconditional pass-through even while running on an unclaimed run", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ stop_nudges: 2 }));
  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW, { HEADSIGN_OBSERVER: "1" });
  assert.deepEqual(decision, { block: false });
  assert.equal(state.readState(dir)?.stop_nudges, 2, "observer pass-through must not touch state");
});

test("HEADSIGN_OBSERVER set -> pass-through even ahead of malformed stdin (checked before parsing)", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState());
  const decision = stophook.evaluate(dir, "not json{{{", NOW, { HEADSIGN_OBSERVER: "1" });
  assert.deepEqual(decision, { block: false });
});

test("a claimed run (driver_agent set) -> pass-through: no state write, no output", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ stop_nudges: 2, driver_agent: "agent-alpha" }));
  const before = fs.readFileSync(state.statePath(dir));

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });

  const after = fs.readFileSync(state.statePath(dir));
  assert.deepEqual(after, before, "a stop on a claimed run must not write state.json at all");
});

test("a claimed run passes through ahead of the stop-note gate: a session's stop must not consume the driving agent's note", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_agent: "agent-alpha" }));
  writeNote(dir, "the driving agent is stepping away");

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });

  const notePath = path.join(dir, ".headsign", "tmp", "stop-note");
  assert.ok(fs.existsSync(notePath), "the note must remain for the driving agent's own SubagentStop");
  assert.equal(readLog(dir).length, 0, "no paused (or any other) log line for a pass-through");
});

test("an unclaimed run (driver_agent null) -> falls through to the normal nudge flow (still blocks)", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_agent: null }));
  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW, NO_ENV);
  assert.equal(decision.block, true);
  assert.equal(state.readState(dir)?.stop_nudges, 1);
});

// The stdin `session_id` is the identifier this hook used to compare against a recorded
// driver. ADR-0013 removed that comparison outright, so the field must now be inert: the
// same run, the same state, three different session ids, one identical answer.
test("the stdin session_id is never read: it changes nothing on either a claimed or an unclaimed run", () => {
  for (const sessionId of ["session-alpha", "agent-alpha", undefined]) {
    const claimed = tmpdir();
    state.writeState(claimed, runningState({ driver_agent: "agent-alpha", stop_nudges: 2 }));
    const claimedBefore = fs.readFileSync(state.statePath(claimed));
    const onClaimed = stophook.evaluate(claimed, JSON.stringify({ cwd: claimed, session_id: sessionId }), NOW, NO_ENV);
    assert.deepEqual(onClaimed, { block: false }, `session_id ${sessionId} must pass through on a claimed run`);
    assert.deepEqual(fs.readFileSync(state.statePath(claimed)), claimedBefore);

    const unclaimed = tmpdir();
    state.writeState(unclaimed, runningState({ driver_agent: null }));
    const onUnclaimed = stophook.evaluate(unclaimed, JSON.stringify({ cwd: unclaimed, session_id: sessionId }), NOW, NO_ENV);
    assert.equal(onUnclaimed.block, true, `session_id ${sessionId} must still nudge on an unclaimed run`);
    assert.equal(state.readState(unclaimed)?.stop_nudges, 1);
  }
});

test("a legacy state.json carrying driver_session/driver_source and no driver_agent reads as unclaimed and nudges, without throwing", () => {
  const dir = tmpdir();
  fs.mkdirSync(path.join(dir, ".headsign"), { recursive: true });
  const legacy: Record<string, unknown> = { ...runningState() };
  delete legacy.driver_agent;
  legacy.driver_session = "session-alpha";
  legacy.driver_source = "env";
  fs.writeFileSync(state.statePath(dir), JSON.stringify(legacy, null, 2) + "\n");

  // `undefined !== null` is true, so a bare null check here would have read the missing
  // field as "someone is driving" and silently stopped nudging this run for good.
  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW, NO_ENV);
  assert.equal(decision.block, true);
  assert.equal(state.readState(dir)?.stop_nudges, 1);
});

test("driver_agent present as a non-string legacy value -> treated as absent, so the run still nudges", () => {
  const dir = tmpdir();
  fs.mkdirSync(path.join(dir, ".headsign"), { recursive: true });
  const corrupt = { ...runningState(), driver_agent: 12345 };
  fs.writeFileSync(state.statePath(dir), JSON.stringify(corrupt, null, 2) + "\n");
  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW, NO_ENV);
  assert.equal(decision.block, true);
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

test("Stop: a claim marker is neither adopted nor consumed — the marker survives untouched and no driver is stamped", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_agent: null, stop_nudges: 0 }));
  writeClaimMarker(dir);

  // Under ADR-0009 this stop would have sealed the enclosing session as the driver, stealing
  // the seat a delegated agent had just asked for. ADR-0010: Stop must not look at the marker.
  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW, NO_ENV);
  assert.equal(decision.block, true, "falls through to the ordinary nudge flow for an unclaimed run");

  assert.ok(fs.existsSync(claimMarkerPath(dir)), "the claim marker must survive a Stop untouched — only SubagentStop may consume it");
  const after = state.readState(dir);
  assert.equal(after?.driver_agent, null, "no adoption: the run is still unclaimed");
  assert.equal(after?.stop_nudges, 1, "the ordinary loop-guard nudge still applies");
  assert.equal(readLog(dir).filter((l) => l.includes(" claimed ")).length, 0, "Stop must never log a claimed line");
});

test("Stop: a claim marker on an already-claimed run is ignored too — pass-through, marker intact, driver unchanged", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_agent: "agent-alpha" }));
  writeClaimMarker(dir);

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });
  assert.ok(fs.existsSync(claimMarkerPath(dir)));
  assert.equal(state.readState(dir)?.driver_agent, "agent-alpha");
});

// --- SubagentStop: sealing and backstopping a delegated agent (ADR-0010) ---

function subagentStdin(o: { dir?: string; agentId?: string; stopHookActive?: boolean }): string {
  const payload: Record<string, unknown> = {};
  if (o.dir !== undefined) payload.cwd = o.dir;
  if (o.agentId !== undefined) payload.agent_id = o.agentId;
  if (o.stopHookActive !== undefined) payload.stop_hook_active = o.stopHookActive;
  return JSON.stringify(payload);
}

test("SubagentStop adoption: a claim marker plus an agent_id seals that agent — driver_agent/stop_nudges stamped, marker consumed, one claimed log line, block=true with the confirmation", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ workflow: "demo", phase: "build", driver_agent: null, stop_nudges: 3 }));
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
  assert.equal(after?.driver_agent, "agent-alpha");
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
  assert.equal(state.readState(dir)?.driver_agent, "agent-alpha");
});

test("SubagentStop adoption: a claim marker with no agent_id leaves the marker in place and changes nothing", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_agent: null, stop_nudges: 1 }));
  writeClaimMarker(dir);
  const before = fs.readFileSync(state.statePath(dir));

  const decision = stophook.evaluateSubagent(dir, subagentStdin({ dir }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false }, "an unnameable subagent stop on an unclaimed run just passes through");
  assert.ok(fs.existsSync(claimMarkerPath(dir)), "the marker waits for a later, identifiable subagent stop");
  assert.deepEqual(fs.readFileSync(state.statePath(dir)), before, "no adoption, no nudge, no state write");
  assert.equal(readLog(dir).length, 0);
});

test("SubagentStop adoption: a blank (whitespace-only) agent_id counts as no agent_id", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_agent: null }));
  writeClaimMarker(dir);

  const decision = stophook.evaluateSubagent(dir, subagentStdin({ dir, agentId: "   " }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });
  assert.ok(fs.existsSync(claimMarkerPath(dir)));
  assert.equal(state.readState(dir)?.driver_agent, null);
});

test("SubagentStop adoption: the environment can never seal a claim — only the payload can name an agent", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_agent: null }));
  writeClaimMarker(dir);

  const decision = stophook.evaluateSubagent(dir, subagentStdin({ dir }), NOW, { SOME_SESSION_ID: "session-alpha" });
  assert.deepEqual(decision, { block: false });
  assert.ok(fs.existsSync(claimMarkerPath(dir)), "an env-derived identifier must not seal a claim");
  assert.equal(state.readState(dir)?.driver_agent, null);
});

test("SubagentStop adoption gate runs BEFORE the owner comparison: an agent that mismatches the old driver is adopted, not passed through as a bystander", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_agent: "agent-beta" }));
  writeClaimMarker(dir);

  const decision = stophook.evaluateSubagent(dir, subagentStdin({ dir, agentId: "agent-alpha" }), NOW, NO_ENV);
  assert.equal(decision.block, true, "adopted, not passed through as a mismatched bystander");
  assert.equal(state.readState(dir)?.driver_agent, "agent-alpha");
});

test("SubagentStop adoption: re-claim re-arms, and the next agent to name itself replaces a previous mistaken adoption", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_agent: null }));
  writeClaimMarker(dir);

  const first = stophook.evaluateSubagent(dir, subagentStdin({ dir, agentId: "agent-beta" }), NOW, NO_ENV);
  assert.equal(first.block, true);
  assert.equal(state.readState(dir)?.driver_agent, "agent-beta");

  writeClaimMarker(dir);
  const second = stophook.evaluateSubagent(dir, subagentStdin({ dir, agentId: "agent-alpha" }), NOW, NO_ENV);
  assert.equal(second.block, true);
  assert.equal(state.readState(dir)?.driver_agent, "agent-alpha", "the later adoption replaces the earlier one");
  assert.equal(readLog(dir).filter((l) => l.includes(" claimed ")).length, 2, "each successful adoption logs its own claimed line");
});

test("SubagentStop owner check: the recorded driver's own turn end blocks and increments stop_nudges", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ workflow: "demo", phase: "build", driver_agent: "agent-alpha", stop_nudges: 0 }));

  const decision = stophook.evaluateSubagent(dir, subagentStdin({ dir, agentId: "agent-alpha" }), NOW, NO_ENV);
  assert.equal(decision.block, true);
  assert.match(decision.message ?? "", /headsign workflow 'demo' is still running \(phase: build\)\./);
  assert.match(decision.message ?? "", /headsign next`/);
  assert.match(decision.message ?? "", /headsign abort/);
  assert.equal(state.readState(dir)?.stop_nudges, 1);
});

test("SubagentStop owner check: a different agent's turn end passes through — no state write, no output", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_agent: "agent-alpha", stop_nudges: 2 }));
  const before = fs.readFileSync(state.statePath(dir));

  const decision = stophook.evaluateSubagent(dir, subagentStdin({ dir, agentId: "agent-beta" }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });
  assert.deepEqual(fs.readFileSync(state.statePath(dir)), before, "an unrelated subagent's stop must not write state.json at all");
});

test("SubagentStop owner check: an unclaimed run (driver_agent null) passes through — no driver means no positive match is possible", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_agent: null, stop_nudges: 0 }));

  const decision = stophook.evaluateSubagent(dir, subagentStdin({ dir, agentId: "agent-alpha" }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });
  assert.equal(state.readState(dir)?.stop_nudges, 0);
});

test("SubagentStop owner check: a legacy state.json carrying driver_session and no driver_agent reads as unclaimed and passes through, without throwing", () => {
  const dir = tmpdir();
  fs.mkdirSync(path.join(dir, ".headsign"), { recursive: true });
  const legacy: Record<string, unknown> = { ...runningState({ stop_nudges: 0 }) };
  delete legacy.driver_agent;
  legacy.driver_session = "agent-alpha";
  legacy.driver_source = "claim";
  fs.writeFileSync(state.statePath(dir), JSON.stringify(legacy, null, 2) + "\n");

  // The old field name must not be honored by proxy: an undefined driver_agent is "nobody
  // has claimed this run", and only a positive match may block here.
  const decision = stophook.evaluateSubagent(dir, subagentStdin({ dir, agentId: "agent-alpha" }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });
  assert.equal(state.readState(dir)?.stop_nudges, 0);
});

test("SubagentStop owner check: a claimed run whose subagent stop carries no agent_id passes through untouched — only a positive match may block", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_agent: "agent-alpha", stop_nudges: 0 }));

  const decision = stophook.evaluateSubagent(dir, subagentStdin({ dir }), NOW, NO_ENV);
  assert.equal(decision.block, false);
  assert.equal(state.readState(dir)?.stop_nudges, 0, "a stop that cannot name itself must never be nudged into someone else's run");
});

test("SubagentStop: a non-empty stop-note pauses instead of blocking — note deleted, stop_nudges reset, one paused log line", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_agent: "agent-alpha", stop_nudges: 3 }));
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
  state.writeState(dir, runningState({ driver_agent: "agent-alpha" }));
  writeNote(dir, "the driving agent is stepping away");

  const decision = stophook.evaluateSubagent(dir, subagentStdin({ dir, agentId: "agent-beta" }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });
  assert.ok(fs.existsSync(path.join(dir, ".headsign", "tmp", "stop-note")));
  assert.equal(readLog(dir).length, 0);
});

test("SubagentStop: HEADSIGN_OBSERVER set -> unconditional pass-through, even ahead of malformed stdin", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_agent: "agent-alpha", stop_nudges: 2 }));

  const parsed = stophook.evaluateSubagent(dir, subagentStdin({ dir, agentId: "agent-alpha" }), NOW, { HEADSIGN_OBSERVER: "1" });
  assert.deepEqual(parsed, { block: false });
  const garbage = stophook.evaluateSubagent(dir, "not json{{{", NOW, { HEADSIGN_OBSERVER: "1" });
  assert.deepEqual(garbage, { block: false });
  assert.equal(state.readState(dir)?.stop_nudges, 2, "observer pass-through must not touch state");
});

test("SubagentStop: stop_hook_active true short-circuits even for the driving agent, and does not increment stop_nudges", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_agent: "agent-alpha", stop_nudges: 0 }));
  writeClaimMarker(dir);

  const decision = stophook.evaluateSubagent(dir, subagentStdin({ dir, agentId: "agent-alpha", stopHookActive: true }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });
  assert.equal(state.readState(dir)?.stop_nudges, 0);
  assert.ok(fs.existsSync(claimMarkerPath(dir)), "an already-unblocked stop must not seal a claim either");
});

for (const status of ["complete", "escalated", "aborted"] as const) {
  test(`SubagentStop: status '${status}' -> pass-through, and no adoption even with a claim marker armed`, () => {
    const dir = tmpdir();
    state.writeState(dir, runningState({ status, driver_agent: "agent-alpha", end_reason: status === "complete" ? null : "some reason" }));
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
  state.writeState(dir, runningState({ driver_agent: "agent-alpha" }));
  const decision = stophook.evaluateSubagent(dir, "not json{{{", NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });
});

test("SubagentStop: nudge lifecycle 1 -> 5 with the final reminder only on the 5th, one stalled line, then pass-through", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_agent: "agent-alpha", stop_nudges: 0 }));
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
  assert.equal(state.readState(root)?.driver_agent, "agent-alpha");

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
  state.writeState(root, runningState({ driver_agent: "agent-alpha", stop_nudges: 0 }));
  const boundaryDir = path.join(root, "a");
  fs.mkdirSync(boundaryDir, { recursive: true });
  fs.writeFileSync(path.join(boundaryDir, ".git"), "gitdir: /elsewhere");
  const deepSubdir = path.join(boundaryDir, "b", "c");
  fs.mkdirSync(deepSubdir, { recursive: true });

  const decision = stophook.evaluateSubagent("anything", subagentStdin({ dir: deepSubdir, agentId: "agent-alpha" }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });
  assert.equal(state.readState(root)?.stop_nudges, 0);
});

// --- isObserver (inlined into stophook.ts when its module lost its other half) ---

test("isObserver: HEADSIGN_OBSERVER=1 -> true", () => {
  assert.equal(stophook.isObserver({ HEADSIGN_OBSERVER: "1" }), true);
});

test("isObserver: any non-empty value is treated the same (the value itself is never inspected)", () => {
  assert.equal(stophook.isObserver({ HEADSIGN_OBSERVER: "yes" }), true);
  assert.equal(stophook.isObserver({ HEADSIGN_OBSERVER: "0" }), true);
  assert.equal(stophook.isObserver({ HEADSIGN_OBSERVER: "false" }), true);
});

test("isObserver: unset -> false", () => {
  assert.equal(stophook.isObserver({}), false);
});

test("isObserver: empty string -> false", () => {
  assert.equal(stophook.isObserver({ HEADSIGN_OBSERVER: "" }), false);
});
