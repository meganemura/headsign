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
    phase_entered_at: null,
    last_stop: null,
    last_drive: null,
    graph_fingerprint: {},
    graph_change_reported: null,
    accepted_graph_changes: 0,
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
  // A second line existed and was dropped, so what's recorded doesn't match the note in
  // full: the trailing mark must be there even though the first line itself fit untrimmed.
  assert.match(lines[0], /^\S+ paused build a=0 i=0 note="stepping away for lunch, resume after…"$/);
});

test("note: first line is trimmed and truncated to 120 chars, marked as cut", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ workflow: "demo", phase: "build" }));
  const longLine = "x".repeat(200);
  writeNote(dir, `  ${longLine}  \nsecond line`);

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });

  const lines = readLog(dir);
  assert.equal(lines.length, 1);
  const expectedFirstLine = longLine.slice(0, 120);
  assert.ok(lines[0].includes(`note="${expectedFirstLine}…"`));
  assert.ok(!lines[0].includes(longLine), "the truncated note must not include the full 200-char line");
});

// The over-length half of the rule, with nothing else cut: every other marked case here has a
// dropped second line too, so without this one an implementation that only looked for a
// newline would pass the whole file.
test("note: a single line over 120 chars is marked as cut with no second line involved", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ workflow: "demo", phase: "build" }));
  writeNote(dir, "x".repeat(200));

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });

  const lines = readLog(dir);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\S+ paused build a=0 i=0 note="x{120}…"$/);
});

test("note: a single line at or under 120 chars is recorded with no cut mark", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ workflow: "demo", phase: "build" }));
  writeNote(dir, "x".repeat(120));

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });

  const lines = readLog(dir);
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes(`note="${"x".repeat(120)}"`));
  assert.ok(!lines[0].includes("…"), "a note that fits in full must not be marked as cut");
});

test("note: a second line dropped, with no 120-char truncation, is still marked as cut", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ workflow: "demo", phase: "build" }));
  writeNote(dir, "short first line\nsecond line ignored");

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });

  const lines = readLog(dir);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\S+ paused build a=0 i=0 note="short first line…"$/);
});

test("note: whitespace-only note is treated as absent — still blocks, note left alone is irrelevant since it's deleted only on pause", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ workflow: "demo", phase: "build" }));
  writeNote(dir, "   \n\t\n   ");

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW, NO_ENV);
  assert.equal(decision.block, true);
  assert.equal(state.readState(dir)?.stop_nudges, 1);
  // The hold this produced has its own line; what must not be here is a `paused` one, since a
  // note of nothing but whitespace is not a pause.
  const lines = readLog(dir);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\S+ held build a=0 i=0 nudges=1$/);
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

test("Stop: the nudge names the way out for a reader who is not driving this run, last, after the pause/abort hint", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ workflow: "demo", phase: "build" }));

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW, NO_ENV);
  assert.equal(decision.block, true);
  assert.ok(decision.message);
  assert.match(
    decision.message,
    /headsign abort <reason>`\. If you are not driving this run, none of the above is yours to do — set `HEADSIGN_OBSERVER` in the environment of whatever started this session instead\.$/,
  );
});

// One line per event, all the way up the cap: four `held` lines and then the `stalled` that
// takes the fifth hold's place. The cap-tripping stop writes one of them and not both, which is
// why `stalled` carries `nudges=5` — it is the fifth hold as well as the moment the guard
// tripped.
test("held/stalled: each of the first four nudges appends its own line, the 5th writes stalled instead, and later stops write neither", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ workflow: "demo", phase: "build" }));
  const stdin = JSON.stringify({ cwd: dir });

  for (let expected = 1; expected <= 4; expected++) {
    stophook.evaluate(dir, stdin, NOW, NO_ENV);
    const lines = readLog(dir);
    assert.equal(lines.length, expected, `nudge #${expected} appends exactly one line`);
    assert.match(lines[expected - 1], new RegExp(`^\\S+ held build a=0 i=0 nudges=${expected}$`));
  }

  stophook.evaluate(dir, stdin, NOW, NO_ENV);
  let lines = readLog(dir);
  assert.equal(lines.length, 5, "the cap-tripping nudge writes one line, not two");
  assert.match(lines[4], /^\S+ stalled build a=0 i=0 nudges=5$/);
  assert.deepEqual(lines.filter((l) => / held /.test(l)).length, 4, "the 5th nudge writes stalled and no held");

  // 6th and 7th stops must fail open and must add nothing: `stalled` is written once, and a
  // stop nothing held is not a hold.
  const sixth = stophook.evaluate(dir, stdin, NOW, NO_ENV);
  assert.deepEqual(sixth, { block: false });
  const seventh = stophook.evaluate(dir, stdin, NOW, NO_ENV);
  assert.deepEqual(seventh, { block: false });
  lines = readLog(dir);
  assert.equal(lines.length, 5, "neither stalled nor held is repeated after the cap is spent");
});

