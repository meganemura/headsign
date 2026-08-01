// Responsibility: one operation on a run — start it, take one lap of `next`, abort it, claim
// it, describe it — carried out and reported as a value. The ONLY place routing rules live
// (ADR-0002, ADR-0004), and that now includes the ORDER a lap asks its questions in:
// ADR-0002's transition table calls itself "the whole routing rule set" and puts the ordering
// inside it, so the ordering is a routing rule by this project's own documents (ADR-0018).
// Arguments arrive RESOLVED. `start` is handed a workflow path, never a name: turning a bare
// name into `.headsign/<name>.yaml` and refusing one with a slash in it both happen before
// the call. "Must NOT know about: argv" below rules out reading the command line; it does not
// by itself say what shape the values arrive in, which a seam sweep had to point out.
//
// The directory is the caller's choice and is taken on trust: every operation works in the
// directory it is handed, looks for the run only there, never searches upward, and never
// checks the choice against anything. That is the cwd-only rule the README and the workflow
// skill explain to users, and until a seam sweep asked, it was stated in neither.
// Must NOT know about: argv, stdout/stderr, exit codes. Every answer and every refusal leaves
// here as data, and cli.ts alone decides how to say it and what to exit with. (The one text
// this module composes is a `.headsign/log` line, through render.logLine, which owns that
// format; choosing which event happened is this module's job and nobody else's.)
//
// NOT a pure module, and the map says so (ADR-0018): a lap spawns the phase's gate through
// gate.ts, and four of the five operations read and write `.headsign/`. Two properties
// survive that move and are kept deliberately:
//   - step() is still pure, total and exported — same (workflow, state, gate result, route),
//     same answer, no I/O — which is what lets tests/engine.test.ts enumerate the whole
//     transition table by calling it directly.
//   - nothing here reads the clock, and nothing reads the environment. A timestamp arrives as an
//     argument (`nowIso`), and so does the environment where one operation needs it (`status`,
//     for the HEADSIGN_OBSERVER line) — the shape stophook.ts already uses across this same
//     boundary, so the same inputs produce byte-identical output and a test can assert a whole
//     line.

import fs from "node:fs";
import path from "node:path";
import * as workflowMod from "./workflow.ts";
// The module namespace `state` is shadowed inside the pure functions below, whose own
// parameter for the run record is also called `state`. Those functions never touch the
// module — that is the point of them — so the shadow costs nothing and the names each read
// correctly where they are.
import * as state from "./state.ts";
import * as gate from "./gate.ts";
import * as render from "./render.ts";
// One function, for one line of `status`: whether HEADSIGN_OBSERVER is set. It is imported
// rather than re-implemented because the switch's definition — any non-empty value, the value
// itself never inspected (ADR-0008) — belongs with the hooks that honour it, and a second copy
// here could drift into reporting an opt-out that the hooks do not act on.
import * as stophook from "./stophook.ts";
import type { Workflow, Route } from "./workflow.ts";
import type { State, UnheldCause } from "./state.ts";
import type { GateVerdict, CheckFailure, RouteResolution } from "./gate.ts";

type FailureInfo = CheckFailure;

// What step() accepts for a k-way `on_pass`: the branch gate.resolveRoute already picked.
// The "error" arm is deliberately excluded — the lap below refuses on it (cli.ts turns that
// into exit 3) and never reaches step(), so the transition function never has to invent a
// destination.
export type ResolvedRoute = Exclude<RouteResolution, { kind: "error" }>;

export type Outcome =
  // `routedBy` is set only when this ADVANCE came through a k-way `on_pass`: which `when:`
  // answered, or that nothing did and the default was taken. Carried verbatim for render.ts
  // to print and log — the engine decides nothing from it.
  | { kind: "ADVANCE"; phase: string; description: string; failure?: FailureInfo & { routedTo: string }; routedBy?: { when: string } | { default: true } }
  // `acceptedGraphChanges` is set only when this run accepted at least one change to its own
  // workflow rules while it was running (see reconcileGraphPin below). Optional, and set
  // through the same spread `routedBy` uses, so a run that never rewrote its workflow prints
  // the COMPLETE it always printed, to the byte.
  | { kind: "COMPLETE"; acceptedGraphChanges?: number }
  | { kind: "RETRY"; phase: string; attempt: number; maxAttempts?: number; failure: FailureInfo }
  | { kind: "ESCALATE"; reason: string }
  | { kind: "ABORT"; reason: string }
  // Constructed only by the lap below (the `ready` probe, short-circuited before the gate
  // runs — same treatment as the phase-missing guard). step() never produces this: it stays
  // pure and clock-free, with no I/O and no shell probe of its own.
  | { kind: "PENDING"; phase: string; ready: string };

// The global ceiling: a wall the run stops in front of, not an ending (ADR-0017). It returns
// an outcome and NO state, which is the whole of the change — nothing here writes
// `status: "escalated"`, so the run stays `running` and a person who decides it was merely
// bigger than declared can raise the limit and continue with `headsign next`. Of the three
// ESCALATE producers this is the only one that can fire on a run doing nothing wrong; the
// two that mean something is actually wrong (`max_attempts` exhausted, `on_fail: escalate`)
// stay terminal in step().
//
// The reason names the way out, because a wall nobody can see over is one a person cannot
// act on. `state.workflow_path` is where the limit is written, and reading it keeps this
// function as pure as it was — no clock, no I/O.
// The ESCALATE arm of Outcome, named because checkIterationLimit only ever produces that one
// and the caller reads its `reason` (the wider union has arms without one). Same idiom as
// ResolvedRoute above: narrow the type rather than make the call site re-check what it knows.
export type CeilingOutcome = Extract<Outcome, { kind: "ESCALATE" }>;

