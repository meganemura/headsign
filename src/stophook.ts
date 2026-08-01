// Responsibility: stop-boundary hook decisions — stdin JSON -> allow/block (ADR-0006).
// Two events, ONE identifier space (ADR-0013): only SubagentStop's `agent_id` can name a
// driver, so `evaluateSubagent` is the only half that compares identifiers at all.
// `evaluate` answers Stop, which carries a session id headsign no longer records anywhere —
// it decides on run state alone. They share this module so the run lookup, the exit-note
// gate and the loop guard can be literally the same code for both boundaries.
// It takes the LOCK before every write and re-reads the record under it, and if the lock is
// held it changes nothing and lets the turn end. A write here replaces the whole record, and
// `next` holds the lock across a lap that can run a gate for seconds, so a hook that wrote
// from a pre-lock read would erase that lap's transition and its attempt increment.
// The directory is the ONE exception to headsign's cwd-only rule, and deliberately so: these
// hooks fire wherever a turn happened to end, so they walk UP from the directory they are
// given to find a run, stopping at the enclosing repo or worktree root (ADR-0006). Every
// other module works only in the directory it is handed.
// A second starting point (ADR-0026) is tried ONLY when that walk finds nothing: Claude Code's
// `CLAUDE_PROJECT_DIR`, read from the same env argument HEADSIGN_OBSERVER already comes from.
// It never changes a case that has an answer today — the walk still runs first, unchanged — and
// on a hit it never blocks: it runs the same free checks the ordinary path does (the record is
// running, the stop could belong to it), then writes one `unheld` line with `cause:
// "CLAUDE_PROJECT_DIR"` and returns. See fallbackUnheld below for the one thing that differs
// between the two hooks on this path.
// It WRITES, which "allow/block" does not suggest and a caller should not have to discover:
// a stop that is let through because a pause note was found consumes that note, resets the
// nudge counter and logs `paused`; a stop that is blocked increments the counter and logs
// `held`, except the one that trips the cap, which logs `stalled` in its place; and a sealed
// claim writes the driver into the run's record and logs `claimed`. The decision is the
// return value, but it is never the only effect.
// It also stamps `last_stop` on EVERY stop it processes and can attribute — a nudge, an
// `unheld` pass, a pause, and the pass that happens because the cap is spent — so that a reader
// of `headsign status` is never handed a value from a stop older than the last one. A field
// written only on passes would still read "not held" long after a later nudge, which is exactly
// the misreading `stop_nudges: 0` produced for the report that asked for this. Never stamped
// where headsign cannot attribute the stop or cannot write: HEADSIGN_OBSERVER, unparseable
// input, no run found, a non-`running` run, a bystander's stop, or a held lock.
//
// TWO GUARANTEES ABOUT THE ALREADY-CONTINUING FLAG, for whoever next reorders these steps.
// When Claude Code sets `stop_hook_active` on a hook's input, the turn it belongs to is one
// headsign has already been overruled on, and so:
//   1. it is NEVER blocked, and
//   2. it NEVER spends a one-shot resource — the pause note, the claim marker.
// One single action violates both at once, which is why it governs the placement below:
// consuming `.headsign/tmp/claim` seats a driver AND blocks. "The already-continuing flag" is
// the name for Claude Code's mechanism throughout this file, never "the loop guard" — that is
// headsign's own name for `stop_nudges` (ADR-0006), and the two are sibling mechanisms whose
// observable outcome is identical (a stop that passes quietly), which is precisely the pair a
// reader has to be able to tell apart.
//
// Nothing here reads the clock or the environment: both arrive as arguments, the shape
// render.ts and engine.ts also use. And the payload is not trusted to be JSON — an empty
// string is an ordinary input (it is what the CLI passes when nothing was piped) and anything
// unparseable answers "allow", because a hook that cannot read its input must never be the
// reason a turn cannot end.
// Must NOT know about: workflow.yaml, gate execution.

import fs from "node:fs";
import path from "node:path";
import { readState, writeState, statePath, appendLog, acquireLock, releaseLock } from "./state.ts";
import type { State, UnheldCause } from "./state.ts";
import { logLine } from "./render.ts";
import type { LogEvent } from "./render.ts";

interface HookDecision {
  block: boolean;
  message?: string;
}

