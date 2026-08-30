import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as state from "../src/state.ts";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";

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
    last_failure: null,
    end_reason: null,
    stop_nudges: 1,
    driver_agent: null,
    phase_entered_at: null,
    last_stop: null,
    last_drive: null,
    // A non-empty pin here on purpose: the map is the one field of this record that is not a
    // scalar, so it is the one that a serialisation change could quietly flatten.
    graph_fingerprint: { plan: "a".repeat(64), $limits: "b".repeat(64) },
    graph_change_reported: null,
    accepted_graph_changes: 0,
  };
  state.writeState(dir, s);
  assert.deepEqual(state.readState(dir), s);
});

test("readState returns null when no state file exists", () => {
  assert.equal(state.readState(tmpdir()), null);
});

// --- driver_agent (ADR-0010, renamed by ADR-0013) ---

test("round-trips a non-null driver_agent", () => {
  const dir = tmpdir();
  const s: state.State = {
    workflow: "demo",
    workflow_path: ".headsign/workflow.yaml",
    status: "running",
    phase: "plan",
    attempts: {},
    total_iterations: 0,
    last_failure: null,
    end_reason: null,
    stop_nudges: 0,
    driver_agent: "agent-claimed",
    phase_entered_at: null,
    last_stop: null,
    last_drive: null,
    graph_fingerprint: {},
    graph_change_reported: null,
    accepted_graph_changes: 0,
  };
  state.writeState(dir, s);
  assert.deepEqual(state.readState(dir), s);
});

test("round-trips a non-null last_drive", () => {
  const dir = tmpdir();
  const s: state.State = {
    workflow: "demo",
    workflow_path: ".headsign/workflow.yaml",
    status: "running",
    phase: "plan",
    attempts: {},
    total_iterations: 0,
    last_failure: null,
    end_reason: null,
    stop_nudges: 0,
    driver_agent: null,
    phase_entered_at: null,
    last_stop: null,
    last_drive: { session: "session-abc", at: "2026-08-01T19:45:29+09:00" },
    graph_fingerprint: {},
    graph_change_reported: null,
    accepted_graph_changes: 0,
  };
  state.writeState(dir, s);
  assert.deepEqual(state.readState(dir), s);
});