// The three exported entry points below are TOTAL: every input either produces an answer or
// is refused by name. That is deliberate, and it is what makes them safe to export.
//
// Each one has a precondition — the run is still going, or has already ended, or the
// workflow was validated — and until this guard existed every one of those was satisfied
// only by the ORDER OF STATEMENTS in the caller. Nothing here said so, so asking a question
// out of order produced a plausible wrong answer rather than a complaint: a completed run
// reported as still open, a finished run judged again, a still-running run called aborted, a
// missing phase surfacing as a raw TypeError about reading a property of undefined.
//
// None of those was reachable through the CLI, which checks status first and loads only
// validated workflows. That is exactly why they were worth closing: an unreachable wrong
// answer is one refactor away from a reachable one, and the thing keeping it unreachable was
// written in another file. That caller now lives in this one (ADR-0018) — which changed
// nothing about these guards, and is why they were done first, as their own change: these
// three are still exported, so the ordering that keeps them safe is still not the only
// caller's to choose.
//
// Refusals throw rather than returning a value. These are caller mistakes, not run outcomes
// — an outcome is something a workflow author can route on, and there is no sensible route
// for "you asked the wrong question". cli.ts's top-level catch turns a throw into
// `ERROR: …` and exit 3, which is where usage errors already go.
function refuse(fn: string, problem: string): never {
  throw new Error(`${fn}: ${problem}`);
}

// The phase a transition is about to enter must exist. Checked rather than indexed blind:
// without it a destination naming no phase dies reaching for `.description` on nothing,
// which names neither the phase nor the workflow. `validate` rejects such a workflow at load
// time, so this is the second line of defence, not the first.
function describePhase(workflow: Workflow, phase: string): string {
  const p = workflow.phases[phase];
  if (p === undefined) {
    refuse("step", `destination '${phase}' does not name a phase in workflow '${workflow.name}'`);
  }
  return p.description;
}

// --- reading the graph pin off a run record ---
//
// The three fields are read through these and never straight off the record. A state.json
// written before they existed has none of them, and `undefined` compares unequal to
// everything: a bare read would report a change against a run that never pinned anything, and
// would arithmetic a count into NaN. The same guards also absorb a hand-edited record, which
// is why they do not go away when the transitional half of the tolerance does — state.ts's
// declaration says when that is.

function recordedFingerprint(state: State): workflowMod.GraphFingerprint | null {
  const recorded: unknown = state.graph_fingerprint;
  // null means "this run has no pin", which is not the same as "its pin is empty" — the empty
  // map is a legitimate pin (a workflow whose every phase is unreachable cannot arise, but the
  // distinction is what the migration branch turns on).
  return typeof recorded === "object" && recorded !== null && !Array.isArray(recorded) ? (recorded as workflowMod.GraphFingerprint) : null;
}

function recordedGraphMarker(state: State): string | null {
  return typeof state.graph_change_reported === "string" ? state.graph_change_reported : null;
}

function acceptedGraphChanges(state: State): number {
  const recorded: unknown = state.accepted_graph_changes;
  return typeof recorded === "number" && Number.isFinite(recorded) ? recorded : 0;
}

// --- reading the last stop off a run record ---
//
// Same tolerance, same two halves: a record written before the field existed lacks it (that half
// is transitional — state.ts's driver_agent declaration carries the criterion), and a
// hand-edited one may carry anything at all (that half is permanent). Anything that is not a
// well-formed object reads as "no stop has been attributed yet", which prints no line — the
// alternative being a `status` that crashes on a record a person edited, on the one command
// whose whole promise is that it is safe to run while diagnosing.
const STOP_DISPOSITIONS: readonly NonNullable<State["last_stop"]>["disposition"][] = ["nudged", "unheld", "paused", "stalled"];
const UNHELD_CAUSES: readonly UnheldCause[] = ["stop_hook_active", "CLAUDE_PROJECT_DIR"];

function recordedLastStop(state: State): NonNullable<State["last_stop"]> | null {
  const recorded: unknown = state.last_stop;
  if (typeof recorded !== "object" || recorded === null || Array.isArray(recorded)) return null;
  const { disposition, at, cause } = recorded as { disposition?: unknown; at?: unknown; cause?: unknown };
  if (typeof at !== "string" || at.length === 0) return null;
  // An unknown disposition is dropped rather than passed through: render.ts turns the word into
  // a phrase through a fixed map, so a word it has no phrase for would print nothing useful and
  // a forged one must not choose the sentence a reader sees.
  if (!STOP_DISPOSITIONS.includes(disposition as NonNullable<State["last_stop"]>["disposition"])) return null;
  // The cause gets the same treatment as the disposition and for the same reason — it also
  // chooses a sentence — but it is DROPPED rather than failing the whole record: an `unheld`
  // with no usable cause still has a true disposition to report, and render.ts's fallback is
  // the cause `unheld` always had before this field existed. Dropping the field and keeping the
  // line is what a record written by an older headsign needs; failing would blank a line that
  // used to print (ADR-0026).
  const known = disposition === "unheld" && UNHELD_CAUSES.includes(cause as UnheldCause);
  return {
    disposition: disposition as NonNullable<State["last_stop"]>["disposition"],
    at,
    ...(known ? { cause: cause as UnheldCause } : {}),
  };
}

// The COMPLETE arm's optional count, spread in the way `routedBy` is spread into ADVANCE: an
// ABSENT key rather than a zero, so a run that never rewrote its own workflow produces the
// outcome — and therefore the output — it produced before any of this existed.
function graphChangeNote(state: State): { acceptedGraphChanges?: number } {
  const accepted = acceptedGraphChanges(state);
  return accepted > 0 ? { acceptedGraphChanges: accepted } : {};
}

