// Responsibility: argv parsing, command dispatch, printing, process exit code. One typed
// command becomes one engine call, and the value it answers with becomes text and a status.
// Must NOT know about: routing rules — including the order `next` asks its questions in
// (ADR-0018) — the workflow YAML schema, or what any operation does to a run; it delegates to
// engine.ts/workflow.ts. It reads the wall clock ADR-0004 gives it sole custody of (gate.ts
// reads a different clock, for a different reason — see its header).
//
// The six commands are start / next / abort / validate / status / claim; `help` and `version`
// are typeable and do not make it eight, because they take the tool as their subject rather
// than a repository (ADR-0002). tests/cli.test.ts asserts that this paragraph says "six
// commands" — it is a comment the suite reads, so edit it and run `npm test`.

import fs from "node:fs";
import * as workflowMod from "./workflow.ts";
import * as state from "./state.ts";
import * as engine from "./engine.ts";
import * as render from "./render.ts";
import * as stophook from "./stophook.ts";

// Local-time ISO 8601, numeric UTC offset, second precision — the format and why it is
// shaped this way is ADR-0004's, "`.headsign/log` (the transition log)" section, "Line
// format" paragraph.
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
// description) and the ADVANCE path's cleared/not-cleared artifact lists. Only a real
// evaluation has both available and can produce ADVANCE/PENDING; a terminal reprint only
// ever carries COMPLETE/ESCALATE/ABORT, which don't need it.
function printOutcome(
  outcome: engine.Outcome,
  workflowName: string,
  ctx?: { wf: workflowMod.Workflow; cleared?: string[]; notCleared?: engine.NotCleared[] },
): never {
  switch (outcome.kind) {
    case "ADVANCE":
      return exitAfter(render.advance(outcome.phase, outcome.description, outcome.failure, ctx?.cleared, ctx?.notCleared, outcome.routedBy), 0);
    case "COMPLETE":
      return exitAfter(render.complete(workflowName, outcome.acceptedGraphChanges), 0);
    case "RETRY":
      return exitAfter(
        render.retry({ phase: outcome.phase, attempt: outcome.attempt, ...(outcome.maxAttempts !== undefined && { maxAttempts: outcome.maxAttempts }), repeats: outcome.repeats, ...outcome.failure }),
        1,
      );
    case "ESCALATE":
      return exitAfter(render.escalate(outcome.reason), 2);
    case "ABORT":
      return exitAfter(render.abort(outcome.reason), 2);
    case "PENDING":
      // Two lookups on this line go unchecked, and the same fact covers both. PENDING is only
      // ever constructed inside engine.ts's lap, on a path that has ALREADY read
      // `wf.phases[current.phase]` and dereferenced it (the `ready` probe) — so the phase
      // exists, and the workflow that holds it is returned alongside the outcome and threaded
      // in below by reportNext. `ctx!` and the `[outcome.phase]` index are therefore the same
      // guarantee twice, not two.
      // Worth naming because the compiler checks neither: `strict` does not imply
      // noUncheckedIndexedAccess, so the index reads as a `Phase` here whatever the key is.
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
// result arm nobody handles makes the end of the function reachable and the build fails —
// deliberate, not decoration. Why a dropped REFUSED arm would be a silent, ordinary-path lie
// to any script that checks the status is ADR-0018's Decision, item 3.

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
      return exitAfter(render.start(result.result.phase, result.result.description, result.result.cleared, result.result.notCleared), 0);
  }
}

