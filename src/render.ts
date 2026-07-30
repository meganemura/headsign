// Responsibility: outcome -> text. The ONLY place the output contract (ADR-0002) is written.
// Also the only place the .headsign/log line format is written (logLine); state.ts owns
// that file's I/O, cli.ts owns the timestamp.
// A log line is composed from the state AFTER the event it describes: the counters printed
// come straight out of what it is handed, so passing the state from before a transition
// produces a line that reads correctly and counts wrong, and nothing here would notice.
// The timestamp arrives as an argument. It originates in cli.ts, the one place headsign reads
// the clock, and reaches this module either directly or by way of engine.ts or stophook.ts.
// Must NOT know about: HOW any of it was decided — the routing rules, the gates, or what made
// a counter the number it is. It is handed the run's state and reads values straight out of
// it (the phase, the attempt count, the iteration count) precisely because reading is all it
// does; the exclusion is about the reasoning, not about the data. That wording used to say
// "must not know about … state", which a seam sweep caught as a contradiction with the line
// above it.

import type { Outcome } from "./engine.ts";
import type { State } from "./state.ts";

export function start(phase: string, description: string, cleared?: string[]): string {
  return `START ${phase}\n${clearedBlock(cleared)}--- phase: ${phase} ---\n${description}\n`;
}

type Failure = { check: string; run: string; exitCode: number | "timeout"; timeoutSeconds?: number };

// `routedBy` is present only for a k-way `on_pass` (ADR-0011) and adds exactly one line, in
// the same slot the gate-failed line uses (the two never co-occur: one is the pass path, the
// other the fail-route path). A string-form `on_pass` adds nothing, so the output of every
// workflow written before k-way routing is unchanged to the byte.
export function advance(
  phase: string,
  description: string,
  failure?: Failure & { routedTo: string },
  cleared?: string[],
  routedBy?: { when: string } | { default: true },
): string {
  const failedLine = failure
    ? `--- gate failed: ${failure.check} (${clause(failure.run, failure.exitCode, failure.timeoutSeconds)}) → routed to ${failure.routedTo} ---\n`
    : "";
  const routedLine = routedBy ? `--- routed: ${"when" in routedBy ? `when "${routedBy.when}"` : "default"} → ${phase} ---\n` : "";
  return `ADVANCE ${phase}\n${clearedBlock(cleared)}${failedLine}${routedLine}--- phase: ${phase} ---\n${description}\n`;
}

// One `--- cleared: <path> ---` line per file clearPhaseArtifacts actually deleted
// (existed and was non-empty) — announced right after the token line, in both start()
// and advance(), so a silently-vanished artifact from a previous pass is visible instead
// of a one-cycle-later surprise.
function clearedBlock(cleared?: string[]): string {
  return (cleared ?? []).map((p) => `--- cleared: ${p} ---\n`).join("");
}

// A phase declared `ready:` and the probe hasn't passed yet: nothing was judged, so
// nothing was counted. Distinct from RETRY (a real, counted, failed judgment) — the whole
// point of this token is that "not ready" and "failed" must not sound the same.
export function pending(phase: string, description: string, ready: string): string {
  return (
    `PENDING ${phase}\n` +
    `--- not ready yet — no attempt counted (readiness: ${ready}) ---\n` +
    `--- phase: ${phase} ---\n${description}\n` +
    "This is not a failure. Do the work above so the gate can run, then run `headsign next` again.\n"
  );
}

export function retry(o: Failure & { phase: string; attempt: number; maxAttempts?: number; outputTail: string }): string {
  const n = o.maxAttempts !== undefined ? `${o.attempt}/${o.maxAttempts}` : `${o.attempt}`;
  return `RETRY ${n} ${o.phase}\n--- gate failed: ${o.check} (${clause(o.run, o.exitCode, o.timeoutSeconds)}) ---\n${o.outputTail}\nFix the failure above, then run \`headsign next\` again.\n`;
}

