import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as stophook from "../src/stophook.ts";
import * as state from "../src/state.ts";

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "headsign-stophook-"));
}

function runningState(overrides: Partial<state.State> = {}): state.State {
  return {
    version: 1,
    workflow: "demo",
    workflow_path: ".headsign/workflow.yaml",
    status: "running",
    phase: "build",
    attempts: {},
    total_iterations: 0,
    last_eval: null,
    history: [],
    end_reason: null,
    stop_nudges: 0,
    ...overrides,
  };
}

test("no state file and no .git ancestor -> does not block", () => {
  const dir = tmpdir();
  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }));
  assert.deepEqual(decision, { block: false });
});

test("running state at cwd -> blocks with workflow name, phase, next hint, and abort hint", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ workflow: "demo", phase: "build" }));
  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }));
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
    const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }));
    assert.deepEqual(decision, { block: false });
  });
}

test("stop_hook_active:true does not block and does not increment stop_nudges", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ stop_nudges: 0 }));
  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir, stop_hook_active: true }));
  assert.deepEqual(decision, { block: false });
  const after = state.readState(dir);
  assert.equal(after?.stop_nudges, 0);
});

test("nudge lifecycle: 1 -> 2 -> 3 with final-reminder only on the 3rd, then 4th call does not block", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState({ stop_nudges: 0 }));
  const stdin = JSON.stringify({ cwd: dir });

  const first = stophook.evaluate(dir, stdin);
  assert.equal(first.block, true);
  assert.equal(state.readState(dir)?.stop_nudges, 1);
  assert.ok(!first.message?.includes("final automatic reminder"));

  const second = stophook.evaluate(dir, stdin);
  assert.equal(second.block, true);
  assert.equal(state.readState(dir)?.stop_nudges, 2);
  assert.ok(!second.message?.includes("final automatic reminder"));

  const third = stophook.evaluate(dir, stdin);
  assert.equal(third.block, true);
  assert.equal(state.readState(dir)?.stop_nudges, 3);
  assert.ok(third.message?.includes("final automatic reminder"));

  const fourth = stophook.evaluate(dir, stdin);
  assert.deepEqual(fourth, { block: false });
  assert.equal(state.readState(dir)?.stop_nudges, 3);
});

test("non-numeric stop_nudges is treated as 0, still blocks, and rewrites it as the number 1", () => {
  const dir = tmpdir();
  const headsignDir = path.join(dir, ".headsign");
  fs.mkdirSync(headsignDir, { recursive: true });
  const corrupt = { ...runningState(), stop_nudges: "x" };
  fs.writeFileSync(state.statePath(dir), JSON.stringify(corrupt, null, 2) + "\n");

  const decision = stophook.evaluate(dir, JSON.stringify({ cwd: dir }));
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

  const decision = stophook.evaluate("anything", JSON.stringify({ cwd: deepSubdir }));
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

  const decision = stophook.evaluate("anything", JSON.stringify({ cwd: deepSubdir }));
  assert.deepEqual(decision, { block: false });
  assert.equal(state.readState(root)?.stop_nudges, 0);
});

test("garbage stdin fails open regardless of state at cwd", () => {
  const dir = tmpdir();
  state.writeState(dir, runningState());
  const decision = stophook.evaluate(dir, "not json{{{");
  assert.deepEqual(decision, { block: false });
});
