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
    last_eval: null,
    end_reason: null,
    stop_nudges: 0,
    ...overrides,
  };
}

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
  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW);
  assert.deepEqual(decision, { block: false });
});

test("running state at cwd -> blocks with workflow name, phase, next hint, and abort hint", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ workflow: "demo", phase: "build" }));
  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW);
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
    const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW);
    assert.deepEqual(decision, { block: false });
  });
}

test("stop_hook_active:true does not block and does not increment stop_nudges", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ stop_nudges: 0 }));
  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir, stop_hook_active: true }), NOW);
  assert.deepEqual(decision, { block: false });
  const after = state.readState(dir);
  assert.equal(after?.stop_nudges, 0);
});

test("nudge lifecycle: 1 -> 5 with final-reminder only on the 5th, then 6th call does not block", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ stop_nudges: 0 }));
  const stdin = JSON.stringify({ cwd: dir });

  for (let expected = 1; expected <= 4; expected++) {
    const result = stophook.evaluate(dir, stdin, NOW);
    assert.equal(result.block, true, `nudge #${expected} should block`);
    assert.equal(state.readState(dir)?.stop_nudges, expected);
    assert.ok(!result.message?.includes("final automatic reminder"), `nudge #${expected} must not carry the final notice`);
  }

  const fifth = stophook.evaluate(dir, stdin, NOW);
  assert.equal(fifth.block, true);
  assert.equal(state.readState(dir)?.stop_nudges, 5);
  assert.ok(fifth.message?.includes("final automatic reminder"));

  const sixth = stophook.evaluate(dir, stdin, NOW);
  assert.deepEqual(sixth, { block: false });
  assert.equal(state.readState(dir)?.stop_nudges, 5);
});

test("non-numeric stop_nudges is treated as 0, still blocks, and rewrites it as the number 1", () => {
  const dir = tmpdir();
  const headsignDir = path.join(dir, ".headsign");
  fs.mkdirSync(headsignDir, { recursive: true });
  const corrupt = { ...runningState(), stop_nudges: "x" };
  fs.writeFileSync(state.statePath(dir), JSON.stringify(corrupt, null, 2) + "\n");

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW);
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

  const decision = stophook.evaluate("anything", JSON.stringify({ cwd: deepSubdir }), NOW);
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

  const decision = stophook.evaluate("anything", JSON.stringify({ cwd: deepSubdir }), NOW);
  assert.deepEqual(decision, { block: false });
  assert.equal(state.readState(root)?.stop_nudges, 0);
});

test("garbage stdin fails open regardless of state at cwd", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState());
  const decision = stophook.evaluate(dir, "not json{{{", NOW);
  assert.deepEqual(decision, { block: false });
});

// --- exit-note gate (ADR-0006 revision) ---

test("note: a non-empty stop-note pauses instead of blocking — exit 0, note deleted, stop_nudges reset, one paused log line", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ workflow: "demo", phase: "build", stop_nudges: 3 }));
  writeNote(dir, "stepping away for lunch, resume after\nsecond line ignored");

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW);
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

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW);
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

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW);
  assert.equal(decision.block, true);
  assert.equal(state.readState(dir)?.stop_nudges, 1);
  assert.equal(readLog(dir).length, 0);
});

test("note: absent -> blocks, and the message contains both the stop-note instructions and the abort escape hatch", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ workflow: "demo", phase: "build" }));

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }), NOW);
  assert.equal(decision.block, true);
  assert.ok(decision.message);
  assert.ok(decision.message.includes(".headsign/tmp/stop-note"), "must name the stop-note path");
  assert.ok(decision.message.includes("headsign abort"), "must name the abort escape hatch");
});

test("stalled: the 5th nudge appends exactly one stalled log line; later stops do not repeat it", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ workflow: "demo", phase: "build" }));
  const stdin = JSON.stringify({ cwd: dir });

  for (let i = 1; i <= 5; i++) stophook.evaluate(dir, stdin, NOW);
  let lines = readLog(dir);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\S+ stalled build a=0 i=0 nudges=5$/);

  // 6th and 7th stops must fail open and must not add another stalled line.
  const sixth = stophook.evaluate(dir, stdin, NOW);
  assert.deepEqual(sixth, { block: false });
  const seventh = stophook.evaluate(dir, stdin, NOW);
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

  const decision = stophook.evaluate("anything", JSON.stringify({ cwd: deepSubdir }), NOW);
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

  const decision = stophook.evaluate("anything", JSON.stringify({ cwd: deepSubdir }), NOW);
  assert.equal(decision.block, true);
  assert.ok(decision.message?.includes(`${root}/.headsign/tmp/stop-note`));
  assert.ok(decision.message?.includes("headsign abort"));
});
