// Responsibility: Stop hook decision — stdin JSON -> allow/block (ADR-0006).
// Must NOT know about: workflow.yaml, gate execution.

import { readState, writeState } from "./state.ts";

export interface HookDecision {
  block: boolean;
  message?: string;
}

const MAX_STOP_NUDGES = 3;

export function evaluate(cwd: string, stdinRaw: string): HookDecision {
  try {
    const state = readState(cwd);
    if (!state) return { block: false }; // sessions not using headsign must pay nothing

    const input = JSON.parse(stdinRaw) as { stop_hook_active?: boolean };
    // Undocumented as of this ADR's revision, but still honored when present: it's a
    // strictly stronger "you already unblocked me" signal than our own guard, and free to check.
    if (input.stop_hook_active) return { block: false };

    if (state.status !== "running") return { block: false }; // complete/escalated/aborted are correct endings

    // Loop guard (ADR-0006): only `next`'s real gate evaluations reset stop_nudges. Three
    // consecutive nudges with no real evaluation between them means nudging isn't working —
    // fail open rather than risk an unstoppable session.
    const nudges = state.stop_nudges ?? 0;
    if (nudges >= MAX_STOP_NUDGES) return { block: false };

    writeState(cwd, { ...state, stop_nudges: nudges + 1 });
    return {
      block: true,
      message: `headsign workflow '${state.workflow}' is still running (phase: ${state.phase}). Run \`headsign next\` and follow its verdict.`,
    };
  } catch {
    // Fail open: a corrupt state file or malformed hook payload must never trap the session.
    return { block: false };
  }
}
