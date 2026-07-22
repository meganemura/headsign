// Responsibility: read/write .headsign/state.json; owns the run-state shape (ADR-0004).
// Must NOT know about: routing rules, the workflow YAML schema.

import fs from "node:fs";
import path from "node:path";

export type Status = "running" | "complete" | "escalated" | "aborted";

export interface LastEval {
  phase: string; result: "fail"; tree_hash: string | null;
  check: string; run: string; exit_code: number | "timeout"; output_tail: string; timeout_seconds?: number;
}
export interface HistoryEntry { phase: string; result: "pass" | "fail"; at: string }
export interface State {
  version: number; workflow: string; workflow_path: string; status: Status; phase: string;
  attempts: Record<string, number>; total_iterations: number; last_eval: LastEval | null;
  history: HistoryEntry[]; end_reason: string | null; stop_nudges: number;
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
