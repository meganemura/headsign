// Responsibility: read/write .headsign/state.json; owns the run-state shape (ADR-0004).
// Also owns I/O for .headsign/log (a sibling, run-scoped transition log; see ADR-0004) —
// line formatting itself lives in render.ts's logLine, not here.
// Must NOT know about: routing rules, the workflow YAML schema.

import fs from "node:fs";
import path from "node:path";

type Status = "running" | "complete" | "escalated" | "aborted";

// Named for what it actually holds: not "the last evaluation" (it is null after a pass, a
// route, and any terminal outcome — only a *failure* ever lands here) but the last failure
// headsign observed. The name also matches the one place it surfaces, `status`'s
// `--- last failure: … ---` block, which is the reason the field exists at all.
// Not `current_failure`: by the time anyone reads it the agent may have already fixed the
// failure without running `next`, so headsign can only honestly claim the last one it saw.
export interface LastFailure {
  phase: string;
  check: string; run: string; exit_code: number | "timeout"; output_tail: string; timeout_seconds?: number;
}
export interface State {
  workflow: string; workflow_path: string; status: Status; phase: string;
  attempts: Record<string, number>; total_iterations: number; last_failure: LastFailure | null;
  end_reason: string | null; stop_nudges: number;
  // Who currently drives this run: the agent id sealed by the SubagentStop hook's adoption
  // gate when a delegated agent that ran `headsign claim` ends its own turn (ADR-0010),
  // or null when nobody has claimed the run.
  //
  // Named `driver_agent`, not the `driver_session` of ADR-0008/0010: the adoption
  // gate is now the only writer, and what that gate writes is always an agent id.
  // A session id can no longer land here, so calling the field `session` would be a lie
  // (ADR-0013). The companion `driver_source` field went with it — one writer means one
  // identifier space, so there is nothing left to discriminate.
  //
  // A state.json written before this rename simply lacks the field; readers must treat
  // anything that isn't a string (missing, or a legacy/corrupt non-string value) as null,
  // the same tolerant idiom stophook.ts already uses for stop_nudges.
  //
  // The missing-field half of that tolerance is TRANSITIONAL, and this is the ONE place the
  // criterion for removing it is written — the two reader sites (stophook.ts's
  // recordedDriver, engine.ts's status) point here instead of restating it. It exists only
  // so a run already in progress across the rename keeps working; nothing headsign writes
  // today can produce a state.json without this field. It can go once no run started before
  // the release that renamed the field can plausibly still be in progress — i.e. that
  // release has shipped and enough time has passed that any older run has finished, been
  // aborted, or been abandoned. A run is one work session in one directory, not a long-lived
  // record, so that window is short: one release cycle is ample. Removing it means dropping
  // the `typeof … === "string"` guards at both reader sites for a plain null check. The
  // non-string *corrupt*-value half of the tolerance is not transitional and stays — a
  // hand-edited state.json is always possible.
  driver_agent: string | null;
}

export function statePath(cwd: string): string {
  return path.join(cwd, ".headsign", "state.json");
}

export function readState(cwd: string): State | null {
  const p = statePath(cwd);
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, "utf8")) as State) : null;
}

export function writeState(cwd: string, state: State): void {
  const dir = path.join(cwd, ".headsign");
  fs.mkdirSync(dir, { recursive: true });
  const target = statePath(cwd);
  // Temp file + rename in the same dir: a process killed mid-write must never
  // leave a half-written (unparseable) state.json behind.
  const tmp = path.join(dir, `.state.json.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
  fs.renameSync(tmp, target);
}

export function lockPath(cwd: string): string {
  return path.join(cwd, ".headsign", "lock");
}

export function logPath(cwd: string): string {
  return path.join(cwd, ".headsign", "log");
}

// Truncates (or creates) the run-transition log. Called once, by `start`, so each run's
// log begins empty — call sites and exact line format are owned by render.ts/engine.ts.
export function initLog(cwd: string): void {
  fs.mkdirSync(path.join(cwd, ".headsign"), { recursive: true });
  fs.writeFileSync(logPath(cwd), "");
}

export function appendLog(cwd: string, line: string): void {
  fs.mkdirSync(path.join(cwd, ".headsign"), { recursive: true });
  fs.appendFileSync(logPath(cwd), line);
}

// Serializes concurrent `headsign next` in the same .headsign/ (e.g. multiple subagents
// delegated to at once): an exclusive create is atomic, so exactly one caller wins.
export function acquireLock(cwd: string): { ok: true } | { ok: false; pid: number } {
  fs.mkdirSync(path.join(cwd, ".headsign"), { recursive: true });
  const p = lockPath(cwd);
  const tryCreate = (): { ok: true } | null => {
    try {
      const fd = fs.openSync(p, "wx");
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return { ok: true };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      return null;
    }
  };

  const first = tryCreate();
  if (first) return first;

  const holderPid = readLockPid(p);
  if (holderPid !== null && isAlive(holderPid)) return { ok: false, pid: holderPid };

  // A crashed holder must not wedge future runs forever: an unparseable or dead pid
  // means the lock outlived its owner, so steal it and retry once.
  try {
    fs.unlinkSync(p);
  } catch {
    // already gone — fall through to the retry below
  }
  const second = tryCreate();
  if (second) {
    // Two processes can both observe the same dead holder and both unlink+create; since
    // pids are distinct, a read-back after the steal tells us whether we actually won or
    // the other stealer's create landed last and clobbered ours.
    if (readLockPid(p) === process.pid) return { ok: true };
    return { ok: false, pid: readLockPid(p) ?? -1 };
  }
  return { ok: false, pid: readLockPid(p) ?? -1 };
}

export function releaseLock(cwd: string): void {
  try {
    // Only remove the lock if we're still its owner — a concurrent stealer may have
    // already taken over the (previously dead) lock we think we hold.
    if (readLockPid(lockPath(cwd)) === process.pid) fs.unlinkSync(lockPath(cwd));
  } catch {
    // nothing to release, or another process already cleaned it up
  }
}

function readLockPid(p: string): number | null {
  try {
    const n = Number.parseInt(fs.readFileSync(p, "utf8").trim(), 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means a process with that pid exists but we can't signal it — still alive.
    // ESRCH (or anything else) means no such process — treat as dead.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
