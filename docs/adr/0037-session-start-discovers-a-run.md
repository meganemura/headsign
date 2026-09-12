# ADR-0037: A running run introduces itself at session start

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
the reader to inspect the run with `headsign status` and continue it with
`headsign next`.

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
  turn, and `next` resumes the running run.