// The second line exists only for a run that rewrote its own workflow while it was running
// (ADR-0016 §5 allows that, and headsign does not forbid it). It says so HERE, on the run's
// final answer, because `.headsign/log` is gitignored: a count that lived only in the log would
// never reach the person reading the pull request. An undefined or zero count adds nothing —
// the COMPLETE of a run that changed nothing is byte-identical to the one headsign has always
// printed.
export function complete(name: string, acceptedGraphChanges?: number): string {
  const accepted = acceptedGraphChanges ?? 0;
  const changeLine =
    accepted > 0 ? `This run accepted ${accepted} ${accepted === 1 ? "change" : "changes"} to its own workflow rules while it was running.\n` : "";
  return `COMPLETE\nWorkflow '${name}' finished.\n${changeLine}`;
}

export function escalate(reason: string): string {
  return `ESCALATE ${reason}\nHuman judgment needed. Report the situation to the user and ask for instructions.\n`;
}

export function abort(reason: string): string {
  return `ABORT ${reason || "(no reason given)"}\nWorkflow aborted. Report to the user.\n`;
}

// --- claim: the driver-adoption handshake (ADR-0009, re-homed onto SubagentStop by ADR-0010) ---
// Deliberately fixed, argument-free text: `claim` itself never judges or varies its
// output by workflow/phase (ADR-0002's "the only judging command is `next`" still holds —
// this just arms a marker for the SubagentStop hook to act on).
export function claim(): string {
  return (
    "CLAIM armed\n" +
    "Now end your turn. Sealing happens on this agent's own turn end, which is the only\n" +
    "moment headsign can learn which delegated agent you are. The hook confirms it in its\n" +
    "message; do not run `headsign next` before you see that confirmation.\n" +
    "If the wrong agent gets adopted, run `headsign claim` again from the right one: that\n" +
    "re-arms the marker, though another agent naming itself first can take it again.\n" +
    "Re-claim until the confirmation names the agent you meant.\n"
  );
}

export function validateOk(name: string, phaseCount: number): string {
  return `OK: workflow '${name}' (${phaseCount} phases)\n`;
}

export function validateFail(path: string, errors: string[]): string {
  return `INVALID: ${path}\n${errors.map((e) => `- ${e}\n`).join("")}`;
}

// Warnings never change an exit code — the workflow still loads and the run still starts.
// Written to stderr by `validate` and `start` only, so `next`'s hot path stays clean.
export function validateWarnings(path: string, warnings: string[]): string {
  return `WARNING: ${path}\n${warnings.map((w) => `- ${w}\n`).join("")}`;
}

function clause(run: string, exitCode: number | "timeout", timeoutSeconds?: number): string {
  return exitCode === "timeout" ? `${run}, timed out after ${timeoutSeconds}s` : `${run}, exit ${exitCode}`;
}

// --- status: the read-only observation window (ADR-0002/0008) ---
// Its own token vocabulary (RUNNING/COMPLETE/ESCALATED/ABORTED), deliberately distinct
// from next's (ADVANCE/RETRY/PENDING/COMPLETE/ESCALATE/ABORT) even where the words
// overlap in meaning — status observes, it never judges, and the two must never be
// mistaken for each other's output.

