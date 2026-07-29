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
//   - nothing here reads the clock. A timestamp arrives as an argument (`nowIso`), the shape
//     stophook.ts already uses across this same boundary, so the same inputs produce
//     byte-identical log lines and a test can assert a whole line.

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
import type { Workflow, Route } from "./workflow.ts";
import type { State } from "./state.ts";
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
  | { kind: "COMPLETE" }
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
  if (state.status === "complete") return { kind: "COMPLETE" };
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
      return { state: next, outcome: { kind: "COMPLETE" } };
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
    return { state: next, outcome: { kind: "COMPLETE" } };
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
  };
  state.writeState(cwd, freshState);
  ensureHeadsignGitignored(cwd);
  // The log is run-scoped: truncate/create it fresh so a previous run's history never
  // bleeds into this one, then record the run's first transition.
  state.initLog(cwd);
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

// The real evaluation (phase-missing guard, iteration limit, ready probe, gate,
// step/writeState), run while next() holds the lock. Private, and reachable only from behind
// that guard sequence: nothing here re-checks that the run is still going, because the only
// caller has just done it against a fresh read.
function evaluateNext(cwd: string, wf: Workflow, current: State, nowIso: string): NextResult {
  if (!wf.phases[current.phase]) {
    return {
      kind: "REFUSED",
      message:
        `workflow '${current.workflow_path}' no longer defines phase '${current.phase}', which this run is currently on. ` +
        `Restore that phase in the workflow file, or run \`headsign abort <reason>\` to end this run.`,
    };
  }

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
export function status(cwd: string): StatusResult {
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
  };
}
