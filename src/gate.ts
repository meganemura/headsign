// Responsibility: run one phase's gate checks in order, shell + env + timeout + output tail (ADR-0002/0003).
// Must NOT know about: routing, state.json, git.

import { spawnSync } from "node:child_process";
import type { Check } from "./workflow.ts";

export interface CheckFailure { check: string; run: string; exitCode: number | "timeout"; outputTail: string; timeoutSeconds?: number }
export type GateResult = { pass: true } | ({ pass: false } & CheckFailure);

const DEFAULT_TIMEOUT_SECONDS = 120;
const OUTPUT_TAIL_LIMIT = 4000;

export function runGate(checks: Check[], cwd: string, env: Record<string, string>): GateResult {
  for (const c of checks) {
    const timeoutSeconds = c.timeout ?? DEFAULT_TIMEOUT_SECONDS;
    const check = c.name ?? c.run;
    const result = spawnSync("/bin/sh", ["-c", c.run], {
      cwd,
      env: { ...process.env, ...env },
      timeout: timeoutSeconds * 1000,
      encoding: "utf8",
    });
    const outputTail = buildTail(result.stdout ?? "", result.stderr ?? "");
    if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") {
      return { pass: false, check, run: c.run, exitCode: "timeout", outputTail, timeoutSeconds };
    }
    if (result.status !== 0) return { pass: false, check, run: c.run, exitCode: result.status ?? -1, outputTail };
  }
  return { pass: true };
}

export function coerceEnv(env: Record<string, unknown> | undefined): Record<string, string> {
  return env ? Object.fromEntries(Object.entries(env).map(([k, v]) => [k, String(v)])) : {};
}

function buildTail(stdout: string, stderr: string): string {
  const combined = stdout + stderr;
  const truncated = combined.length > OUTPUT_TAIL_LIMIT;
  const tail = combined.slice(-OUTPUT_TAIL_LIMIT).trim();
  if (tail.length === 0) return "(no output)";
  return truncated ? `… (output truncated)\n${tail}` : tail;
}
