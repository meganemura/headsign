import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as optimization from "../src/optimization.ts";
import type { State } from "../src/state.ts";

const ID = "123e4567-e89b-42d3-a456-426614174000";

function record(value: unknown): State {
  return { optimization: value } as State;
}

test("optimization metadata accepts only the complete run-scoped shape", () => {
  assert.deepEqual(optimization.metadata(record({ id: ID, stop_requested: false, friction_noticed: true })), { id: ID, stop_requested: false, friction_noticed: true });
  for (const value of [undefined, null, [], {}, { id: "../escape", stop_requested: false, friction_noticed: false }, { id: ID, stop_requested: 0, friction_noticed: false }]) {
    assert.equal(optimization.metadata(record(value)), null);
  }
});

test("assessment validation accepts four dispositions, CRLF, and nonempty details", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "headsign-optimization-"));
  const state = record({ id: ID, stop_requested: false, friction_noticed: false });
  const file = optimization.assessmentPath(dir, state)!;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (const disposition of ["NO_CHANGE", "APPLIED", "PROPOSED", "DEFERRED"]) {
    fs.writeFileSync(file, `${disposition}\r\nUseful reason.\r\n`);
    assert.equal(optimization.hasAssessment(dir, state), true);
  }
  fs.writeFileSync(file, "APPLIED\n   \n");
  assert.equal(optimization.hasAssessment(dir, state), false);
  fs.writeFileSync(file, "UNKNOWN\nUseful reason.\n");
  assert.equal(optimization.hasAssessment(dir, state), false);
});

test("assessment reads fail closed for missing, nonregular, oversized, and malformed records", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "headsign-optimization-"));
  const state = record({ id: ID, stop_requested: false, friction_noticed: false });
  const file = optimization.assessmentPath(dir, state)!;
  assert.equal(optimization.hasAssessment(dir, state), false);
  fs.mkdirSync(file, { recursive: true });
  assert.equal(optimization.hasAssessment(dir, state), false);
  fs.rmSync(file, { recursive: true });
  fs.writeFileSync(file, `APPLIED\n${"x".repeat(65_537)}`);
  assert.equal(optimization.hasAssessment(dir, state), false);
  fs.writeFileSync(file, "APPLIED without newline");
  assert.equal(optimization.hasAssessment(dir, state), false);
});

test("assessment I/O errors are distinct from an ordinary missing record", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "headsign-optimization-"));
  const state = record({ id: ID, stop_requested: false, friction_noticed: false });
  const file = optimization.assessmentPath(dir, state)!;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.symlinkSync(file, file);
  assert.equal(optimization.assessmentState(dir, state), "unavailable");
  assert.equal(optimization.hasAssessment(dir, state), false);
});

test("guidance names the exact path until a valid assessment exists", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "headsign-optimization-"));
  const state = record({ id: ID, stop_requested: false, friction_noticed: false });
  assert.match(optimization.guidance(dir, state)!, /optimize.*assessment\.md/);
  const file = optimization.assessmentPath(dir, state)!;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "NO_CHANGE\nThe current method worked.\n");
  assert.equal(optimization.guidance(dir, state), null);
  assert.equal(optimization.assessmentPath(dir, record(null)), null);
});