// The exact bytes of one held line, because every field of it is load-bearing: the event word
// headsign chose for what it does to a turn, the phase/attempt/iteration head every event
// carries, and the `nudges=` key — the same key `stalled` uses for the same quantity, so
// counting holds is one grep rather than two vocabularies.
test("held: the whole line, to the byte", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ workflow: "demo", phase: "review", attempts: { review: 2 }, total_iterations: 7, stop_nudges: 2 }));

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW, NO_ENV);
  assert.equal(decision.block, true);
  assert.deepEqual(readLog(dir), [`${NOW} held review a=2 i=7 nudges=3`]);
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

// The stdin `session_id` used to be compared against a recorded DRIVER, until ADR-0013 removed
// that comparison outright. ADR-0027 brings a session_id comparison back, but against a
// different field entirely (`last_drive`, never `driver_agent`) and only when that field
// actually holds a stamp. Every run `runningState` below builds has none (`last_drive: null`
// is its default), so this specific case is exactly as inert to session_id as it has always
// been: the same run, the same state, three different session ids, one identical answer. The
// stamped case, where session_id decides the outcome, is exercised in the ADR-0027 section
// further down this file.
test("the stdin session_id changes nothing on a run with no last_drive stamp, claimed or not", () => {
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
  assert.doesNotMatch(
    decision.message,
    /HEADSIGN_OBSERVER/,
    "the adoption message confirms this agent IS the driver, so the not-driving hint must never appear here",
  );

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
  assert.match(
    decision.message ?? "",
    /If you are not driving this run, none of the above is yours to do — set `HEADSIGN_OBSERVER` in the environment of whatever started this session instead\.$/,
  );
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
  // Same one-rule cut mark as the Stop path: a dropped second line means the recorded note
  // doesn't match the note in full.
  assert.match(lines[0], /^\S+ paused build a=0 i=0 note="handing back to the human…"$/);
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

test("SubagentStop: nudge lifecycle 1 -> 5 with the final reminder only on the 5th, four held lines then one stalled, then pass-through", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_agent: "agent-alpha", stop_nudges: 0 }));
  const stdin = subagentStdin({ dir, agentId: "agent-alpha" });

  for (let expected = 1; expected <= 4; expected++) {
    const result = stophook.evaluateSubagent(dir, stdin, NOW, NO_ENV);
    assert.equal(result.block, true, `nudge #${expected} should block`);
    assert.equal(state.readState(dir)?.stop_nudges, expected);
    assert.ok(!result.message?.includes("final automatic reminder"), `nudge #${expected} must not carry the final notice`);
    assert.match(readLog(dir)[expected - 1], new RegExp(`^\\S+ held build a=0 i=0 nudges=${expected}$`));
  }

  const fifth = stophook.evaluateSubagent(dir, stdin, NOW, NO_ENV);
  assert.equal(fifth.block, true);
  assert.ok(fifth.message?.includes("final automatic reminder"));
  let lines = readLog(dir);
  assert.equal(lines.length, 5);
  assert.match(lines[4], /^\S+ stalled build a=0 i=0 nudges=5$/);

  const sixth = stophook.evaluateSubagent(dir, stdin, NOW, NO_ENV);
  assert.deepEqual(sixth, { block: false });
  const seventh = stophook.evaluateSubagent(dir, stdin, NOW, NO_ENV);
  assert.deepEqual(seventh, { block: false });
  lines = readLog(dir);
  assert.equal(lines.length, 5, "neither stalled nor held is repeated after the cap is spent");
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

// --- the already-continuing flag: Claude Code overruled the hook, and it says so ---
//
// `stop_hook_active` on the hook's input means the turn end belongs to a turn Claude Code has
// already resumed, so headsign is overruled and lets it pass. What these pin is that the pass now
// leaves a trace — and that acquiring one did not cost either of the two guarantees the pass
// carries: it is never blocked, and it never spends a one-shot resource (the pause note, the
// claim marker).

// Holds the run's lock the way a concurrent `headsign next` lap does: a lock file carrying a
// LIVE pid (this test process's own), which acquireLock refuses to steal.
function holdLock(dir: string): void {
  fs.mkdirSync(path.join(dir, ".headsign"), { recursive: true });
  fs.writeFileSync(state.lockPath(dir), String(process.pid));
}

test("Stop: a flagged stop on an unclaimed run records an unheld stop — the field and one whole log line, and it still ends the turn", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ workflow: "demo", phase: "build", driver_agent: null, stop_nudges: 2 }));

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir, stop_hook_active: true }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });

  const after = state.readState(dir);
  assert.deepEqual(after?.last_stop, { disposition: "unheld", at: NOW, cause: "stop_hook_active" });
  assert.equal(after?.stop_nudges, 2, "the already-continuing flag never touches headsign's own nudge counter");

  const lines = readLog(dir);
  assert.equal(lines.length, 1);
  assert.equal(lines[0], `${NOW} unheld build a=0 i=0 by=stop_hook_active`);
});

