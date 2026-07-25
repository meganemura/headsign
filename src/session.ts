// Responsibility: session identity + observer detection from the environment.
// Must NOT know about: state shape, hook protocol.

// Identifier source precedence (ADR-0008): HEADSIGN_SESSION_ID (explicit, harness-agnostic
// — any harness can export it to opt in) before CLAUDE_CODE_SESSION_ID (Claude Code's own
// auto-detected session id, an undocumented implementation detail that may vanish in a
// future Claude Code version — see the ADR for the degradation path when it does). Each
// candidate is trimmed and only accepted if non-empty, so a blank-but-set env var falls
// through to the next candidate instead of "winning" with an empty string. Returns null if
// neither yields anything — callers must treat that as "no positive identifier available",
// never as evidence of a match or a mismatch.
export function resolveSessionId(env: NodeJS.ProcessEnv): string | null {
  for (const key of ["HEADSIGN_SESSION_ID", "CLAUDE_CODE_SESSION_ID"]) {
    const raw = env[key];
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

// Manual opt-out (ADR-0008) for a session that is not driving this run and has no
// identifier to prove it — or simply wants to be unconditionally exempt. Any non-empty
// value passes both stop-boundary hooks — Stop and SubagentStop alike, since a session
// that opts out is opting its delegated agents' stops out too — regardless of driver
// ownership; the value itself is never inspected, presence is the whole signal
// (documented as `=1`).
export function isObserver(env: NodeJS.ProcessEnv): boolean {
  const raw = env["HEADSIGN_OBSERVER"];
  return typeof raw === "string" && raw.length > 0;
}
