// Responsibility: run shell commands on a phase's behalf and report their exit codes. Three
// callers' questions, not two — the count matters, because the header said "both" for a while
// and a seam sweep had to point out that the first of the three was declared nowhere:
//   - is this phase ready to be judged at all (the `ready:` probe)?
//   - do its gate checks pass, in order, with timeout and output tail (ADR-0002/0003)?
//   - which branch of a k-way `on_pass` answered yes, by running its `when:` predicates
//     (ADR-0011)?
// All three are "run shell, read exit code" — the routing *rules* still live in engine.ts;
// this module only reports which branch answered yes. `runGate`'s optional progress observer
// (ADR-0032) is not a fourth question of its own: it reports live on the second question above,
// as each check in the gate produces an answer, rather than asking anything new.
// All three can also come back with NO exit code, and all three answer that in the same shape
// — `unrunnable` for the first two, the `error` arm of RouteResolution for the third. A
// command headsign could not run has not answered, and an unanswered question is not a "no":
// the caller stops the run on it instead of falling toward whichever default this module
// found convenient. Which command it was and why it could not run are reported here; what to
// do about it is engine.ts's business.
// Commands run in a directory the caller supplies, taken as given and never checked: a wrong
// one runs every check somewhere else and the answers come back looking perfectly ordinary.
// Resolving a branch is only legitimate AFTER the gate has passed, and nothing here enforces
// that — ask it after a failure and you get a destination for a phase that did not pass. The
// caller owns that ordering (ADR-0011), which is why it lives in engine.ts and not here.
// Must NOT know about: state.json, git.
//
// Every command here inherits headsign's own environment unmodified — no phase-level `env:`
// merges over it (ADR-0014 §1).
//
// One clock reading that is not ADR-0004's: that ADR gives cli.ts sole custody of the WALL
// clock (the timestamp written into state.json and the log), so a date on disk always comes
// from one place. Timing how long a spawnSync call ran is a different question with a
// different clock — process.hrtime.bigint() is monotonic, so it cannot be pushed negative or
// jumped by a system-clock adjustment mid-check — and this module already touches the outside
// world (it is the one running the command). engine.ts still never reads a clock of its own:
// it only receives the finished, rounded number below and carries it through.

import { spawnSync } from "node:child_process";
import type { Check, Route } from "./workflow.ts";

export interface CheckFailure {
  check: string; run: string; exitCode: number | "timeout"; outputTail: string; timeoutSeconds?: number;
  // How long the check actually ran — elapsed time from a monotonic clock, seconds to one
  // decimal. Only ever set on a `fail` (both arms: an ordinary nonzero exit and a timeout) —
  // never on `unrunnable` (the command never answered, so there is no "time to an answer" to
  // report) and never on `pass` (out of scope here: `advance` covers several checks and a
  // per-check number would not name one).
  // Optional even though both `fail` arms below always set it: the only value *declared* as a
  // `CheckFailure` is assembled in one place in production (engine.ts's step(), straight off a
  // live GateVerdict), so nothing there needs the latitude — but making the field required
  // here also binds `LogEvent`/`Outcome` test fixtures that predate it
  // (tests/engine.test.ts's `FAIL()` helper, tests/render.test.ts's pre-`dur=` `logLine`
  // literals), and rewriting those is out of scope for this change.
  // state.LastFailure.elapsed_seconds, engine.StatusFailure.elapsedSeconds and
  // render.Failure.elapsedSeconds are optional for a different reason, transitional on its own
  // criterion — see state.ts's field for that one. The two expire independently, and this one
  // has to clear first: render.Failure is fed a `CheckFailure` directly by cli.ts, so it cannot
  // drop its `?` while this field keeps one.
  elapsedSeconds?: number;
  // How many checks this gate declares, and how many of them ran before this one failed and
  // the loop stopped (runGate still stops at the first failure — that doesn't change here,
  // only what gets reported about it). `checksRun` always counts the failing check itself, so
  // `checksTotal - checksRun` is how many never got a turn this lap. Optional for the same
  // reason `elapsedSeconds` above is: existing `GateVerdict` fixtures (tests/engine.test.ts's
  // `FAIL()`) predate the field and set neither.
  checksTotal?: number;
  checksRun?: number;
  // Names of the checks after the failing one, in gate order — same name-or-run fallback as
  // `check` above. Whoever prints these decides whether an empty list (the failing check was
  // the last one) is worth a line; this module only supplies the fact.
  notRunChecks?: string[];
}

function checkName(c: Check): string {
  return c.name ?? c.run;
}

// Three outcomes, not two, and the third is not a kind of failure: `fail` is an answered gate,
// `unrunnable` is the absence of one, and the caller refuses the lap on it rather than
// spending an attempt — ADR-0021 §1, §2.
export type GateResult =
  | { kind: "pass" }
  | ({ kind: "fail" } & CheckFailure)
  | { kind: "unrunnable"; check: string; run: string; reason: string };

