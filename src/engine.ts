// Responsibility: one operation on a run — start it, take one lap of `next`, abort it, claim
// it, describe it — carried out and reported as a value. The ONLY place routing rules live
// (ADR-0002, ADR-0004), and that now includes the ORDER a lap asks its questions in —
// ADR-0018's Context makes the case: ADR-0002's transition table calls itself "the whole
// routing rule set" and puts the ordering inside it, so the ordering is a routing rule too.
// Arguments arrive RESOLVED. `start` is handed a workflow path, never a name: turning a bare
// name into `.headsign/<name>.yaml` and refusing one with a slash in it both happen before
// the call. "Must NOT know about: argv" below rules out reading the command line; it does not
// by itself say what shape the values arrive in, which a seam sweep had to point out.
//
// The directory is the caller's choice and is taken on trust, never searched for — see
// ADR-0004's cwd-only resolution section.
// Must NOT know about: argv, stdout/stderr, exit codes. Every answer and every refusal leaves
// here as data, and cli.ts alone decides how to say it and what to exit with. (The one text
// this module composes is a `.headsign/log` line, through render.logLine, which owns that
// format; choosing which event happened is this module's job and nobody else's.)
//
// NOT a pure module: it spawns the phase's gate through gate.ts, and four of the five
// operations read and write `.headsign/`. Two properties are kept deliberately, stated in the
// same words at ADR-0018 §5 ("engine.ts is no longer a pure module, and its row says so"):
// step() stays pure, total and exported, and the module reads no clock. The environment gets
// the same treatment as the clock; the argument shape that carries it in, and why, is spelled
// out at `status` below.

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
import type { State, UnheldCause, LastFailure } from "./state.ts";
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
  // `acceptedGraphChanges` is set only when this run accepted a change (see reconcileGraphPin
  // below), through the same spread `routedBy` uses — ADR-0023 §8's byte-identical-when-zero
  // guarantee.
  | { kind: "COMPLETE"; acceptedGraphChanges?: number }
  // `repeats`: how many consecutive times (state.LastFailure's field, computed by
  // sameFailureStreak below) this exact failure has just happened — always a real number here,
  // never carried over from an old record the way `state.last_failure.repeats` sometimes is,
  // because this Outcome is always built fresh off a live gate verdict.
  | { kind: "RETRY"; phase: string; attempt: number; maxAttempts?: number; failure: FailureInfo; repeats: number }
  | { kind: "ESCALATE"; reason: string }
  | { kind: "ABORT"; reason: string }
  // Constructed only by the lap below (the `ready` probe, short-circuited before the gate
  // runs — same treatment as the phase-missing guard). step() never produces this: it stays
  // pure and clock-free, with no I/O and no shell probe of its own.
  | { kind: "PENDING"; phase: string; ready: string };

// The global ceiling: a wall the run stops in front of, not an ending — ADR-0017's Decision and
// Context ("only the global ceiling can fire on a run doing nothing wrong") state this in the
// same words, the reason string's wording and the workflow_path-keeps-this-pure fact included.
// The ESCALATE arm of Outcome, named because checkIterationLimit only ever produces that one
// and the caller reads its `reason` (the wider union has arms without one). Same idiom as
// ResolvedRoute above: narrow the type rather than make the call site re-check what it knows.
export type CeilingOutcome = Extract<Outcome, { kind: "ESCALATE" }>;

// The three exported entry points below are TOTAL: every input either produces an answer or
// is refused by name. That is deliberate, and it is what makes them safe to export.
// ADR-0018's "What this is not about" section, in the same words, names the specific edges
// this closed (a completed run reported as still open, a finished run judged again, a
// still-running run called aborted, a missing phase dying on a raw TypeError), why they were
// unreachable before the seam moved yet worth closing anyway, and why the three stay exported.
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