// Guarantee 2 at the Stop boundary: the moved-down check passes over only read-only steps, and
// the pause note is opened one step further down, inside the nudge flow.
test("Stop: a flagged stop does not consume the pause note it passes over", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_agent: null }));
  writeNote(dir, "a one-shot pause that must survive an overruled turn end");

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir, stop_hook_active: true }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });
  assert.ok(fs.existsSync(path.join(dir, ".headsign", "tmp", "stop-note")), "the note is a one-shot resource and this stop must not spend it");
  assert.equal(state.readState(dir)?.last_stop?.disposition, "unheld", "the pass is recorded as unheld, not as a pause");
  assert.deepEqual(readLog(dir).filter((l) => l.includes(" paused ")), []);
});

// The reason the check sits BELOW the recorded-driver test rather than at the top of `evaluate`:
// a claimed run's Stop can never be its driver's (only SubagentStop carries an agent id), so
// headsign cannot attribute the stop to anybody and must write nothing at all.
test("Stop: a flagged stop on a claimed run writes nothing at all — no field, no line, not one byte of state.json", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_agent: "agent-alpha", stop_nudges: 1 }));
  const before = fs.readFileSync(state.statePath(dir));

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir, stop_hook_active: true }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });
  assert.deepEqual(fs.readFileSync(state.statePath(dir)), before, "an unattributable stop must not write state.json");
  assert.deepEqual(readLog(dir), []);
});

test("Stop: a flagged stop on a non-running run, and one where no run is reachable at all, write nothing", () => {
  for (const status of ["complete", "escalated", "aborted"] as const) {
    const dir = tmpdir();
    state.writeState(dir, runningState({ status, end_reason: status === "complete" ? null : "some reason" }));
    const before = fs.readFileSync(state.statePath(dir));
    assert.deepEqual(stophook.evaluate(dir, JSON.stringify({ cwd: dir, stop_hook_active: true }), NOW, NO_ENV), { block: false });
    assert.deepEqual(fs.readFileSync(state.statePath(dir)), before);
    assert.deepEqual(readLog(dir), []);
  }

  const noRun = tmpdir();
  assert.deepEqual(stophook.evaluate(noRun, JSON.stringify({ cwd: noRun, stop_hook_active: true }), NOW, NO_ENV), { block: false });
  assert.equal(fs.existsSync(state.statePath(noRun)), false, "a flagged stop must not conjure a record where there is no run");
});

// The observer path must stay a COMPLETE no-op: it returns before the input is parsed and before
// the walk-up, and writing there would both undo the short-circuit that makes the opt-out an
// opt-out and record a non-participant in the record of a run it opted out of.
test("Stop: HEADSIGN_OBSERVER set -> a flagged stop records nothing, not even the field", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_agent: null }));
  const before = fs.readFileSync(state.statePath(dir));

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir, stop_hook_active: true }), NOW, { HEADSIGN_OBSERVER: "1" });
  assert.deepEqual(decision, { block: false });
  assert.deepEqual(fs.readFileSync(state.statePath(dir)), before);
  assert.deepEqual(readLog(dir), []);
});

// The write is best-effort, exactly like every other write in this module: somebody holding the
// lock is somebody judging the run, and a hook must never be the reason a turn cannot end. So a
// MISSING unheld line never proves the hook did not run.
test("Stop: with the run's lock held, a flagged stop writes neither the field nor the line, and the turn still ends", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_agent: null }));
  holdLock(dir);
  const before = fs.readFileSync(state.statePath(dir));

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir, stop_hook_active: true }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false }, "the turn must end regardless");
  assert.deepEqual(fs.readFileSync(state.statePath(dir)), before, "no field: the record belongs to whoever holds the lock");
  assert.deepEqual(readLog(dir), []);
  assert.equal(fs.readFileSync(state.lockPath(dir), "utf8"), String(process.pid), "the holder's lock is left alone");
});

test("SubagentStop: with the run's lock held, a flagged stop by the driver writes neither the field nor the line, and the turn still ends", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_agent: "agent-alpha" }));
  holdLock(dir);
  const before = fs.readFileSync(state.statePath(dir));

  const decision = stophook.evaluateSubagent(dir, subagentStdin({ dir, agentId: "agent-alpha", stopHookActive: true }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });
  assert.deepEqual(fs.readFileSync(state.statePath(dir)), before);
  assert.deepEqual(readLog(dir), []);
});

