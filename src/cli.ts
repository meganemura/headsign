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
import * as session from "./session.ts";

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

// Shared by cmdNext and cmdStatus (ADR-0004/0008): both are cwd-only lookups of the same
// .headsign/state.json, so a missing run gets the same actionable guidance either way.
const NO_RUN_HERE_MESSAGE =
  "no run in progress here. headsign uses the .headsign/ directory in the current directory and does not search parent directories — " +
  "run it from the directory that owns the workflow (usually the repo or git-worktree root). To begin one here, run `headsign start`.";

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

  // Claim ownership at the moment of start (ADR-0008); null when no identifier is
  // available (unstamped, same as a pre-multi-session state.json — every session
  // nudges, same as today). driver_source mirrors that: "env" only when an id was
  // actually available to stamp, otherwise null — a new run always starts with a clean
  // (non-sticky) driver, never inheriting a previous run's "claim" stickiness.
  const startSid = session.resolveSessionId(process.env);
  const freshState: state.State = {
    workflow: wf.name, workflow_path: workflowPath, status: "running", phase: wf.entry,
    attempts: {}, total_iterations: 0, last_eval: null, end_reason: null, stop_nudges: 0,
    driver_session: startSid,
    driver_source: startSid !== null ? "env" : null,
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
  if (!current) errorExit(NO_RUN_HERE_MESSAGE);
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
  let fresh = state.readState(cwd);
  if (!fresh) {
    state.releaseLock(cwd);
    errorExit("the run ended while acquiring the lock; re-run `headsign next`.");
  }

  // Driver stamp (ADR-0008), right after the fresh re-read under the lock: claim/refresh
  // ownership so the Stop hook's owner check always compares against whoever most
  // recently called `next`. Only a *positive* identifier overwrites — a caller that
  // resolved no id (env stripped mid-run) must never orphan an existing driver — and only
  // a *changed* value is written, so the common case (same driver calling next
  // repeatedly) costs nothing extra, preserving PENDING's zero-write guarantee below.
  // driver_source !== "claim" is the stickiness rule from ADR-0009's claim handshake: once
  // the Stop hook has adopted a driver via `headsign claim`, this env-derived auto-stamp
  // must never silently overwrite it — only a *new* claim (or a fresh `start`) may. Any
  // other driver_source (including missing/corrupt) is plain overwritable, same as today.
  const sid = session.resolveSessionId(process.env);
  if (sid !== null && fresh.driver_source !== "claim" && fresh.driver_session !== sid) {
    fresh = { ...fresh, driver_session: sid, driver_source: "env" };
    state.writeState(cwd, fresh);
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

// Arms the driver-adoption marker (the claim handshake, ADR-0009 as re-homed by ADR-0010) —
// cwd-only, like next/abort/status. Deliberately writes nothing to state.json: the CLI
// process itself can never learn who is running it at agent granularity (only the
// SubagentStop hook's stdin carries an agent id), so `claim` can only ask that hook to do
// the actual adoption when this agent's own turn ends.
function cmdClaim(): void {
  const cwd = process.cwd();
  const current = state.readState(cwd);
  if (!current) errorExit(NO_RUN_HERE_MESSAGE);
  if (current.status !== "running") {
    errorExit(`run for workflow '${current.workflow}' is already ${current.status}; nothing to claim.`);
  }

  const tmpDir = path.join(cwd, ".headsign", "tmp");
  // A re-run (e.g. after a mistaken adoption) must harmlessly re-arm rather than fail: an
  // empty file's content is never read, only its existence — mkdir+write is idempotent.
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "claim"), "");
  exitAfter(render.claim(), 0);
}