// --- reading the last drive off a run record (ADR-0027) ---
//
// `status`'s ONLY window onto `last_drive`, and it takes ONLY `at` — never `session`. That is
// what keeps the identifier from ever reaching render.ts: this function's return type makes
// printing one impossible, rather than merely a rule callers have to remember. The tolerance
// is the same shape recordedLastStop just above uses, and for the same reason: anything that
// is not a well-formed `{ session: non-empty string, at: string }` reads as "nothing to
// report" — missing (a run started before this field existed) and malformed (a hand-edited
// record) are indistinguishable to a reader, and both must mean silence rather than a crash on
// the one command whose whole promise is that it is safe to run while diagnosing.
function recordedLastMoved(state: State): string | null {
  const recorded: unknown = state.last_drive;
  if (typeof recorded !== "object" || recorded === null || Array.isArray(recorded)) return null;
  const { session, at } = recorded as { session?: unknown; at?: unknown };
  if (typeof session !== "string" || session.length === 0) return null;
  if (typeof at !== "string" || at.length === 0) return null;
  return at;
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
  // One line, no embedded newline — ADR-0017's own parenthetical on this exact reason string:
  // it is the tail of ESCALATE's line-1 token line and one `.headsign/log` record, and a
  // newline would split both in two.
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
// by the caller into one destination. The string form is unaffected by any of this —
// ADR-0011's Consequences: "entirely unaffected: same routing, same stdout, same log line."
function passTarget(onPass: string | Route[], route?: ResolvedRoute): { to: string; routedBy?: { when: string } | { default: true } } {
  if (typeof onPass === "string") return { to: onPass };
  // Can't happen through the lap below (it resolves whenever on_pass is a list). Throwing
  // beats guessing a phase: an unrouted k-way pass has no defensible destination.
  if (route === undefined) throw new Error("step: on_pass is a route list but no resolution was given");
  return route.kind === "matched" ? { to: route.to, routedBy: { when: route.when } } : { to: route.to, routedBy: { default: true } };
}

// How many times in a row, ending with the failure just handed in, the exact same failure has
// landed: same phase, same check name, same `run:` text, same exit_code, same output_tail.
// `run:` is in the comparison because the line this feeds says "same check", and a check whose
// command was edited mid-run is not the same check even when its name and output are — a
// changed `run:` is a changed rule, which the graph pin reports separately. Its timeout is left
// out: it cannot change without `run:`'s own phase entry changing too, and a failure that
// timed out already says so through `exit_code`.
// Compared here and not in gate.ts: gate.ts only ever answers whether ONE run passed, and
// giving it a memory of the run before it would blur that boundary. Never asserts the gate
// CANNOT pass — that would need running an arbitrary shell to know, which is exactly the
// question this function is not answering; it only counts what already happened.
function sameFailureStreak(prev: LastFailure | null, phaseName: string, failure: FailureInfo): number {
  if (
    prev === null ||
    prev.phase !== phaseName ||
    prev.check !== failure.check ||
    prev.run !== failure.run ||
    prev.exit_code !== failure.exitCode ||
    prev.output_tail !== failure.outputTail
  ) {
    return 1;
  }
  // `prev.repeats ?? 1`: the same tolerant read `elapsed_seconds` uses, for the same reason —
  // a record written before this field existed simply lacks it, and an absent count on a
  // failure that otherwise matches is read as "that one was the first", not as damage.
  return (prev.repeats ?? 1) + 1;
}

// step() is fully deterministic: same (workflow, state, gateResult, route) always yields the
// same output — no clock, no randomness. The shell work behind `route` happened in gate.ts
// before the call; this function only reads the answer.
//
// `gateResult` is a GateVerdict, not a GateResult, the same way ResolvedRoute above excludes
// an unresolvable route: ADR-0021 §3's "never handed a non-answer" guarantee, kept by the
// type rather than a comment asking the caller to remember it.
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
  // step() runs only on a real gate evaluation — ADR-0006's loop-guard reset rule — so it
  // clears the Stop hook's nudge counter unconditionally here.
  next.stop_nudges = 0;

  if (gateResult.kind === "pass") {
    // The only place an attempt count is ever cleared — leaving the phase without passing
    // does not touch it. `.headsign/notes/what-headsign-protects.md` #13.
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
  const { check, run, exitCode, outputTail, timeoutSeconds, elapsedSeconds } = gateResult;
  const failure: FailureInfo = { check, run, exitCode, outputTail, timeoutSeconds, elapsedSeconds };
  // Computed once, ahead of both branches below that can use it (exhaustion and retry): it
  // reads `state.last_failure`, which the exhaustion branch is about to null out, so it has to
  // run before that happens either way.
  const repeats = sameFailureStreak(state.last_failure, phaseName, failure);

  const maxAttempts = phase.max_attempts;
  // Exhaustion always escalates — ADR-0014 §2's "spent budget is the canonical moment to ask
  // [a person]," not a workflow author's call to make at authoring time.
  if (maxAttempts !== undefined && next.attempts[phaseName] >= maxAttempts) {
    // `repeats >= 2` is a deliberate floor: at max_attempts=1 the streak is trivially "1 in a
    // row" on the very first-ever failure, which has nothing before it to repeat, and reporting
    // it as a repeated failure would misreport a plain single failure as one. Above that floor,
    // the streak can only reach `maxAttempts` here, never pass it — attempts and repeats grow
    // together while every failure keeps matching (see sameFailureStreak) — so `repeats >=
    // maxAttempts` means every attempt since the last pass shared one (phase, check, exit_code,
    // output_tail) signature. `repeats`, not `maxAttempts`, is what the sentence counts: the two
    // are equal in the ordinary case, but `repeats` is the number the record actually supports.
    const reason =
      repeats >= 2 && repeats >= maxAttempts
        ? `${phaseName}: max_attempts (${maxAttempts}) exhausted — ${repeats} attempts in a row failed the same check with the same output`
        : `${phaseName}: max_attempts (${maxAttempts}) exhausted`;
    next.last_failure = null;
    next.end_reason = reason;
    next.status = "escalated";
    return { state: next, outcome: { kind: "ESCALATE", reason } };
  }

  const onFail = phase.on_fail ?? "retry";
  if (onFail === "retry") {
    // Recorded purely for `status` to read back — ADR-0004: "status is its only reader."
    next.last_failure = {
      phase: phaseName, check: failure.check, run: failure.run,
      exit_code: failure.exitCode, output_tail: failure.outputTail, timeout_seconds: failure.timeoutSeconds,
      elapsed_seconds: failure.elapsedSeconds, repeats,
    };
    return { state: next, outcome: { kind: "RETRY", phase: phaseName, attempt: next.attempts[phaseName], maxAttempts, failure, repeats } };
  }

  next.last_failure = null;
  if (onFail === "$end") {
    next.status = "complete";
    return { state: next, outcome: { kind: "COMPLETE", ...graphChangeNote(next) } };
  }
  // `escalate` is the only end-the-run token on the failure path — ADR-0014 §3. ABORT is never
  // a verdict this function reaches; only `headsign abort`, a person's own action, produces it.
  if (onFail === "escalate") {
    const reason = `${phaseName}: gate failed (on_fail: escalate)`;
    next.status = "escalated";
    next.end_reason = reason;
    return { state: next, outcome: { kind: "ESCALATE", reason } };
  }

  next.phase = onFail;
  return { state: next, outcome: { kind: "ADVANCE", phase: onFail, description: describePhase(workflow, onFail), failure: { ...failure, routedTo: onFail } } };
}

// --- the five operations on a run, and what they answer with (ADR-0018) ---

// Every operation below used to end by building text and printing and exiting directly; each
// now hands its answer back instead, refusals included — ADR-0018 §3's own words, stated once
// there rather than restated here.
export type Refused = { kind: "REFUSED"; message: string };

// Kept apart from REFUSED because the two print differently and always did — ADR-0018 §3.
// Only the two operations that load a workflow (`start`, `next`) can produce it.
export type WorkflowInvalid = { kind: "WORKFLOW_INVALID"; workflowPath: string; errors: string[] };

export type Rejection = Refused | WorkflowInvalid;

// A load that succeeded but had something to say — ADR-0011 §6 says who prints warnings and
// why not on every lap of `next`'s hot path.
export interface LoadWarnings { workflowPath: string; warnings: string[] }

export interface StartResult {
  // Reported before whatever `result` says, because that is the order `start` printed them
  // in when it lived in cli.ts: the load's warnings reach stderr even when the start is then
  // refused because a run is already in progress. Null when there were none — and also when
  // the workflow did not load at all, which is the one case `start` never warned about.
  warnings: LoadWarnings | null;
  result: Rejection | { kind: "STARTED"; phase: string; description: string; cleared: string[]; notCleared: string[] };
}

export type NextResult =
  | Rejection
  // One lap's answer. `workflowName` is what a COMPLETE prints as the finished workflow, and
  // it comes from two different places on purpose: a terminal reprint uses the name recorded
  // in state.json (the workflow file may not even have been read), a real evaluation uses the
  // loaded workflow's own name. `wf`, `cleared` and `notCleared` are render extras the Outcome
  // deliberately doesn't carry: the workflow resolves a PENDING phase's description, and
  // `cleared`/`notCleared` are only ever set alongside an ADVANCE.
  | { kind: "ANSWERED"; outcome: Outcome; workflowName: string; wf?: Workflow; cleared?: string[]; notCleared?: string[] };

export type AbortResult = Refused | { kind: "ABORTED"; reason: string };

export type ClaimResult = Refused | { kind: "CLAIMED" };

// The current phase's last recorded failure, field-renamed out of state.json's snake_case
// into the shape render.ts prints. Reading the run record is this module's job; knowing that
// `output_tail` is called `outputTail` on the way out is part of it.
// `elapsedSeconds` is optional for the one reason state.ts's `LastFailure.elapsed_seconds`
// documents (see there): this type is only ever built from a stored `last_failure`, never
// fresh, so a record predating that field restores as one with no `elapsedSeconds`.
export interface StatusFailure { check: string; run: string; exitCode: number | "timeout"; timeoutSeconds?: number; elapsedSeconds?: number; outputTail: string }

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
      // Whether anyone has claimed this run — never who: ADR-0013 §4 is why the CLI can only
      // state that fact, never judge who is reading. Worded by cli.ts, not here.
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
      // When this run was last MOVED — `start`ed, or reached by a `next` (ADR-0027 §7) — never
      // who moved it: `recordedLastMoved` returns only the timestamp, so the session id cannot
      // travel any further than this module even by accident. null when no drive has been
      // recorded (a run predating this field, or one with a malformed record) — cli.ts prints
      // no line for either, the same treatment `lastStop` gets above.
      lastMoved: string | null;
      // Whether HEADSIGN_OBSERVER is set in the environment `status` was called with — ADR-0025
      // §6: the one quiet-ending cause a caller can answer about itself.
      observer: boolean;
      // The graph pin as an observation — ADR-0023 §8's two lines. Read-only like everything
      // else here: reconciling can WRITE, and looking must stay free (protects #12).
      acceptedGraphChanges: number;
      graphChangeReported: boolean;
      // The current phase's instruction, the same field `start`/`next` print — undefined
      // exactly when `attemptUnknown` is true, since both come from the same lookup (`phase`
      // below): the workflow could not be read, or no longer defines this phase. render.ts
      // decides nothing about when to show it; it prints the block only when this is present.
      description?: string;
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
  // headsign self-manages these entries — ADR-0004's start/abort details section states why.
  const gitignorePath = path.join(cwd, ".headsign", ".gitignore");
  const original = readFileOrEmpty(gitignorePath);
  let content = original;
  for (const entry of ["state.json", "lock", "log", "tmp/"]) {
    if (content.split("\n").some((l) => l.trim() === entry)) continue;
    const sep = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
    content = `${content}${sep}${entry}\n`;
  }
  if (content !== original) fs.writeFileSync(gitignorePath, content);
}

