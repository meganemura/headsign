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
    workflow: "demo",
    workflow_path: ".headsign/workflow.yaml",
    status: "running",
    phase: "plan",
    attempts: { plan: 1 },
    total_iterations: 3,
    last_eval: null,
    end_reason: null,
    stop_nudges: 1,
  };
  state.writeState(dir, s);
  assert.deepEqual(state.readState(dir), s);
});

test("readState returns null when no state file exists", () => {
  assert.equal(state.readState(tmpdir()), null);
});

test("acquireLock succeeds on a fresh directory and writes this process's own pid", () => {
  const dir = tmpdir();
  const result = state.acquireLock(dir);
  assert.deepEqual(result, { ok: true });
  assert.equal(fs.readFileSync(state.lockPath(dir), "utf8"), String(process.pid));
});

test("acquireLock fails against a lock held by a live pid (this process's own), without disturbing the lock file", () => {
  const dir = tmpdir();
  fs.mkdirSync(path.join(dir, ".headsign"), { recursive: true });
  fs.writeFileSync(state.lockPath(dir), String(process.pid));
  const result = state.acquireLock(dir);
  assert.deepEqual(result, { ok: false, pid: process.pid });
  assert.equal(fs.readFileSync(state.lockPath(dir), "utf8"), String(process.pid));
});

test("acquireLock steals a lock held by a definitely-dead pid and succeeds", () => {
  const dir = tmpdir();
  fs.mkdirSync(path.join(dir, ".headsign"), { recursive: true });
  fs.writeFileSync(state.lockPath(dir), "2147483647");
  const result = state.acquireLock(dir);
  assert.deepEqual(result, { ok: true });
  assert.equal(fs.readFileSync(state.lockPath(dir), "utf8"), String(process.pid));
});

test("acquireLock steals a lock file containing an unparseable pid and succeeds", () => {
  const dir = tmpdir();
  fs.mkdirSync(path.join(dir, ".headsign"), { recursive: true });
  fs.writeFileSync(state.lockPath(dir), "garbage");
  const result = state.acquireLock(dir);
  assert.deepEqual(result, { ok: true });
});

test("releaseLock removes the lock file", () => {
  const dir = tmpdir();
  state.acquireLock(dir);
  assert.ok(fs.existsSync(state.lockPath(dir)));
  state.releaseLock(dir);
  assert.equal(fs.existsSync(state.lockPath(dir)), false);
});

test("releaseLock on an absent lock file is a silent no-op", () => {
  const dir = tmpdir();
  assert.doesNotThrow(() => state.releaseLock(dir));
});

test("atomic write leaves valid JSON and no leftover temp files", () => {
  const dir = tmpdir();
  const s: state.State = {
    workflow: "demo",
    workflow_path: ".headsign/workflow.yaml",
    status: "running",
    phase: "plan",
    attempts: {},
    total_iterations: 0,
    last_eval: null,
    end_reason: null,
    stop_nudges: 0,
  };
  state.writeState(dir, s);
  const raw = fs.readFileSync(state.statePath(dir), "utf8");
  assert.doesNotThrow(() => JSON.parse(raw));
  const leftovers = fs.readdirSync(path.join(dir, ".headsign")).filter((f) => f.endsWith(".tmp"));
  assert.deepEqual(leftovers, []);
});
