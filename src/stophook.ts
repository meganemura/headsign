// Responsibility: stop-boundary hook decisions — stdin JSON -> allow/block (ADR-0006).
// Two-event, one-driver-identifier-space split: ADR-0010 §1, ADR-0013 §1, ADR-0027 §2.3/§3.
// Lock-before-write / re-read-under-lock: see withRunLock, below.
// Bounded cwd walk-up: see findRunDir, below, and ADR-0006's "Bounded walk-up".
// CLAUDE_PROJECT_DIR second starting point: see fallbackUnheld, below, and ADR-0026.
// What a hook write can produce: ADR-0006 (paused/stalled), ADR-0009 (claimed).
// last_stop, stamped on every attributable stop: ADR-0025 §4.
//
// TWO GUARANTEES ABOUT THE ALREADY-CONTINUING FLAG, referenced below by both hooks: ADR-0025
// §5. Naming discipline ("the already-continuing flag" vs "the loop guard"): ADR-0025 §2.
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

// One source for the session stamp (ADR-0027 §2.1): measured directly, inside a real hook
// invocation, on 2026-08-01, the env var read below and the Stop payload's own `session_id`
// are the same string for a session's own turn end. Placed here for the same reason
// `isObserver` is: engine.ts calls this one function rather than reaching for `process.env`
// itself (see engine.ts's `driveStamp`), so the fact this comment states — the env value and
// the payload value agree, for a session's own stop — is written down in exactly the one place
// that has to stay true for the comparison in `evaluate` below to mean anything.
// ADR-0013's "trap" was two mechanisms resolving this name in a different order each; `src/`
// reads `CLAUDE_CODE_SESSION_ID` in exactly this one place (grep the tree to check) — one
// reader of the env var is how this round avoids repeating that.
export function resolveDriveSession(env: NodeJS.ProcessEnv): string | null {
  const raw = env["CLAUDE_CODE_SESSION_ID"];
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}

// The recorded driver, read the tolerant way state.ts's `driver_agent` doc requires
// (ADR-0013 §3) — including the transitional-tolerance criterion, which lives there.
function recordedDriver(state: State): string | null {
  return typeof state.driver_agent === "string" && state.driver_agent.length > 0 ? state.driver_agent : null;
}