// Sorts the relative paths named in `clear:` into the two the caller has a line for. `cleared`
// is the ones that held a non-empty file — worth announcing to the agent so a silently-vanished
// artifact from a previous pass doesn't go unnoticed for a whole extra cycle. `notCleared` is
// the ones `rmSync` will refuse, which is directories and only directories: `clear:` removes
// files, and a directory named here was never going anywhere, so this function says so rather
// than leaving the silence a swallowed EISDIR leaves. An empty file and a path that never
// existed are in neither list — nothing worth announcing happened to them.
//
// The two questions are asked of two different views on purpose, because they are about
// different things. "Was there a non-empty artifact here" is about what the path RESOLVES to,
// so it follows a symlink (`statSync`) — a link to a real artifact is an artifact, and its
// removal is worth the same line as the file's would be. "Will rmSync refuse this" is about the
// path ITSELF, so it must not follow (`lstatSync`), because that is the view rmSync uses to
// decide: a symlink pointing at a directory is unlinked like any other link, and classifying it
// off the resolved target printed a line saying a directory had been left alone while the link
// was already gone. Two false claims in one line, in the field this reporting exists to stop
// being silent about (`what-headsign-protects` #3, #4).
//
// What neither list claims is that the removal succeeded. A file `rmSync` cannot remove for
// some other reason — a permission, a read-only filesystem — is still reported as cleared, as
// it was before any of this reporting existed. Confirming the removal is a different check from
// classifying what was found, and this function does the second.
function clearPhaseArtifacts(cwd: string, phase: workflowMod.Phase): { cleared: string[]; notCleared: string[] } {
  const cleared: string[] = [];
  const notCleared: string[] = [];
  for (const rel of phase.clear ?? []) {
    const full = path.join(cwd, rel);
    let heldNonEmptyFile = false;
    let rmWillRefuse = false;
    try {
      const resolved = fs.statSync(full);
      heldNonEmptyFile = resolved.isFile() && resolved.size > 0;
    } catch {
      // ENOENT (or a dangling symlink): nothing resolving here to announce.
    }
    try {
      rmWillRefuse = fs.lstatSync(full).isDirectory();
    } catch {
      // ENOENT: nothing there at all.
    }
    // Best-effort: force suppresses ENOENT. Any rmSync error past that (a directory's EISDIR
    // included) is still ignored here so a bad `clear` entry never wedges a transition — the
    // classification above, not this catch, is what tells the caller what happened.
    try { fs.rmSync(full, { force: true }); } catch { /* best effort */ }
    if (heldNonEmptyFile) cleared.push(rel);
    else if (rmWillRefuse) notCleared.push(rel);
  }
  return { cleared, notCleared };
}