// What a transition may be computed from: the two arms that are actual verdicts, and why
// `engine.step` takes this type rather than `GateResult` — ADR-0021 §3.
export type GateVerdict = Exclude<GateResult, { kind: "unrunnable" }>;

// What `runGate` tells an optional observer, live, as its own loop runs — ADR-0032. Two shapes,
// not a running total on one: `gate` is the count a caller reads once, before anything has
// happened, and `check` is one report per check that produced an exit code, whichever way it
// went — `outcome` names which of three. A timeout is its own word rather than folded into
// `failed`: this line is the only report a run-ending failure ever gets (ADR-0032 §3), so it
// cannot afford to blur what `render.clause` keeps apart everywhere else it reports one. Never
// for an unrunnable check: the command never answered, so the caller refuses the lap on it
// instead of routing on a verdict, and that refusal already names the check and the command
// (ADR-0021 §2) — a progress line would only repeat it. `runGate` calls the function it is
// given; it never learns why, and nothing here answers to ADR-0002's stdout contract, because
// this never reaches stdout.
// `timeoutSeconds` on the `check` shape is the limit this one check ran under — the `timeout:`
// its author wrote, or the default when they wrote none — the same value the loop below already
// computes before spawning and already carries on a `CheckFailure`'s timeout arm. Sent on every
// check, not only a timed-out one: `render.ts` decides whether a given elapsed time is worth
// showing next to it, and that decision needs the limit whichever way the check went.
export type GateProgress =
  | { kind: "gate"; total: number }
  | { kind: "check"; index: number; total: number; name: string; elapsedSeconds: number; timeoutSeconds: number; outcome: "passed" | "failed" | "timed out" };

const DEFAULT_TIMEOUT_SECONDS = 120;
const OUTPUT_TAIL_LIMIT = 4000;

// Seconds, one decimal place, rounded rather than truncated — the same unit and precision as
// `timeoutSeconds`, so a reader can compare the two without doing arithmetic first.
function elapsedSecondsSince(startedAt: bigint): number {
  const ms = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  return Math.round(ms / 100) / 10;
}

// `onProgress` is optional and, when given, called once up front with the gate's size and once
// more after each check that produces an exit code — passed, failed, or timed out, `outcome`
// names which (ADR-0032 §3) — but never for an unrunnable one: the refusal that ends the lap on
// it already names the check and the command.
export function runGate(checks: Check[], cwd: string, onProgress?: (p: GateProgress) => void): GateResult {
  onProgress?.({ kind: "gate", total: checks.length });
  for (let i = 0; i < checks.length; i++) {
    const c = checks[i];
    const timeoutSeconds = c.timeout ?? DEFAULT_TIMEOUT_SECONDS;
    const check = checkName(c);
    const startedAt = process.hrtime.bigint();
    const result = spawnSync("/bin/sh", ["-c", c.run], {
      cwd,
      timeout: timeoutSeconds * 1000,
      // Node's spawnSync default maxBuffer is 1MB; a verbose-but-passing check
      // (e.g. a large test suite) can legitimately print more than that.
      maxBuffer: 64 * 1024 * 1024,
      encoding: "utf8",
    });
    const elapsedSeconds = elapsedSecondsSince(startedAt);
    const outputTail = buildTail(result.stdout ?? "", result.stderr ?? "");
    const spawnError = result.error as NodeJS.ErrnoException | undefined;
    // Computed unconditionally, ahead of both fail arms below (timeout and ordinary nonzero
    // exit) that share it: the checks after index i are exactly the ones this lap never got to.
    const checksTotal = checks.length;
    const checksRun = i + 1;
    const notRunChecks = checks.slice(i + 1).map(checkName);
    if (spawnError?.code === "ETIMEDOUT") {
      // A timeout is a verdict, deliberately NOT an unrunnable check — ADR-0021 §4.
      // `elapsedSeconds` lands close to `timeoutSeconds` here, which is itself the
      // confirmation that the check really did run to the limit rather than being cut short
      // some other way. Routing still treats a timeout as an ordinary failure, the same
      // ADR-0021 §4 reading: the check ran and answered, by running past a limit the workflow
      // itself wrote. This line says so in its own word rather than `failed`, though — it is
      // the only report a run-ending failure gets (ADR-0032 §3), and `failed (120.1s)` would
      // read as an ordinary failure that happened to take two minutes.
      onProgress?.({ kind: "check", index: checksRun, total: checksTotal, name: check, elapsedSeconds, timeoutSeconds, outcome: "timed out" });
      return { kind: "fail", check, run: c.run, exitCode: "timeout", outputTail, timeoutSeconds, elapsedSeconds, checksTotal, checksRun, notRunChecks };
    }
    if (spawnError) {
      // The runner itself couldn't execute/complete the check (e.g. ENOBUFS despite
      // maxBuffer, or a cwd that vanished): there is no exit code, so there is nothing to
      // route on. The caller stops the run on this (exit 3) instead of spending an attempt.
      // `reason` stays short — the errno, which names the situation to anyone who can fix it.
      // No `elapsedSeconds`: the command never answered, so there is no "time to an answer" to
      // report. No `onProgress` call either, for the same reason: the check never produced an
      // exit code, and the refusal the caller prints instead already names it (ADR-0032 §3).
      return { kind: "unrunnable", check, run: c.run, reason: spawnError.code ?? spawnError.message };
    }
    if (result.status !== 0) {
      onProgress?.({ kind: "check", index: checksRun, total: checksTotal, name: check, elapsedSeconds, timeoutSeconds, outcome: "failed" });
      return { kind: "fail", check, run: c.run, exitCode: result.status ?? -1, outputTail, elapsedSeconds, checksTotal, checksRun, notRunChecks };
    }
    // Reached only once none of the three return arms above fired: this check passed.
    // `elapsedSeconds` is the same measurement a failing check reports on the same clock.
    onProgress?.({ kind: "check", index: checksRun, total: checksTotal, name: check, elapsedSeconds, timeoutSeconds, outcome: "passed" });
  }
  return { kind: "pass" };
}