// The regression this branch exists to prevent, and the reason it is a branch rather than a
// moved check: consuming the claim marker seats a driver AND blocks, which violates both
// guarantees at once. The branch returns before the adoption gate is anywhere in its path, so no
// later reordering can put a flagged turn end through that gate.
test("SubagentStop: a flagged stop with an armed claim marker passes through, leaves the marker armed, and seats no driver", () => {
  const unclaimed = tmpdir();
  state.writeState(unclaimed, runningState({ driver_agent: null, stop_nudges: 0 }));
  writeClaimMarker(unclaimed);
  const before = fs.readFileSync(state.statePath(unclaimed));

  const onUnclaimed = stophook.evaluateSubagent(unclaimed, subagentStdin({ dir: unclaimed, agentId: "agent-alpha", stopHookActive: true }), NOW, NO_ENV);
  assert.deepEqual(onUnclaimed, { block: false });
  assert.ok(fs.existsSync(claimMarkerPath(unclaimed)), "the marker is a one-shot request and must wait for an unflagged turn end");
  assert.deepEqual(fs.readFileSync(state.statePath(unclaimed)), before, "no adoption, and nothing to attribute either: the run has no driver to match");
  assert.deepEqual(readLog(unclaimed), [], "no claimed line, and no unheld line for an unattributable stop");

  // The same marker on a run this agent already drives: the unheld stop is recorded (positive
  // match), and the marker still survives untouched.
  const claimed = tmpdir();
  state.writeState(claimed, runningState({ driver_agent: "agent-alpha", stop_nudges: 0 }));
  writeClaimMarker(claimed);

  const onClaimed = stophook.evaluateSubagent(claimed, subagentStdin({ dir: claimed, agentId: "agent-alpha", stopHookActive: true }), NOW, NO_ENV);
  assert.deepEqual(onClaimed, { block: false });
  assert.ok(fs.existsSync(claimMarkerPath(claimed)), "the adoption gate is not in the flagged branch's path at all");
  const after = state.readState(claimed);
  assert.equal(after?.driver_agent, "agent-alpha", "no driver was seated by this stop");
  assert.equal(after?.stop_nudges, 0);
  assert.deepEqual(after?.last_stop, { disposition: "unheld", at: NOW, cause: "stop_hook_active" });
  assert.deepEqual(readLog(claimed), [`${NOW} unheld build a=0 i=0 by=stop_hook_active`]);
});

// Only a positive match is recorded, for the same reason only a positive match may block: most
// subagent stops belong to reviewers, searchers and workers with no headsign role, and a line
// about one of those would report a run as unheld for a party that never held it.
test("SubagentStop: a flagged stop that cannot be matched to the recorded driver records nothing", () => {
  for (const [label, driver, agentId] of [
    ["a bystander agent", "agent-alpha", "agent-beta"],
    ["an unnameable agent", "agent-alpha", undefined],
    ["an unclaimed run", null, "agent-alpha"],
  ] as const) {
    const dir = tmpdir();
    state.writeState(dir, runningState({ driver_agent: driver }));
    const before = fs.readFileSync(state.statePath(dir));

    const decision = stophook.evaluateSubagent(dir, subagentStdin({ dir, ...(agentId !== undefined && { agentId }), stopHookActive: true }), NOW, NO_ENV);
    assert.deepEqual(decision, { block: false }, label);
    assert.deepEqual(fs.readFileSync(state.statePath(dir)), before, `${label}: nothing headsign can attribute, so nothing is written`);
    assert.deepEqual(readLog(dir), [], label);
  }
});

test("SubagentStop: a flagged stop reaches the record through the same walk-up an unflagged one does", () => {
  const root = tmpdir();
  fs.mkdirSync(path.join(root, ".git"));
  state.writeState(root, runningState({ workflow: "demo", phase: "build", driver_agent: "agent-alpha" }));
  const deepSubdir = path.join(root, "a", "b", "c");
  fs.mkdirSync(deepSubdir, { recursive: true });

  const decision = stophook.evaluateSubagent("anything", subagentStdin({ dir: deepSubdir, agentId: "agent-alpha", stopHookActive: true }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });
  assert.deepEqual(state.readState(root)?.last_stop, { disposition: "unheld", at: NOW, cause: "stop_hook_active" });
  assert.deepEqual(readLog(root), [`${NOW} unheld build a=0 i=0 by=stop_hook_active`]);
});

// --- the second starting point: CLAUDE_PROJECT_DIR (ADR-0026) ---
//
// A quiet stop used to be indistinguishable from a hook that never ran at all: a session whose
// working directory moved outside its run's tree found nothing on the walk-up and returned
// having written nothing. The fallback below is consulted ONLY on that branch — never before
// it — and even then it never blocks: it runs the same free checks the ordinary path does (the
// record is running, the stop could belong to it), then writes one `unheld` line naming
// `CLAUDE_PROJECT_DIR` as the cause and returns.

test("fallback: the cwd walk finding a run means CLAUDE_PROJECT_DIR is never consulted, even when it names a different, claimed run", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ workflow: "demo", phase: "build", driver_agent: null, stop_nudges: 0 }));

  const elsewhere = tmpdir();
  state.writeState(elsewhere, runningState({ workflow: "other", phase: "review", driver_agent: "agent-alpha" }));
  const elsewhereBefore = fs.readFileSync(state.statePath(elsewhere));

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW, { CLAUDE_PROJECT_DIR: elsewhere });
  assert.equal(decision.block, true, "the run the cwd walk found is nudged exactly as it would be without CLAUDE_PROJECT_DIR set");
  assert.equal(state.readState(dir)?.stop_nudges, 1);

  assert.deepEqual(fs.readFileSync(state.statePath(elsewhere)), elsewhereBefore, "the CLAUDE_PROJECT_DIR run must be untouched — the fallback was never reached");
  assert.deepEqual(readLog(elsewhere), []);
});

