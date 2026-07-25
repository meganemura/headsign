// Responsibility: Stop hook decision — stdin JSON -> allow/block (ADR-0006).
// Must NOT know about: workflow.yaml, gate execution.

import fs from "node:fs";
import path from "node:path";
import { readState, writeState, statePath, appendLog } from "./state.ts";
import { logLine } from "./render.ts";
import { isObserver } from "./session.ts";

interface HookDecision {
  block: boolean;
  message?: string;
}

const MAX_STOP_NUDGES = 5;

// The hook's own identifier resolution (ADR-0008) — deliberately narrower than
// session.resolveSessionId: the stdin `session_id` field already *is* Claude Code's
// CLAUDE_CODE_SESSION_ID (the two are documented to match), so only the explicit
// HEADSIGN_SESSION_ID override is worth an extra env fallback here; re-checking
// CLAUDE_CODE_SESSION_ID from env would just re-derive what stdin already gave us.
function resolveHookSessionId(input: { session_id?: unknown }, env: NodeJS.ProcessEnv): string | null {
  const fromStdin = typeof input.session_id === "string" ? input.session_id.trim() : "";
  if (fromStdin.length > 0) return fromStdin;
  const fromEnv = typeof env.HEADSIGN_SESSION_ID === "string" ? env.HEADSIGN_SESSION_ID.trim() : "";
  return fromEnv.length > 0 ? fromEnv : null;
}

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

