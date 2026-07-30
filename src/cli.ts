// Responsibility: argv parsing, command dispatch, printing, process exit code. One typed
// command becomes one engine call, and the value it answers with becomes text and a status.
// Must NOT know about: routing rules — including the order `next` asks its questions in
// (ADR-0018) — the workflow YAML schema, or what any operation does to a run; it delegates to
// engine.ts/workflow.ts. It reads the clock, which no module below it does.

import fs from "node:fs";
import * as workflowMod from "./workflow.ts";
import * as state from "./state.ts";
import * as engine from "./engine.ts";
import * as render from "./render.ts";
import * as stophook from "./stophook.ts";

// Local-time ISO 8601 with a numeric UTC offset, second precision, no milliseconds — e.g.
// "2026-07-24T23:00:17+09:00". The log's reader is a human or agent writing a run report in
// the user's own timezone, and a numeric offset keeps the line unambiguous and
// machine-parseable without forcing a mental UTC conversion.
function localIso(d: Date): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const offsetMinutes = -d.getTimezoneOffset(); // getTimezoneOffset is UTC-minus-local, so negate for local-minus-UTC
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const offset = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return `${date}T${time}${offset}`;
}

function stderrExit(text: string, code: number): never {
  process.stderr.write(text);
  return process.exit(code);
}

function errorExit(message: string): never {
  return stderrExit(`ERROR: ${message}\n`, 3);
}

// Resolves the workflow path for `start`/`validate` per the precedence:
// --workflow <path> wins if given; else a bare positional <name> resolves to
// .headsign/<name>.yaml (appending .yaml unless the name already ends in
// .yaml/.yml); else `defaultPath` (plain .headsign/workflow.yaml for `start`
// and no-run `validate`; a run's own recorded workflow_path for `validate`
// when a run exists — see cmdValidate). `abort`'s args (a free-text reason)
// never go through this.
function resolveWorkflowPath(args: string[], defaultPath = ".headsign/workflow.yaml"): string {
  const flagIdx = args.indexOf("--workflow");
  let flagValue: string | undefined;
  const consumed = new Set<number>();
  if (flagIdx !== -1) {
    flagValue = args[flagIdx + 1];
    if (!flagValue) errorExit("--workflow requires a path argument");
    consumed.add(flagIdx);
    consumed.add(flagIdx + 1);
  }
  const positional = args.find((_, i) => !consumed.has(i));

  if (positional !== undefined && flagValue !== undefined) {
    errorExit("use either a workflow name or --workflow <path>, not both");
  }
  if (flagValue !== undefined) return flagValue;
  if (positional === undefined) return defaultPath;
  if (positional.includes("/")) {
    errorExit(`workflow name '${positional}' cannot contain '/'; use --workflow <path> to name an explicit path`);
  }
  const filename = positional.endsWith(".yaml") || positional.endsWith(".yml") ? positional : `${positional}.yaml`;
  return `.headsign/${filename}`;
}

// `validate`'s own loader, and the only one left here: it may exit, which is exactly what
// the two engine operations that load a workflow may not do — they hand the errors back
// (engine.WorkflowInvalid) for reportStart/reportNext to print through the same two render
// calls used below.
function loadWorkflowOrExit(workflowPath: string, showWarnings = false): workflowMod.Workflow {
  const { workflow: wf, errors, warnings } = workflowMod.load(workflowPath);
  if (!wf) stderrExit(render.validateFail(workflowPath, errors), 3);
  if (showWarnings && warnings.length > 0) process.stderr.write(render.validateWarnings(workflowPath, warnings));
  return wf;
}

// `ctx` carries what the Outcome type itself deliberately doesn't (per-call-site render
// extras, not routing state): the loaded workflow (to resolve a PENDING phase's
// description) and the ADVANCE path's cleared-artifact list. Only a real evaluation has both
// available and can produce ADVANCE/PENDING; a terminal reprint only ever carries
// COMPLETE/ESCALATE/ABORT, which don't need it.
function printOutcome(outcome: engine.Outcome, workflowName: string, ctx?: { wf: workflowMod.Workflow; cleared?: string[] }): never {
  switch (outcome.kind) {
    case "ADVANCE":
      return exitAfter(render.advance(outcome.phase, outcome.description, outcome.failure, ctx?.cleared, outcome.routedBy), 0);
    case "COMPLETE":
      return exitAfter(render.complete(workflowName, outcome.acceptedGraphChanges), 0);
    case "RETRY":
      return exitAfter(render.retry({ phase: outcome.phase, attempt: outcome.attempt, maxAttempts: outcome.maxAttempts, ...outcome.failure }), 1);
    case "ESCALATE":
      return exitAfter(render.escalate(outcome.reason), 2);
    case "ABORT":
      return exitAfter(render.abort(outcome.reason), 2);
    case "PENDING":
      // ctx.wf is guaranteed here: PENDING is only ever constructed inside engine.ts's lap,
      // which returns the workflow it loaded alongside it, and reportNext threads it in below.
      return exitAfter(render.pending(outcome.phase, ctx!.wf.phases[outcome.phase].description, outcome.ready), 1);
  }
}