test("fallback (Stop): the cwd walk finds nothing but CLAUDE_PROJECT_DIR names an unclaimed running run — writes unheld with by=CLAUDE_PROJECT_DIR, never blocks", () => {
  const startDir = tmpdir(); // no .git, no state of its own — the walk finds nothing
  const projectDir = tmpdir();
  state.writeState(projectDir, runningState({ workflow: "demo", phase: "build", driver_agent: null, stop_nudges: 3 }));

  const decision = stophook.evaluate(startDir, JSON.stringify({ cwd: startDir }), NOW, { CLAUDE_PROJECT_DIR: projectDir });
  assert.deepEqual(decision, { block: false }, "the fallback never blocks");

  const after = state.readState(projectDir);
  assert.deepEqual(after?.last_stop, { disposition: "unheld", at: NOW, cause: "CLAUDE_PROJECT_DIR" });
  assert.equal(after?.stop_nudges, 3, "the fallback never touches the nudge counter, same as the flagged branch");
  assert.deepEqual(readLog(projectDir), [`${NOW} unheld build a=0 i=0 by=CLAUDE_PROJECT_DIR`]);
});

test("fallback (Stop): CLAUDE_PROJECT_DIR names a place with no run, is empty, or is unset — nothing is written, same as today", () => {
  const startDir = tmpdir();

  const unset = stophook.evaluate(startDir, JSON.stringify({ cwd: startDir }), NOW, NO_ENV);
  assert.deepEqual(unset, { block: false });
  assert.equal(fs.existsSync(state.statePath(startDir)), false);

  const noRunHere = tmpdir();
  const pointingNowhere = stophook.evaluate(startDir, JSON.stringify({ cwd: startDir }), NOW, { CLAUDE_PROJECT_DIR: noRunHere });
  assert.deepEqual(pointingNowhere, { block: false });
  assert.equal(fs.existsSync(state.statePath(noRunHere)), false, "the fallback must not conjure a run where there is none");

  const emptyValue = stophook.evaluate(startDir, JSON.stringify({ cwd: startDir }), NOW, { CLAUDE_PROJECT_DIR: "" });
  assert.deepEqual(emptyValue, { block: false }, "an empty value is treated the same as unset");
});

test("fallback (Stop): a claimed run at CLAUDE_PROJECT_DIR is a certain bystander — nothing is written, the same rule the ordinary path applies", () => {
  const startDir = tmpdir();
  const projectDir = tmpdir();
  state.writeState(projectDir, runningState({ driver_agent: "agent-alpha", stop_nudges: 1 }));
  const before = fs.readFileSync(state.statePath(projectDir));

  const decision = stophook.evaluate(startDir, JSON.stringify({ cwd: startDir }), NOW, { CLAUDE_PROJECT_DIR: projectDir });
  assert.deepEqual(decision, { block: false });
  assert.deepEqual(fs.readFileSync(state.statePath(projectDir)), before, "a claimed run's Stop can never be its driver's — the fallback must not overwrite last_stop");
  assert.deepEqual(readLog(projectDir), []);
});

test("fallback (Stop): a non-running run at CLAUDE_PROJECT_DIR writes nothing", () => {
  for (const status of ["complete", "escalated", "aborted"] as const) {
    const startDir = tmpdir();
    const projectDir = tmpdir();
    state.writeState(projectDir, runningState({ status, end_reason: status === "complete" ? null : "some reason" }));
    const before = fs.readFileSync(state.statePath(projectDir));

    const decision = stophook.evaluate(startDir, JSON.stringify({ cwd: startDir }), NOW, { CLAUDE_PROJECT_DIR: projectDir });
    assert.deepEqual(decision, { block: false }, status);
    assert.deepEqual(fs.readFileSync(state.statePath(projectDir)), before, status);
    assert.deepEqual(readLog(projectDir), [], status);
  }
});

test("fallback (SubagentStop): only a positive driver match is attributed, the same rule the owner check uses", () => {
  for (const [label, driver, agentId, shouldWrite] of [
    ["the recorded driver's own stop", "agent-alpha", "agent-alpha", true],
    ["a bystander agent", "agent-alpha", "agent-beta", false],
    ["an unnameable agent", "agent-alpha", undefined, false],
    ["an unclaimed run", null, "agent-alpha", false],
  ] as const) {
    const startDir = tmpdir();
    const projectDir = tmpdir();
    state.writeState(projectDir, runningState({ workflow: "demo", phase: "build", driver_agent: driver }));

    const decision = stophook.evaluateSubagent(startDir, subagentStdin({ dir: startDir, ...(agentId !== undefined && { agentId }) }), NOW, { CLAUDE_PROJECT_DIR: projectDir });
    assert.deepEqual(decision, { block: false }, label);
    const after = state.readState(projectDir);
    if (shouldWrite) {
      assert.deepEqual(after?.last_stop, { disposition: "unheld", at: NOW, cause: "CLAUDE_PROJECT_DIR" }, label);
      assert.deepEqual(readLog(projectDir), [`${NOW} unheld build a=0 i=0 by=CLAUDE_PROJECT_DIR`], label);
    } else {
      assert.equal(after?.last_stop, null, label);
      assert.deepEqual(readLog(projectDir), [], label);
    }
  }
});

