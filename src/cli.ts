// Responsibility: argv parsing, command dispatch, printing, process exit code.
// Must NOT know about: routing rules, the workflow YAML schema — delegates to engine.ts/workflow.ts.

import fs from "node:fs";
import path from "node:path";
import * as workflowMod from "./workflow.ts";
import * as state from "./state.ts";
import * as gate from "./gate.ts";
import * as treehash from "./treehash.ts";
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
// .yaml/.yml); else the default .headsign/workflow.yaml. `abort`'s args (a
// free-text reason) never go through this.
function resolveWorkflowPath(args: string[]): string {
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
  if (positional === undefined) return ".headsign/workflow.yaml";
  if (positional.includes("/")) {
    errorExit(`workflow name '${positional}' cannot contain '/'; use --workflow <path> to name an explicit path`);
  }
  const filename = positional.endsWith(".yaml") || positional.endsWith(".yml") ? positional : `${positional}.yaml`;
  return `.headsign/${filename}`;
}

function loadWorkflowOrExit(workflowPath: string): workflowMod.Workflow {
  const { workflow: wf, errors } = workflowMod.load(workflowPath);
  if (!wf) stderrExit(render.validateFail(workflowPath, errors), 3);
  return wf;
}

// `ctx` carries what the Outcome type itself deliberately doesn't (per-call-site render
// extras, not routing state): the loaded workflow (to resolve a PENDING phase's
// description) and the ADVANCE path's cleared-artifact list. Only cmdNext's real
// evaluateNext() call has both available and can produce ADVANCE/PENDING; the two
// terminal-reprint call sites only ever pass COMPLETE/ESCALATE/ABORT, which don't need it.
function printOutcome(outcome: engine.Outcome, workflowName: string, ctx?: { wf: workflowMod.Workflow; cleared?: string[] }): never {
  switch (outcome.kind) {
    case "ADVANCE":
      return exitAfter(render.advance(outcome.phase, outcome.description, outcome.failure, ctx?.cleared), 0);
    case "COMPLETE":
      return exitAfter(render.complete(workflowName), 0);
    case "RETRY":
      return exitAfter(render.retry({ phase: outcome.phase, attempt: outcome.attempt, maxAttempts: outcome.maxAttempts, ...outcome.failure, cached: outcome.cached }), 1);
    case "ESCALATE":
      return exitAfter(render.escalate(outcome.reason), 2);
    case "ABORT":
      return exitAfter(render.abort(outcome.reason), 2);
    case "PENDING":
      // ctx.wf is guaranteed here: PENDING is only ever constructed inside evaluateNext,
      // itself only called from cmdNext after wf is loaded and threaded into ctx below.
      return exitAfter(render.pending(outcome.phase, ctx!.wf.phases[outcome.phase].description, outcome.ready), 1);
  }
}

function exitAfter(text: string, code: number): never {
  process.stdout.write(text);
  return process.exit(code);
}