// The value ADR-0027 §4/§5 stamps at `start` and every `next` that reaches the run: the
// session `stophook.resolveDriveSession` names, or null if none does (a run driven from
// outside Claude Code, or its one env var absent for any other reason — named nowhere in this
// file; stophook.ts's `resolveDriveSession` is where its name lives, per ADR-0027 §2.1's "one
// source" and the comment there explaining why). One function so `start`'s and `next`'s stamps
// can never compute this differently — the point of one source for the stamp is one answer,
// not two call sites that happen to agree today. Calls stophook.ts rather than reading `env`
// itself: this module never reaches for `process.env` (see the header comment), and the fact
// that the env value and a Stop payload's `session_id` agree for a session's own stop is a
// claim that must live in exactly one place (stophook.ts's `resolveDriveSession`) for the
// comparison stophook.ts makes against this value to mean anything.
function driveStamp(env: NodeJS.ProcessEnv, nowIso: string): State["last_drive"] {
  const session = stophook.resolveDriveSession(env);
  return session === null ? null : { session, at: nowIso };
}

export function start(cwd: string, workflowPath: string, nowIso: string, env: NodeJS.ProcessEnv): StartResult {
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

  // A new run always begins undelegated — ADR-0013: the CLI cannot learn who is running it at
  // agent granularity. Until claimed, both hooks nudge whoever stopped — ADR-0008's
  // Consequences, "behaves exactly as it did before this ADR."
  const freshState: State = {
    workflow: wf.name, workflow_path: workflowPath, status: "running", phase: wf.entry,
    attempts: {}, total_iterations: 0, last_failure: null, end_reason: null, stop_nudges: 0,
    driver_agent: null,
    // No stop has been processed yet, and `start` must not invent one: the field is written only
    // by the stop-boundary hooks, at a stop they actually saw.
    last_stop: null,
    // Beside `last_stop`, never inside it (state.ts's `last_drive` doc): this answers who
    // DROVE the run — ran the command — a different question from what happened at a turn
    // end, and answered every time regardless (ADR-0027 §5). null is the ordinary value for a
    // run started outside Claude Code, not damage.
    last_drive: driveStamp(env, nowIso),
    // The pin is taken here and nowhere else at run start: from the entry phase, because that
    // is where the run is about to stand and the fingerprint covers what is reachable from
    // where it stands. Nothing is outstanding and nothing has been accepted yet.
    graph_fingerprint: workflowMod.graphFingerprint(wf, wf.entry),
    graph_change_reported: null,
    accepted_graph_changes: 0,
  };
  state.writeState(cwd, freshState);
  ensureHeadsignGitignored(cwd);
  // Record the run's first transition — ADR-0024: the log is never cleared here, appended
  // only, and survives a restart. This `start` line is what marks where the new run begins.
  state.appendLog(cwd, render.logLine(nowIso, { kind: "START", workflow: wf.name }, freshState));
  // Every run starts with a clean scratch dir — ADR-0004's start/abort details section.
  const tmpDir = path.join(cwd, ".headsign", "tmp");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  const { cleared, notCleared } = clearPhaseArtifacts(cwd, wf.phases[wf.entry]);
  return { warnings, result: { kind: "STARTED", phase: wf.entry, description: wf.phases[wf.entry].description, cleared, notCleared } };
}