test("fallback: HEADSIGN_OBSERVER short-circuits before the fallback is ever reached", () => {
  const startDir = tmpdir();
  const projectDir = tmpdir();
  state.writeState(projectDir, runningState({ driver_agent: null }));

  const decision = stophook.evaluate(startDir, JSON.stringify({ cwd: startDir }), NOW, { CLAUDE_PROJECT_DIR: projectDir, HEADSIGN_OBSERVER: "1" });
  assert.deepEqual(decision, { block: false });
  assert.equal(state.readState(projectDir)?.last_stop, null, "an opted-out caller must never write into any run, including one reached via CLAUDE_PROJECT_DIR");
});

test("fallback: garbage stdin fails open before the fallback is reached, exactly like the ordinary path", () => {
  const startDir = tmpdir();
  const projectDir = tmpdir();
  state.writeState(projectDir, runningState({ driver_agent: null }));

  const decision = stophook.evaluate(startDir, "not json{{{", NOW, { CLAUDE_PROJECT_DIR: projectDir });
  assert.deepEqual(decision, { block: false });
  assert.equal(state.readState(projectDir)?.last_stop, null);
});

// --- last_stop at every disposition headsign can attribute ---
//
// Written on every stop the hook processes and can attribute, not only on the passes. A field
// written only on passes would still read "not held" long after a later nudge — which is exactly
// the misreading `stop_nudges: 0` produced for the report that asked for this field.

test("last_stop: a nudge records `nudged` alongside the counter it increments, and the line it writes carries the same count", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_agent: null, stop_nudges: 0 }));

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW, NO_ENV);
  assert.equal(decision.block, true);
  const after = state.readState(dir);
  assert.equal(after?.stop_nudges, 1);
  assert.deepEqual(after?.last_stop, { disposition: "nudged", at: NOW });
  // One locked write, so the counter, the field and the line cannot disagree about one event.
  assert.deepEqual(readLog(dir), [`${NOW} held build a=0 i=0 nudges=1`]);
});

test("last_stop: a consumed pause note records `paused`, in the same write as the paused line, and carries the note's first line", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_agent: null, stop_nudges: 3 }));
  writeNote(dir, "stepping away");

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });
  const after = state.readState(dir);
  assert.equal(after?.stop_nudges, 0);
  assert.deepEqual(after?.last_stop, { disposition: "paused", at: NOW, note: "stepping away" });
  assert.equal(readLog(dir).length, 1);
});

// The value on the record and the value in the line must be the SAME truncation, computed once
// (noteGateThenNudge's `recordedNote`) — this pins the record's own truncation/ellipsis rule
// rather than trusting the log line's own test (above) to stand in for it.
test("last_stop: the recorded note is truncated and ellipsis-marked the same way the log line's is", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_agent: null, stop_nudges: 0 }));
  writeNote(dir, "x".repeat(200));

  stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW, NO_ENV);
  const after = state.readState(dir);
  assert.equal(after?.last_stop?.note, `${"x".repeat(120)}…`);
});

// The one stop where the field and the log answer differently, and deliberately: the 5th nudge
// still HELD the turn, so its disposition is `nudged`, while its `stalled` line records the
// moment the loop guard tripped. `stalled` as a disposition belongs to the stops afterwards,
// which are the ones that are no longer held.
test("last_stop: the cap-tripping nudge records `nudged` while logging `stalled`, and the passes after it record `stalled`", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_agent: null, stop_nudges: 4 }));
  const stdin = JSON.stringify({ cwd: dir });

  const fifth = stophook.evaluate(dir, stdin, NOW, NO_ENV);
  assert.equal(fifth.block, true);
  assert.deepEqual(state.readState(dir)?.last_stop, { disposition: "nudged", at: NOW });
  assert.equal(readLog(dir).length, 1);
  assert.match(readLog(dir)[0], /^\S+ stalled build a=0 i=0 nudges=5$/);

  const later = "2026-07-25T10:00:00+09:00";
  const sixth = stophook.evaluate(dir, stdin, later, NO_ENV);
  assert.deepEqual(sixth, { block: false });
  const after = state.readState(dir);
  assert.deepEqual(after?.last_stop, { disposition: "stalled", at: later });
  assert.equal(after?.stop_nudges, 5, "a spent cap is not incremented further");
  assert.equal(readLog(dir).length, 1, "stalled is never repeated: only the field moves");
});

test("last_stop: the cap-exhausted pass keeps its fail-open behaviour — with the lock held it changes nothing and the turn still ends", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_agent: null, stop_nudges: 5 }));
  holdLock(dir);
  const before = fs.readFileSync(state.statePath(dir));

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });
  assert.deepEqual(fs.readFileSync(state.statePath(dir)), before);
  assert.deepEqual(readLog(dir), []);
});

