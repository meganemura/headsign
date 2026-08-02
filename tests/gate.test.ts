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
  const result = gate.runGate([{ run: "exit 1" }, { run: `touch ${marker}` }], dir);
  assert.equal(result.kind, "fail");
  assert.equal(fs.existsSync(marker), false);
});

test("passes when all checks succeed", () => {
  const result = gate.runGate([{ run: "true" }, { run: "true" }], tmpdir());
  assert.deepEqual(result, { kind: "pass" });
});

test("check name defaults to the run string; explicit name overrides it", () => {
  const dir = tmpdir();
  const withoutName = gate.runGate([{ run: "exit 3" }], dir);
  const withName = gate.runGate([{ name: "unit tests", run: "exit 3" }], dir);
  assert.equal(withoutName.kind, "fail");
  assert.equal(withName.kind, "fail");
  if (withoutName.kind === "fail") assert.equal(withoutName.check, "exit 3");
  if (withName.kind === "fail") assert.equal(withName.check, "unit tests");
});

// A check inherits headsign's own environment and nothing else (ADR-0014): variables a
// check needs are written into its own `run:` string, in the shell it already runs in.
test("a check sees headsign's own environment, and a run: string can set its own variables", () => {
  const result = gate.runGate([{ run: 'test -n "$PATH" && FOO=bar; test "$FOO" = "bar"' }], tmpdir());
  assert.equal(result.kind, "pass");
});

test("output tail is truncated at 4000 chars with a marker", () => {
  const run = `node -e "process.stdout.write('x'.repeat(5000))" && exit 1`;
  const result = gate.runGate([{ run }], tmpdir());
  assert.equal(result.kind, "fail");
  if (result.kind === "fail") {
    assert.ok(result.outputTail.startsWith("… (output truncated)\n"));
    assert.equal(result.outputTail.length, "… (output truncated)\n".length + 4000);
  }
});

test("empty output renders as (no output)", () => {
  const result = gate.runGate([{ run: "exit 1" }], tmpdir());
  assert.equal(result.kind, "fail");
  if (result.kind === "fail") assert.equal(result.outputTail, "(no output)");
});

test("large output from a passing check is not misreported as a failure", () => {
  const run = `node -e "process.stdout.write('x'.repeat(2_000_000))" && exit 0`;
  const result = gate.runGate([{ run }], tmpdir());
  assert.deepEqual(result, { kind: "pass" });
});

// A timeout stays a FAIL, deliberately, next to the unrunnable tests below that look almost
// like it: the command ran, and the limit it ran past is one the workflow author wrote. Only
// "headsign never got an exit code at all" is unrunnable — this is the regression guard for
// that line.
test("timeout is reported as a failure with a timeout marker, not as an unrunnable check", () => {
  const result = gate.runGate([{ run: "sleep 5", timeout: 0.2 }], tmpdir());
  assert.equal(result.kind, "fail");
  if (result.kind === "fail") {
    assert.equal(result.exitCode, "timeout");
    assert.equal(result.timeoutSeconds, 0.2);
  }
});

// --- elapsedSeconds: how long the check actually ran, timed by a monotonic clock (not the
// record's existing timeout_seconds, which is the LIMIT, not a measurement) ---

test("elapsedSeconds: an ordinary failure reports a number with the sleep it waited for as a lower bound (the upper bound is environment noise, so it is not asserted)", () => {
  const result = gate.runGate([{ run: "sleep 0.3 && exit 1" }], tmpdir());
  assert.equal(result.kind, "fail");
  if (result.kind === "fail") {
    assert.equal(typeof result.elapsedSeconds, "number");
    assert.ok((result.elapsedSeconds as number) >= 0.3, `expected >= 0.3, got ${result.elapsedSeconds}`);
  }
});

test("elapsedSeconds: a timed-out check also has one, close to the limit it ran past", () => {
  const result = gate.runGate([{ run: "sleep 5", timeout: 0.2 }], tmpdir());
  assert.equal(result.kind, "fail");
  if (result.kind === "fail") {
    assert.equal(typeof result.elapsedSeconds, "number");
    assert.ok((result.elapsedSeconds as number) >= 0.2, `expected >= 0.2, got ${result.elapsedSeconds}`);
  }
});

test("elapsedSeconds: an unrunnable check carries none — the command never answered, so there is no interval to report", () => {
  // Same trick as the unrunnable tests below: a nonexistent cwd stops /bin/sh from starting.
  const brokenCwd = path.join(tmpdir(), "does-not-exist");
  const result = gate.runGate([{ run: "false" }], brokenCwd);
  assert.equal(result.kind, "unrunnable");
  if (result.kind === "unrunnable") assert.equal("elapsedSeconds" in result, false);
});

// --- a check that could not be run at all: the third result, not a failure ---