// One lap of `headsign next`: read the record, check the run is still going, load the
// workflow, take the lock, re-read, check again, evaluate, release, answer. The order is the
// point — it is the part of ADR-0002's transition table that a table cannot draw — and so is
// the fact that every question that could refuse does so before anything is written.
export function next(cwd: string, nowIso: string, env: NodeJS.ProcessEnv): NextResult {
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

  // Everything from here to the `finally` runs under the lock, release structural rather than
  // remembered — ADR-0018 §4's "one acquire... cannot skip it," restated here at the call site.
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

    // No DRIVER stamping here — ADR-0013: next's old env-based stamp named the wrong party
    // whenever a delegated agent called it. Ownership changes only via the SubagentStop
    // adoption gate. The stamp just below is last_drive, answering a different question
    // (ADR-0027 §4).

    if (fresh.status !== "running") return { kind: "ANSWERED", outcome: terminalOutcome(fresh), workflowName: fresh.workflow };

    // Stamp who ran this lap (ADR-0027 §5): the two commands a driver runs, `start` and every
    // `next` that reaches this point, record who ran them — including PENDING and the global
    // ceiling below, neither of which writes anything else to state.json. Skipping either
    // would switch the backstop off during the one wait it exists to cover (a review in
    // progress is exactly when somebody walks away).
    //
    // Written HERE, once, immediately after the last check that can refuse without reaching the
    // run — and threaded into evaluateNext as `current` rather than left for that function's
    // own writeState calls to preserve — because that is what stamps every path below
    // (PENDING, the ceiling, a graph-change report, gate-unrunnable and route-error REFUSEDs,
    // ADVANCE/RETRY/COMPLETE/ESCALATE) without an exception list: every one of those either
    // writes no state of its own, or spreads `...current` into whatever it does write, so the
    // stamp rides along either way. A REFUSED reached before this line (no run, the lock held,
    // an invalid workflow) never had the run's own record in hand to begin with, which is why
    // none of them stamp anything (ADR-0027 §3's list of what does not reach the run).
    //
    // The write condition mirrors ADR-0027 §5's "record what there is to record OR clear a
    // stale record" rule directly: a resolvable session always writes, an unresolvable one
    // still writes when the disk holds an old stamp (an unnamed `next` is itself a real
    // "somebody drove this" event, and leaving a stale name on it would keep a backstop pointed
    // at a party that is no longer the one moving the run — ADR-0027 §5 explains why clearing,
    // not keeping, is the safe direction), and only a null-to-null pair skips the write, so a
    // run driven entirely outside Claude Code never gets an unexplained state.json write.
    const drive = driveStamp(env, nowIso);
    const diskDrive = fresh.last_drive ?? null;
    const stamped: State = drive !== null || diskDrive !== null ? { ...fresh, last_drive: drive } : fresh;
    if (stamped !== fresh) state.writeState(cwd, stamped);

    return evaluateNext(cwd, wf, stamped, nowIso);
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
// One line, no embedded newline, for the reason ADR-0017's own ceiling-reason parenthetical
// gives: the tail of ESCALATE's token line and one `.headsign/log` record.
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

  // The graph pin's position is the whole of it — ADR-0023 §4's own words: "Check the graph
  // before using the graph," after the phase-missing guard and before everything that reads a
  // rule.
  const pin = reconcileGraphPin(cwd, wf, incoming, nowIso);
  if (pin.kind === "REPORT") return { kind: "ANSWERED", outcome: pin.outcome, workflowName: wf.name, wf };
  const current = pin.state;

  // The ceiling — ADR-0017's Decision, stated here at the call site: ESCALATE with no
  // writeState, short-circuited before the gate so standing at the wall costs no iteration.
  const limitOutcome = checkIterationLimit(wf, current);
  if (limitOutcome) {
    // Logged as `ceiling`, not `escalate`, and repeated calls repeat the line — ADR-0004's log
    // section states both in the same words. `current` is passed unchanged because nothing was
    // written; the line reports what's on disk, same as every other log line does.
    state.appendLog(cwd, render.logLine(nowIso, { kind: "CEILING", reason: limitOutcome.reason }, current));
    return { kind: "ANSWERED", outcome: limitOutcome, workflowName: wf.name, wf };
  }

  const phase = wf.phases[current.phase];
  // Ready probe: before the gate, answering without judging — ADR-0002's transition-table
  // note: uncounted, state.json untouched on this path. "stay put, don't count it," the cell
  // the table was missing.
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
  // A check that produced no exit code refuses exactly like an unresolvable route below —
  // ADR-0021 §2's own words: nothing written, so "run `headsign next` again" is honest advice,
  // not a resumption mid-transition.
  if (gateResult.kind === "unrunnable") {
    const what = `the gate check '${gateResult.check}' (\`${gateResult.run}\`)`;
    return { kind: "REFUSED", message: unrunnableMessage(current, what, gateResult.reason) };
  }

  // k-way `on_pass` (ADR-0011 Decision 1): resolved after the gate passed, never on the
  // failure path, so the transition function stays free of shell execution.
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
  let notCleared: string[] | undefined;
  if (outcome.kind === "ADVANCE") ({ cleared, notCleared } = clearPhaseArtifacts(cwd, wf.phases[outcome.phase]));
  state.writeState(cwd, nextState);
  state.appendLog(cwd, render.logLine(nowIso, outcome, nextState, current.phase));
  return { kind: "ANSWERED", outcome, workflowName: wf.name, wf, cleared, notCleared };
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

// Arms the driver-adoption marker — ADR-0009's two-beat claim procedure, re-homed onto
// SubagentStop by ADR-0010. Writes nothing to state.json: the CLI cannot resolve identity at
// agent granularity, only the hook's own stdin can.
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
// this module reaching for process.env — which nothing below cli.ts does. It was the first
// thing outside the hook path to need one, so it followed the existing shape instead of
// inventing one; `start` and `next` follow the same shape now, for the `last_drive` stamp
// (ADR-0027).
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
      ? {
          check: recorded.check, run: recorded.run, exitCode: recorded.exit_code,
          timeoutSeconds: recorded.timeout_seconds, elapsedSeconds: recorded.elapsed_seconds, outputTail: recorded.output_tail,
        }
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
    lastMoved: recordedLastMoved(current),
    observer: stophook.isObserver(env),
    acceptedGraphChanges: acceptedGraphChanges(current),
    graphChangeReported: recordedGraphMarker(current) !== null,
    description: phase?.description,
  };
}