test("last_stop: a bystander subagent's stop leaves the field describing the earlier stop it does not overwrite", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_agent: "agent-alpha", last_stop: { disposition: "nudged", at: NOW } }));

  const decision = stophook.evaluateSubagent(dir, subagentStdin({ dir, agentId: "agent-beta" }), NOW, NO_ENV);
  assert.deepEqual(decision, { block: false });
  assert.deepEqual(state.readState(dir)?.last_stop, { disposition: "nudged", at: NOW }, "unattributable stops leave the field alone rather than blanking it");
});

// --- ADR-0027: last_drive, the session that most recently drove this run ---
//
// `Stop` is the only hook that reads `last_drive` — `SubagentStop` reads the claim only
// (ADR-0027 §3) — so every test in this section calls `evaluate`, never `evaluateSubagent`.

test("Stop: a matching session_id nudges exactly as today — block=true, stop_nudges increments, one held line", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ last_drive: { session: "session-alpha", at: NOW }, stop_nudges: 2 }));
  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir, session_id: "session-alpha" }), NOW, NO_ENV);
  assert.equal(decision.block, true);
  assert.equal(state.readState(dir)?.stop_nudges, 3);
  assert.deepEqual(readLog(dir), [`${NOW} held build a=0 i=0 nudges=3`]);
});

// The load-bearing half of ADR-0027 §3's new step: "no stamp" must read as UNKNOWN, never as a
// mismatch, or every run in flight at upgrade time would silently lose its backstop. Both
// shapes "no stamp" can take — an explicit null, and the field missing entirely (a run started
// before this field existed) — must land on the identical, ordinary nudge.
test("Stop: a run with no last_drive at all — null, or the field missing entirely — nudges exactly as today", () => {
  const withNull = tmpdir();
  state.writeState(withNull, runningState({ last_drive: null }));
  const onNull = stophook.evaluate(withNull, JSON.stringify({ cwd: withNull, session_id: "whoever-stopped" }), NOW, NO_ENV);
  assert.equal(onNull.block, true, "an explicit null must still nudge");
  assert.equal(state.readState(withNull)?.stop_nudges, 1);

  const missing = tmpdir();
  fs.mkdirSync(path.join(missing, ".headsign"), { recursive: true });
  const legacy: Record<string, unknown> = { ...runningState() };
  delete legacy.last_drive;
  fs.writeFileSync(state.statePath(missing), JSON.stringify(legacy, null, 2) + "\n");
  const onMissing = stophook.evaluate(missing, JSON.stringify({ cwd: missing, session_id: "whoever-stopped" }), NOW, NO_ENV);
  assert.equal(onMissing.block, true, "a state.json predating this field must still nudge, not silently lose its backstop");
  assert.equal(state.readState(missing)?.stop_nudges, 1);
});

test("Stop: a mismatched session_id passes silently — no nudge, stop_nudges unchanged, no log line, last_stop unchanged", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ last_drive: { session: "session-alpha", at: NOW }, stop_nudges: 2, last_stop: { disposition: "nudged", at: NOW } }));
  const before = fs.readFileSync(state.statePath(dir));

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir, session_id: "session-beta" }), NOW, NO_ENV);

  assert.deepEqual(decision, { block: false });
  assert.deepEqual(fs.readFileSync(state.statePath(dir)), before, "nothing at all is written — not stop_nudges, not last_stop");
  assert.equal(state.readState(dir)?.stop_nudges, 2);
  assert.deepEqual(state.readState(dir)?.last_stop, { disposition: "nudged", at: NOW });
  assert.deepEqual(readLog(dir), []);
});

test("Stop: a mismatched session_id with stop_hook_active also writes nothing — not even an unheld line", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ last_drive: { session: "session-alpha", at: NOW } }));
  const before = fs.readFileSync(state.statePath(dir));

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir, session_id: "session-beta", stop_hook_active: true }), NOW, NO_ENV);

  assert.deepEqual(decision, { block: false });
  assert.deepEqual(fs.readFileSync(state.statePath(dir)), before, "the already-continuing flag never got a chance to write — the drive-session check returned first");
  assert.deepEqual(readLog(dir), []);
});

// The claim check returns above anything last_drive would be read at (ADR-0027 §3): a claimed
// run is unchanged byte for byte, whichever way session_id happens to fall.
test("Stop: a claimed run never reaches the last_drive comparison — same pass-through whether session_id matches or not", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ driver_agent: "agent-alpha", last_drive: { session: "session-alpha", at: NOW } }));
  const before = fs.readFileSync(state.statePath(dir));

  const matching = stophook.evaluate(dir, JSON.stringify({ cwd: dir, session_id: "session-alpha" }), NOW, NO_ENV);
  assert.deepEqual(matching, { block: false });
  const mismatching = stophook.evaluate(dir, JSON.stringify({ cwd: dir, session_id: "someone-else" }), NOW, NO_ENV);
  assert.deepEqual(mismatching, { block: false });

  assert.deepEqual(fs.readFileSync(state.statePath(dir)), before, "a claimed run is unchanged byte for byte, ADR-0027 §3's headline consequence");
});

