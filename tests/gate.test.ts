import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as gate from "../src/gate.ts";

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "headsign-gate-"));
}

test("stops at the first failing check; later checks do not run", () => {
  const dir = tmpdir();
  const marker = path.join(dir, "ran-second");
  const result = gate.runGate([{ run: "exit 1" }, { run: `touch ${marker}` }], dir, {});
  assert.equal(result.pass, false);
  assert.equal(fs.existsSync(marker), false);
});

test("passes when all checks succeed", () => {
  const result = gate.runGate([{ run: "true" }, { run: "true" }], tmpdir(), {});
  assert.deepEqual(result, { pass: true });
});

test("check name defaults to the run string; explicit name overrides it", () => {
  const dir = tmpdir();
  const withoutName = gate.runGate([{ run: "exit 3" }], dir, {});
  const withName = gate.runGate([{ name: "unit tests", run: "exit 3" }], dir, {});
  assert.equal(withoutName.pass, false);
  assert.equal(withName.pass, false);
  if (!withoutName.pass) assert.equal(withoutName.check, "exit 3");
  if (!withName.pass) assert.equal(withName.check, "unit tests");
});

test("phase env reaches the check", () => {
  const result = gate.runGate([{ run: 'test "$FOO" = "bar"' }], tmpdir(), { FOO: "bar" });
  assert.equal(result.pass, true);
});

test("output tail is truncated at 4000 chars with a marker", () => {
  const run = `node -e "process.stdout.write('x'.repeat(5000))" && exit 1`;
  const result = gate.runGate([{ run }], tmpdir(), {});
  assert.equal(result.pass, false);
  if (!result.pass) {
    assert.ok(result.outputTail.startsWith("… (output truncated)\n"));
    assert.equal(result.outputTail.length, "… (output truncated)\n".length + 4000);
  }
});

test("empty output renders as (no output)", () => {
  const result = gate.runGate([{ run: "exit 1" }], tmpdir(), {});
  assert.equal(result.pass, false);
  if (!result.pass) assert.equal(result.outputTail, "(no output)");
});

test("timeout is reported as a failure with a timeout marker", () => {
  const result = gate.runGate([{ run: "sleep 5", timeout: 0.2 }], tmpdir(), {});
  assert.equal(result.pass, false);
  if (!result.pass) {
    assert.equal(result.exitCode, "timeout");
    assert.equal(result.timeoutSeconds, 0.2);
  }
});
