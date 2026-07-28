// Responsibility: outcome -> text. The ONLY place the output contract (ADR-0002) is written.
// Also the only place the .headsign/log line format is written (logLine); state.ts owns
// that file's I/O, cli.ts owns the timestamp.
// Must NOT know about: how outcomes were computed (routing rules, state, gates).

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

export function complete(name: string): string {
  return `COMPLETE\nWorkflow '${name}' finished.\n`;
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
}): string {
  const n = o.attemptUnknown ? `${o.attempt}/?` : o.maxAttempts !== undefined ? `${o.attempt}/${o.maxAttempts}` : `${o.attempt}`;
  const lastFailureBlock = o.lastFailure
    ? `--- last failure: ${o.lastFailure.check} (${clause(o.lastFailure.run, o.lastFailure.exitCode, o.lastFailure.timeoutSeconds)}) ---\n${o.lastFailure.outputTail}\n`
    : "";
  return `RUNNING ${o.phase} (attempt ${n})\nworkflow: ${o.workflowName}\n${lastFailureBlock}driver: ${o.driver}\n`;
}

export function statusTerminal(status: "complete" | "escalated" | "aborted", workflowName: string, endReason: string | null): string {
  const reasonLine = endReason !== null && endReason.length > 0 ? `reason: ${endReason}\n` : "";
  return `${status.toUpperCase()}\nworkflow: ${workflowName}\n${reasonLine}`;
}

// What a `.headsign/log` line can be about: every real transition engine.ts logs, plus the
// synthetic `start` event (which isn't an engine.Outcome — `start` never runs step()), plus
// the two Stop-boundary events (ADR-0004's explicit exception to "transitions only"; owned
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
  | { kind: "PAUSED"; note: string }
  | { kind: "STALLED" }
  // The claim handshake's adoption event (ADR-0009/0010) — a third hook-boundary exception
  // alongside PAUSED/STALLED. Deliberately detail-free: the identifier that was just
  // adopted must never be written to the log (see logDetail below).
  | { kind: "CLAIMED" };

// Pure formatting of one .headsign/log line (state.ts's appendLog/initLog own the I/O).
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
    case "PAUSED":
      return "paused";
    case "STALLED":
      return "stalled";
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
    case "PAUSED":
      return `note="${event.note}"`;
    case "STALLED":
      return "nudges=5";
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
