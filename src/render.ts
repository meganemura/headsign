// Responsibility: outcome -> text. The ONLY place the output contract (ADR-0002) is written.
// Must NOT know about: how outcomes were computed (routing rules, state, gates).

export function start(phase: string, description: string): string {
  return `START ${phase}\n--- phase: ${phase} ---\n${description}\n`;
}

type Failure = { check: string; run: string; exitCode: number | "timeout"; timeoutSeconds?: number };

export function advance(phase: string, description: string, failure?: Failure & { routedTo: string }): string {
  const failedLine = failure
    ? `--- gate failed: ${failure.check} (${clause(failure.run, failure.exitCode, failure.timeoutSeconds)}) → routed to ${failure.routedTo} ---\n`
    : "";
  return `ADVANCE ${phase}\n${failedLine}--- phase: ${phase} ---\n${description}\n`;
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