function readFileOrEmpty(p: string | number): string {
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

function cmdStart(args: string[]): void {
  const workflowPath = resolveWorkflowPath(args);
  const wf = loadWorkflowOrExit(workflowPath);
  const cwd = process.cwd();

  const existing = state.readState(cwd);
  if (existing && existing.status === "running") {
    errorExit(`a headsign run is already in progress (phase: ${existing.phase}). Run \`headsign next\` to continue, or \`headsign abort\` to stop it.`);
  }

  const freshState: state.State = {
    workflow: wf.name, workflow_path: workflowPath, status: "running", phase: wf.entry,
    attempts: {}, total_iterations: 0, last_eval: null, end_reason: null, stop_nudges: 0,
  };
  state.writeState(cwd, freshState);
  ensureHeadsignGitignored(cwd);
  // The log is run-scoped: truncate/create it fresh so a previous run's history never
  // bleeds into this one, then record the run's first transition.
  state.initLog(cwd);
  state.appendLog(cwd, render.logLine(localIso(new Date()), { kind: "START", workflow: wf.name }, freshState));
  // Every run starts with a clean scratch dir: artifacts from a previous run (verdicts,
  // tickets, notes) must not leak into this one.
  const tmpDir = path.join(cwd, ".headsign", "tmp");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  const cleared = clearPhaseArtifacts(cwd, wf.phases[wf.entry]);
  exitAfter(render.start(wf.entry, wf.phases[wf.entry].description, cleared), 0);
}

// Runs the real evaluation (phase-missing guard, iteration limit, cache check, ready
// probe, gate, step/writeState) while cmdNext holds the lock. Returns the outcome instead
// of printing it: printOutcome calls process.exit, and the lock must be released before
// that happens (see releaseLock calls below and in cmdNext's caller). `cleared` is only
// ever set alongside an ADVANCE outcome.
function evaluateNext(cwd: string, wf: workflowMod.Workflow, current: state.State): { outcome: engine.Outcome; cleared?: string[] } {
  if (!wf.phases[current.phase]) {
    state.releaseLock(cwd);
    errorExit(
      `workflow '${current.workflow_path}' no longer defines phase '${current.phase}', which this run is currently on. ` +
        `Restore that phase in the workflow file, or run \`headsign abort <reason>\` to end this run.`,
    );
  }

  const limitHit = engine.checkIterationLimit(wf, current);
  if (limitHit) {
    state.writeState(cwd, limitHit.state);
    state.appendLog(cwd, render.logLine(localIso(new Date()), limitHit.outcome, limitHit.state));
    return { outcome: limitHit.outcome };
  }

  const hash = treehash.treeHash(cwd);
  if (engine.shouldUseCache(current, hash)) return { outcome: engine.cachedRetry(wf, current) };

  const phase = wf.phases[current.phase];
  // Ready probe: after the cache check, before the gate. The two are structurally
  // exclusive — shouldUseCache only ever fires on a previously FAILED, cached verdict
  // (last_eval), and no verdict can exist yet for a phase that was never ready to judge
  // in the first place. Not ready -> PENDING without touching state.json at all (no
  // writeState on this path): "stay put, don't count it" — the cell the transition table
  // was missing.
  if (phase.ready !== undefined && !gate.isReady(phase.ready, cwd, phase.env)) {
    return { outcome: { kind: "PENDING", phase: current.phase, ready: phase.ready } };
  }

  const gateResult = gate.runGate(phase.gate.checks, cwd, phase.env);
  const { state: nextState, outcome } = engine.step(wf, current, gateResult, hash);
  let cleared: string[] | undefined;
  if (outcome.kind === "ADVANCE") cleared = clearPhaseArtifacts(cwd, wf.phases[outcome.phase]);
  state.writeState(cwd, nextState);
  state.appendLog(cwd, render.logLine(localIso(new Date()), outcome, nextState, current.phase));
  return { outcome, cleared };
}

function cmdNext(): void {
  const cwd = process.cwd();
  const current = state.readState(cwd);
  if (!current) {
    errorExit(
      "no run in progress here. headsign uses the .headsign/ directory in the current directory and does not search parent directories — " +
        "run it from the directory that owns the workflow (usually the repo or git-worktree root). To begin one here, run `headsign start`.",
    );
  }
  if (current.status !== "running") printOutcome(engine.terminalOutcome(current), current.workflow);

  const wf = loadWorkflowOrExit(current.workflow_path);

  const lock = state.acquireLock(cwd);
  if (!lock.ok) {
    errorExit(`another \`headsign next\` is running in this repo (pid ${lock.pid}); wait for it to finish, or remove .headsign/lock if it is stale.`);
  }

  // Re-read state now that we hold the lock: the lock only serializes evaluation, it does
  // not make `current` (read before we even attempted to acquire it) current. Another
  // `next` can acquire, evaluate, write, and release entirely within the gap between our
  // pre-lock read and our own acquisition (loadWorkflowOrExit's YAML parse widens that
  // gap); acting on the stale `current` would silently overwrite that process's attempt
  // increment, which defeats the lock's entire purpose.
  const fresh = state.readState(cwd);
  if (!fresh) {
    state.releaseLock(cwd);
    errorExit("the run ended while acquiring the lock; re-run `headsign next`.");
  }
  if (fresh.status !== "running") {
    state.releaseLock(cwd);
    printOutcome(engine.terminalOutcome(fresh), fresh.workflow);
  }

  const { outcome, cleared } = evaluateNext(cwd, wf, fresh);
  state.releaseLock(cwd);
  printOutcome(outcome, wf.name, { wf, cleared });
}

function cmdAbort(args: string[]): void {
  const cwd = process.cwd();
  const current = state.readState(cwd);
  if (!current) {
    errorExit(
      "no run in progress to abort here. headsign uses the .headsign/ directory in the current directory and does not search parent " +
        "directories — run it from the directory that owns the workflow (usually the repo or git-worktree root).",
    );
  }
  if (current.status !== "running") {
    errorExit(`run for workflow '${current.workflow}' is already ${current.status}; nothing to abort.`);
  }

  const reason = args.join(" ");
  const nextState: state.State = { ...current, status: "aborted", end_reason: reason || null };
  state.writeState(cwd, nextState);
  state.appendLog(cwd, render.logLine(localIso(new Date()), { kind: "ABORT", reason }, nextState));
  exitAfter(render.abort(reason), 2);
}

function cmdValidate(args: string[]): void {
  const workflowPath = resolveWorkflowPath(args);
  const wf = loadWorkflowOrExit(workflowPath);
  exitAfter(render.validateOk(wf.name, Object.keys(wf.phases).length), 0);
}

function cmdStopHook(): void {
  const raw = readFileOrEmpty(0); // no stdin piped -> "", which evaluate() fails open on
  const decision = stophook.evaluate(process.cwd(), raw, localIso(new Date()));
  if (decision.block) stderrExit(`${decision.message}\n`, 2);
  process.exit(0);
}

// Human convenience only — outside the agent-facing contract (ADR-0002). The hidden
// stop-hook subcommand is deliberately omitted; the four commands are the whole surface.
const HELP_TEXT = `headsign — a tiny phase gate for coding agents

Usage:
  headsign start [name] [--workflow <path>]     start a run (name → .headsign/<name>.yaml)
  headsign next                                 run the current gate and answer with a verdict
  headsign abort [reason]                       end the run for good (records why)
  headsign validate [name] [--workflow <path>]  statically check a workflow file

\`next\` answers on line 1: ADVANCE / RETRY / PENDING / COMPLETE / ESCALATE / ABORT.
Exit codes: 0 advance or complete, 1 retry or pending, 2 escalate or abort,
3 usage or configuration error.

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
    case "validate": return cmdValidate(rest);
    case "stop-hook": return cmdStopHook();
    default: errorExit(`unknown command '${command}'. Run \`headsign --help\` for usage.`);
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`ERROR: ${(err as Error).message}\n`);
  process.exit(3);
}
