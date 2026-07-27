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

test("non-string phase env values are coerced to their string form", () => {
  const result = gate.runGate([{ run: 'test "$COUNT" = "3" && test "$FLAG" = "true"' }], tmpdir(), { COUNT: 3, FLAG: true });
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

test("large output from a passing check is not misreported as a failure", () => {
  const run = `node -e "process.stdout.write('x'.repeat(2_000_000))" && exit 0`;
  const result = gate.runGate([{ run }], tmpdir(), {});
  assert.deepEqual(result, { pass: true });
});

test("timeout is reported as a failure with a timeout marker", () => {
  const result = gate.runGate([{ run: "sleep 5", timeout: 0.2 }], tmpdir(), {});
  assert.equal(result.pass, false);
  if (!result.pass) {
    assert.equal(result.exitCode, "timeout");
    assert.equal(result.timeoutSeconds, 0.2);
  }
});

// --- isReady: the `ready:` readiness probe ---

test("isReady: exit 0 means ready", () => {
  assert.equal(gate.isReady("true", tmpdir(), undefined), true);
});

test("isReady: nonzero exit means not ready", () => {
  assert.equal(gate.isReady("false", tmpdir(), undefined), false);
});

test("isReady: runs in the given cwd, like runGate", () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, "marker"), "");
  assert.equal(gate.isReady("test -f marker", dir, undefined), true);
  assert.equal(gate.isReady("test -f nope", dir, undefined), false);
});

test("isReady: phase env reaches the probe, coerced to strings like runGate", () => {
  assert.equal(gate.isReady('test "$FOO" = "bar"', tmpdir(), { FOO: "bar" }), true);
  assert.equal(gate.isReady('test "$COUNT" = "3"', tmpdir(), { COUNT: 3 }), true);
});

test("isReady: fails open (true) on a spawn error rather than stalling the run behind a broken probe", () => {
  // A nonexistent cwd makes spawnSync fail to launch /bin/sh at all (result.error set),
  // as distinct from the shell running and exiting nonzero — use a command that would
  // report "not ready" if it ever ran, so a false pass can't hide a broken fail-open path.
  const brokenCwd = path.join(tmpdir(), "does-not-exist");
  assert.equal(gate.isReady("false", brokenCwd, undefined), true);
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
    undefined,
  );
  assert.deepEqual(resolution, { kind: "matched", to: "b", when: "true" });
});

test("resolveRoute: no match falls to the entry without a when", () => {
  const resolution = gate.resolveRoute([{ when: "false", to: "a" }, { to: "fallback" }], tmpdir(), undefined);
  assert.deepEqual(resolution, { kind: "default", to: "fallback" });
});

test("resolveRoute: entries after the first match are not evaluated", () => {
  const dir = tmpdir();
  const marker = path.join(dir, "ran-later");
  gate.resolveRoute([{ when: "true", to: "a" }, { when: `touch ${marker}`, to: "b" }, { to: "fallback" }], dir, undefined);
  assert.equal(fs.existsSync(marker), false);
});

test("resolveRoute: predicates run in the given cwd, like runGate", () => {
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, "marker"), "");
  assert.deepEqual(gate.resolveRoute([{ when: "test -f marker", to: "a" }, { to: "b" }], dir, undefined), {
    kind: "matched",
    to: "a",
    when: "test -f marker",
  });
});

test("resolveRoute: phase env reaches the predicate, coerced to strings like runGate", () => {
  const routes = [{ when: 'test "$KIND" = "docs"', to: "docs" }, { when: 'test "$COUNT" = "3"', to: "counted" }, { to: "fallback" }];
  assert.deepEqual(gate.resolveRoute(routes, tmpdir(), { KIND: "docs" }), { kind: "matched", to: "docs", when: 'test "$KIND" = "docs"' });
  assert.deepEqual(gate.resolveRoute(routes, tmpdir(), { COUNT: 3 }), { kind: "matched", to: "counted", when: 'test "$COUNT" = "3"' });
});

test("resolveRoute: a timed-out predicate is an error, not a fall-through to the default", () => {
  const resolution = gate.resolveRoute([{ when: "sleep 5", to: "a", timeout: 0.2 }, { to: "fallback" }], tmpdir(), undefined);
  assert.deepEqual(resolution, { kind: "error", when: "sleep 5", reason: "timed out after 0.2s" });
});

test("resolveRoute: a predicate that cannot be launched at all is an error", () => {
  // Same trick as the isReady spawn-error test: a nonexistent cwd stops /bin/sh from
  // starting, which is not the same event as the shell running and exiting nonzero.
  const brokenCwd = path.join(tmpdir(), "does-not-exist");
  const resolution = gate.resolveRoute([{ when: "true", to: "a" }, { to: "fallback" }], brokenCwd, undefined);
  assert.equal(resolution.kind, "error");
  if (resolution.kind === "error") assert.equal(resolution.when, "true");
});

test("resolveRoute: a route list with no default entry is an error rather than a silent no-answer", () => {
  const resolution = gate.resolveRoute([{ when: "false", to: "a" }], tmpdir(), undefined);
  assert.equal(resolution.kind, "error");
});
