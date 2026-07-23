// Responsibility: Stop hook decision — stdin JSON -> allow/block (ADR-0006).
// Must NOT know about: workflow.yaml, gate execution.

import fs from "node:fs";
import path from "node:path";
import { readState, writeState, statePath } from "./state.ts";

interface HookDecision {
  block: boolean;
  message?: string;
}

const MAX_STOP_NUDGES = 3;

// Walk up from startDir to find a run's .headsign/state.json, bounded by the enclosing
// git worktree/repo root: stop at (and including) the first directory containing a `.git`
// entry (a directory in a normal checkout, a FILE in a linked worktree). This lets the
// backstop fire from any subdirectory of the run's project, while never crossing a worktree
// boundary into a sibling/parent checkout — which is why the rest of headsign stays cwd-only.
// fs only: the hook fires on every session stop and must not pay for a git subprocess.
function findRunDir(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(statePath(dir))) return dir;
    if (fs.existsSync(path.join(dir, ".git"))) return null; // repo/worktree root, no run here — stop
    const parent = path.dirname(dir);
    if (parent === dir) return null; // filesystem root
    dir = parent;
  }
}

export function evaluate(cwd: string, stdinRaw: string): HookDecision {
  try {
    const input = JSON.parse(stdinRaw) as { stop_hook_active?: boolean; cwd?: string };

    // The stdin `cwd` is the hook's authoritative session cwd per Claude Code's Stop-hook
    // docs (it reflects any `cd` during the session); fall back to the invocation cwd for
    // callers/tests that don't set it.
    const startDir = typeof input.cwd === "string" && input.cwd.length > 0 ? input.cwd : cwd;
    const runDir = findRunDir(startDir);
    if (!runDir) return { block: false }; // no headsign run reachable from here — near-no-op

    // Undocumented as of this ADR's revision, but still honored when present: it's a
    // strictly stronger "you already unblocked me" signal than our own guard, and free to check.
    if (input.stop_hook_active) return { block: false };

    const state = readState(runDir);
    if (!state) return { block: false }; // race: vanished between findRunDir and here
    if (state.status !== "running") return { block: false }; // complete/escalated/aborted are correct endings

    // Loop guard (ADR-0006): only `next`'s real gate evaluations reset stop_nudges. Three
    // consecutive nudges with no real evaluation between them means nudging isn't working —
    // fail open rather than risk an unstoppable session.
    // ?? alone doesn't catch a non-null but wrong-type value (e.g. a corrupt/forged/legacy
    // state.json with stop_nudges as a string): "x" + 1 would string-concatenate to "x1",
    // which is always < 3, disabling the fail-open guard forever. Require an actual number.
    const nudges = typeof state.stop_nudges === "number" && Number.isFinite(state.stop_nudges) ? state.stop_nudges : 0;
    if (nudges >= MAX_STOP_NUDGES) return { block: false };

    const nextNudges = nudges + 1;
    writeState(runDir, { ...state, stop_nudges: nextNudges });
    // Every nudge names `headsign abort` as the clean way out — not only the final one —
    // so a human who wants to stop mid-run never has to hunt for how.
    const abortHint = " To stop this run instead, run `headsign abort <reason>`.";
    const finalNotice = nextNudges === MAX_STOP_NUDGES ? " This is the final automatic reminder." : "";
    // `next`/`abort` stay strictly cwd-only (ADR-0004), so when the run was found via
    // walk-up (runDir !== startDir) the agent must be told where to cd first — cwd-only
    // `next` will not find the run from startDir itself.
    const message =
      (runDir === startDir
        ? `headsign workflow '${state.workflow}' is still running (phase: ${state.phase}). Run \`headsign next\` and follow its verdict.`
        : `headsign workflow '${state.workflow}' is still running (phase: ${state.phase}) in ${runDir}. cd there and run \`headsign next\`, then follow its verdict.`) +
      finalNotice + abortHint;
    return { block: true, message };
  } catch {
    // Fail open: a corrupt state file or malformed hook payload must never trap the session.
    return { block: false };
  }
}