const MAX_STOP_NUDGES = 5;

// Manual opt-out (ADR-0008) for a session or agent that is not driving this run — or simply
// wants to be unconditionally exempt. Any non-empty value passes both stop-boundary hooks —
// a session that opts out is opting its delegated agents' stops out too — regardless of
// driver ownership; the value itself is never inspected, presence is the whole signal
// (documented as `=1`). This lived in its own module while the environment was also where a
// session identifier came from; ADR-0013 removed that path, and reading one env var did not
// earn a module boundary of its own.
// It has a second caller now — engine.ts's `status`, for the one line that reports the switch
// (ADR-0025) — and it stays here rather than moving somewhere neutral on purpose: what the
// switch MEANS is "these turn ends are never held", which is a fact about these hooks. A
// reporting line that resolved the switch by its own rule could drift into announcing an
// opt-out the hooks do not act on, and the reader would have no way to tell which was wrong.
export function isObserver(env: NodeJS.ProcessEnv): boolean {
  const raw = env["HEADSIGN_OBSERVER"];
  return typeof raw === "string" && raw.length > 0;
}

// The recorded driver, read the tolerant way every consumer of state.json reads its
// fields: a bare `!== null` check would not do, because a legacy state.json carries the old
// `driver_session` name and this field reads back as undefined — and `undefined !== null`
// is true, which would send a run nobody claimed down the "someone is driving" path,
// silently ending the backstop for that run.
//
// Tolerating a *missing* field is transitional, not permanent: state.ts's driver_agent
// declaration is where the criterion for deleting it is written. Tolerating a non-string
// value is permanent (a hand-edited state.json is always possible), so only the
// missing-field case goes when that day comes.
function recordedDriver(state: State): string | null {
  return typeof state.driver_agent === "string" && state.driver_agent.length > 0 ? state.driver_agent : null;
}

// The agent's own identifier, never an env-derived fallback: every env identifier describes the
// enclosing session, not this agent, so falling back to one would seal the wrong identity —
// exactly the confusion this hook exists to end (and why ADR-0013 deleted the env path rather
// than leaving it as a tempting second source).
// A function rather than two inline expressions because evaluateSubagent resolves it twice, on
// two branches that must agree: a flagged turn end and an ordinary one have to name the same
// agent, or the `unheld` line would be attributed by a rule the nudge does not use.
function resolveAgentId(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}

type StopDisposition = NonNullable<State["last_stop"]>["disposition"];

// The record half of "what happened at the last stop". Always applied to the record read INSIDE
// the lock, and returned for the same write that appends the line, so the field and the log can
// never disagree about one event. `cause` is passed only by the two `unheld` writers below —
// every other disposition has nothing upstream to name (state.ts's `last_stop` doc) — and its
// absence must produce an object with no `cause` key at all, not one holding `undefined`: a
// caller that compares the written record against a literal without the key (every existing
// last_stop assertion outside `unheld`) would otherwise see two different shapes.
function withLastStop(fresh: State, disposition: StopDisposition, nowIso: string, cause?: UnheldCause): State {
  return { ...fresh, last_stop: cause !== undefined ? { disposition, at: nowIso, cause } : { disposition, at: nowIso } };
}

// The whole body of both hooks' `unheld` writers — the flagged branches AND the CLAUDE_PROJECT_DIR
// fallback (ADR-0026) — stamp the record, write the line, let the turn end. It reads nothing
// else and consumes nothing — no pause note, no claim marker — which is guarantee 2 of the two
// at the top of this file. Fail-open is unchanged from every other write here: a lock that
// cannot be had means somebody is judging the run right now, so nothing is written and the turn
// still ends. A missing line therefore never proves the hook did not run.
function recordUnheld(runDir: string, nowIso: string, cause: UnheldCause): HookDecision {
  withRunLock(runDir, (fresh) => ({ state: withLastStop(fresh, "unheld", nowIso, cause), log: stamped(nowIso, { kind: "UNHELD", cause }) }));
  return { block: false };
}

