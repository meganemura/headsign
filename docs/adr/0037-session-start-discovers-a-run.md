# ADR-0037: A running run introduces itself at session start

## Context

ADR-0027 stopped a second session from receiving another session's Stop
nudge. That rule protects bystanders. It also creates a handover gap. A new
session receives no signal until it runs `headsign next`.

The run already has the information needed for discovery. `state.json` says
whether it is running and names its workflow and phase. A consumed pause note
also leaves its first line in `last_stop`.

`SessionStart` provides a different boundary from `Stop`. Output from this
hook can inform a new session without holding a turn or claiming a driver.

## Decision

The plugin registers a `SessionStart` hook. It searches upward from the hook's
`cwd` and stops at the first Git boundary. When it finds a running run, it
prints the workflow, phase, and the last pause note when one exists. It tells
the reader to inspect the run with `headsign status` and continue it with
`headsign next`.

The hook labels all state values as untrusted data and quotes each value. It
does not run a gate. It does not write state, logs, locks, or markers. It does
not decide that the current session owns the run.

The hook stays silent when it finds no run, when the run has ended, or when it
cannot parse its input or state. Discovery must not prevent a session from
starting.

## Consequences

- A new session can discover a paused or active run before its first turn.
- A bystander can also see the notice. The notice does not hold its turn and
  does not consume the stop-nudge budget.
- The Stop hook still passes on a `last_drive.session` mismatch. The handover
  backstop gap remains until the new session runs `headsign next`.
- `stop-note` remains a one-turn exit ticket. This decision adds no paused
  state and no resume command.
