# ADR-0037: A running run introduces itself at session start

- Revised: 2026-09-22 (the hooks guide embedded in agy 1.2.7 lists five
  events: `PreToolUse`, `PostToolUse`, `PreInvocation`, `PostInvocation`, and
  `Stop`. Its `PreInvocation` hook calls the same discovery on the first
  invocation and returns the notice as an ephemeral message. ADR-0028 §3
  records the adapter).

## Context

ADR-0027 protects bystanders by withholding another session's Stop nudge,
which creates a handover gap until the new session runs `headsign next`.

`state.json` provides the discovery data: running status, workflow, phase, and
the first line of a consumed pause note in `last_stop`.

`SessionStart` provides a different boundary from `Stop`. Output from this
hook can inform a new session without holding a turn or claiming a driver.

## Decision

The plugin registers a `SessionStart` hook. It searches upward from the hook's
`cwd` and stops at the first Git boundary. When it finds a running run, it
prints the workflow, phase, and the last pause note when one exists. It tells
the authorized driver to inspect the run with `headsign status`, perform the
phase's unfinished work, and then judge it with `headsign next`.

Clarified on 2026-09-13: `RUNNING` means persisted unfinished work. It does not
assert that an agent process is active. Discovery starts no phase work or
delegation. The responsible agent performs that work before asking the gate.

The hook labels all state values as untrusted data and quotes each value. Its
read-only scope covers state lookup and notice output. The gate engine owns
gate execution, and the stop hooks own persistent records and driver choices.

The hook stays silent when it finds no run, when the run has ended, or when it
cannot parse its input or state. Discovery must not prevent a session from
starting.

## Consequences

- A new session can discover a paused or active run before its first turn.
- A bystander can also see the notice, which leaves its turn and stop-nudge
  budget unchanged.
- The Stop hook passes on a `last_drive.session` mismatch, and the handover
  backstop gap remains until the new session runs `headsign next`.
- This decision keeps the state model unchanged: `stop-note` releases one
  turn, and `next` judges the current phase when its work is ready.
