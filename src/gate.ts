// Responsibility: run one phase's gate checks in order, shell + timeout + output tail
// (ADR-0002/0003), and resolve a k-way `on_pass` by running its `when:` predicates (ADR-0011).
// Both are "run shell, read exit code" — the routing *rules* still live in engine.ts; this
// module only reports which branch answered yes.
// Must NOT know about: state.json, git.
//
// Every command here inherits headsign's own environment unmodified (ADR-0014): a phase
// cannot declare variables, because `FOO=bar cmd` in the `run:` string already says it, in
// the shell the workflow author is already writing.

import { spawnSync } from "node:child_process";
import type { Check, Route } from "./workflow.ts";

export interface CheckFailure { check: string; run: string; exitCode: number | "timeout"; outputTail: string; timeoutSeconds?: number }
export type GateResult = { pass: true } | ({ pass: false } & CheckFailure);

const DEFAULT_TIMEOUT_SECONDS = 120;
const OUTPUT_TAIL_LIMIT = 4000;

export function runGate(checks: Check[], cwd: string): GateResult {
  for (const c of checks) {
    const timeoutSeconds = c.timeout ?? DEFAULT_TIMEOUT_SECONDS;
    const check = c.name ?? c.run;
    const result = spawnSync("/bin/sh", ["-c", c.run], {
      cwd,
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

// Readiness probe for a phase's optional `ready:` field, mirroring runGate's spawnSync
// pattern (same shell, same cwd). exitCode 0 -> ready (the real gate should be
// evaluated); nonzero -> not ready (PENDING, no attempt counted).
export function isReady(sh: string, cwd: string): boolean {
  const result = spawnSync("/bin/sh", ["-c", sh], {
    cwd,
    timeout: DEFAULT_TIMEOUT_SECONDS * 1000,
    stdio: "ignore",
  });
  // Fail toward evaluating on a spawn error (bad cwd, timeout, ...): a broken probe
  // must not silently stall the run behind PENDING forever — running the real gate and
  // producing an actual verdict is the safer failure mode.
  if (result.error) return true;
  return result.status === 0;
}

// --- resolveRoute: which branch of a k-way `on_pass` takes the pass (ADR-0011) ---

export type RouteResolution =
  | { kind: "matched"; to: string; when: string }
  | { kind: "default"; to: string }
  | { kind: "error"; when: string; reason: string };

// Evaluated only after the gate has already passed. Entries are tried top to bottom and the
// first `when:` to exit 0 wins; the entry without a `when:` (validated to be the last one) is
// the default. Mirrors runGate's spawnSync pattern (same shell, cwd, timeout default), but
// discards output like isReady does: a `when:` is a predicate, and nothing here is ever
// shown to the agent.
//
// Fails toward stopping, unlike isReady: a nonzero exit is a real answer ("not this branch"),
// but a probe that could not run at all has produced no answer, and the thing being decided
// here is the destination itself. Silently taking the default would move the run to a phase
// nobody declared for that situation — see ADR-0011.
export function resolveRoute(routes: Route[], cwd: string): RouteResolution {
  for (const route of routes) {
    if (route.when === undefined) return { kind: "default", to: route.to };
    const timeoutSeconds = route.timeout ?? DEFAULT_TIMEOUT_SECONDS;
    const result = spawnSync("/bin/sh", ["-c", route.when], {
      cwd,
      timeout: timeoutSeconds * 1000,
      stdio: "ignore",
    });
    const spawnError = result.error as NodeJS.ErrnoException | undefined;
    if (spawnError?.code === "ETIMEDOUT") {
      return { kind: "error", when: route.when, reason: `timed out after ${timeoutSeconds}s` };
    }
    if (spawnError) return { kind: "error", when: route.when, reason: `could not run it (${spawnError.code})` };
    if (result.status === 0) return { kind: "matched", to: route.to, when: route.when };
  }
  // Unreachable for a validated workflow: the last entry always omits `when` and returns
  // "default" above. Kept total rather than asserted, so a hand-built Route[] can't fall off
  // the end silently.
  return { kind: "error", when: "", reason: "no default destination (the last on_pass entry must have no 'when')" };
}

function buildTail(stdout: string, stderr: string): string {
  const combined = stdout + stderr;
  const truncated = combined.length > OUTPUT_TAIL_LIMIT;
  const tail = combined.slice(-OUTPUT_TAIL_LIMIT).trim();
  if (tail.length === 0) return "(no output)";
  return truncated ? `… (output truncated)\n${tail}` : tail;
}