export function checkIterationLimit(workflow: Workflow, state: State): CeilingOutcome | null {
  // A finished run has no allowance left to be over or under, and the reason string below
  // would tell a reader "the run is still open" about a run that is not.
  if (state.status !== "running") {
    refuse("checkIterationLimit", `run is already ${state.status}; ask terminalOutcome instead`);
  }
  const limit = workflow.limits?.max_total_iterations;
  if (limit === undefined || state.total_iterations < limit) return null;
  // Deliberately one line, no embedded newline: the reason is printed as the rest of
  // ESCALATE's line-1 token line (ADR-0002) and written into one `.headsign/log` record,
  // and a newline would split both of those in two.
  const reason =
    `${state.phase}: max_total_iterations (${limit}) reached — the run is still open: raise limits.max_total_iterations in ` +
    `${state.workflow_path} and run \`headsign next\` to continue from this phase, or run \`headsign abort <reason>\` to end it`;
  return { kind: "ESCALATE", reason };
}

export function terminalOutcome(state: State): Outcome {
  // Without this a run that is still going falls past both arms below and comes back as
  // ABORT with an empty reason — a still-running run reported as one somebody ended.
  if (state.status === "running") {
    refuse("terminalOutcome", "run is still running; there is no terminal outcome to report");
  }
  // A reprint says exactly what the run said when it finished, accepted-changes line included:
  // the run record still holds the count, and a COMPLETE that mentions the rewrites once and
  // then stops mentioning them would make asking twice a way to lose the fact.
  if (state.status === "complete") return { kind: "COMPLETE", ...graphChangeNote(state) };
  if (state.status === "escalated") return { kind: "ESCALATE", reason: state.end_reason ?? "" };
  return { kind: "ABORT", reason: state.end_reason ?? "" };
}

// Turns the phase's declared `on_pass` plus (for the k-way form) the branch already resolved
// by the caller into one destination. String form ignores `route` entirely, so existing
// workflows keep the exact behavior they had.
function passTarget(onPass: string | Route[], route?: ResolvedRoute): { to: string; routedBy?: { when: string } | { default: true } } {
  if (typeof onPass === "string") return { to: onPass };
  // Can't happen through the lap below (it resolves whenever on_pass is a list). Throwing
  // beats guessing a phase: an unrouted k-way pass has no defensible destination.
  if (route === undefined) throw new Error("step: on_pass is a route list but no resolution was given");
  return route.kind === "matched" ? { to: route.to, routedBy: { when: route.when } } : { to: route.to, routedBy: { default: true } };
}

// step() is fully deterministic: same (workflow, state, gateResult, route) always yields the
// same output — no clock, no randomness. The shell work behind `route` happened in gate.ts
// before the call; this function only reads the answer.
//
// `gateResult` is a GateVerdict, not a GateResult: the "unrunnable" arm — a check that
// produced no exit code — is excluded by the type, the same way ResolvedRoute excludes an
// unresolvable route above. The lap below refuses on it (cli.ts turns that into exit 3), so
// this function is never handed a non-answer to invent a transition from.
export function step(workflow: Workflow, state: State, gateResult: GateVerdict, route?: ResolvedRoute): { state: State; outcome: Outcome } {
  // Without this an already-ended run is judged again: the iteration count rises, a fresh
  // RETRY comes back, and the state handed out still says the run finished — a record that
  // contradicts itself.
  if (state.status !== "running") {
    refuse("step", `run is already ${state.status}; nothing left to step`);
  }
  const phaseName = state.phase;
  const phase = workflow.phases[phaseName];
  const next: State = { ...state, attempts: { ...state.attempts } };
  next.total_iterations += 1;
  // step() runs only on a real gate evaluation, which is exactly the event that
  // should clear the Stop hook's loop guard (ADR-0006) — reset it unconditionally here.
  next.stop_nudges = 0;

  if (gateResult.kind === "pass") {
    delete next.attempts[phaseName];
    next.last_failure = null;
    const { to, routedBy } = passTarget(phase.on_pass, route);
    if (to === "$end") {
      next.status = "complete";
      return { state: next, outcome: { kind: "COMPLETE", ...graphChangeNote(next) } };
    }
    next.phase = to;
    // Spread rather than always setting the key: a string-form `on_pass` must produce the
    // byte-identical outcome it produced before k-way routing existed, absent key included.
    return { state: next, outcome: { kind: "ADVANCE", phase: to, description: describePhase(workflow, to), ...(routedBy && { routedBy }) } };
  }

  next.attempts[phaseName] = (next.attempts[phaseName] ?? 0) + 1;
  // Destructure rather than reuse gateResult as-is: it also carries `kind: "fail"`,
  // which must not leak into the outcome's public FailureInfo shape.
  const { check, run, exitCode, outputTail, timeoutSeconds } = gateResult;
  const failure: FailureInfo = { check, run, exitCode, outputTail, timeoutSeconds };

  const maxAttempts = phase.max_attempts;
  // Exhaustion always escalates (ADR-0014): a budget running out is precisely the moment a
  // person should be asked, and it is not a fact the workflow author can know better at
  // authoring time than the run does at exhaustion time.
  if (maxAttempts !== undefined && next.attempts[phaseName] >= maxAttempts) {
    const reason = `${phaseName}: max_attempts (${maxAttempts}) exhausted`;
    next.last_failure = null;
    next.end_reason = reason;
    next.status = "escalated";
    return { state: next, outcome: { kind: "ESCALATE", reason } };
  }

  const onFail = phase.on_fail ?? "retry";
  if (onFail === "retry") {
    // Recorded purely so `status` can show what the run is currently stuck on; nothing in
    // this function ever reads it back.
    next.last_failure = {
      phase: phaseName, check: failure.check, run: failure.run,
      exit_code: failure.exitCode, output_tail: failure.outputTail, timeout_seconds: failure.timeoutSeconds,
    };
    return { state: next, outcome: { kind: "RETRY", phase: phaseName, attempt: next.attempts[phaseName], maxAttempts, failure } };
  }

  next.last_failure = null;
  if (onFail === "$end") {
    next.status = "complete";
    return { state: next, outcome: { kind: "COMPLETE", ...graphChangeNote(next) } };
  }
  // `escalate` is the only end-the-run token on the failure path (ADR-0014). A run ends as
  // ABORT only when a person says so through `headsign abort`, which this module writes
  // directly — never as a verdict this function reaches.
  if (onFail === "escalate") {
    const reason = `${phaseName}: gate failed (on_fail: escalate)`;
    next.status = "escalated";
    next.end_reason = reason;
    return { state: next, outcome: { kind: "ESCALATE", reason } };
  }

  next.phase = onFail; // onFail names a phase to route to
  return { state: next, outcome: { kind: "ADVANCE", phase: onFail, description: describePhase(workflow, onFail), failure: { ...failure, routedTo: onFail } } };
}