// The recorded drive session, read the tolerant way state.ts's `last_drive` doc requires.
function recordedDriveSession(state: State): string | null {
  const recorded = state.last_drive;
  return typeof recorded === "object" && recorded !== null && typeof recorded.session === "string" && recorded.session.length > 0
    ? recorded.session
    : null;
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

// The Stop payload's own session id, resolved to the same shape resolveAgentId uses just
// above — but kept a SEPARATE function rather than folded into it (ADR-0027 §2.3). A session
// id and an agent id are two different identifier spaces: a session drives a run directly, an
// agent is sealed as its driver by a completely different mechanism. One function serving
// both would read as one identifier space to the next caller, which is the exact confusion
// ADR-0013 spent a whole decision clearing up. The one duplicated line is cheaper than that risk.
function resolveSessionId(raw: unknown): string | null {
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

// The whole body of both hooks' `unheld` writers — the flagged branches and the
// CLAUDE_PROJECT_DIR fallback: ADR-0025 §5 (the two guarantees), ADR-0026 §1/§5.
function recordUnheld(runDir: string, nowIso: string, cause: UnheldCause): HookDecision {
  withRunLock(runDir, (fresh) => ({ state: withLastStop(fresh, "unheld", nowIso, cause), log: stamped(nowIso, { kind: "UNHELD", cause }) }));
  return { block: false };
}

// Walk up from startDir to find a run's .headsign/state.json: ADR-0006's "Bounded walk-up".
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
// each already runs on the ordinary path below: Stop's two tests, conjoined (ADR-0027 §9) — a
// claimed run's Stop can never be its driver's, and a stamped run's Stop must match the
// payload's own session id, the same `last_drive` comparison `evaluate` makes below — and
// SubagentStop's driver match (only a positive match may be attributed, since most subagent
// stops belong to reviewers, searchers and workers with no headsign role at all). Everything
// else is identical and deliberately minimal: read the record, confirm it is running, and
// either write the line or write nothing — never open the pause note, never touch the claim
// marker, never increment stop_nudges, and never read `stop_hook_active` (guarantee 2 holds by
// construction on a path that can never block).
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

// Every option a nudge names above this line — run `next`, write a pause note, `abort` — is a
// driver's action. A subprocess that a program started to answer something else entirely can
// stop in this run's directory too, and finding no option meant for it, has been seen reaching
// for one of the driver's anyway. This clause is the one thing it may legitimately do, so it
// is the exit of last resort: last, after the exits that leave a trace (pause writes `paused`,
// abort writes `abort` with a reason; this one leaves nothing in the run at all — see ADR-0026).
// It tests the reader's own situation — "are you driving this run" — rather than naming *who*
// might be reading, on purpose: "a program started this session" would miss a session that is
// driving a run of its own and merely standing inside a different checkout, who is in exactly
// the same position and must recognize themselves too. Phrased this way, a driver reading it
// can tell it does not apply to them, which is the whole of this clause's safety.
// Named as a relay, not an instruction to "set this variable": a subprocess cannot set its own
// environment, only the party that started it can, but the subprocess is the only channel back
// to that party — so it is told where to send the word, not told to act on it directly.
// One clause, appended to the NUDGE only, never to the adoption message: `Claim confirmed …`
// tells an agent it just became this run's driver, the opposite of what this clause is for.
const NOT_DRIVING_HINT =
  " If you are not driving this run, none of the above is yours to do — set `HEADSIGN_OBSERVER` in the environment of whatever started this session instead.";

// Every write this module makes funnels through here: ADR-0004's `lock` section. The
// different bars the two HOOKS set before reaching this point — `evaluate` nudging an
// unclaimed run's stopper, `evaluateSubagent` requiring a positive match — belong to
// noteGateThenNudge's callers, not to this function's five: ADR-0010 §3, ADR-0013 §2 step 6.
//
// The gap this closes, and why: ADR-0004's `lock` section; tests/cli.test.ts's "--- the stop
// hook and the lock ---" section.
//
// Failing open on a held lock, twice over: ADR-0004's `lock` section.
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
  // Exit-note gate: ADR-0006's Decision section (the exit-note gate as primary mechanism).
  const notePath = path.join(runDir, ".headsign", "tmp", "stop-note");
  if (fs.existsSync(notePath)) {
    const noteRaw = fs.readFileSync(notePath, "utf8");
    const trimmedNote = noteRaw.trim();
    if (trimmedNote.length > 0) {
      const firstLine = trimmedNote.split(/\r?\n/)[0].trim().slice(0, 120);
      // Truncation rule for a cut-short note: ADR-0006's exit-note gate step (5.2).
      const recordedNote = firstLine === trimmedNote ? firstLine : `${firstLine}…`;
      // Consume the note only if the write lands: tests/cli.test.ts, "stop-hook: a held lock
      // leaves the pause note unconsumed, so the next turn still pauses".
      const paused = withRunLock(runDir, (fresh) => {
        fs.rmSync(notePath, { force: true });
        const pausedState = withLastStop({ ...fresh, stop_nudges: 0 }, "paused", nowIso);
        return { state: pausedState, log: stamped(nowIso, { kind: "PAUSED", note: recordedNote }) };
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
    // Why the cap-spent pass writes `stalled` to the record but no log line: ADR-0025 §4,
    // §7's retraction.
    withRunLock(runDir, (fresh) => ({ state: withLastStop(fresh, "stalled", nowIso) }));
    return { block: false };
  }

  const nextNudges = nudges + 1;
  // Disposition `nudged` covers all five nudges, cap-tripping one included; the log word is
  // `held` for the first four and `stalled` only for the fifth — disposition `stalled` starts
  // at the stop after this one, once the cap is already spent: ADR-0025 §4, §7's retraction.
  const counted = withRunLock(runDir, (fresh) => {
    const nudgedState = withLastStop({ ...fresh, stop_nudges: nextNudges }, "nudged", nowIso);
    const event: LogEvent = nextNudges === MAX_STOP_NUDGES ? { kind: "STALLED" } : { kind: "HELD", nudges: nextNudges };
    return { state: nudgedState, log: stamped(nowIso, event) };
  });
  // Fail-open on a held lock: see withRunLock's comment, above, in this file.
  if (!counted) return { block: false };

  // cd guidance when runDir !== startDir: ADR-0006's "Bounded walk-up"; ADR-0004's cwd-only
  // rule.
  const verdictSentence =
    runDir === startDir
      ? `headsign workflow '${state.workflow}' is still running (phase: ${state.phase}). Run \`headsign next\` and follow its verdict.`
      : `headsign workflow '${state.workflow}' is still running (phase: ${state.phase}) in ${runDir}. cd there and run \`headsign next\`, then follow its verdict.`;
  // The final-reminder phrase rides only on the nudge that trips the cap: earlier nudges
  // must keep pushing `headsign next`, not dilute it with "this is your last chance".
  const finalNotice = nextNudges === MAX_STOP_NUDGES ? " This is the final automatic reminder." : "";
  return { block: true, message: verdictSentence + finalNotice + pauseAndAbortHint(runDir, startDir) + NOT_DRIVING_HINT };
}

export function evaluate(cwd: string, stdinRaw: string, nowIso: string, env: NodeJS.ProcessEnv): HookDecision {
  // Manual opt-out, checked before stdin is parsed: ADR-0006's Decision step 1, ADR-0008 §4.
  if (isObserver(env)) return { block: false };

  try {
    // `session_id`: ADR-0027 §8 (retracts ADR-0013's "Stop compares no identifiers at all").
    const input = JSON.parse(stdinRaw) as { stop_hook_active?: boolean; cwd?: string; session_id?: string };

    // stdin `cwd` as the authoritative session cwd, invocation cwd as fallback: ADR-0006's
    // "Bounded walk-up" measured-facts section.
    const startDir = typeof input.cwd === "string" && input.cwd.length > 0 ? input.cwd : cwd;
    const runDir = findRunDir(startDir);
    if (!runDir) {
      // `shouldAttribute` here mirrors fallbackUnheld's own comment, in this file (ADR-0027
      // §9).
      //
      // The payload's session id is resolved once here, OUTSIDE the closure — the same place
      // evaluateSubagent resolves `fallbackAgentId` just below, so both fallback branches settle
      // an identifier by one rule rather than two (ADR-0013's named trap: two mechanisms
      // resolving the same name in a different order each).
      //
      // "No stamp" reads as UNKNOWN, not a mismatch: ADR-0027 §3 step 6.
      const fallbackSessionId = resolveSessionId(input.session_id);
      return fallbackUnheld(env, nowIso, (fallbackState) => {
        if (recordedDriver(fallbackState) !== null) return false;
        const drove = recordedDriveSession(fallbackState);
        return drove === null || drove === fallbackSessionId;
      });
    }

    const state = readState(runDir);
    if (!state) return { block: false }; // race: vanished between findRunDir and here
    if (state.status !== "running") return { block: false }; // complete/escalated/aborted are correct endings

    // Claim marker deliberately NOT read here: ADR-0010 Decision 1; the ADR-0009 handoff this
    // corrected.

    // The whole of Stop's driver-ownership logic: ADR-0013's Decision 2 step 6; ADR-0006's
    // "Why the driver check precedes the exit-note gate".
    if (recordedDriver(state) !== null) return { block: false };

    // `last_drive` comparison, and why it sits above the already-continuing flag: ADR-0027 §3.
    //
    // `drove !== null` load-bearing, "no stamp" must not read as "no match": ADR-0027 §3 step 6.
    const drove = recordedDriveSession(state);
    if (drove !== null && drove !== resolveSessionId(input.session_id)) return { block: false };

    // The already-continuing flag, undocumented but honored: ADR-0006's Decision step 4.
    //
    // Why the check sits here, immediately above the nudge flow, in `evaluate`: ADR-0025 §5.
    if (input.stop_hook_active) return recordUnheld(runDir, nowIso, "stop_hook_active");

    return noteGateThenNudge(runDir, startDir, state, nowIso);
  } catch {
    // Fail open: ADR-0006's Decision step 7.
    return { block: false };
  }
}

// SubagentStop, and why agent_id is the one nameable identifier: ADR-0010 facts 2-7,
// Decision 1.
export function evaluateSubagent(cwd: string, stdinRaw: string, nowIso: string, env: NodeJS.ProcessEnv): HookDecision {
  // Manual opt-out, same reason as `evaluate`: ADR-0006's Decision step 1, ADR-0008 §4.
  if (isObserver(env)) return { block: false };

  try {
    const input = JSON.parse(stdinRaw) as { agent_id?: string; cwd?: string; stop_hook_active?: boolean };

    const startDir = typeof input.cwd === "string" && input.cwd.length > 0 ? input.cwd : cwd;
    const runDir = findRunDir(startDir);
    if (!runDir) {
      // `shouldAttribute` here matches the owner check, below: ADR-0010 §3; and mirrors
      // fallbackUnheld's own comment (ADR-0027 §9).
      const fallbackAgentId = resolveAgentId(input.agent_id);
      return fallbackUnheld(env, nowIso, (fallbackState) => {
        const driver = recordedDriver(fallbackState);
        return driver !== null && fallbackAgentId !== null && driver === fallbackAgentId;
      });
    }

    const state = readState(runDir);
    if (!state) return { block: false }; // race: vanished between findRunDir and here
    if (state.status !== "running") return { block: false }; // complete/escalated/aborted are correct endings

    // Why this branch returns before the adoption gate, rather than merely sitting above it:
    // ADR-0025 §5.
    //
    // The asymmetry with `evaluate` is placement only, consistent with ADR-0010: ADR-0025 §5.
    //
    // Only a positive match is recorded, same reason the owner check below requires one:
    // ADR-0010 §3; ADR-0025 §4's "Not written".
    if (input.stop_hook_active) {
      const flaggedAgentId = resolveAgentId(input.agent_id);
      if (flaggedAgentId !== null && recordedDriver(state) === flaggedAgentId) return recordUnheld(runDir, nowIso, "stop_hook_active");
      return { block: false };
    }

    const agentId = resolveAgentId(input.agent_id);

    // Adoption gate precedes the owner comparison: ADR-0006's "Why the adoption gate still
    // precedes owner match"; ADR-0009's ordering argument.
    const claimPath = path.join(runDir, ".headsign", "tmp", "claim");
    if (fs.existsSync(claimPath) && agentId !== null) {
      // Consume the marker, a one-shot request: ADR-0009's two-beat claim procedure.
      const seated = withRunLock(runDir, (fresh) => {
        // Consume the marker inside the lock, for the same reason the pause note is: a claim
        // spent while another process was mid-lap would be a request nobody answered.
        fs.rmSync(claimPath, { force: true });
        const adoptedState = { ...fresh, driver_agent: agentId, stop_nudges: 0 };
        return { state: adoptedState, log: stamped(nowIso, { kind: "CLAIMED" }) };
      });
      // An unsealed claim keeps its marker: ADR-0004's `lock` section.
      if (!seated) return { block: false };
      // cd guidance when runDir !== startDir: ADR-0006's "Bounded walk-up"; ADR-0004's cwd-only
      // rule.
      const adoptionMessage =
        `Claim confirmed: this agent now drives workflow '${state.workflow}' (phase: ${state.phase})` +
        (runDir === startDir
          ? ". Run `headsign next` and follow its verdict."
          : ` in ${runDir}. cd there and run \`headsign next\`, then follow its verdict.`) +
        pauseAndAbortHint(runDir, startDir);
      return { block: true, message: adoptionMessage };
    }
    // A marker with no resolvable agent_id stays armed for a later stop: ADR-0010 step 7;
    // ADR-0009's marker-lingering / ADR-0004's tmp/ wipe.

    // Owner check — block only the recorded driver's own turn end: ADR-0010 §3.
    const driver = recordedDriver(state);
    if (driver === null) return { block: false };
    // Positive match required, and why that differs from `Stop`'s fail-open default: ADR-0010
    // §3.
    if (agentId === null || driver !== agentId) return { block: false };

    return noteGateThenNudge(runDir, startDir, state, nowIso);
  } catch {
    // Fail open: ADR-0006's Decision step 7.
    return { block: false };
  }
}