function exitAfter(text: string, code: number): never {
  process.stdout.write(text);
  return process.exit(code);
}

// Whatever a hook piped in on fd 0 — "", which both evaluators fail open on, when nothing was
// piped. The general file-reading form of this went to engine.ts with the commands that read
// `.headsign/`; the only read left here is a stream, not a file.
function readStdin(): string {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// --- reporting: engine result -> text + exit code ---
//
// One function per command, each a `switch` in a function declared to return `never`, so a
// result arm nobody handles makes the end of the function reachable and the build fails.
// That is deliberate and not decoration: every REFUSED arm below was an `errorExit` inside
// the command itself before ADR-0018 moved the command out, and a refusal quietly dropped on
// the way back here would print an error and exit 0 — a silent lie to any script that checks
// the status, on the ordinary path rather than an unreachable edge.

function reportStart(result: engine.StartResult): never {
  // Warnings first, on stderr, exactly where `start` printed them before: at load time,
  // whatever the operation then decided.
  if (result.warnings) process.stderr.write(render.validateWarnings(result.warnings.workflowPath, result.warnings.warnings));
  switch (result.result.kind) {
    case "WORKFLOW_INVALID":
      return stderrExit(render.validateFail(result.result.workflowPath, result.result.errors), 3);
    case "REFUSED":
      return errorExit(result.result.message);
    case "STARTED":
      return exitAfter(render.start(result.result.phase, result.result.description, result.result.cleared), 0);
  }
}

function reportNext(result: engine.NextResult): never {
  switch (result.kind) {
    case "WORKFLOW_INVALID":
      return stderrExit(render.validateFail(result.workflowPath, result.errors), 3);
    case "REFUSED":
      return errorExit(result.message);
    case "ANSWERED":
      return printOutcome(result.outcome, result.workflowName, result.wf ? { wf: result.wf, cleared: result.cleared } : undefined);
  }
}

function reportAbort(result: engine.AbortResult): never {
  switch (result.kind) {
    case "REFUSED":
      return errorExit(result.message);
    case "ABORTED":
      return exitAfter(render.abort(result.reason), 2);
  }
}

function reportClaim(result: engine.ClaimResult): never {
  switch (result.kind) {
    case "REFUSED":
      return errorExit(result.message);
    case "CLAIMED":
      return exitAfter(render.claim(), 0);
  }
}

function reportStatus(result: engine.StatusResult): never {
  switch (result.kind) {
    case "REFUSED":
      return errorExit(result.message);
    case "TERMINAL":
      return exitAfter(render.statusTerminal(result.status, result.workflowName, result.endReason), 0);
    case "RUNNING":
      // The two words the run's claimed-ness is reported in, and the only place they are
      // written. Deliberately neither of them says anything about *who is reading*
      // (ADR-0013): the recorded driver is an agent id, which only the SubagentStop hook's
      // stdin ever carries, so the CLI has no id of its own to compare and must not imply it
      // does. Why the line is worth printing at all: `claim` is a two-beat handshake that can
      // fail quietly — the agent ended its turn without the hook firing, or another agent
      // named itself first — and one `headsign status` is how a human or agent confirms the
      // delegation actually took.
      return exitAfter(
        render.statusRunning({
          phase: result.phase,
          attempt: result.attempt,
          maxAttempts: result.maxAttempts,
          attemptUnknown: result.attemptUnknown,
          workflowName: result.workflowName,
          lastFailure: result.lastFailure,
          driver: result.delegated ? "a delegated agent" : "not delegated yet — no agent has claimed this run",
          // Both conditional, and both absent rather than falsy when there is nothing to say:
          // `undefined` is what makes a run on which no stop has been processed print exactly
          // what `status` printed before either line existed. The last stop is the answer to the
          // question the `driver:` line cannot reach — whether the previous turn end was held —
          // and the observer line is the only one of these facts that is about the caller rather
          // than the run.
          lastStop: result.lastStop ?? undefined,
          observer: result.observer ? true : undefined,
          acceptedGraphChanges: result.acceptedGraphChanges,
          graphChangeReported: result.graphChangeReported,
        }),
        0,
      );
  }
}

// --- commands ---
//
// The five that operate on a run are one line each on purpose: turn argv into the values
// engine.ts takes (cwd, the resolved path or the joined reason, and the timestamp —
// `localIso(new Date())` is captured here because this is the only file that reads the
// clock, ADR-0004), then report what comes back. Nothing else belongs in them.

function cmdStart(args: string[]): never {
  return reportStart(engine.start(process.cwd(), resolveWorkflowPath(args), localIso(new Date())));
}

function cmdNext(): never {
  return reportNext(engine.next(process.cwd(), localIso(new Date())));
}

function cmdAbort(args: string[]): never {
  return reportAbort(engine.abort(process.cwd(), args.join(" "), localIso(new Date())));
}

function cmdClaim(): never {
  return reportClaim(engine.claim(process.cwd()));
}

// `process.env` is handed over the same way it already is to the two hook evaluators: this file
// is the only one that reads the process, and `status` now has one line to print about the
// environment it was called in.
function cmdStatus(): never {
  return reportStatus(engine.status(process.cwd(), process.env));
}

// The one command that stayed behind when ADR-0018 moved the other five into engine.ts, and
// the reason is not size: `validate` does not operate on a run at all, it operates on a
// FILE. Its glance at the run record below is argument resolution — deciding which file was
// meant when none was named — and nothing else: it never changes the run and never judges it.
function cmdValidate(args: string[]): never {
  // No-args default (ADR-0009): with a run present here — of any status, not just
  // running — validate the workflow it actually recorded (current.workflow_path), so a
  // named run (`headsign start myflow`) doesn't ENOENT against the plain
  // .headsign/workflow.yaml default. An explicit name/--workflow always overrides this
  // (resolveWorkflowPath's own precedence, unchanged); only the no-run-here fallback is
  // still the plain default.
  const current = state.readState(process.cwd());
  const defaultPath = current !== null ? current.workflow_path : ".headsign/workflow.yaml";
  const workflowPath = resolveWorkflowPath(args, defaultPath);
  const wf = loadWorkflowOrExit(workflowPath, true);
  return exitAfter(render.validateOk(wf.name, Object.keys(wf.phases).length), 0);
}

function cmdStopHook(): never {
  const raw = readStdin(); // no stdin piped -> "", which evaluate() fails open on
  const decision = stophook.evaluate(process.cwd(), raw, localIso(new Date()), process.env);
  if (decision.block) stderrExit(`${decision.message}\n`, 2);
  return process.exit(0);
}

// The SubagentStop counterpart (ADR-0010) — same shape as cmdStopHook, different event and
// different identifier space: this one is answered from the stdin `agent_id`, and it is the
// only path that can seal a claim.
function cmdSubagentStopHook(): never {
  const raw = readStdin(); // no stdin piped -> "", which evaluateSubagent() fails open on
  const decision = stophook.evaluateSubagent(process.cwd(), raw, localIso(new Date()), process.env);
  if (decision.block) stderrExit(`${decision.message}\n`, 2);
  return process.exit(0);
}

// Human convenience only — outside the agent-facing contract (ADR-0002). The two hidden
// hook subcommands are deliberately omitted; these six commands are the whole surface.
const HELP_TEXT = `headsign — a tiny phase gate for coding agents

Usage:
  headsign start [name] [--workflow <path>]     start a run (name → .headsign/<name>.yaml)
  headsign next                                 run the current gate and answer with a verdict
  headsign abort [reason]                       end the run for good (records why)
  headsign status                               read-only view of the current run (never judges)
  headsign validate [name] [--workflow <path>]  defaults to the current run's workflow, then .headsign/workflow.yaml
  headsign claim                                claim driver ownership for this delegated agent (see docs)

\`next\` answers on line 1: ADVANCE / RETRY / PENDING / COMPLETE / ESCALATE / ABORT.
Exit codes: 0 advance or complete, 1 retry or pending, 2 escalate or abort,
3 usage or configuration error.

\`status\` answers on line 1: RUNNING / COMPLETE / ESCALATED / ABORTED — its own
vocabulary, never next's. Exit code: 0 whenever state was readable regardless of
status value, 3 if there is no run here or on a usage error — it never reuses
next's 1/2, so observing status alone can't trip a \`set -e\` script.

Guide and workflow reference: https://github.com/meganemura/headsign
`;

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  if (command === undefined || command === "-h" || command === "--help") {
    return exitAfter(HELP_TEXT, 0);
  }
  switch (command) {
    case "start": return cmdStart(rest);
    case "next": return cmdNext();
    case "abort": return cmdAbort(rest);
    case "status": return cmdStatus();
    case "validate": return cmdValidate(rest);
    case "claim": return cmdClaim();
    case "stop-hook": return cmdStopHook();
    case "subagent-stop-hook": return cmdSubagentStopHook();
    default: errorExit(`unknown command '${command}'. Run \`headsign --help\` for usage.`);
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`ERROR: ${(err as Error).message}\n`);
  process.exit(3);
}
