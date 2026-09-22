// Responsibility: Antigravity lifecycle hooks — stdin JSON -> stdout JSON.
// Stop: prevents premature agent termination when workflow is still running.
// PreInvocation: surfaces running/paused workflow notice at session start (invocationNum === 1).
// Antigravity uses the installed plugin directory as the hook cwd, so cwd cannot identify a workspace.
// Must NOT know about: workflow.yaml, gate execution.

import * as stophook from "./stophook.ts";
import * as sessionhook from "./sessionhook.ts";

export interface AntigravityStopInput {
  conversationId?: string;
  workspacePaths?: string[];
  executionNum?: number;
  terminationReason?: string;
  error?: string;
  fullyIdle?: boolean;
}

export interface AntigravityStopOutput {
  decision: "continue" | "allow";
  reason?: string;
}

export interface AntigravityPreInvocationInput {
  invocationNum?: number;
  initialNumSteps?: number;
  workspacePaths?: string[];
  conversationId?: string;
}

export interface AntigravityPreInvocationOutput {
  injectSteps: Array<{ ephemeralMessage: string }>;
}

export function evaluateStop(
  stdinRaw: string,
  nowIso: string,
  env: NodeJS.ProcessEnv,
): AntigravityStopOutput {
  try {
    const input = JSON.parse(stdinRaw) as AntigravityStopInput;
    if (typeof input !== "object" || input === null) return { decision: "allow" };

    // If terminated due to an error, fail open to avoid trapping a broken agent.
    if (input.terminationReason === "error" || (typeof input.error === "string" && input.error.length > 0)) {
      return { decision: "allow" };
    }

    if (!Array.isArray(input.workspacePaths) || typeof input.workspacePaths[0] !== "string" || input.workspacePaths[0].length === 0) {
      return { decision: "allow" };
    }
    const startDir = input.workspacePaths[0];

    const synthesizedPayload = JSON.stringify({
      cwd: startDir,
      session_id: typeof input.conversationId === "string" && input.conversationId.length > 0 ? input.conversationId : undefined,
    });

    const decision = stophook.evaluate(startDir, synthesizedPayload, nowIso, env);
    if (decision.block && typeof decision.message === "string" && decision.message.length > 0) {
      return { decision: "continue", reason: decision.message };
    }
    return { decision: "allow" };
  } catch {
    return { decision: "allow" };
  }
}

export function evaluatePreInvocation(
  stdinRaw: string,
): AntigravityPreInvocationOutput {
  try {
    const input = JSON.parse(stdinRaw) as AntigravityPreInvocationInput;
    if (typeof input !== "object" || input === null) return { injectSteps: [] };

    // Only inject at session start (first invocation).
    if (typeof input.invocationNum === "number" && input.invocationNum > 1) {
      return { injectSteps: [] };
    }

    if (!Array.isArray(input.workspacePaths) || typeof input.workspacePaths[0] !== "string" || input.workspacePaths[0].length === 0) {
      return { injectSteps: [] };
    }
    const startDir = input.workspacePaths[0];

    const notice = sessionhook.evaluate(startDir, JSON.stringify({ cwd: startDir }));
    if (notice !== null && typeof notice.message === "string" && notice.message.length > 0) {
      return { injectSteps: [{ ephemeralMessage: notice.message }] };
    }
    return { injectSteps: [] };
  } catch {
    return { injectSteps: [] };
  }
}
