// Responsibility: the pure transition function (workflow, state, gate result) -> (new state, outcome).
// The ONLY place routing rules live (ADR-0002, ADR-0004).
// Must NOT know about: child_process, printing.

import type { Workflow, Route } from "./workflow.ts";
import type { State, LastEval } from "./state.ts";
import type { GateResult, CheckFailure, RouteResolution } from "./gate.ts";

type FailureInfo = CheckFailure;

// What step() accepts for a k-way `on_pass`: the branch gate.resolveRoute already picked.
// The "error" arm is deliberately excluded — cli.ts stops the run on it (exit 3) and never
// reaches step(), so the transition function never has to invent a destination.
export type ResolvedRoute = Exclude<RouteResolution, { kind: "error" }>;

export type Outcome =
  // `routedBy` is set only when this ADVANCE came through a k-way `on_pass`: which `when:`
  // answered, or that nothing did and the default was taken. Carried verbatim for render.ts
  // to print and log — the engine decides nothing from it.
  | { kind: "ADVANCE"; phase: string; description: string; failure?: FailureInfo & { routedTo: string }; routedBy?: { when: string } | { default: true } }
  | { kind: "COMPLETE" }
  | { kind: "RETRY"; phase: string; attempt: number; maxAttempts?: number; failure: FailureInfo; cached: boolean }
  | { kind: "ESCALATE"; reason: string }
  | { kind: "ABORT"; reason: string }
  // Constructed only in cli.ts (the `ready` probe, short-circuited before the gate runs —
  // same treatment as the phase-missing guard). step() never produces this: it stays pure
  // and clock-free, with no I/O and no shell probe of its own.
  | { kind: "PENDING"; phase: string; ready: string };

export function shouldUseCache(state: State, treeHash: string | null): boolean {
  const le = state.last_eval;
  return le !== null && le.result === "fail" && le.phase === state.phase && treeHash !== null && le.tree_hash === treeHash;
}

export function cachedRetry(workflow: Workflow, state: State): Outcome {
  const le = state.last_eval as LastEval; // caller must have checked shouldUseCache first
  return {
    kind: "RETRY", phase: state.phase, attempt: state.attempts[state.phase] ?? 0,
    maxAttempts: workflow.phases[state.phase].max_attempts,
    failure: { check: le.check, run: le.run, exitCode: le.exit_code, timeoutSeconds: le.timeout_seconds, outputTail: le.output_tail },
    cached: true,
  };
}

export function checkIterationLimit(workflow: Workflow, state: State): { state: State; outcome: Outcome } | null {
  const limit = workflow.limits?.max_total_iterations;
  if (limit === undefined || state.total_iterations < limit) return null;
  const reason = `${state.phase}: max_total_iterations (${limit}) reached`;
  return { state: { ...state, status: "escalated", end_reason: reason }, outcome: { kind: "ESCALATE", reason } };
}

export function terminalOutcome(state: State): Outcome {
  if (state.status === "complete") return { kind: "COMPLETE" };
  if (state.status === "escalated") return { kind: "ESCALATE", reason: state.end_reason ?? "" };
  return { kind: "ABORT", reason: state.end_reason ?? "" };
}

// Turns the phase's declared `on_pass` plus (for the k-way form) the branch already resolved
// by the caller into one destination. String form ignores `route` entirely, so existing
// workflows keep the exact behavior they had.
function passTarget(onPass: string | Route[], route?: ResolvedRoute): { to: string; routedBy?: { when: string } | { default: true } } {
  if (typeof onPass === "string") return { to: onPass };
  // Can't happen through cli.ts (it resolves whenever on_pass is a list). Throwing beats
  // guessing a phase: an unrouted k-way pass has no defensible destination.
  if (route === undefined) throw new Error("step: on_pass is a route list but no resolution was given");
  return route.kind === "matched" ? { to: route.to, routedBy: { when: route.when } } : { to: route.to, routedBy: { default: true } };
}

// step() is fully deterministic: same (workflow, state, gateResult, treeHash, route) always
// yields the same output — no clock, no randomness. The shell work behind `route` happened in
// gate.ts before the call; this function only reads the answer.
export function step(workflow: Workflow, state: State, gateResult: GateResult, treeHash: string | null, route?: ResolvedRoute): { state: State; outcome: Outcome } {
  const phaseName = state.phase;
  const phase = workflow.phases[phaseName];
  const next: State = { ...state, attempts: { ...state.attempts } };
  next.total_iterations += 1;
  // step() runs only on a real gate evaluation, which is exactly the event that
  // should clear the Stop hook's loop guard (ADR-0006) — reset it unconditionally here.
  next.stop_nudges = 0;

  if (gateResult.pass) {
    delete next.attempts[phaseName];
    next.last_eval = null;
    const { to, routedBy } = passTarget(phase.on_pass, route);
    if (to === "$end") {
      next.status = "complete";
      return { state: next, outcome: { kind: "COMPLETE" } };
    }
    next.phase = to;
    // Spread rather than always setting the key: a string-form `on_pass` must produce the
    // byte-identical outcome it produced before k-way routing existed, absent key included.
    return { state: next, outcome: { kind: "ADVANCE", phase: to, description: workflow.phases[to].description, ...(routedBy && { routedBy }) } };
  }

  next.attempts[phaseName] = (next.attempts[phaseName] ?? 0) + 1;
  // Destructure rather than reuse gateResult as-is: it also carries `pass: false`,
  // which must not leak into the outcome's public FailureInfo shape.
  const { check, run, exitCode, outputTail, timeoutSeconds } = gateResult;
  const failure: FailureInfo = { check, run, exitCode, outputTail, timeoutSeconds };

  const maxAttempts = phase.max_attempts;
  if (maxAttempts !== undefined && next.attempts[phaseName] >= maxAttempts) {
    const reason = `${phaseName}: max_attempts (${maxAttempts}) exhausted`;
    next.last_eval = null;
    next.end_reason = reason;
    next.status = phase.on_exhausted === "abort" ? "aborted" : "escalated";
    return { state: next, outcome: { kind: next.status === "aborted" ? "ABORT" : "ESCALATE", reason } };
  }

  const onFail = phase.on_fail ?? "retry";
  if (onFail === "retry") {
    next.last_eval = {
      phase: phaseName, result: "fail", tree_hash: treeHash, check: failure.check, run: failure.run,
      exit_code: failure.exitCode, output_tail: failure.outputTail, timeout_seconds: failure.timeoutSeconds,
    };
    return { state: next, outcome: { kind: "RETRY", phase: phaseName, attempt: next.attempts[phaseName], maxAttempts, failure, cached: false } };
  }

  next.last_eval = null;
  if (onFail === "$end") {
    next.status = "complete";
    return { state: next, outcome: { kind: "COMPLETE" } };
  }
  if (onFail === "escalate" || onFail === "abort") {
    const reason = `${phaseName}: gate failed (on_fail: ${onFail})`;
    next.status = onFail === "abort" ? "aborted" : "escalated";
    next.end_reason = reason;
    return { state: next, outcome: { kind: onFail === "abort" ? "ABORT" : "ESCALATE", reason } };
  }

  next.phase = onFail; // onFail names a phase to route to
  return { state: next, outcome: { kind: "ADVANCE", phase: onFail, description: workflow.phases[onFail].description, failure: { ...failure, routedTo: onFail } } };
}