export function statusRunning(o: {
  phase: string;
  attempt: number;
  maxAttempts?: number;
  // Workflow unreadable, or this phase no longer defined in it — degrade to "n/?" rather
  // than guess at a limit that can't actually be resolved right now.
  attemptUnknown: boolean;
  workflowName: string;
  // Only set by the caller when state.last_failure is non-null AND belongs to the current
  // phase (engine.ts's job — render.ts doesn't know the state shape's field names); a
  // last_failure left over from a since-departed phase must never be shown as if it were
  // about now.
  lastFailure?: (Failure & { outputTail: string }) | null;
  // Two values, and deliberately neither of them says anything about *who is reading*
  // (ADR-0013): the recorded driver is an agent id, and only the SubagentStop hook's stdin
  // ever carries one, so the CLI has no id of its own to compare and must not imply it does.
  // What this line reports is the one fact the CLI can read off state.json — whether the run
  // has been claimed — which is exactly the question `headsign claim`'s two-beat handshake
  // leaves open when it fails quietly (see cli.ts's reportStatus for why the line is kept).
  driver: "a delegated agent" | "not delegated yet — no agent has claimed this run";
  // What headsign did with the last turn end it could attribute to this run, straight off the
  // record (no log parsing). Optional, so a run on which no stop has been processed prints what
  // `status` has always printed, to the byte. The wordings below say what HEADSIGN did and, for
  // `unheld`, name the upstream field it was told — never what any platform documentation
  // currently says about that field, because a published claim about somebody else's docs rots
  // silently.
  lastStop?: { disposition: "nudged" | "unheld" | "paused" | "stalled"; at: string };
  // HEADSIGN_OBSERVER, read from the environment of the process `status` runs in (engine.ts
  // takes it as an argument; this module reads nothing). The one quiet-ending cause a caller can
  // answer ABOUT ITSELF — there is no identifier to resolve — which makes it worth a line even
  // though the switch is nothing to do with the run's record.
  observer?: boolean;
  // The graph pin, and both are optional: a run whose workflow never changed under it says
  // nothing about it at all, and its status output is byte-identical to what it always was.
  // `acceptedGraphChanges` is history (how many changes this run has taken on board);
  // `graphChangeReported` is a standing question (one was shown and has not been accepted).
  acceptedGraphChanges?: number;
  graphChangeReported?: boolean;
}): string {
  const n = o.attemptUnknown ? `${o.attempt}/?` : o.maxAttempts !== undefined ? `${o.attempt}/${o.maxAttempts}` : `${o.attempt}`;
  const lastFailureBlock = o.lastFailure
    ? `--- last failure: ${o.lastFailure.check} (${clause(o.lastFailure.run, o.lastFailure.exitCode, o.lastFailure.timeoutSeconds)}) ---\n${o.lastFailure.outputTail}\n`
    : "";
  // After the driver line rather than beside the workflow line: the last-failure block's slot
  // (between `workflow:` and `driver:`) is part of this contract already, and an addendum that
  // only some runs have is safer at the end than wedged into a documented gap. History first,
  // then the outstanding question — the reader wants the thing that needs an answer last.
  const accepted = o.acceptedGraphChanges ?? 0;
  const acceptedLine =
    accepted > 0 ? `graph: ${accepted} accepted ${accepted === 1 ? "change" : "changes"} to the workflow's rules during this run\n` : "";
  const reportedLine = o.graphChangeReported ? "graph: changed since this run accepted it — restore the file, or `headsign next` to accept\n" : "";
  // Directly after `driver:`, which is the other line about who and what happened at a turn
  // boundary, and ahead of the `graph:` lines, which are about the rules rather than the run's
  // stops. The timestamp is printed VERBATIM: this module reads no clock, cannot know the
  // reader's timezone, and the stored value already carries its own offset — reformatting or
  // truncating it to a wall clock would be inventing a fact the writer did not record.
  const lastStopLine = o.lastStop ? `last stop: ${LAST_STOP_WORDING[o.lastStop.disposition]} — at ${o.lastStop.at}\n` : "";
  // Last, because it is the only line here that is about the CALLER rather than the run.
  const observerLine = o.observer ? "observer: HEADSIGN_OBSERVER is set here — turn ends from this environment are never held\n" : "";
  return `RUNNING ${o.phase} (attempt ${n})\nworkflow: ${o.workflowName}\n${lastFailureBlock}driver: ${o.driver}\n${lastStopLine}${acceptedLine}${reportedLine}${observerLine}`;
}

// One phrase per disposition, and each one is about what headsign did to the turn: "held" for
// the two dispositions that blocked, "not held" for the two that could not. `paused` says
// neither, because a pause is the reader's own doing and "not held" would read as a failure.
const LAST_STOP_WORDING: Record<"nudged" | "unheld" | "paused" | "stalled", string> = {
  nudged: "held, and pointed back to headsign next",
  unheld: "not held — Claude Code had already resumed the turn (stop_hook_active)",
  paused: "paused by a note",
  stalled: "not held — the nudge cap is spent",
};