test("Stop: no session_id in the payload at all, on a stamped run, passes silently and writes nothing", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ last_drive: { session: "session-alpha", at: NOW } }));
  const before = fs.readFileSync(state.statePath(dir));

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW, NO_ENV);

  assert.deepEqual(decision, { block: false });
  assert.deepEqual(fs.readFileSync(state.statePath(dir)), before);
});

// --- ADR-0027 §9: the same comparison governs the CLAUDE_PROJECT_DIR fallback ---
//
// `fallbackUnheld`'s `shouldAttribute` argument, as built by `evaluate`, is now the conjunction
// of the two tests just exercised above: not claimed, and (no stamp, or a matching one). The
// "claimed run at CLAUDE_PROJECT_DIR" case is already covered by "fallback (Stop): a claimed
// run at CLAUDE_PROJECT_DIR is a certain bystander" above (the second starting point section) —
// nothing new to add there, since the last_drive comparison is never reached once a driver is
// recorded, on this path exactly as on the ordinary one.

test("fallback (Stop): CLAUDE_PROJECT_DIR names an unclaimed run whose last_drive stamp matches the payload's session_id — unheld by=CLAUDE_PROJECT_DIR is still written", () => {
  const startDir = tmpdir(); // no .git, no state of its own — the walk finds nothing
  const projectDir = tmpdir();
  state.writeState(projectDir, runningState({ workflow: "demo", phase: "build", driver_agent: null, last_drive: { session: "session-alpha", at: NOW } }));

  const decision = stophook.evaluate(startDir, JSON.stringify({ cwd: startDir, session_id: "session-alpha" }), NOW, { CLAUDE_PROJECT_DIR: projectDir });
  assert.deepEqual(decision, { block: false }, "the fallback never blocks");

  const after = state.readState(projectDir);
  assert.deepEqual(after?.last_stop, { disposition: "unheld", at: NOW, cause: "CLAUDE_PROJECT_DIR" }, "a driver whose session wandered out of the run's tree is still attributed");
  assert.deepEqual(readLog(projectDir), [`${NOW} unheld build a=0 i=0 by=CLAUDE_PROJECT_DIR`]);
});

test("fallback (Stop): CLAUDE_PROJECT_DIR names an unclaimed run whose last_drive stamp does NOT match the payload's session_id — nothing is written", () => {
  const startDir = tmpdir();
  const projectDir = tmpdir();
  state.writeState(projectDir, runningState({ driver_agent: null, last_drive: { session: "session-alpha", at: NOW } }));
  const before = fs.readFileSync(state.statePath(projectDir));

  const decision = stophook.evaluate(startDir, JSON.stringify({ cwd: startDir, session_id: "session-beta" }), NOW, { CLAUDE_PROJECT_DIR: projectDir });

  assert.deepEqual(decision, { block: false });
  assert.deepEqual(fs.readFileSync(state.statePath(projectDir)), before, "a bystander that never drove this run must not overwrite last_stop, the same rule the ordinary path applies");
  assert.deepEqual(readLog(projectDir), []);
});

test("fallback (Stop): CLAUDE_PROJECT_DIR names an unclaimed run with no last_drive stamp — unheld by=CLAUDE_PROJECT_DIR is still written (fail-open)", () => {
  const startDir = tmpdir();
  const projectDir = tmpdir();
  state.writeState(projectDir, runningState({ workflow: "demo", phase: "build", driver_agent: null, last_drive: null }));

  const decision = stophook.evaluate(startDir, JSON.stringify({ cwd: startDir, session_id: "whoever-stopped" }), NOW, { CLAUDE_PROJECT_DIR: projectDir });
  assert.deepEqual(decision, { block: false });

  const after = state.readState(projectDir);
  assert.deepEqual(after?.last_stop, { disposition: "unheld", at: NOW, cause: "CLAUDE_PROJECT_DIR" }, "no stamp reads as UNKNOWN, never as a mismatch, so this path still fails open");
  assert.deepEqual(readLog(projectDir), [`${NOW} unheld build a=0 i=0 by=CLAUDE_PROJECT_DIR`]);
});

// --- resolveDriveSession: the one place CLAUDE_CODE_SESSION_ID is read (ADR-0027 §2.1) ---

test("resolveDriveSession: a non-empty CLAUDE_CODE_SESSION_ID is returned trimmed", () => {
  assert.equal(stophook.resolveDriveSession({ CLAUDE_CODE_SESSION_ID: "  session-abc  " }), "session-abc");
});

test("resolveDriveSession: unset, empty, or whitespace-only -> null", () => {
  assert.equal(stophook.resolveDriveSession({}), null);
  assert.equal(stophook.resolveDriveSession({ CLAUDE_CODE_SESSION_ID: "" }), null);
  assert.equal(stophook.resolveDriveSession({ CLAUDE_CODE_SESSION_ID: "   " }), null);
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