// --- the five operations on a run, and what they answer with (ADR-0018) ---

// Every operation below used to end by building text and calling a helper that printed it
// and exited. In a module that may not choose an exit code, each has to hand its answer back
// instead — and the dangerous half of that is the refusals, because every one of them was an
// `ERROR: <message>` on stderr with exit 3. A refusal dropped on the way back is an error
// message printed with exit 0: a silent lie to any script that checks its status, and on the
// ordinary path rather than some unreachable edge.
//
// So the refusals are one discriminated kind, every result type below is a union containing
// it, and cli.ts maps each arm in a `switch` inside a function declared to return `never` —
// a missed arm makes that function's end reachable, which does not compile. Structure, not a
// comment asking someone to remember.
export type Refused = { kind: "REFUSED"; message: string };

// Kept apart from REFUSED because cli.ts prints it differently — render.validateFail's
// `INVALID: <path>` block listing every error, not a one-line `ERROR:` — though both exit 3.
// Only the two operations that load a workflow (`start`, `next`) can produce it.
export type WorkflowInvalid = { kind: "WORKFLOW_INVALID"; workflowPath: string; errors: string[] };

export type Rejection = Refused | WorkflowInvalid;

// A load that succeeded but had something to say. Warnings never affect an exit code, and
// `next` never asks for them: a warning belongs where someone is in a position to act on it
// (`validate`, and once per run at `start`), not on every lap of the loop.
export interface LoadWarnings { workflowPath: string; warnings: string[] }

export interface StartResult {
  // Reported before whatever `result` says, because that is the order `start` printed them
  // in when it lived in cli.ts: the load's warnings reach stderr even when the start is then
  // refused because a run is already in progress. Null when there were none — and also when
  // the workflow did not load at all, which is the one case `start` never warned about.
  warnings: LoadWarnings | null;
  result: Rejection | { kind: "STARTED"; phase: string; description: string; cleared: string[] };
}

export type NextResult =
  | Rejection
  // One lap's answer. `workflowName` is what a COMPLETE prints as the finished workflow, and
  // it comes from two different places on purpose: a terminal reprint uses the name recorded
  // in state.json (the workflow file may not even have been read), a real evaluation uses the
  // loaded workflow's own name. `wf` and `cleared` are render extras the Outcome deliberately
  // doesn't carry: the workflow resolves a PENDING phase's description, and `cleared` is only
  // ever set alongside an ADVANCE.
  | { kind: "ANSWERED"; outcome: Outcome; workflowName: string; wf?: Workflow; cleared?: string[] };

export type AbortResult = Refused | { kind: "ABORTED"; reason: string };

export type ClaimResult = Refused | { kind: "CLAIMED" };

// The current phase's last recorded failure, field-renamed out of state.json's snake_case
// into the shape render.ts prints. Reading the run record is this module's job; knowing that
// `output_tail` is called `outputTail` on the way out is part of it.
export interface StatusFailure { check: string; run: string; exitCode: number | "timeout"; timeoutSeconds?: number; outputTail: string }

export type StatusResult =
  | Refused
  | { kind: "TERMINAL"; status: Exclude<State["status"], "running">; workflowName: string; endReason: string | null }
  | {
      kind: "RUNNING";
      phase: string;
      attempt: number;
      maxAttempts?: number;
      // Workflow unreadable, or this phase no longer defined in it.
      attemptUnknown: boolean;
      workflowName: string;
      lastFailure: StatusFailure | null;
      // Whether anyone has claimed this run — never who. Two values, and neither is a
      // judgment about *who is reading* (ADR-0013): the recorded driver is an agent id, which
      // the CLI can never resolve for itself, so this reports the one thing the CLI can
      // honestly know. The words that carry it to the reader are cli.ts's.
      delegated: boolean;
      // What headsign did with the last turn end it could attribute to this run, read off the
      // record — never by parsing `.headsign/log`, which spans runs and would have to be read
      // backwards to answer this. null when no stop has been attributed yet, and also when the
      // field is malformed (see recordedLastStop): both mean "there is nothing to report", and
      // cli.ts prints no line for either.
      // `cause` rides along only on `unheld`, and only when the recorded value is one render.ts
      // has a sentence for — an `unheld` whose cause is missing or unrecognized still reports
      // its disposition, and render.ts supplies the cause that word carried before the field
      // existed (ADR-0026).
      lastStop: { disposition: "nudged" | "unheld" | "paused" | "stalled"; at: string; cause?: UnheldCause } | null;
      // Whether HEADSIGN_OBSERVER is set in the environment `status` was called with. The one
      // quiet-ending cause the caller can answer about ITSELF; what it reports is the environment
      // of the process `status` runs in, which is normally the session's but not necessarily.
      observer: boolean;
      // The graph pin as an observation: how many changes to its own rules this run has
      // accepted, and whether one is reported but not yet accepted. Read-only like everything
      // else here — `status` never reconciles the pin, because reconciling can WRITE (accept a
      // change, clear a marker) and the observation window judges nothing (ADR-0002/0008).
      acceptedGraphChanges: number;
      graphChangeReported: boolean;
    };

// Shared by next, claim and status (ADR-0004/0008): all three are cwd-only lookups of the
// same .headsign/state.json, so a missing run gets the same actionable guidance from each.
const NO_RUN_HERE_MESSAGE =
  "no run in progress here. headsign uses the .headsign/ directory in the current directory and does not search parent directories — " +
  "run it from the directory that owns the workflow (usually the repo or git-worktree root). To begin one here, run `headsign start`.";