export function statusTerminal(status: "complete" | "escalated" | "aborted", workflowName: string, endReason: string | null): string {
  const reasonLine = endReason !== null && endReason.length > 0 ? `reason: ${endReason}\n` : "";
  return `${status.toUpperCase()}\nworkflow: ${workflowName}\n${reasonLine}`;
}

// What a `.headsign/log` line can be about: every real transition engine.ts logs, plus the
// synthetic `start` event (which isn't an engine.Outcome — `start` never runs step()), plus
// the Stop-boundary events (ADR-0004's explicit exception to "transitions only"; owned
// and appended by stophook.ts, not engine.ts — see ADR-0006). The type is the full
// engine.Outcome (PENDING included) rather than a narrower Exclude<>, because
// engine.step()'s declared return type still carries PENDING even though it never actually
// produces one — narrowing here would just force an unsafe cast at the one real call site.
// PENDING has no line format (see logDetail): engine.ts never calls this on the PENDING path
// (probes aren't transitions), so it's unreachable in practice, not by type.
export type LogEvent =
  | { kind: "START"; workflow: string }
  | Outcome
  // The global ceiling (ADR-0017). A synthetic event rather than the ESCALATE outcome it is
  // printed as, because `escalate` in this file means "the run ended by escalation" for its
  // two other producers, and this one ends nothing: the run stays `running` and may continue
  // after someone raises the limit. Logging it as `escalate` would make every reader of a log
  // that stops here — and of one that carries on past it — read an ending that never happened.
  | { kind: "CEILING"; reason: string }
  // The workflow's own rules moved under a running run (engine.ts's reconcileGraphPin). One
  // event word for both dispositions, distinguished in the detail, because they are two
  // readings of the same finding and a reader following a run wants them on one grep. Not an
  // `escalate`, for the same reason `ceiling` is not: the reported disposition prints as
  // ESCALATE but ends nothing.
  // `disposition` rather than `state` even though it PRINTS as `state=`: `state` in this file
  // means the run record, which logLine also takes, and one word for two things across one
  // function signature is how a log line ends up reporting the wrong one.
  | { kind: "GRAPH_CHANGED"; disposition: "reported" | "accepted"; keys: string[] }
  | { kind: "PAUSED"; note: string }
  | { kind: "STALLED" }
  // A turn end headsign was overruled on: Claude Code's already-continuing flag was set on the
  // hook's input, so the stop was let through (stophook.ts's flagged branches). `unheld` and
  // not `pass`, deliberately — `pass` is this codebase's word for a GATE SUCCEEDING
  // (GateVerdict's passing arm is literally named `pass`), so reusing it here would put the
  // same string in the log for the opposite kind of event. `unheld` negates the verb headsign
  // already uses for what these hooks do to a turn, and claims no choice: headsign did not let
  // go, it was overruled.
  | { kind: "UNHELD" }
  // The claim handshake's adoption event (ADR-0009/0010) — a third hook-boundary exception
  // alongside PAUSED/STALLED. Deliberately detail-free: the identifier that was just
  // adopted must never be written to the log (see logDetail below).
  | { kind: "CLAIMED" };

// Pure formatting of one .headsign/log line (state.ts's appendLog owns the I/O).
// `ts` always originates from cli.ts's local `localIso(new Date())` helper — the one place
// headsign reads the clock (ADR-0006) — even though neither caller is cli.ts any more:
// engine.ts and stophook.ts both receive `ts` as a `nowIso` argument and never call
// `new Date()` themselves.
// `state` is the resulting state of this transition — the same object passed to state.writeState —
// so `a=`/`i=`/`<phase>` always match what's on disk after this event. `prevPhase` is the
// one piece of context that state doesn't carry after the fact (an ADVANCE's `state.phase`
// is already the destination): it feeds the `from=` clause and is otherwise unused.
export function logLine(ts: string, event: LogEvent, state: State, prevPhase?: string): string {
  const phase = state.phase;
  const a = state.attempts[phase] ?? 0;
  const i = state.total_iterations;
  const head = `${ts} ${eventName(event)} ${phase} a=${a} i=${i}`;
  const detail = logDetail(event, prevPhase);
  return detail ? `${head} ${detail}\n` : `${head}\n`;
}