export function evaluate(cwd: string, stdinRaw: string, nowIso: string, env: NodeJS.ProcessEnv): HookDecision {
  // Manual opt-out (ADR-0008): checked before stdin is even parsed, so a session that
  // knows it isn't driving this run passes through unconditionally, even if the hook
  // payload itself is malformed.
  if (isObserver(env)) return { block: false };

  try {
    const input = JSON.parse(stdinRaw) as { stop_hook_active?: boolean; cwd?: string; session_id?: string };

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

    // Both exits (pause via note, or end for good via abort) are named on every block, not
    // only the last one, so a human who wants out never has to hunt for how. Computed here
    // (depends only on runDir/startDir, already known) so the adoption gate below and the
    // ordinary nudge message further down can share the identical wording.
    const notePathForMessage = runDir === startDir ? ".headsign/tmp/stop-note" : `${runDir}/.headsign/tmp/stop-note`;
    const pauseAndAbortHint = ` To pause, write one line explaining why to ${notePathForMessage} and stop again; to end the run for good, run \`headsign abort <reason>\`.`;

    // Adoption gate (ADR-0009's claim handshake): a claim marker means some session ran
    // `headsign claim` and ended its turn, waiting for the Stop hook to seal it as this
    // run's driver — the CLI itself can never learn the session-granular id (only the hook's
    // stdin can), so this is the one place that identifier can actually be recorded. Checked
    // BEFORE the owner comparison below, on purpose: otherwise a just-claiming session that
    // doesn't yet match the (possibly stale, possibly wrong) old driver would be passed
    // through as a mismatched bystander instead of adopted — exactly backwards.
    const claimPath = path.join(runDir, ".headsign", "tmp", "claim");
    if (fs.existsSync(claimPath)) {
      const claimSid = resolveHookSessionId(input, env);
      if (claimSid !== null) {
        // Consume the marker: like the stop-note below, a claim is a one-shot request —
        // leaving it in place would re-adopt on every future stop, not just this one.
        fs.rmSync(claimPath, { force: true });
        const adoptedState = { ...state, driver_session: claimSid, driver_source: "claim" as const, stop_nudges: 0 };
        writeState(runDir, adoptedState);
        appendLog(runDir, logLine(nowIso, { kind: "CLAIMED" }, adoptedState));
        const adoptionMessage =
          `Claim confirmed: this session now drives workflow '${state.workflow}' (phase: ${state.phase}). ` +
          "Run `headsign next` and follow its verdict." +
          pauseAndAbortHint;
        return { block: true, message: adoptionMessage };
      }
      // No session identifier resolvable from anywhere (neither stdin nor
      // HEADSIGN_SESSION_ID): leave the marker in place for a later, hopefully
      // identifiable, stop to consume instead — adopting an unnamed driver would defeat
      // the owner check claim exists to feed. `start`'s tmp/ wipe eventually reclaims a
      // marker that's never consumed, so this can't wedge a run permanently.
    }

    // Owner check (ADR-0008): a session whose identifier disagrees with the run's
    // recorded driver is a bystander, not the one this nudge is meant for — checked here,
    // BEFORE the exit-note gate below, so a bystander's stop can never consume the actual
    // driver's one-shot pause note. Only fires when BOTH sides resolve to a positive
    // identifier: if either is missing, there is nothing to compare, so this falls
    // through to the unchanged nudge flow (ADR-0006 fail-open — absence must never be
    // read as a mismatch).
    const hookSid = resolveHookSessionId(input, env);
    const driver = typeof state.driver_session === "string" && state.driver_session.length > 0 ? state.driver_session : null;
    if (hookSid !== null && driver !== null && hookSid !== driver) return { block: false };

    // Exit-note gate (ADR-0006): the primary mechanism for a deliberate pause. Checked
    // before the nudge/loop-guard logic below, so a human (or agent) who wants out never
    // has to wait for or count nudges — writing one line and stopping again is immediate.
    const notePath = path.join(runDir, ".headsign", "tmp", "stop-note");
    if (fs.existsSync(notePath)) {
      const noteRaw = fs.readFileSync(notePath, "utf8");
      const trimmedNote = noteRaw.trim();
      if (trimmedNote.length > 0) {
        const firstLine = trimmedNote.split(/\r?\n/)[0].trim().slice(0, 120);
        // Consume the note: leaving it in place would turn a one-time note into a
        // permanent free pass, the same staleness bug a stale cached verdict would be.
        fs.rmSync(notePath, { force: true });
        const pausedState = { ...state, stop_nudges: 0 };
        writeState(runDir, pausedState);
        appendLog(runDir, logLine(nowIso, { kind: "PAUSED", note: firstLine }, pausedState));
        return { block: false };
      }
    }

    // Loop guard (ADR-0006): a safety net for the case where the agent can't even write a
    // stop-note (a stuck loop, or an agent that has silently departed) — only `next`'s real
    // gate evaluations reset stop_nudges. Five consecutive nudges with no real evaluation
    // (and no note) between them means nudging isn't working — fail open rather than risk
    // an unstoppable session. N=5 is an arbitrary safety value, not a load-bearing constant.
    // ?? alone doesn't catch a non-null but wrong-type value (e.g. a corrupt/forged/legacy
    // state.json with stop_nudges as a string): "x" + 1 would string-concatenate to "x1",
    // which is always < 5, disabling the fail-open guard forever. Require an actual number.
    const nudges = typeof state.stop_nudges === "number" && Number.isFinite(state.stop_nudges) ? state.stop_nudges : 0;
    if (nudges >= MAX_STOP_NUDGES) return { block: false };

    const nextNudges = nudges + 1;
    const nudgedState = { ...state, stop_nudges: nextNudges };
    writeState(runDir, nudgedState);
    // The final nudge alone gets a `stalled` log line: 1st-4th nudges (and any pass-through
    // after the cap trips) are deliberately silent (ADR-0004's spam-prevention rule) — only
    // the moment the loop guard actually trips is worth a permanent record.
    if (nextNudges === MAX_STOP_NUDGES) appendLog(runDir, logLine(nowIso, { kind: "STALLED" }, nudgedState));

    // `next`/`abort` stay strictly cwd-only (ADR-0004), so when the run was found via
    // walk-up (runDir !== startDir) the agent must be told where to cd first — cwd-only
    // `next` will not find the run from startDir itself.
    const verdictSentence =
      runDir === startDir
        ? `headsign workflow '${state.workflow}' is still running (phase: ${state.phase}). Run \`headsign next\` and follow its verdict.`
        : `headsign workflow '${state.workflow}' is still running (phase: ${state.phase}) in ${runDir}. cd there and run \`headsign next\`, then follow its verdict.`;
    // The final-reminder phrase rides only on the nudge that trips the cap: earlier nudges
    // must keep pushing `headsign next`, not dilute it with "this is your last chance".
    const finalNotice = nextNudges === MAX_STOP_NUDGES ? " This is the final automatic reminder." : "";
    const message = verdictSentence + finalNotice + pauseAndAbortHint;
    return { block: true, message };
  } catch {
    // Fail open: a corrupt state file or malformed hook payload must never trap the session.
    return { block: false };
  }
}
