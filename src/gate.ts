// Responsibility: run one phase's gate checks in order, shell + env + timeout + output tail (ADR-0002/0003).
// Must NOT know about: routing, state.json, git.

import { spawnSync } from "node:child_process";
import type { Check } from "./workflow.ts";

export interface CheckFailure { check: string; run: string; exitCode: number | "timeout"; outputTail: string; timeoutSeconds?: number }
export type GateResult = { pass: true } | ({ pass: false } & CheckFailure);

const DEFAULT_TIMEOUT_SECONDS = 120;
const OUTPUT_TAIL_LIMIT = 4000;

export function runGate(checks: Check[], cwd: string, phaseEnv: Record<string, unknown> | undefined): GateResult {
  const env = phaseEnv ? Object.fromEntries(Object.entries(phaseEnv).map(([k, v]) => [k, String(v)])) : {};
  for (const c of checks) {
    const timeoutSeconds = c.timeout ?? DEFAULT_TIMEOUT_SECONDS;
    const check = c.name ?? c.run;
    const result = spawnSync("/bin/sh", ["-c", c.run], {
      cwd,
      env: { ...process.env, ...env },
      timeout: timeoutSeconds * 1000,
      // Node's spawnSync default maxBuffer is 1MB; a verbose-but-passing check
      // (e.g. a large test suite) can legitimately print more than that.
      maxBuffer: 64 * 1024 * 1024,
      encoding: "utf8",
    });
    const outputTail = buildTail(result.stdout ?? "", result.stderr ?? "");
    const spawnError = result.error as NodeJS.ErrnoException | undefined;
    if (spawnError?.code === "ETIMEDOUT") {
      return { pass: false, check, run: c.run, exitCode: "timeout", outputTail, timeoutSeconds };
    }
    if (spawnError) {
      // The runner itself couldn't execute/complete the check (e.g. ENOBUFS despite
      // maxBuffer) — this is a headsign-level failure, not the check's own nonzero
      // exit, and must be reported unambiguously as such, not as a RETRY-worthy fail.
      return {
        pass: false, check, run: c.run, exitCode: -1,
        outputTail: `headsign: could not run check '${check}' (${spawnError.code}) — see below\n${outputTail}`,
      };
    }
    if (result.status !== 0) return { pass: false, check, run: c.run, exitCode: result.status ?? -1, outputTail };
  }
  return { pass: true };
}

function buildTail(stdout: string, stderr: string): string {
  const combined = stdout + stderr;
  const truncated = combined.length > OUTPUT_TAIL_LIMIT;
  const tail = combined.slice(-OUTPUT_TAIL_LIMIT).trim();
  if (tail.length === 0) return "(no output)";
  return truncated ? `… (output truncated)\n${tail}` : tail;
}
