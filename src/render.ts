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

export function advance(phase: string, description: string, failure?: Failure & { routedTo: string }, cleared?: string[]): string {
  const failedLine = failure
    ? `--- gate failed: ${failure.check} (${clause(failure.run, failure.exitCode, failure.timeoutSeconds)}) → routed to ${failure.routedTo} ---\n`
    : "";
  return `ADVANCE ${phase}\n${clearedBlock(cleared)}${failedLine}--- phase: ${phase} ---\n${description}\n`;
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

export function retry(o: Failure & { phase: string; attempt: number; maxAttempts?: number; outputTail: string; cached: boolean }): string {
  const n = o.maxAttempts !== undefined ? `${o.attempt}/${o.maxAttempts}` : `${o.attempt}`;
  const unchanged = o.cached ? " (unchanged)" : "";
  const cachedNote = o.cached ? " [cached — tree unchanged, attempt not counted]" : "";
  return `RETRY ${n} ${o.phase}${unchanged}\n--- gate failed: ${o.check} (${clause(o.run, o.exitCode, o.timeoutSeconds)})${cachedNote} ---\n${o.outputTail}\nFix the failure above, then run \`headsign next\` again.\n`;
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

export function validateOk(name: string, phaseCount: number): string {
  return `OK: workflow '${name}' (${phaseCount} phases)\n`;
}

export function validateFail(path: string, errors: string[]): string {
  return `INVALID: ${path}\n${errors.map((e) => `- ${e}\n`).join("")}`;
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
  // Only set by the caller when state.last_eval is non-null AND belongs to the current
  // phase (cli.ts's job — render.ts doesn't know the state shape's field names); a
  // last_eval left over from a since-departed phase must never be shown as if it were
  // about now.
  lastFailure?: (Failure & { outputTail: string }) | null;
  driver: "this session" | "another session" | "unknown";
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

// What a `.headsign/log` line can be about: every real transition cli.ts logs, plus the
// synthetic `start` event (which isn't an engine.Outcome — `start` never runs step()), plus
// the two Stop-boundary events (ADR-0004's explicit exception to "transitions only"; owned
// and appended by stophook.ts, not cli.ts — see ADR-0006). The type is the full
// engine.Outcome (PENDING included) rather than a narrower Exclude<>, because
// engine.step()'s declared return type still carries PENDING even though it never actually
// produces one — narrowing here would just force an unsafe cast at the one real call site.
// PENDING has no line format (see logDetail): cli.ts never calls this on the PENDING path
// (probes aren't transitions), so it's unreachable in practice, not by type.
export type LogEvent = { kind: "START"; workflow: string } | Outcome | { kind: "PAUSED"; note: string } | { kind: "STALLED" };

// Pure formatting of one .headsign/log line (state.ts's appendLog/initLog own the I/O).
// `ts` always originates from cli.ts's local `localIso(new Date())` helper — the one place
// headsign reads the clock (ADR-0006) — even when the caller is stophook.ts, which never
// calls `new Date()` itself and instead receives `ts` as `evaluate`'s `nowIso` argument.
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
    case "PAUSED":
      return "paused";
    case "STALLED":
      return "stalled";
    case "PENDING":
      // Unreachable: no cli.ts call site ever logs a PENDING outcome. Kept only so this
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
      return event.failure
        ? `from=${prevPhase} routed-fail check="${event.failure.check}" exit=${event.failure.exitCode}`
        : `from=${prevPhase}`;
    case "ESCALATE":
    case "ABORT":
      return `reason="${event.reason}"`;
    case "PAUSED":
      return `note="${event.note}"`;
    case "STALLED":
      return "nudges=5";
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