function readFileOrEmpty(p: string): string {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function ensureHeadsignGitignored(cwd: string): void {
  // headsign self-manages these entries so run state and the concurrency lock can
  // never be committed by accident.
  const gitignorePath = path.join(cwd, ".headsign", ".gitignore");
  const original = readFileOrEmpty(gitignorePath); // "" if no .gitignore yet
  let content = original;
  for (const entry of ["state.json", "lock", "log", "tmp/"]) {
    if (content.split("\n").some((l) => l.trim() === entry)) continue;
    const sep = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
    content = `${content}${sep}${entry}\n`;
  }
  if (content !== original) fs.writeFileSync(gitignorePath, content);
}

// Returns the relative paths (as written in `clear:`) of files that actually existed and
// were non-empty before deletion — i.e. the ones whose removal is worth announcing to the
// agent, so a silently-vanished artifact from a previous pass doesn't go unnoticed for a
// whole extra cycle. Directories are never reported here (see the EISDIR note below: they
// were never actually removed either).
function clearPhaseArtifacts(cwd: string, phase: workflowMod.Phase): string[] {
  const cleared: string[] = [];
  for (const rel of phase.clear ?? []) {
    const full = path.join(cwd, rel);
    let removedNonEmptyFile = false;
    try {
      const st = fs.statSync(full);
      removedNonEmptyFile = st.isFile() && st.size > 0;
    } catch {
      // ENOENT: nothing there to clear, nothing to announce.
    }
    // Best-effort: force suppresses ENOENT; a directory (EISDIR) or any other
    // error is ignored so a bad `clear` entry never wedges a transition.
    try { fs.rmSync(full, { force: true }); } catch { /* best effort */ }
    if (removedNonEmptyFile) cleared.push(rel);
  }
  return cleared;
}

export function start(cwd: string, workflowPath: string, nowIso: string): StartResult {
  const loaded = workflowMod.load(workflowPath);
  const wf = loaded.workflow;
  if (!wf) return { warnings: null, result: { kind: "WORKFLOW_INVALID", workflowPath, errors: loaded.errors } };
  const warnings = loaded.warnings.length > 0 ? { workflowPath, warnings: loaded.warnings } : null;

  const existing = state.readState(cwd);
  if (existing && existing.status === "running") {
    return {
      warnings,
      result: {
        kind: "REFUSED",
        message: `a headsign run is already in progress (phase: ${existing.phase}). Run \`headsign next\` to continue, or \`headsign abort\` to stop it.`,
      },
    };
  }

  // A new run always begins undelegated (ADR-0013): the CLI process can never learn who is
  // running it at agent granularity, so `start` has nothing honest to stamp. Until a
  // delegated agent claims the run, both stop-boundary hooks fall back to nudging whoever
  // stopped, which is the same behavior a pre-ownership headsign always had.
  const freshState: State = {
    workflow: wf.name, workflow_path: workflowPath, status: "running", phase: wf.entry,
    attempts: {}, total_iterations: 0, last_failure: null, end_reason: null, stop_nudges: 0,
    driver_agent: null,
    // No stop has been processed yet, and `start` must not invent one: the field is written only
    // by the stop-boundary hooks, at a stop they actually saw.
    last_stop: null,
    // The pin is taken here and nowhere else at run start: from the entry phase, because that
    // is where the run is about to stand and the fingerprint covers what is reachable from
    // where it stands. Nothing is outstanding and nothing has been accepted yet.
    graph_fingerprint: workflowMod.graphFingerprint(wf, wf.entry),
    graph_change_reported: null,
    accepted_graph_changes: 0,
  };
  state.writeState(cwd, freshState);
  ensureHeadsignGitignored(cwd);
  // Record the run's first transition. The log is never cleared here: it is gitignored, so a
  // previous run's history exists nowhere else, and a restart must not be the cheap way to
  // erase it (see state.ts). This `start` line is what marks where the new run begins.
  state.appendLog(cwd, render.logLine(nowIso, { kind: "START", workflow: wf.name }, freshState));
  // Every run starts with a clean scratch dir: artifacts from a previous run (verdicts,
  // tickets, notes) must not leak into this one.
  const tmpDir = path.join(cwd, ".headsign", "tmp");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  const cleared = clearPhaseArtifacts(cwd, wf.phases[wf.entry]);
  return { warnings, result: { kind: "STARTED", phase: wf.entry, description: wf.phases[wf.entry].description, cleared } };
}

// One lap of `headsign next`: read the record, check the run is still going, load the
// workflow, take the lock, re-read, check again, evaluate, release, answer. The order is the
// point — it is the part of ADR-0002's transition table that a table cannot draw — and so is
// the fact that every question that could refuse does so before anything is written.
export function next(cwd: string, nowIso: string): NextResult {
  const current = state.readState(cwd);
  if (!current) return { kind: "REFUSED", message: NO_RUN_HERE_MESSAGE };
  if (current.status !== "running") return { kind: "ANSWERED", outcome: terminalOutcome(current), workflowName: current.workflow };

  const loaded = workflowMod.load(current.workflow_path);
  if (!loaded.workflow) return { kind: "WORKFLOW_INVALID", workflowPath: current.workflow_path, errors: loaded.errors };
  const wf = loaded.workflow;

  const lock = state.acquireLock(cwd);
  if (!lock.ok) {
    return { kind: "REFUSED", message: `another \`headsign next\` is running in this repo (pid ${lock.pid}); wait for it to finish, or remove .headsign/lock if it is stale.` };
  }

  // Everything from here to the `finally` runs under the lock, and the release is structural
  // rather than remembered: this body and the evaluation it calls have five exits between
  // them, and every one of them used to need its own release call before the caller printed
  // and exited — five calls, kept correct by a comment. One acquire, one release, and no exit
  // that can skip it.
  try {
    // Re-read state now that we hold the lock: the lock only serializes evaluation, it does
    // not make `current` (read before we even attempted to acquire it) current. Another
    // `next` can acquire, evaluate, write, and release entirely within the gap between our
    // pre-lock read and our own acquisition (the workflow load above widens that gap, and it
    // is deliberately on this side of the acquire — parsing YAML while holding the lock would
    // only make other processes wait for it); acting on the stale `current` would silently
    // overwrite that process's attempt increment, which defeats the lock's entire purpose.
    const fresh = state.readState(cwd);
    if (!fresh) return { kind: "REFUSED", message: "the run ended while acquiring the lock; re-run `headsign next`." };

    // No driver stamping here (ADR-0013). `next` used to record the calling session's env
    // identifier, which named the enclosing session even when a delegated agent was the
    // caller — the wrong identity, and never the one the hooks compare against. Driver
    // ownership now changes in exactly one place: the SubagentStop adoption gate.

    if (fresh.status !== "running") return { kind: "ANSWERED", outcome: terminalOutcome(fresh), workflowName: fresh.workflow };

    return evaluateNext(cwd, wf, fresh, nowIso);
  } finally {
    state.releaseLock(cwd);
  }
}

// The refusal a lap produces when a shell command it asked answered nothing at all. Written
// to the same skeleton as the route-error refusal further down — what could not be run and
// why, that the run therefore has not moved, and where to fix it — because they are the same
// event: headsign asked, got no exit code, and will not invent one. One logical line, like
// every other REFUSED message (cli.ts prints it as `ERROR: <message>` on stderr); the
// concatenation is for reading the source, not for the output.
//
// One function for both the gate check and the readiness probe, taking the naming of the
// command as a parameter: the two differ only in what to call the thing that failed, and the
// rest is a statement of policy — nothing moved, nothing was spent, here is where to fix
// it — which is the kind of sentence that gets corrected in one copy and not the other.
//
// `state` shadows the module namespace of the same name here, exactly as it does in the pure
// functions above and for the same reason: this does not touch the module.
function unrunnableMessage(state: State, what: string, reason: string): string {
  return (
    `phase '${state.phase}': could not run ${what} — ${reason}. ` +
    "headsign has no verdict to act on, so the run has not moved and no attempt was spent. " +
    `Fix that command in '${state.workflow_path}', or the environment it needs, and run \`headsign next\` again.`
  );
}

// What the graph pin decides for this lap: either the lap goes on (with the state it must go
// on WITH — see reconcileGraphPin) or the change is handed to a person and the lap is over.
// The reported arm is narrowed to ESCALATE by the same idiom CeilingOutcome uses, but spelled
// out rather than reusing that alias: this report is not the ceiling, and a type named for the
// ceiling appearing here would say it was.
type PinResult = { kind: "CONTINUE"; state: State } | { kind: "REPORT"; outcome: Extract<Outcome, { kind: "ESCALATE" }> };

// Same skeleton as the ceiling's reason, because it is the same kind of answer: an ESCALATE
// that ends nothing. So it has to name both ways forward — put the file back, or ask again —
// and say what asking again will cost, since accepting is counted and reported at the end.
// Deliberately one line, no embedded newline: it is the tail of ESCALATE's token line
// (ADR-0002) and one `.headsign/log` record.
function graphChangedReason(state: State, changed: string[]): string {
  const noun = changed.length === 1 ? "phase" : "phases";
  const named = changed.map((key) => `'${key}'`).join(", ");
  return (
    `${state.phase}: the workflow's rules changed under this run (${noun} ${named}) — the run is still open and nothing was counted: ` +
    `restore '${state.workflow_path}' to what this run has been running, or run \`headsign next\` again to accept the change and continue. ` +
    "An accepted change is counted and reported at COMPLETE."
  );
}

// Compare the rules this run pinned against the rules now on disk, and decide the lap's fate.
// Four answers, and the reasoning behind each is the whole of this feature:
//
//   1. Nothing pinned (a run older than these fields) or nothing this run depends on moved:
//      carry on. The pin follows the reachable set silently — see changedFingerprintKeys for
//      why a key on one side only is not a difference. If a report was outstanding and the
//      difference is now gone, somebody put the file back: clear the marker and say nothing.
//      Restoring must be free and silent, or the most correct response to the report is the
//      one that costs the most.
//   2. Only `$limits` moved: accept it on the spot, count it, and CARRY ON — no report. The
//      ceiling's own ESCALATE was already the human beat (ADR-0017): a person read the wall,
//      decided the run deserved more room, and raised it. Asking them to confirm the decision
//      they just made would make the documented way to resume cost two laps and teach everyone
//      that the report is noise.
//   3. A phase moved and this exact difference has not been reported yet: report it. Write the
//      MARKER ONLY — not the fingerprint, not the counters, not the phase. Leaving the
//      fingerprint on the rules the run has been running is what makes (1) reachable: update
//      it here and a restored file becomes a second difference, escalating again and counting
//      the correction as a change.
//   4. A phase moved and this exact difference is the one already reported: accept it, count
//      it, clear the marker, carry on. The person has now been shown it and asked again.
//
// The state this returns is the state the rest of the lap must use. step() builds its answer
// from the state it is handed, so handing it the pre-acceptance object would write the
// acceptance straight back out of existence.
function reconcileGraphPin(cwd: string, wf: Workflow, current: State, nowIso: string): PinResult {
  const computed = workflowMod.graphFingerprint(wf, current.phase);
  const saved = recordedFingerprint(current);
  const marker = recordedGraphMarker(current);
  const accepted = acceptedGraphChanges(current);
  const changed = saved === null ? [] : workflowMod.changedFingerprintKeys(saved, computed);
  // Adopting `computed` is how "a key on only one side is not a difference" is actually
  // carried out: the reachable set moves as the run walks, and the pin moves with it.
  const adopt = (count: number): State => ({
    ...current,
    graph_fingerprint: computed,
    graph_change_reported: null,
    accepted_graph_changes: count,
  });

  if (changed.length === 0) {
    if (marker === null) return { kind: "CONTINUE", state: adopt(accepted) };
    const restored = adopt(accepted);
    state.writeState(cwd, restored);
    return { kind: "CONTINUE", state: restored };
  }

  const digest = workflowMod.fingerprintDigest(computed);
  const limitsOnly = changed.every((key) => key === workflowMod.LIMITS_KEY);
  if (limitsOnly || marker === digest) {
    const accepting = adopt(accepted + 1);
    state.writeState(cwd, accepting);
    state.appendLog(cwd, render.logLine(nowIso, { kind: "GRAPH_CHANGED", disposition: "accepted", keys: changed }, accepting));
    return { kind: "CONTINUE", state: accepting };
  }

  const reporting: State = { ...current, graph_change_reported: digest };
  state.writeState(cwd, reporting);
  state.appendLog(cwd, render.logLine(nowIso, { kind: "GRAPH_CHANGED", disposition: "reported", keys: changed }, reporting));
  return { kind: "REPORT", outcome: { kind: "ESCALATE", reason: graphChangedReason(current, changed) } };
}

// The real evaluation (phase-missing guard, graph pin, iteration limit, ready probe, gate,
// step/writeState), run while next() holds the lock. Private, and reachable only from behind
// that guard sequence: nothing here re-checks that the run is still going, because the only
// caller has just done it against a fresh read.
function evaluateNext(cwd: string, wf: Workflow, incoming: State, nowIso: string): NextResult {
  if (!wf.phases[incoming.phase]) {
    return {
      kind: "REFUSED",
      message:
        `workflow '${incoming.workflow_path}' no longer defines phase '${incoming.phase}', which this run is currently on. ` +
        `Restore that phase in the workflow file, or run \`headsign abort <reason>\` to end this run.`,
    };
  }

  // The graph pin, and its position is the whole of it: after the phase-missing guard (which
  // is about the phase the run is standing on, not about the rules) and before EVERYTHING that
  // reads a rule. The ceiling reads `limits`, the readiness probe and the gate read the phase,
  // step() reads its edges — every one of them would be acting on the very definitions this is
  // about to check. Check the graph before using the graph. Where in the lap this sits is a
  // routing rule, so it belongs to this module (ADR-0018).
  const pin = reconcileGraphPin(cwd, wf, incoming, nowIso);
  if (pin.kind === "REPORT") return { kind: "ANSWERED", outcome: pin.outcome, workflowName: wf.name, wf };
  const current = pin.state;

  // The ceiling (ADR-0017): answered as ESCALATE, but no writeState — the run stays
  // `running`, so raising `limits.max_total_iterations` and running `next` again resumes
  // this very phase. Short-circuited before the gate, so the wall costs no iteration
  // either; that is what keeps a runaway from advancing by being asked repeatedly.
  const limitOutcome = checkIterationLimit(wf, current);
  if (limitOutcome) {
    // Logged as `ceiling`, not `escalate`: the log's job is to let a later reader tell a run
    // that ended from one that was merely stopped at the wall, and reusing the ending's word
    // for a run still open is exactly the confusion to avoid (see render.ts's LogEvent).
    // `current` is passed unchanged because nothing was written — the line reports the state
    // that is on disk, same as every other log line does.
    //
    // Repeated `next` calls at the wall therefore repeat this line. That is deliberate: each
    // one is a real request that was really refused, and hiding the repetition would make the
    // log understate how long the run sat here.
    state.appendLog(cwd, render.logLine(nowIso, { kind: "CEILING", reason: limitOutcome.reason }, current));
    return { kind: "ANSWERED", outcome: limitOutcome, workflowName: wf.name, wf };
  }

  const phase = wf.phases[current.phase];
  // Ready probe: before the gate, and the one path that answers without judging. Not
  // ready -> PENDING without touching state.json at all (no writeState on this path):
  // "stay put, don't count it" — the cell the transition table was missing.
  if (phase.ready !== undefined) {
    const readiness = gate.isReady(phase.ready, cwd);
    if (readiness.kind === "unrunnable") {
      return { kind: "REFUSED", message: unrunnableMessage(current, `the readiness probe \`${phase.ready}\``, readiness.reason) };
    }
    if (readiness.kind === "not-ready") {
      return { kind: "ANSWERED", outcome: { kind: "PENDING", phase: current.phase, ready: phase.ready }, workflowName: wf.name, wf };
    }
  }

  const gateResult = gate.runGate(phase.gate.checks, cwd);
  // A check that produced no exit code is refused on exactly like an unresolvable route
  // below, and for the same reason: headsign has no verdict, so it has nothing to transition
  // on. Nothing has been written at this point — state.json, the log, this phase's attempt
  // count and total_iterations are all as they were before the lap, which is what makes
  // "run `headsign next` again" honest advice rather than a resumption mid-transition.
  if (gateResult.kind === "unrunnable") {
    const what = `the gate check '${gateResult.check}' (\`${gateResult.run}\`)`;
    return { kind: "REFUSED", message: unrunnableMessage(current, what, gateResult.reason) };
  }

  // k-way `on_pass` (ADR-0011): resolved here, after the gate passed and before step(), so
  // the transition function stays free of shell execution. Only the pass path ever routes —
  // a failed gate never evaluates a `when:`.
  let route: ResolvedRoute | undefined;
  if (gateResult.kind === "pass" && Array.isArray(phase.on_pass)) {
    const resolution = gate.resolveRoute(phase.on_pass, cwd);
    if (resolution.kind === "error") {
      // Nothing has been written yet: state.json, the log and total_iterations are all
      // untouched, so this refusal leaves the run exactly where it was. Deliberately not
      // falling through to the default destination — the thing that could not be evaluated
      // is the destination itself, and a silent wrong phase would break the one promise
      // headsign makes about transitions (ADR-0011).
      return {
        kind: "REFUSED",
        message:
          `phase '${current.phase}': could not evaluate the on_pass condition \`${resolution.when}\` (${resolution.reason}). ` +
          `The gate passed, but headsign will not guess where to go: fix that condition in '${current.workflow_path}' ` +
          "and run `headsign next` again. The run has not moved.",
      };
    }
    route = resolution;
  }

  const { state: nextState, outcome } = step(wf, current, gateResult, route);
  let cleared: string[] | undefined;
  if (outcome.kind === "ADVANCE") cleared = clearPhaseArtifacts(cwd, wf.phases[outcome.phase]);
  state.writeState(cwd, nextState);
  state.appendLog(cwd, render.logLine(nowIso, outcome, nextState, current.phase));
  return { kind: "ANSWERED", outcome, workflowName: wf.name, wf, cleared };
}

export function abort(cwd: string, reason: string, nowIso: string): AbortResult {
  const current = state.readState(cwd);
  if (!current) {
    return {
      kind: "REFUSED",
      message:
        "no run in progress to abort here. headsign uses the .headsign/ directory in the current directory and does not search parent " +
        "directories — run it from the directory that owns the workflow (usually the repo or git-worktree root).",
    };
  }
  if (current.status !== "running") {
    return { kind: "REFUSED", message: `run for workflow '${current.workflow}' is already ${current.status}; nothing to abort.` };
  }

  const nextState: State = { ...current, status: "aborted", end_reason: reason || null };
  state.writeState(cwd, nextState);
  state.appendLog(cwd, render.logLine(nowIso, { kind: "ABORT", reason }, nextState));
  return { kind: "ABORTED", reason };
}

// Arms the driver-adoption marker (the claim handshake, ADR-0009 as re-homed by ADR-0010) —
// cwd-only, like next/abort/status. Deliberately writes nothing to state.json: the CLI
// process itself can never learn who is running it at agent granularity (only the
// SubagentStop hook's stdin carries an agent id), so `claim` can only ask that hook to do
// the actual adoption when this agent's own turn ends.
export function claim(cwd: string): ClaimResult {
  const current = state.readState(cwd);
  if (!current) return { kind: "REFUSED", message: NO_RUN_HERE_MESSAGE };
  if (current.status !== "running") {
    return { kind: "REFUSED", message: `run for workflow '${current.workflow}' is already ${current.status}; nothing to claim.` };
  }

  const tmpDir = path.join(cwd, ".headsign", "tmp");
  // A re-run (e.g. after a mistaken adoption) must harmlessly re-arm rather than fail: an
  // empty file's content is never read, only its existence — mkdir+write is idempotent.
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "claim"), "");
  return { kind: "CLAIMED" };
}