// Walk up from startDir to find a run's .headsign/state.json, bounded by the enclosing
// git worktree/repo root: stop at (and including) the first directory containing a `.git`
// entry (a directory in a normal checkout, a FILE in a linked worktree). This lets the
// backstop fire from any subdirectory of the run's project, while never crossing a worktree
// boundary into a sibling/parent checkout — which is why the rest of headsign stays cwd-only.
// fs only: the hook fires on every session stop and must not pay for a git subprocess.
function findRunDir(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(statePath(dir))) return dir;
    if (fs.existsSync(path.join(dir, ".git"))) return null; // repo/worktree root, no run here — stop
    const parent = path.dirname(dir);
    if (parent === dir) return null; // filesystem root
    dir = parent;
  }
}

// The second starting point (ADR-0026): reached only from the branch that today returns having
// found no run, so it can only turn silence into a line — it never changes a case that already
// has an answer. Reuses findRunDir rather than a bare statePath check so a project root without
// its own `.headsign/` still walks no further than the ordinary bound (the first `.git` it
// meets, which a documented project root has); the two candidate directories differ, the rule
// for turning a directory into a run does not.
//
// `shouldAttribute` is the one thing that differs between the two hooks, and mirrors the test
// each already runs on the ordinary path below: Stop's recorded-driver test (a claimed run's
// Stop can never be its driver's), SubagentStop's driver match (only a positive match may be
// attributed, since most subagent stops belong to reviewers, searchers and workers with no
// headsign role at all). Everything else is identical and deliberately minimal: read the
// record, confirm it is running, and either write the line or write nothing — never open the
// pause note, never touch the claim marker, never increment stop_nudges, and never read
// `stop_hook_active` (guarantee 2 holds by construction on a path that can never block).
function fallbackUnheld(env: NodeJS.ProcessEnv, nowIso: string, shouldAttribute: (state: State) => boolean): HookDecision {
  const claudeProjectDir = env["CLAUDE_PROJECT_DIR"];
  if (typeof claudeProjectDir !== "string" || claudeProjectDir.length === 0) return { block: false };
  const runDir = findRunDir(claudeProjectDir);
  if (!runDir) return { block: false };
  const state = readState(runDir);
  if (!state || state.status !== "running") return { block: false };
  if (!shouldAttribute(state)) return { block: false };
  return recordUnheld(runDir, nowIso, "CLAUDE_PROJECT_DIR");
}

// Both exits (pause via note, or end for good via abort) are named on every block, not only
// the last one, so a human who wants out never has to hunt for how. Depends only on
// runDir/startDir, so both hooks' adoption/nudge messages can share the identical wording.
function pauseAndAbortHint(runDir: string, startDir: string): string {
  const notePathForMessage = runDir === startDir ? ".headsign/tmp/stop-note" : `${runDir}/.headsign/tmp/stop-note`;
  return ` To pause, write one line explaining why to ${notePathForMessage} and stop again; to end the run for good, run \`headsign abort <reason>\`.`;
}

// The shared tail of both hooks, entered once the caller has stopped ruling the stopper out.
// The two callers set a different bar for that, on purpose: evaluateSubagent requires a
// positive match against the recorded driver, while evaluate only gets here on a run nobody
// has claimed — where headsign has no driver to prefer and nudges whoever stopped (ADR-0006's
// fail-open default). Deliberately identical for Stop and SubagentStop (ADR-0010): how you
// pause, how many reminders you get, and what the nudge says must not depend on which
// stop-boundary event happened to deliver that fact.
// Every write this module makes goes through here, and the shape is the same each time: take
// the lock, RE-READ the record under it, apply the change to what was actually on disk, write,
// release — and if the lock cannot be had, change nothing and let the turn end.
//
// It was not always so, and the gap was real. `next` holds the lock across a lap that can run
// a gate for seconds, and these hooks fire whenever any turn ends in the same directory —
// which is the ordinary multi-session case headsign is built for, not an exotic one. A hook
// that read the record before that lap finished, changed one field and wrote the WHOLE record
// back (writes replace, they do not merge) would erase the lap's phase transition and its
// attempt increment. The lock protected `next` from `next` and from nothing else. A seam
// sweep of stophook.ts→state.ts is what asked whether a writer here must hold it.
//
// Failing open when the lock is held is not a compromise, it is the right answer twice over.
// Somebody holding the lock is somebody judging the run, so the run is being driven and needs
// no reminder; and a hook must never be the reason a turn cannot end.
function withRunLock(runDir: string, apply: (fresh: State) => { state: State; log?: LogEvent }): boolean {
  const lock = acquireLock(runDir);
  if (!lock.ok) return false;
  try {
    const fresh = readState(runDir);
    // Vanished, or ended, between the caller's read and this one: nothing here has anything
    // left to say about it.
    if (!fresh || fresh.status !== "running") return false;
    const { state: nextState, log } = apply(fresh);
    writeState(runDir, nextState);
    if (log) appendLog(runDir, logLine(nowIsoOf(log), log, nextState));
    return true;
  } finally {
    releaseLock(runDir);
  }
}

