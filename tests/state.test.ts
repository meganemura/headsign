import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as state from "../src/state.ts";

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "headsign-state-"));
}

test("round-trips through write/read", () => {
  const dir = tmpdir();
  const s: state.State = {
    version: 1,
    workflow: "demo",
    workflow_path: ".headsign/workflow.yaml",
    status: "running",
    phase: "plan",
    attempts: { plan: 1 },
    total_iterations: 3,
    last_eval: null,
    history: [{ phase: "plan", result: "fail", at: "t1" }],
    end_reason: null,
    stop_nudges: 1,
  };
  state.writeState(dir, s);
  assert.deepEqual(state.readState(dir), s);
});

test("readState returns null when no state file exists", () => {
  assert.equal(state.readState(tmpdir()), null);
});

test("atomic write leaves valid JSON and no leftover temp files", () => {
  const dir = tmpdir();
  const s: state.State = {
    version: 1,
    workflow: "demo",
    workflow_path: ".headsign/workflow.yaml",
    status: "running",
    phase: "plan",
    attempts: {},
    total_iterations: 0,
    last_eval: null,
    history: [],
    end_reason: null,
    stop_nudges: 0,
  };
  state.writeState(dir, s);
  const raw = fs.readFileSync(state.statePath(dir), "utf8");
  assert.doesNotThrow(() => JSON.parse(raw));
  const leftovers = fs.readdirSync(path.join(dir, ".headsign")).filter((f) => f.endsWith(".tmp"));
  assert.deepEqual(leftovers, []);
});