// Same three-way shape as GateResult, for the same reason: a probe that produced no exit code
// answered neither "ready" nor "not ready", and the caller refuses on it rather than picking
// one of the two on the probe's behalf.
export type ReadyResult =
  | { kind: "ready" }
  | { kind: "not-ready" }
  | { kind: "unrunnable"; reason: string };

// Readiness probe for a phase's optional `ready:` field, mirroring runGate's spawnSync
// pattern (same shell, same cwd). exit 0 -> ready (the real gate should be evaluated);
// nonzero -> not ready (PENDING, no attempt counted).
export function isReady(sh: string, cwd: string): ReadyResult {
  const result = spawnSync("/bin/sh", ["-c", sh], {
    cwd,
    timeout: DEFAULT_TIMEOUT_SECONDS * 1000,
    stdio: "ignore",
  });
  const spawnError = result.error as NodeJS.ErrnoException | undefined;
  // A timed-out probe still ran; this stays the one lenient arm in the file, and the gate is
  // the thing being deferred here, not a destination — ADR-0021 §5.
  if (spawnError?.code === "ETIMEDOUT") return { kind: "ready" };
  if (spawnError) return { kind: "unrunnable", reason: spawnError.code ?? spawnError.message };
  return result.status === 0 ? { kind: "ready" } : { kind: "not-ready" };
}

// --- resolveRoute: which branch of a k-way `on_pass` takes the pass (ADR-0011) ---

export type RouteResolution =
  | { kind: "matched"; to: string; when: string }
  | { kind: "default"; to: string }
  | { kind: "error"; when: string; reason: string };

// Evaluated only after the gate has already passed, entries tried top to bottom, first
// `when:` to exit 0 wins, the entry without one (last, by validation) is the default —
// ADR-0011 §1. Mirrors runGate's spawnSync pattern (same shell, cwd, timeout default), but
// discards output like isReady does: a `when:` is a predicate, and nothing here is ever shown
// to the agent.
//
// Fails toward stopping, unlike isReady: a spawn error or a timeout here has produced no
// answer, and silently taking the default would move the run to a destination nothing
// actually selected — ADR-0011 §5.
export function resolveRoute(routes: Route[], cwd: string): RouteResolution {
  for (const route of routes) {
    if (route.when === undefined) return { kind: "default", to: route.to };
    const timeoutSeconds = route.timeout ?? DEFAULT_TIMEOUT_SECONDS;
    const result = spawnSync("/bin/sh", ["-c", route.when], {
      cwd,
      timeout: timeoutSeconds * 1000,
      stdio: "ignore",
    });
    const spawnError = result.error as NodeJS.ErrnoException | undefined;
    if (spawnError?.code === "ETIMEDOUT") {
      return { kind: "error", when: route.when, reason: `timed out after ${timeoutSeconds}s` };
    }
    if (spawnError) return { kind: "error", when: route.when, reason: `could not run it (${spawnError.code})` };
    if (result.status === 0) return { kind: "matched", to: route.to, when: route.when };
  }
  // Unreachable for a validated workflow: the last entry always omits `when` and returns
  // "default" above. Kept total rather than asserted, so a hand-built Route[] can't fall off
  // the end silently.
  return { kind: "error", when: "", reason: "no default destination (the last on_pass entry must have no 'when')" };
}

function buildTail(stdout: string, stderr: string): string {
  const combined = stdout + stderr;
  const truncated = combined.length > OUTPUT_TAIL_LIMIT;
  const tail = combined.slice(-OUTPUT_TAIL_LIMIT).trim();
  if (tail.length === 0) return "(no output)";
  return truncated ? `… (output truncated)\n${tail}` : tail;
}