// The timestamp rides along with the event so `withRunLock` needs no fourth parameter; it is
// still the caller's value, read once in cli.ts, never a clock reached for here.
type StampedLogEvent = LogEvent & { __nowIso: string };
const stamped = (nowIso: string, event: LogEvent): StampedLogEvent => ({ ...event, __nowIso: nowIso }) as StampedLogEvent;
const nowIsoOf = (event: LogEvent): string => (event as StampedLogEvent).__nowIso;

function noteGateThenNudge(runDir: string, startDir: string, state: State, nowIso: string): HookDecision {
  // Exit-note gate (ADR-0006): the primary mechanism for a deliberate pause. Checked
  // before the nudge/loop-guard logic below, so a human (or agent) who wants out never
  // has to wait for or count nudges — writing one line and stopping again is immediate.
  const notePath = path.join(runDir, ".headsign", "tmp", "stop-note");
  if (fs.existsSync(notePath)) {
    const noteRaw = fs.readFileSync(notePath, "utf8");
    const trimmedNote = noteRaw.trim();
    if (trimmedNote.length > 0) {
      const firstLine = trimmedNote.split(/\r?\n/)[0].trim().slice(0, 120);
      // Consume the note INSIDE the lock, and only if the write lands: a note eaten while
      // another process was mid-lap would be a one-shot pause spent on nothing.
      const paused = withRunLock(runDir, (fresh) => {
        fs.rmSync(notePath, { force: true });
        const pausedState = withLastStop({ ...fresh, stop_nudges: 0 }, "paused", nowIso);
        return { state: pausedState, log: stamped(nowIso, { kind: "PAUSED", note: firstLine }) };
      });
      // Either the pause was recorded, or somebody is judging right now — both mean the turn
      // may end, and an unconsumed note simply pauses the next one instead.
      return { block: false };
    }
  }

  // Loop guard (ADR-0006): a safety net for the case where the agent can't even write a
  // stop-note (a stuck loop, or an agent that has silently departed). stop_nudges is reset
  // by anything that proves someone is still steering the run: `next`'s real gate
  // evaluations, the exit-note gate just above, and the adoption gate in evaluateSubagent.
  // Five consecutive nudges with none of those in between means nudging isn't working — fail
  // open rather than risk an unstoppable session. N=5 is an arbitrary safety value, not a
  // load-bearing constant.
  // ?? alone doesn't catch a non-null but wrong-type value (e.g. a corrupt/forged/legacy
  // state.json with stop_nudges as a string): "x" + 1 would string-concatenate to "x1",
  // which is always < 5, disabling the fail-open guard forever. Require an actual number.
  const nudges = typeof state.stop_nudges === "number" && Number.isFinite(state.stop_nudges) ? state.stop_nudges : 0;
  if (nudges >= MAX_STOP_NUDGES) {
    // The cap is spent, so this stop passes — and now says so in the record, on a path that
    // wrote nothing at all before. Still no log line, and now for two reasons rather than one:
    // `stalled` records the moment the guard tripped, which happened once and is not made truer
    // by repetition, and nothing held this stop, so there is no `held` line to write either.
    // Fail-open is exactly as it was: the write is best-effort, and a lock that cannot be had
    // changes nothing and lets the turn end.
    withRunLock(runDir, (fresh) => ({ state: withLastStop(fresh, "stalled", nowIso) }));
    return { block: false };
  }

  const nextNudges = nudges + 1;
  // Every nudge leaves a line, and the one that trips the cap writes `stalled` INSTEAD of
  // `held` rather than as well — one line per event, as it has always been. Nothing is lost by
  // that: `stalled`'s detail is already `nudges=5`, so a reader counting holds since the last
  // transition gets four `held` lines plus the `stalled`, which is five.
  // Silence on 1st-4th was the earlier rule, and it left the log with three of the record's
  // four dispositions — missing the most frequent one. What that cost was not one absent line
  // but two unreadable ones: `stalled` had no denominator (a cap can trip with no countable
  // hold anywhere), and an `unheld` line could not be read on its own, because the hold it
  // followed left nothing.
  // The disposition is `nudged` for all five, including the one that trips the cap: that stop
  // WAS held, and `stalled` is reserved for the stops afterwards that are not. The log line and
  // the field answer different questions — when the guard tripped, versus what happened to the
  // most recent turn end — and this is the one stop where those two answers differ.
  const counted = withRunLock(runDir, (fresh) => {
    const nudgedState = withLastStop({ ...fresh, stop_nudges: nextNudges }, "nudged", nowIso);
    const event: LogEvent = nextNudges === MAX_STOP_NUDGES ? { kind: "STALLED" } : { kind: "HELD", nudges: nextNudges };
    return { state: nudgedState, log: stamped(nowIso, event) };
  });
  // Nothing was counted because a lap is in progress: that lap is the proof somebody is
  // steering, which is exactly what a nudge exists to establish. Let the turn end.
  if (!counted) return { block: false };

  // `next`/`abort` stay strictly cwd-only (ADR-0004), so when the run was found via
  // walk-up (runDir !== startDir) the agent must be told where to cd first — cwd-only
  // `next` will not find the run from startDir itself.
  const verdictSentence =
    runDir === startDir
      ? `headsign workflow '${state.workflow}' is still running (phase: ${state.phase}). Run \`headsign next\` and follow its verdict.`
      : `headsign workflow '${state.workflow}' is still running (phase: ${state.phase}) in ${runDir}. cd there and run \`headsign next\`, then follow its verdict.`;
  // The final-reminder phrase rides only on the nudge that trips the cap: earlier nudges
  // must keep pushing `headsign next`, not dilute it with "this is your last chance".
  const finalNotice = nextNudges === MAX_STOP_NUDGES ? " This is the final automatic reminder." : "";
  return { block: true, message: verdictSentence + finalNotice + pauseAndAbortHint(runDir, startDir) };
}

