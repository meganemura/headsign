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

function printOutcome(outcome: engine.Outcome, workflowName: string): never {
  switch (outcome.kind) {
    case "ADVANCE":
      return exitAfter(render.advance(outcome.phase, outcome.description, outcome.failure), 0);
    case "COMPLETE":
      return exitAfter(render.complete(workflowName), 0);
    case "RETRY":
      return exitAfter(render.retry({ phase: outcome.phase, attempt: outcome.attempt, maxAttempts: outcome.maxAttempts, ...outcome.failure, cached: outcome.cached }), 1);
    case "ESCALATE":
      return exitAfter(render.escalate(outcome.reason), 2);
    case "ABORT":
      return exitAfter(render.abort(outcome.reason), 2);
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
  for (const entry of ["state.json", "lock", "tmp/"]) {
    if (content.split("\n").some((l) => l.trim() === entry)) continue;
    const sep = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
    content = `${content}${sep}${entry}\n`;
  }
  if (content !== original) fs.writeFileSync(gitignorePath, content);
}

function clearPhaseArtifacts(cwd: string, phase: workflowMod.Phase): void {
  for (const rel of phase.clear ?? []) {
    // Best-effort: force suppresses ENOENT; a directory (EISDIR) or any other
    // error is ignored so a bad `clear` entry never wedges a transition.
    try { fs.rmSync(path.join(cwd, rel), { force: true }); } catch { /* best effort */ }
  }
}

function cmdStart(args: string[]): void {
  const workflowPath = resolveWorkflowPath(args);
  const wf = loadWorkflowOrExit(workflowPath);
  const cwd = process.cwd();

  const existing = state.readState(cwd);
  if (existing && existing.status === "running") {
    errorExit(`a headsign run is already in progress (phase: ${existing.phase}). Run \`headsign next\` to continue, or \`headsign abort\` to stop it.`);
  }

  state.writeState(cwd, {
    version: 1, workflow: wf.name, workflow_path: workflowPath, status: "running", phase: wf.entry,
    attempts: {}, total_iterations: 0, last_eval: null, history: [], end_reason: null, stop_nudges: 0,
  });
  ensureHeadsignGitignored(cwd);
  // Every run starts with a clean scratch dir: artifacts from a previous run (verdicts,
  // tickets, notes) must not leak into this one.
  const tmpDir = path.join(cwd, ".headsign", "tmp");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  clearPhaseArtifacts(cwd, wf.phases[wf.entry]);
  exitAfter(render.start(wf.entry, wf.phases[wf.entry].description), 0);
}

// Runs the real evaluation (phase-missing guard, iteration limit, cache check, gate,
// step/writeState) while cmdNext holds the lock. Returns the outcome instead of printing
// it: printOutcome calls process.exit, and the lock must be released before that happens
// (see releaseLock calls below and in cmdNext's caller).
function evaluateNext(cwd: string, wf: workflowMod.Workflow, current: state.State): engine.Outcome {
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
    return limitHit.outcome;
  }

  const hash = treehash.treeHash(cwd);
  if (engine.shouldUseCache(current, hash)) return engine.cachedRetry(wf, current);

  const phase = wf.phases[current.phase];
  const gateResult = gate.runGate(phase.gate.checks, cwd, gate.coerceEnv(phase.env));
  const { state: nextState, outcome } = engine.step(wf, current, gateResult, hash, new Date().toISOString());
  if (outcome.kind === "ADVANCE") clearPhaseArtifacts(cwd, wf.phases[outcome.phase]);
  state.writeState(cwd, nextState);
  return outcome;
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
  // increment and history entry, which defeats the lock's entire purpose.
  const fresh = state.readState(cwd);
  if (!fresh) {
    state.releaseLock(cwd);
    errorExit("the run ended while acquiring the lock; re-run `headsign next`.");
  }
  if (fresh.status !== "running") {
    state.releaseLock(cwd);
    printOutcome(engine.terminalOutcome(fresh), fresh.workflow);
  }

  const outcome = evaluateNext(cwd, wf, fresh);
  state.releaseLock(cwd);
  printOutcome(outcome, wf.name);
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
  state.writeState(cwd, { ...current, status: "aborted", end_reason: reason || null });
  exitAfter(render.abort(reason), 2);
}

function cmdValidate(args: string[]): void {
  const workflowPath = resolveWorkflowPath(args);
  const wf = loadWorkflowOrExit(workflowPath);
  exitAfter(render.validateOk(wf.name, Object.keys(wf.phases).length), 0);
}

function cmdStopHook(): void {
  const raw = readFileOrEmpty(0); // no stdin piped -> "", which evaluate() fails open on
  const decision = stophook.evaluate(process.cwd(), raw);
  if (decision.block) stderrExit(`${decision.message}\n`, 2);
  process.exit(0);
}

function main(): void {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "start": return cmdStart(rest);
    case "next": return cmdNext();
    case "abort": return cmdAbort(rest);
    case "validate": return cmdValidate(rest);
    case "stop-hook": return cmdStopHook();
    default: errorExit(`unknown command '${command ?? ""}'. Usage: headsign <start|next|abort|validate>`);
  }
}

try {
  main();
} catch (err) {
  process.stderr.write(`ERROR: ${(err as Error).message}\n`);
  process.exit(3);
}