function reportNext(result: engine.NextResult): never {
  switch (result.kind) {
    case "WORKFLOW_INVALID":
      return stderrExit(render.validateFail(result.workflowPath, result.errors), 3);
    case "REFUSED":
      return errorExit(result.message);
    case "ANSWERED":
      return printOutcome(
        result.outcome,
        result.workflowName,
        result.wf
          ? { wf: result.wf, ...(result.cleared !== undefined && { cleared: result.cleared }), ...(result.notCleared !== undefined && { notCleared: result.notCleared }) }
          : undefined,
      );
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
          ...(result.maxAttempts !== undefined && { maxAttempts: result.maxAttempts }),
          attemptUnknown: result.attemptUnknown,
          workflowName: result.workflowName,
          lastFailure: result.lastFailure,
          driver: result.delegated ? "a delegated agent" : "not delegated yet — no agent has claimed this run",
          // All three conditional, and all genuinely ABSENT rather than present-and-empty
          // when there is nothing to say — which is what makes a run on which none of them has
          // happened print exactly what `status` printed before any of these lines existed.
          // They used to pass `undefined` for that; the key is now simply not spread, which
          // says the same thing to a reader and to exactOptionalPropertyTypes alike. The last stop is
          // the answer to the question the `driver:` line cannot reach — whether the previous
          // turn end was held; the last moved time is a different question again — when the run
          // itself was last acted on (ADR-0027 §7) — and the observer line is the only one of
          // these facts that is about the caller rather than the run.
          ...(result.lastStop !== null && { lastStop: result.lastStop }),
          ...(result.lastMoved !== null && { lastMoved: result.lastMoved }),
          ...(result.phaseEnteredAt !== null && { phaseEnteredAt: result.phaseEnteredAt }),
          ...(result.observer && { observer: true }),
          acceptedGraphChanges: result.acceptedGraphChanges,
          graphChangeReported: result.graphChangeReported,
          // Conditional for the same reason the three above are: engine.ts sets it only when the
          // file says something the record does not, so a run whose file agrees prints exactly
          // what it printed before this line existed.
          ...(result.graphUnreported !== undefined && { graphUnreported: result.graphUnreported }),
          ...(result.description !== undefined && { description: result.description }),
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
// wall clock, ADR-0004), then report what comes back. Nothing else belongs in them.
//
// `start` and `next` also pass `process.env` now (ADR-0027), the same way `status` already
// does below: engine.ts stamps `last_drive` with whichever session actually ran the command,
// and this file stays the only one that reads the process to find out.

function cmdStart(args: string[]): never {
  return reportStart(engine.start(process.cwd(), resolveWorkflowPath(args), localIso(new Date()), process.env));
}

// `next`'s one flag, parsed the same way `resolveWorkflowPath` above parses `--workflow`:
// located by name, boolean rather than taking a value. Whether the flag may do anything at all
// — there being a reported change for it to accept — is engine.ts's decision to make (ADR-0018's
// boundary, restated for this flag); this function only says whether it was typed.
function resolveAcceptGraphChange(args: string[]): boolean {
  return args.indexOf("--accept-graph-change") !== -1;
}

function cmdNext(args: string[]): never {
  return reportNext(engine.next(process.cwd(), localIso(new Date()), process.env, resolveAcceptGraphChange(args)));
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
  const raw = readStdin();
  const decision = stophook.evaluate(process.cwd(), raw, localIso(new Date()), process.env);
  if (decision.block) stderrExit(`${decision.message}\n`, 2);
  return process.exit(0);
}

// The SubagentStop counterpart (ADR-0010) — same shape as cmdStopHook, different event and
// different identifier space: this one is answered from the stdin `agent_id`, and it is the
// only path that can seal a claim.
function cmdSubagentStopHook(): never {
  const raw = readStdin();
  const decision = stophook.evaluateSubagent(process.cwd(), raw, localIso(new Date()), process.env);
  if (decision.block) stderrExit(`${decision.message}\n`, 2);
  return process.exit(0);
}

// The version the CLI reports, substituted by esbuild at build time (the `--define` in
// package.json's `build` script) rather than read from package.json at runtime. Read at
// runtime it would be unreliable: this bundle ships through two channels and package.json is
// reliably present in only one of them. The npm package has it at the root, while the Claude
// Code plugin's source is the `plugin/` directory alone — so a copy cached from the
// marketplace has plugin/.claude-plugin/plugin.json and nothing above it. A runtime read would
// work from npm and fail from a plugin copy, or worse, silently find some *other* package.json
// on the way up.
//
// Which checks keep the reported number honest, and when each fires, is ADR-0002's to state —
// it is the one copy of that reasoning, and every other mention should be a pointer to it. This
// comment used to restate it and was wrong for a day, which is the argument for the rule.
//
// Declared, never assigned: esbuild replaces the identifier itself. `| undefined` records that
// a bundle built outside `npm run build` leaves it unsubstituted, which is why every read of it
// goes through `typeof` — an identifier that was never substituted does not merely hold
// `undefined`, it does not exist, and anything but `typeof` would throw reading it.
declare const HEADSIGN_VERSION: string | undefined;

// Prints the bare version and a newline, not "headsign 0.4.0" — why a bare value is the right
// shape is ADR-0002's, "Six commands, one (driver's) question" section.
//
// Exit 0, and not a verdict. ADR-0002 gives `next` the 1 = RETRY/PENDING, 2 = ESCALATE/ABORT
// contract and reserves 3 for usage and configuration errors; `version` (like `help`) answers a
// question about the tool rather than about a run, so it always succeeds.
//
// No `-v`, deliberately: it reads as *verbose* in enough tools that claiming it for *version*
// now would foreclose the shorter, more useful meaning later, and `--version` is not long
// enough to need an abbreviation. Its absence is a decision — do not add it "for consistency".
function cmdVersion(): never {
  // Refuses rather than guesses: an unsubstituted or empty-string HEADSIGN_VERSION both mean
  // this bundle was not produced by `npm run build`. The two ways a version can be wrong
  // rather than absent, and why the empty-string case needed a guard term of its own, are
  // ADR-0002's, "Six commands, one (driver's) question" section, to state.
  if (typeof HEADSIGN_VERSION !== "string" || HEADSIGN_VERSION.length === 0) {
    return errorExit("this build carries no version — it was not produced by `npm run build`, which is what substitutes it");
  }
  return exitAfter(`${HEADSIGN_VERSION}\n`, 0);
}

// Human convenience only, outside the agent-facing contract — why the two hidden hook
// subcommands are omitted here and why `help`/`version` differ from the six run-facing
// commands is ADR-0002's, "Six commands, one (driver's) question" section.
//
// Each line also names what running it touches, so a caller under a "don't run headsign here"
// constraint can tell from this text alone which commands are safe, rather than starting a run in
// a spare worktree to find out empirically (the situation that motivated adding this). That has to
// include the writes that leave `.headsign/` to be honest about the question being asked: `start`
// creates or amends `.headsign/.gitignore` (engine.ts's ensureHeadsignGitignored, a TRACKED file
// in a repository that has committed it), and both `start` and `next` delete whatever the phase
// they are entering lists under `clear:` — paths chosen by the workflow, which may be anywhere in
// the tree and may be tracked. "Which of state.json / log / lock / tmp it writes" was the first
// version of this list and was too narrow: a reader deciding whether a command can disturb a
// repository cares most about exactly the deletions it left out.
const HELP_TEXT = `headsign — a tiny phase gate for coding agents

Usage:
  headsign start [name] [--workflow <path>]     start a run (name → .headsign/<name>.yaml) — writes state.json, log, .gitignore; wipes and recreates tmp/; deletes the entry phase's clear: paths
  headsign next [--accept-graph-change]         run the current gate and answer with a verdict — writes state.json, log, lock; on advancing, deletes the next phase's clear: paths
  headsign abort [reason]                       end the run for good (records why) — writes state.json, log
  headsign status                               read-only view of the current run (never judges)
  headsign validate [name] [--workflow <path>]  defaults to the current run's workflow, then .headsign/workflow.yaml — read-only
  headsign claim                                claim driver ownership for this delegated agent (see docs) — writes tmp/
  headsign version                              print the version of this copy (also --version) — read-only
  headsign help                                 print this text (also -h, --help, no arguments) — read-only

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
  // Help and version are matched before the switch, in both their word and flag spellings,
  // because the flag spellings could never live in the switch anyway (a bare `headsign` has no
  // command at all to switch on). Keeping the spellings of one answer in one place is what
  // makes them byte-identical rather than two texts that drift.
  if (command === undefined || command === "help" || command === "-h" || command === "--help") {
    return exitAfter(HELP_TEXT, 0);
  }
  if (command === "version" || command === "--version") {
    return cmdVersion();
  }
  switch (command) {
    case "start": return cmdStart(rest);
    case "next": return cmdNext(rest);
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