export function evaluate(cwd: string, stdinRaw: string, nowIso: string, env: NodeJS.ProcessEnv): HookDecision {
  // Manual opt-out (ADR-0008): checked before stdin is even parsed, so a session that
  // knows it isn't driving this run passes through unconditionally, even if the hook
  // payload itself is malformed.
  if (isObserver(env)) return { block: false };

  try {
    // `session_id` is deliberately absent from this type (ADR-0013): Stop compares no
    // identifiers at all, so the field is not read, and naming it here would invite one.
    const input = JSON.parse(stdinRaw) as { stop_hook_active?: boolean; cwd?: string };

    // The stdin `cwd` is the hook's authoritative session cwd per Claude Code's Stop-hook
    // docs (it reflects any `cd` during the session); fall back to the invocation cwd for
    // callers/tests that don't set it.
    const startDir = typeof input.cwd === "string" && input.cwd.length > 0 ? input.cwd : cwd;
    const runDir = findRunDir(startDir);
    if (!runDir) {
      // The walk from the session's own directory found nothing: try CLAUDE_PROJECT_DIR
      // (ADR-0026) before giving up. `shouldAttribute` matches the recorded-driver test a few
      // lines below — a claimed run's Stop can never be its driver's, so a fallback stop on one
      // is a certain bystander and must not overwrite that run's `last_stop`.
      return fallbackUnheld(env, nowIso, (fallbackState) => recordedDriver(fallbackState) === null);
    }

    const state = readState(runDir);
    if (!state) return { block: false }; // race: vanished between findRunDir and here
    if (state.status !== "running") return { block: false }; // complete/escalated/aborted are correct endings

    // Claim marker: deliberately NOT read here (ADR-0010). Sealing a claim is
    // SubagentStop's job alone, because a delegated agent's own turn end is the only moment
    // headsign can learn which agent it is. Under ADR-0009 this hook adopted the marker
    // too, which structurally handed the lead session the driver seat a teammate had just
    // asked for — the lead's Stop simply fired first. Not looking is the fix: this hook
    // must neither consume nor honor the marker.

    // The whole of Stop's ownership logic (ADR-0013), and it compares nothing: the only
    // identifier this run can record is an agent id sealed by SubagentStop, and a Stop is a
    // *session's* turn end, so a claimed run's stop can never be its driver's. Checked here,
    // BEFORE the exit-note gate below, so an enclosing session's stop can never consume the
    // driving agent's one-shot pause note. An unclaimed run keeps the fail-open default:
    // nobody named a driver, so whoever stopped here gets nudged.
    if (recordedDriver(state) !== null) return { block: false };

    // The already-continuing flag (see the two guarantees at the top of this file). Undocumented
    // as of ADR-0006's revision, but still honored when present: it is a strictly stronger "you
    // already unblocked me" signal than headsign's own nudge counter.
    //
    // It sits HERE, immediately above the nudge flow, and not at the top of this function where
    // it used to. Everything it now passes over is read-only — the record read, the status test,
    // the recorded-driver test — and the pause note is opened only inside noteGateThenNudge, so
    // moving it down spends nothing (guarantee 2) and still blocks nothing (guarantee 1). What it
    // buys is a line that can name the phase and belong to the right party: from here headsign
    // knows the phase, and knows the run is unclaimed because a claimed run returned one step
    // earlier — so the stopper is the very party this hook would otherwise have nudged.
    if (input.stop_hook_active) return recordUnheld(runDir, nowIso, "stop_hook_active");

    return noteGateThenNudge(runDir, startDir, state, nowIso);
  } catch {
    // Fail open: a corrupt state file or malformed hook payload must never trap the session.
    return { block: false };
  }
}