function cmdValidate(args: string[]): void {
  // No-args default (ADR-0009): with a run present here — of any status, not just
  // running — validate the workflow it actually recorded (current.workflow_path), so a
  // named run (`headsign start myflow`) doesn't ENOENT against the plain
  // .headsign/workflow.yaml default. An explicit name/--workflow always overrides this
  // (resolveWorkflowPath's own precedence, unchanged); only the no-run-here fallback is
  // still the plain default.
  const current = state.readState(process.cwd());
  const defaultPath = current !== null ? current.workflow_path : ".headsign/workflow.yaml";
  const workflowPath = resolveWorkflowPath(args, defaultPath);
  const wf = loadWorkflowOrExit(workflowPath);
  exitAfter(render.validateOk(wf.name, Object.keys(wf.phases).length), 0);
}

// Read-only observation window (ADR-0002/0008), deliberately kept apart from `next`'s
// single judging question: no lock, no writeState, no gate/ready execution, no clock
// read, and cwd-only like `next`/`abort` (no walk-up). workflow.yaml is read best-effort
// only to resolve max_attempts for the attempt display — its content never gates
// anything here, so a broken workflow.yaml degrades the display instead of erroring out.
function cmdStatus(): void {
  const cwd = process.cwd();
  const current = state.readState(cwd);
  if (!current) errorExit(NO_RUN_HERE_MESSAGE);

  if (current.status !== "running") {
    exitAfter(render.statusTerminal(current.status, current.workflow, current.end_reason), 0);
  }

  const { workflow: wf } = workflowMod.load(current.workflow_path);
  const phase = wf?.phases[current.phase];
  const attempt = current.attempts[current.phase] ?? 0;

  const lastEval = current.last_eval;
  const lastFailure =
    lastEval !== null && lastEval.phase === current.phase
      ? { check: lastEval.check, run: lastEval.run, exitCode: lastEval.exit_code, timeoutSeconds: lastEval.timeout_seconds, outputTail: lastEval.output_tail }
      : null;

  // Never print the session id itself (nothing here is material for impersonation) —
  // only whether it matches the recorded driver, and legacy-tolerant the same way the
  // Stop hook's own owner check is (non-string driver_session -> null).
  //
  // driver_source === "claim" (ADR-0010) skips the match/mismatch judgment entirely: the
  // recorded driver is then an *agent* id, and the CLI can't resolve one at all (only the
  // SubagentStop hook's stdin carries it) — a delegated agent whose Bash env shows the
  // enclosing session's id would otherwise always misjudge "this session"/"another session"
  // here. Naming the fact ("a delegated agent" drives this run, whether or not that's the
  // reader) is honest about what the CLI can and can't know.
  let driver: "this session" | "another session" | "unknown" | "a delegated agent";
  if (current.driver_source === "claim") {
    driver = "a delegated agent";
  } else {
    const mySid = session.resolveSessionId(process.env);
    const driverSid = typeof current.driver_session === "string" && current.driver_session.length > 0 ? current.driver_session : null;
    driver = mySid === null || driverSid === null ? "unknown" : mySid === driverSid ? "this session" : "another session";
  }

  exitAfter(
    render.statusRunning({
      phase: current.phase,
      attempt,
      maxAttempts: phase?.max_attempts,
      attemptUnknown: phase === undefined,
      workflowName: current.workflow,
      lastFailure,
      driver,
    }),
    0,
  );
}

function cmdStopHook(): void {
  const raw = readFileOrEmpty(0); // no stdin piped -> "", which evaluate() fails open on
  const decision = stophook.evaluate(process.cwd(), raw, localIso(new Date()), process.env);
  if (decision.block) stderrExit(`${decision.message}\n`, 2);
  process.exit(0);
}

// The SubagentStop counterpart (ADR-0010) — same shape as cmdStopHook, different event and
// different identifier space: this one is answered from the stdin `agent_id`, and it is the
// only path that can seal a claim.
function cmdSubagentStopHook(): void {
  const raw = readFileOrEmpty(0); // no stdin piped -> "", which evaluateSubagent() fails open on
  const decision = stophook.evaluateSubagent(process.cwd(), raw, localIso(new Date()), process.env);
  if (decision.block) stderrExit(`${decision.message}\n`, 2);
  process.exit(0);
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
