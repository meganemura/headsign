// Responsibility: run shell commands on a phase's behalf and report their exit codes. Three
// callers' questions, not two — the count matters, because the header said "both" for a while
// and a seam sweep had to point out that the first of the three was declared nowhere:
//   - is this phase ready to be judged at all (the `ready:` probe)?
//   - do its gate checks pass, in order, with timeout and output tail (ADR-0002/0003)?
//   - which branch of a k-way `on_pass` answered yes, by running its `when:` predicates
//     (ADR-0011)?
// All three are "run shell, read exit code" — the routing *rules* still live in engine.ts;
// this module only reports which branch answered yes.
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
// Every command here inherits headsign's own environment unmodified (ADR-0014): a phase
// cannot declare variables, because `FOO=bar cmd` in the `run:` string already says it, in
// the shell the workflow author is already writing.
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
}

// Three outcomes, not two, and the third is not a kind of failure. `fail` is an ANSWER: the
// check ran and said no, which is exactly what a gate is for. `unrunnable` is the ABSENCE of
// one — the command never started, or was killed by this runner before it could finish (a cwd
// that no longer exists, an output flood past maxBuffer), so there is no exit code to route
// on. Reporting that as `fail` spends an attempt on a verdict nobody measured, and
// `max_attempts` failures away it ends the run — a transition decided by something that never
// ran, which is precisely what ADR-0001 says headsign does not do. Same rule resolveRoute
// already applies to a `when:` (ADR-0011), now stated in the same vocabulary.
export type GateResult =
  | { kind: "pass" }
  | ({ kind: "fail" } & CheckFailure)
  | { kind: "unrunnable"; check: string; run: string; reason: string };

// What a transition may be computed from: the two arms that are actual verdicts. engine.step
// takes THIS, not GateResult, so "unrunnable never reaches the transition function" is a fact
// the compiler keeps rather than a comment asking a future caller to remember it — the caller
// has to deal with the third arm before it can call step at all.
export type GateVerdict = Exclude<GateResult, { kind: "unrunnable" }>;

const DEFAULT_TIMEOUT_SECONDS = 120;
const OUTPUT_TAIL_LIMIT = 4000;

// Seconds, one decimal place, rounded rather than truncated — the same unit and precision as
// `timeoutSeconds`, so a reader can compare the two without doing arithmetic first.
function elapsedSecondsSince(startedAt: bigint): number {
  const ms = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  return Math.round(ms / 100) / 10;
}

export function runGate(checks: Check[], cwd: string): GateResult {
  for (const c of checks) {
    const timeoutSeconds = c.timeout ?? DEFAULT_TIMEOUT_SECONDS;
    const check = c.name ?? c.run;
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
    if (spawnError?.code === "ETIMEDOUT") {
      // A timeout is a verdict, deliberately NOT an unrunnable check: the command did run,
      // it reported on the work by being stopped, and the limit it ran past is one the
      // workflow author wrote in this very file. Only "headsign never got an answer at all"
      // belongs in the arm below. `elapsedSeconds` lands close to `timeoutSeconds` here, which
      // is itself the confirmation that the check really did run to the limit rather than
      // being cut short some other way.
      return { kind: "fail", check, run: c.run, exitCode: "timeout", outputTail, timeoutSeconds, elapsedSeconds };
    }
    if (spawnError) {
      // The runner itself couldn't execute/complete the check (e.g. ENOBUFS despite
      // maxBuffer, or a cwd that vanished): there is no exit code, so there is nothing to
      // route on. The caller stops the run on this (exit 3) instead of spending an attempt.
      // `reason` stays short — the errno, which names the situation to anyone who can fix it.
      // No `elapsedSeconds`: the command never answered, so there is no "time to an answer" to
      // report.
      return { kind: "unrunnable", check, run: c.run, reason: spawnError.code ?? spawnError.message };
    }
    if (result.status !== 0) return { kind: "fail", check, run: c.run, exitCode: result.status ?? -1, outputTail, elapsedSeconds };
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
  // A timed-out probe still ran, and this stays the one lenient arm in the file: a slow
  // probe must not silently stall the run behind PENDING forever — running the real gate and
  // producing an actual verdict is the safer failure mode, and the gate is the thing being
  // deferred here, not a destination. That leniency was never about the case below: a probe
  // that could not be started produced nothing to be lenient toward.
  if (spawnError?.code === "ETIMEDOUT") return { kind: "ready" };
  if (spawnError) return { kind: "unrunnable", reason: spawnError.code ?? spawnError.message };
  return result.status === 0 ? { kind: "ready" } : { kind: "not-ready" };
}

// --- resolveRoute: which branch of a k-way `on_pass` takes the pass (ADR-0011) ---

export type RouteResolution =
  | { kind: "matched"; to: string; when: string }
  | { kind: "default"; to: string }
  | { kind: "error"; when: string; reason: string };

// Evaluated only after the gate has already passed. Entries are tried top to bottom and the
// first `when:` to exit 0 wins; the entry without a `when:` (validated to be the last one) is
// the default. Mirrors runGate's spawnSync pattern (same shell, cwd, timeout default), but
// discards output like isReady does: a `when:` is a predicate, and nothing here is ever
// shown to the agent.
//
// Fails toward stopping, unlike isReady: a nonzero exit is a real answer ("not this branch"),
// but a probe that could not run at all has produced no answer, and the thing being decided
// here is the destination itself. Silently taking the default would move the run to a phase
// nobody declared for that situation — see ADR-0011.
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
