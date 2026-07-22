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