function eventName(event: LogEvent): string {
  switch (event.kind) {
    case "START":
      return "start";
    case "ADVANCE":
      return "advance";
    case "COMPLETE":
      return "complete";
    case "RETRY":
      return "retry";
    case "ESCALATE":
      return "escalate";
    case "ABORT":
      return "abort";
    case "CEILING":
      return "ceiling";
    case "GRAPH_CHANGED":
      return "graph-changed";
    case "PAUSED":
      return "paused";
    case "STALLED":
      return "stalled";
    case "UNHELD":
      return "unheld";
    case "CLAIMED":
      return "claimed";
    case "PENDING":
      // Unreachable: no call site in engine.ts ever logs a PENDING outcome. Kept only so this
      // switch stays exhaustive against the full engine.Outcome type.
      throw new Error("logLine: PENDING is never logged");
  }
}

function logDetail(event: LogEvent, prevPhase?: string): string {
  switch (event.kind) {
    case "START":
      return `workflow=${event.workflow}`;
    case "RETRY":
      return `check="${event.failure.check}" exit=${event.failure.exitCode}`;
    case "ADVANCE":
      // Which branch of a k-way `on_pass` was taken is recorded here and nowhere else that
      // outlives the run: without it, a routed advance reads exactly like a straight one and
      // why the run went this way instead of that way is gone for good. The log is the
      // human's audit trail, so it may say more than stdout does.
      if (event.routedBy) {
        const why = "when" in event.routedBy ? `routed-when="${event.routedBy.when}"` : "routed-default";
        return `from=${prevPhase} ${why}`;
      }
      return event.failure
        ? `from=${prevPhase} routed-fail check="${event.failure.check}" exit=${event.failure.exitCode}`
        : `from=${prevPhase}`;
    case "ESCALATE":
    case "ABORT":
    // Same `reason="…"` shape as the two endings: only the event word separates them, so a
    // reader who knows one line format knows all three.
    case "CEILING":
      return `reason="${event.reason}"`;
    case "GRAPH_CHANGED":
      // Which keys moved, comma-separated and unquoted: they are identifiers (phase names and
      // `$limits`), not free text like a reason, and this is the one record of WHAT changed
      // that outlives the lap. A reported line is written every time a difference is reported,
      // the same way `ceiling` repeats at the wall: each one was a real question really asked,
      // and collapsing them would understate how much a run's rules moved under it.
      return `state=${event.disposition} phases=${event.keys.join(",")}`;
    case "PAUSED":
      return `note="${event.note}"`;
    case "STALLED":
      return "nudges=5";
    case "UNHELD":
      // Bare, not quoted, by this file's own rule: quotes are for free text, and
      // `stop_hook_active` is an identifier (see the graph-changed arm above). Naming the
      // upstream field is deliberate — it is the one token common to the whole diagnostic
      // chain, from this line through headsign's source to the hook payload a person can
      // print. Which is also why the event WORD stays inside headsign's own vocabulary: the
      // line says what headsign did, and names in the detail what it was told.
      return "by=stop_hook_active";
    case "CLAIMED":
      // No detail — the whole point of the claimed event is to record *that* an adoption
      // happened, never *who* was adopted (that stays in state.json only, per ADR-0009).
      // ADR-0010 changed which identifier that is (an agent id, not a session id); it did
      // not change the rule that it never reaches the log.
      return "";
    case "COMPLETE":
      // No detail form is specified for `complete` in the spec's enumeration (start /
      // retry / fail-route advance / pass advance / escalate+abort) despite it being
      // named as one of the logged events — `<phase>`/`a=`/`i=` already name which phase
      // just completed, so nothing is appended here. Flagged to the coordinator as a
      // spec gap rather than guessed at.
      return "";
    case "PENDING":
      // Unreachable — see eventName's PENDING case.
      throw new Error("logLine: PENDING is never logged");
  }
}