// SubagentStop (ADR-0010): fires at the end of every delegated agent's turn, and its stdin
// is the ONE place a delegated agent can be named — its `agent_id` is stable across that
// agent's turns, while env (session id, pid) only ever describes the lead session it shares
// a process with. That makes this hook both the only place a claim can be sealed and the
// only backstop a delegated agent can have; Stop never fires for those turns at all.
export function evaluateSubagent(cwd: string, stdinRaw: string, nowIso: string, env: NodeJS.ProcessEnv): HookDecision {
  // Manual opt-out (ADR-0008), first for the same reason as in evaluate: a payload that
  // never parses must still honor an explicit "I'm only watching".
  if (isObserver(env)) return { block: false };

  try {
    const input = JSON.parse(stdinRaw) as { agent_id?: string; cwd?: string; stop_hook_active?: boolean };

    const startDir = typeof input.cwd === "string" && input.cwd.length > 0 ? input.cwd : cwd;
    const runDir = findRunDir(startDir);
    if (!runDir) {
      // The walk from the session's own directory found nothing: try CLAUDE_PROJECT_DIR
      // (ADR-0026) before giving up. `shouldAttribute` matches the owner check further down —
      // only a positive match against the recorded driver may be attributed, since most
      // subagent stops belong to reviewers, searchers and workers with no headsign role at all.
      const fallbackAgentId = resolveAgentId(input.agent_id);
      return fallbackUnheld(env, nowIso, (fallbackState) => {
        const driver = recordedDriver(fallbackState);
        return driver !== null && fallbackAgentId !== null && driver === fallbackAgentId;
      });
    }

    const state = readState(runDir);
    if (!state) return { block: false }; // race: vanished between findRunDir and here
    if (state.status !== "running") return { block: false }; // complete/escalated/aborted are correct endings

    // The already-continuing flag (see the two guarantees at the top of this file), and here it
    // gets a BRANCH OF ITS OWN rather than the moved-down check `evaluate` uses. It must not
    // travel past the adoption gate below: that gate consumes the claim marker and blocks, which
    // is the one action that violates both guarantees at once — and its position is itself
    // decided, since ADR-0010 requires it to precede the owner comparison. So this branch
    // returns before the gate is anywhere in its path, which is safety by CONSTRUCTION rather
    // than by position: a later reordering can undo a position, and cannot undo a return.
    //
    // The asymmetry with `evaluate` is placement only, and consistent with ADR-0010: its
    // identical-behaviour rule is about OBSERVABLE behaviour, and both hooks record an `unheld`
    // stop under the same condition, write the same line, and block nothing. ADR-0010 itself
    // notes the two share "everything below the adoption gate", which concedes that above it
    // they do not.
    //
    // Only a positive match against the recorded driver is recorded, for the same reason the
    // owner check below requires one: most subagent stops belong to reviewers, searchers and
    // workers with no headsign role, and a line about them would say a run was unheld for a party
    // that never held it. An unclaimed run and an unnameable agent therefore write nothing —
    // undecidable, not unimportant.
    if (input.stop_hook_active) {
      const flaggedAgentId = resolveAgentId(input.agent_id);
      if (flaggedAgentId !== null && recordedDriver(state) === flaggedAgentId) return recordUnheld(runDir, nowIso, "stop_hook_active");
      return { block: false };
    }

    const agentId = resolveAgentId(input.agent_id);

    // Adoption gate (the claim handshake, re-homed here by ADR-0010): a claim marker means
    // an agent ran `headsign claim` and ended its turn, waiting to be sealed as this run's
    // driver. Checked BEFORE the owner comparison below, on purpose: otherwise a
    // just-claiming agent that doesn't yet match the (possibly stale, possibly wrong) old
    // driver would be passed through as an unrelated bystander instead of adopted.
    const claimPath = path.join(runDir, ".headsign", "tmp", "claim");
    if (fs.existsSync(claimPath) && agentId !== null) {
      // Consume the marker: like the stop-note, a claim is a one-shot request — leaving it
      // in place would re-adopt on every future subagent stop, not just this one.
      const seated = withRunLock(runDir, (fresh) => {
        // Consume the marker inside the lock, for the same reason the pause note is: a claim
        // spent while another process was mid-lap would be a request nobody answered.
        fs.rmSync(claimPath, { force: true });
        const adoptedState = { ...fresh, driver_agent: agentId, stop_nudges: 0 };
        return { state: adoptedState, log: stamped(nowIso, { kind: "CLAIMED" }) };
      });
      // A claim that could not be sealed because a lap is running keeps its marker and is
      // sealed by this agent's next turn end.
      if (!seated) return { block: false };
      // Same cwd-only caveat the nudge carries (ADR-0004): when the run was found by walking
      // up, the newly seated agent has to be told where to cd before `next` can find it.
      const adoptionMessage =
        `Claim confirmed: this agent now drives workflow '${state.workflow}' (phase: ${state.phase})` +
        (runDir === startDir
          ? ". Run `headsign next` and follow its verdict."
          : ` in ${runDir}. cd there and run \`headsign next\`, then follow its verdict.`) +
        pauseAndAbortHint(runDir, startDir);
      return { block: true, message: adoptionMessage };
    }
    // A marker with no resolvable agent_id is left in place for a later, identifiable
    // subagent stop to consume: adopting an unnamed driver would defeat the owner check
    // claim exists to feed. `start`'s tmp/ wipe eventually reclaims a marker that's never
    // consumed, so this can't wedge a run permanently.

    // Owner check — the safety rule for everything below this line: block ONLY when the
    // recorded driver is the agent that just stopped. Anything else reaching here passes
    // through untouched, so an unrelated subagent (a reviewer, a searcher, a worker with no
    // headsign role at all) is never trapped by a run it isn't driving. The adoption gate above
    // is the one place that can hold an agent this check would have released — it seats whoever
    // names itself first under an armed marker, deliberately, because no other signal can name
    // a delegated agent (ADR-0010's named race).
    //
    // A run nobody has claimed has no driver to match, so nothing below this line can apply.
    const driver = recordedDriver(state);
    if (driver === null) return { block: false };
    // Positive match required — the only place in headsign where a stop is blocked without
    // one is the adoption gate above. Stop, by contrast, nudges an unclaimed run's stopper
    // without proving anything, because the session that stopped in the run's own directory
    // is very likely its driver. Here the opposite prior holds: most subagent stops belong to
    // reviewers, searchers and workers with no headsign role, so a stop that cannot name
    // itself is far more likely to be one of those than the driver. Nudging it would trap a
    // bystander in someone else's run — the one outcome this hook must never produce — so
    // absence of proof is treated as "not the driver".
    if (agentId === null || driver !== agentId) return { block: false };

    return noteGateThenNudge(runDir, startDir, state, nowIso);
  } catch {
    // Fail open: a corrupt state file or malformed hook payload must never trap the agent.
    return { block: false };
  }
}