test("a check that cannot be launched is unrunnable, naming the check and the errno", () => {
  // Same trick the isReady and resolveRoute spawn-error tests use: a nonexistent cwd stops
  // /bin/sh from starting at all (spawnSync sets result.error), which is a different event
  // from the shell running and exiting nonzero. `false` would be a plain fail if it ever ran,
  // so a mislabelled result can't hide behind a command that fails anyway.
  const brokenCwd = path.join(tmpdir(), "does-not-exist");
  const result = gate.runGate([{ name: "unit tests", run: "false" }], brokenCwd);
  assert.equal(result.kind, "unrunnable");
  if (result.kind === "unrunnable") {
    assert.equal(result.check, "unit tests");
    assert.equal(result.run, "false");
    assert.equal(result.reason, "ENOENT");
  }
});

test("an unrunnable check stops the gate where it is: later checks do not run", () => {
  const dir = tmpdir();
  const brokenCwd = path.join(dir, "does-not-exist");
  const marker = path.join(dir, "ran-second");
  const result = gate.runGate([{ run: "true" }, { run: `touch ${marker}` }], brokenCwd);
  assert.equal(result.kind, "unrunnable");
  assert.equal(fs.existsSync(marker), false);
});

// --- isReady: the `ready:` readiness probe ---

test("isReady: exit 0 means ready", () => {
  assert.deepEqual(gate.isReady("true", tmpdir()), { kind: "ready" });
});

test("isReady: nonzero exit means not ready", () => {
  assert.deepEqual(gate.isReady("false", tmpdir()), { kind: "not-ready" });
});

test("isReady: runs in the given cwd, like runGate", () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, "marker"), "");
  assert.deepEqual(gate.isReady("test -f marker", dir), { kind: "ready" });
  assert.deepEqual(gate.isReady("test -f nope", dir), { kind: "not-ready" });
});

test("isReady: a probe that cannot be launched at all is unrunnable, not a guess in either direction", () => {
  // A nonexistent cwd makes spawnSync fail to launch /bin/sh at all (result.error set), as
  // distinct from the shell running and exiting nonzero — use a command that would report
  // "not ready" if it ever ran, so a mislabelled result can't hide behind a truthful one.
  // This used to answer "ready", which handed the phase to a gate on the strength of a
  // question nobody managed to ask; the caller now refuses instead.
  const brokenCwd = path.join(tmpdir(), "does-not-exist");
  assert.deepEqual(gate.isReady("false", brokenCwd), { kind: "unrunnable", reason: "ENOENT" });
});

// --- resolveRoute: which branch of a k-way on_pass answers (ADR-0011) ---

test("resolveRoute: the first matching when wins", () => {
  const resolution = gate.resolveRoute(
    [
      { when: "false", to: "a" },
      { when: "true", to: "b" },
      { when: "true", to: "c" },
      { to: "fallback" },
    ],
    tmpdir(),
  );
  assert.deepEqual(resolution, { kind: "matched", to: "b", when: "true" });
});

test("resolveRoute: no match falls to the entry without a when", () => {
  const resolution = gate.resolveRoute([{ when: "false", to: "a" }, { to: "fallback" }], tmpdir());
  assert.deepEqual(resolution, { kind: "default", to: "fallback" });
});

test("resolveRoute: entries after the first match are not evaluated", () => {
  const dir = tmpdir();
  const marker = path.join(dir, "ran-later");
  gate.resolveRoute([{ when: "true", to: "a" }, { when: `touch ${marker}`, to: "b" }, { to: "fallback" }], dir);
  assert.equal(fs.existsSync(marker), false);
});

test("resolveRoute: predicates run in the given cwd, like runGate", () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, "marker"), "");
  assert.deepEqual(gate.resolveRoute([{ when: "test -f marker", to: "a" }, { to: "b" }], dir), {
    kind: "matched",
    to: "a",
    when: "test -f marker",
  });
});

test("resolveRoute: a timed-out predicate is an error, not a fall-through to the default", () => {
  const resolution = gate.resolveRoute([{ when: "sleep 5", to: "a", timeout: 0.2 }, { to: "fallback" }], tmpdir());
  assert.deepEqual(resolution, { kind: "error", when: "sleep 5", reason: "timed out after 0.2s" });
});

test("resolveRoute: a predicate that cannot be launched at all is an error", () => {
  // Same trick as the isReady spawn-error test: a nonexistent cwd stops /bin/sh from
  // starting, which is not the same event as the shell running and exiting nonzero.
  const brokenCwd = path.join(tmpdir(), "does-not-exist");
  const resolution = gate.resolveRoute([{ when: "true", to: "a" }, { to: "fallback" }], brokenCwd);
  assert.equal(resolution.kind, "error");
  if (resolution.kind === "error") assert.equal(resolution.when, "true");
});

test("resolveRoute: a route list with no default entry is an error rather than a silent no-answer", () => {
  const resolution = gate.resolveRoute([{ when: "false", to: "a" }], tmpdir());
  assert.equal(resolution.kind, "error");
});