// Read-only observation window (ADR-0002/0008), deliberately kept apart from `next`'s
// single judging question: no lock, no writeState, no gate/ready execution, no timestamp
// argument to log with, and cwd-only like `next`/`abort` (no walk-up). workflow.yaml is read
// best-effort only to resolve max_attempts for the attempt display — its content never gates
// anything here, so a broken workflow.yaml degrades the display instead of refusing.
//
// The environment arrives as an ARGUMENT, the shape stophook.ts uses for the same reason
// ("Nothing here reads the clock or the environment: both arrive as arguments"), rather than
// this module reaching for process.env — which nothing below cli.ts does. It is the first thing
// outside the hook path to need one, so it follows the existing shape instead of inventing one.
export function status(cwd: string, env: NodeJS.ProcessEnv): StatusResult {
  const current = state.readState(cwd);
  if (!current) return { kind: "REFUSED", message: NO_RUN_HERE_MESSAGE };

  if (current.status !== "running") {
    return { kind: "TERMINAL", status: current.status, workflowName: current.workflow, endReason: current.end_reason };
  }

  const { workflow: wf } = workflowMod.load(current.workflow_path);
  const phase = wf?.phases[current.phase];
  const attempt = current.attempts[current.phase] ?? 0;

  // `?? null` rather than reading the field straight: a state.json written before this
  // field was renamed has no `last_failure` at all, and `undefined !== null` is true — the
  // guard below would pass and then dereference nothing.
  //
  // Transitional, like the driver_agent guard below. Nothing headsign writes today omits
  // `last_failure`; this only covers a run that was already in progress when the field was
  // renamed. It can go once no run predating that rename's release can plausibly still be
  // running — see state.ts's driver_agent declaration for the full criterion, which applies
  // unchanged here. Removing it means reading `current.last_failure` directly.
  const recorded = current.last_failure ?? null;
  const lastFailure =
    recorded !== null && recorded.phase === current.phase
      ? { check: recorded.check, run: recorded.run, exitCode: recorded.exit_code, timeoutSeconds: recorded.timeout_seconds, outputTail: recorded.output_tail }
      : null;

  // Read through the same tolerant idiom the SubagentStop hook uses (stophook.ts's
  // recordedDriver), rather than a bare `!== null`: a state.json from before the rename has
  // no `driver_agent` at all, and `undefined !== null` is true — which would report a
  // delegation that never happened. The missing-field half of that tolerance is transitional
  // and removable; state.ts's driver_agent declaration says when.
  //
  // The id itself never leaves this function: what `status` may report is whether the run has
  // been claimed at all, never by whom (ADR-0013).
  const driverAgent = typeof current.driver_agent === "string" && current.driver_agent.length > 0 ? current.driver_agent : null;

  return {
    kind: "RUNNING",
    phase: current.phase,
    attempt,
    maxAttempts: phase?.max_attempts,
    attemptUnknown: phase === undefined,
    workflowName: current.workflow,
    lastFailure,
    delegated: driverAgent !== null,
    lastStop: recordedLastStop(current),
    observer: stophook.isObserver(env),
    acceptedGraphChanges: acceptedGraphChanges(current),
    graphChangeReported: recordedGraphMarker(current) !== null,
  };
}