test("a legacy state.json carrying the old driver_session/driver_source fields reads back with driver_agent simply absent (state.ts itself does no validation — tolerance is each consumer's job)", () => {
  const dir = tmpdir();
  const legacy = {
    workflow: "demo",
    workflow_path: ".headsign/workflow.yaml",
    status: "running",
    phase: "plan",
    attempts: {},
    total_iterations: 0,
    last_failure: null,
    end_reason: null,
    stop_nudges: 0,
    // The pre-ADR-0013 shape: the driver lived under a different name, in a field whose
    // meaning depended on a companion that no longer exists.
    driver_session: "session-abc",
    driver_source: "env",
  };
  fs.mkdirSync(path.join(dir, ".headsign"), { recursive: true });
  fs.writeFileSync(state.statePath(dir), JSON.stringify(legacy, null, 2) + "\n");

  const read = state.readState(dir) as unknown as Record<string, unknown>;
  assert.equal("driver_agent" in read, false);
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

// Both lock helpers swallow a failed unlink. Neither swallow had a test, and they guard
// different callers: acquireLock's decides whether a run can start at all, releaseLock's runs
// inside a `finally` where a throw would replace whatever error the caller was already
// carrying. A lock path that is a directory is the cheapest way to make an unlink fail for a
// reason that has nothing to do with a race, and it is not far-fetched — a stray `mkdir`, an
// interrupted archive extraction, or a sync tool that recreates paths as folders all produce it.

test("acquireLock reports a lock path it cannot remove as held, rather than throwing", () => {
  const dir = tmpdir();
  fs.mkdirSync(path.join(dir, ".headsign"), { recursive: true });
  // A directory: unreadable as a pid file (so no holder is identified) and un-unlinkable (so
  // the steal cannot clear it either).
  fs.mkdirSync(state.lockPath(dir));

  let result: ReturnType<typeof state.acquireLock> | undefined;
  assert.doesNotThrow(() => {
    result = state.acquireLock(dir);
  });
  assert.equal(result?.ok, false, "a lock it cannot clear must never read as acquired");
  assert.ok(fs.existsSync(state.lockPath(dir)), "and the path is left exactly as found");
});

test("releaseLock does not throw when the lock cannot be removed, so it never replaces the caller's own error", () => {
  const dir = tmpdir();
  const headsignDir = path.join(dir, ".headsign");
  fs.mkdirSync(headsignDir, { recursive: true });
  // The lock must stay READABLE and name this process, or release skips the unlink and proves
  // nothing: what is under test is the owner deciding to remove its own lock and failing. A
  // read-only parent is what denies the unlink while leaving the read alone.
  fs.writeFileSync(state.lockPath(dir), String(process.pid));
  // Root ignores the directory bit, so under a root-run suite the unlink succeeds and this
  // test proves nothing (it still passes — releaseLock does not throw either way). That is why
  // the assertion below is the one that would notice, and why nobody should run CI as root.
  fs.chmodSync(headsignDir, 0o555);
  try {
    assert.doesNotThrow(() => state.releaseLock(dir));
    assert.ok(fs.existsSync(state.lockPath(dir)), "the lock is still there — swallowed, not silently succeeded");
  } finally {
    // Restored unconditionally: a directory left at 0555 defeats the runner's own cleanup.
    fs.chmodSync(headsignDir, 0o755);
  }
});

// --- .headsign/log I/O ---

test("appendLog appends without truncating, creating the file and .headsign/ if needed", () => {
  const dir = tmpdir();
  state.appendLog(dir, "line 1\n");
  state.appendLog(dir, "line 2\n");
  assert.equal(fs.readFileSync(state.logPath(dir), "utf8"), "line 1\nline 2\n");
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
  };
  state.writeState(dir, s);
  const raw = fs.readFileSync(state.statePath(dir), "utf8");
  assert.doesNotThrow(() => JSON.parse(raw));
  const leftovers = fs.readdirSync(path.join(dir, ".headsign")).filter((f) => f.endsWith(".tmp"));
  assert.deepEqual(leftovers, []);
});

// --- properties (hegel) ---
//
// The round-trip tests above each carry one record. These carry records nobody typed. The whole
// point of the file is that what a lap writes is what the next lap reads: every optional field
// here is optional because an older run's record simply lacks it, so a record that came back
// reshaped would be read as a run that never had the field.

// Every field of the record, with each optional one drawn as present or absent. Absent means the
// key is not written at all — a key holding `undefined` survives JSON differently from one that
// was never there, which is the distinction the writers keep by hand.
function drawState(tc: hegel.TestCase): state.State {
  const phases = tc.draw(gs.arrays(gs.text({ minSize: 1, maxSize: 8 }), { minSize: 1, maxSize: 4, unique: true }));
  const attempts: Record<string, number> = {};
  for (const p of phases) if (tc.draw(gs.booleans())) attempts[p] = tc.draw(gs.integers({ minValue: 0, maxValue: 99 }));
  const fingerprint: Record<string, string> = {};
  for (const p of phases) if (tc.draw(gs.booleans())) fingerprint[p] = tc.draw(gs.text({ alphabet: "0123456789abcdef", minSize: 64, maxSize: 64 }));
  return {
    workflow: tc.draw(gs.text({ maxSize: 12 })),
    workflow_path: tc.draw(gs.text({ maxSize: 24 })),
    status: tc.draw(gs.sampledFrom(["running", "complete", "escalated", "aborted"] as const)),
    phase: tc.draw(gs.sampledFrom(phases)),
    attempts,
    total_iterations: tc.draw(gs.integers({ minValue: 0, maxValue: 10_000 })),
    last_failure: tc.draw(gs.booleans()) ? null : drawLastFailure(tc, phases),
    end_reason: tc.draw(gs.booleans()) ? null : tc.draw(gs.text({ maxSize: 40 })),
    stop_nudges: tc.draw(gs.integers({ minValue: 0, maxValue: 5 })),
    driver_agent: tc.draw(gs.booleans()) ? null : tc.draw(gs.text({ minSize: 1, maxSize: 20 })),
    phase_entered_at: tc.draw(gs.booleans()) ? null : "2026-08-30T09:00:00+09:00",
    last_stop: tc.draw(gs.booleans()) ? null : drawLastStop(tc),
    last_drive: tc.draw(gs.booleans()) ? null : { session: tc.draw(gs.text({ minSize: 1, maxSize: 20 })), at: "2026-08-30T09:00:01+09:00" },
    graph_fingerprint: fingerprint,
    graph_change_reported: tc.draw(gs.booleans()) ? null : tc.draw(gs.text({ alphabet: "0123456789abcdef", minSize: 64, maxSize: 64 })),
    accepted_graph_changes: tc.draw(gs.integers({ minValue: 0, maxValue: 20 })),
  };
}

function drawLastFailure(tc: hegel.TestCase, phases: string[]): state.LastFailure {
  const failure: state.LastFailure = {
    phase: tc.draw(gs.sampledFrom(phases)),
    check: tc.draw(gs.text({ maxSize: 16 })),
    run: tc.draw(gs.text({ maxSize: 24 })),
    exit_code: tc.draw(gs.booleans()) ? "timeout" : tc.draw(gs.integers({ minValue: -128, maxValue: 255 })),
    output_tail: tc.draw(gs.text({ maxSize: 200 })),
  };
  if (tc.draw(gs.booleans())) failure.timeout_seconds = tc.draw(gs.integers({ minValue: 1, maxValue: 600 }));
  if (tc.draw(gs.booleans())) failure.elapsed_seconds = tc.draw(gs.integers({ minValue: 0, maxValue: 6000 })) / 10;
  if (tc.draw(gs.booleans())) failure.repeats = tc.draw(gs.integers({ minValue: 1, maxValue: 50 }));
  return failure;
}

function drawLastStop(tc: hegel.TestCase): NonNullable<state.State["last_stop"]> {
  const disposition = tc.draw(gs.sampledFrom(["nudged", "unheld", "paused", "stalled"] as const));
  const record: NonNullable<state.State["last_stop"]> = { disposition, at: "2026-08-30T09:00:02+09:00" };
  if (disposition === "unheld") record.cause = tc.draw(gs.sampledFrom(["stop_hook_active", "CLAUDE_PROJECT_DIR"] as const));
  if (disposition === "paused" && tc.draw(gs.booleans())) record.note = tc.draw(gs.text({ maxSize: 60 }));
  return record;
}

test("any record a lap can write is the record the next lap reads", () =>
  hegel.test((tc) => {
    const dir = tmpdir();
    const s = drawState(tc);
    state.writeState(dir, s);
    assert.deepEqual(state.readState(dir), s);
  }, { testCases: 50 }));

// The write is a temp file renamed into place, so writing again has to leave the record the
// second write describes and nothing of the first — and reading twice has to agree with itself.
test("writing a record over another leaves the second one and nothing of the first", () =>
  hegel.test((tc) => {
    const dir = tmpdir();
    state.writeState(dir, drawState(tc));
    const second = drawState(tc);
    state.writeState(dir, second);
    assert.deepEqual(state.readState(dir), second);
    assert.deepEqual(state.readState(dir), state.readState(dir));
  }, { testCases: 50 }));

// This module's header says an append writes exactly the bytes handed over and adds nothing —
// framing an entry is render.ts's job. So a run of appends is the concatenation of what it was
// given, whatever those bytes were.
test("appending is exactly concatenation, byte for byte", () =>
  hegel.test((tc) => {
    const dir = tmpdir();
    // Lone surrogates are out: they are not text a UTF-8 file can hold, so the encoder replaces
    // them and the difference would be Node's rather than this module's.
    const chunks = tc.draw(gs.arrays(gs.text({ maxSize: 40, excludeCategories: ["Cs"] }), { maxSize: 6 }));
    for (const chunk of chunks) state.appendLog(dir, chunk);
    const written = fs.existsSync(state.logPath(dir)) ? fs.readFileSync(state.logPath(dir), "utf8") : "";
    assert.equal(written, chunks.join(""));
  }, { testCases: 50 }));
