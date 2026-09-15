# ADR-0041: A command that names its caller

- Status: accepted
- Date: 2026-09-15
- Amends [ADR-0013](0013-claim-only-driver-identity.md) §1: the `SubagentStop`
  adoption gate is no longer the only writer of `driver_agent`. A command
  that carries an engine-attributed agent id writes it too. The reason
  ADR-0013 retired the environment stamp is restated below, and this
  decision does not reopen that path.
- Amends [ADR-0010](0010-subagent-stop-identity.md) Decision 1 in the same
  way; the seal itself is unchanged.
- Amends [ADR-0027](0027-recording-who-drove-a-run.md) §2.1: `last_drive.session`
  has a second source, read ahead of `CLAUDE_CODE_SESSION_ID` in the same
  function.
- Amends [ADR-0028](0028-codex-as-a-second-principal.md) §4: the
  session-attribution boundary now differs by host, and this ADR says how.
- Relates to [ADR-0033](0033-the-one-variable-headsign-sets.md): headsign
  now reads one variable that its own plugin writes. ADR-0033 governs what
  headsign sets for the commands it runs; this ADR governs what the plugin
  sets for the commands the agent runs.
- Relates to [ADR-0040](0040-the-run-pane-is-a-claude-only-overlay.md): the
  hook lives in the same module, under the same placement and the same bet.

## Context

A delegated agent (a subagent or a teammate) shares the process and the
environment of the session that spawned it. No command it runs can say which
agent ran it. ADR-0009, ADR-0010, and ADR-0013 built the claim ceremony on
that fact: the agent runs `headsign claim`, ends its turn, and the
`SubagentStop` hook seals the `agent_id` that event carries. The skill's rule 2
teaches the ceremony, and its length measures what the fact costs.

Function hooks change the fact on one host. A module's `tool.call` hook sees
each Bash command before the shell does, together with the loop that issued
it: `e.agentId` in a subagent's loop and nothing in the session's own loop.
`$.session.id()` names the session. The hook may rewrite the command.

Four measurements on 2026-09-15 decided the design:

1. A subagent's `tool.call` `agentId` is the same string as the `agent_id`
   its `SubagentStop` carries. The seal and the stamp name one agent by one
   identifier.
2. `$.session.id()` in a subagent's loop is the main session's id, and it is
   the same string as the Stop payload's `session_id`. The `Stop` comparison
   in ADR-0027 §3 keeps its meaning.
3. A rewritten `e.command` is what the shell runs. `export NAME='…'; <command>`
   survives a `cd … &&` and a pipeline inside the command, and the Bash tool's
   shell state does not carry the variable into the next call.
4. In a scratch repository, a nested session ran `start` from its own loop and
   `next` from a subagent, with no `claim`. The state file then held that
   subagent's id as `driver_agent`, and the only held turn was that
   subagent's.

One thing stayed unmeasured: what `$.session.id()` and `agentId` carry inside
a teammate's loop. This machine has agent teams disabled and a `-p` session
cannot create them.

## Decision

### 1. The module exports `HEADSIGN_ACTOR` in front of each `headsign` command

The `tool.call` hook for Bash, in the plugin's one function-hooks module,
matches a command that names `headsign` or `headsign.mjs` with a subcommand.
It prefixes `export HEADSIGN_ACTOR='<value>'; ` and passes the rest of the
chain the rewritten command. The value is `<session>` in the session's own
loop and `<session>/<agentId>` in a subagent's. Both halves must match
`[A-Za-z0-9_-]+`; otherwise the command passes through unchanged. A command
that does not name `headsign` is never touched, so `npm test` run from a
session inherits nothing.

An `export` rather than a `NAME=value` prefix, because the prefix form sets
the variable for the first word only, and agents write `cd <repo> && headsign
next`.

### 2. The CLI reads it in the one place it reads a session id

`resolveDriveSession` in `stophook.ts` is still the one reader of
`CLAUDE_CODE_SESSION_ID`. It now reads `HEADSIGN_ACTOR` first, in the same
function, and returns its session half when the value is well formed. A new
`resolveDriveAgent` returns the agent half or null. `driveStamp` is unchanged
and keeps calling the one function. A malformed value reads as absent whole:
it cannot stamp a partial name.

### 3. What each half writes

- **The session half** stamps `last_drive.session` exactly where
  `CLAUDE_CODE_SESSION_ID` did (ADR-0027 §5), and wins over it when both are
  present. It was written for this one command; the other describes the
  process.
- **An agent half** stamps `driver_agent` at `start` and at every `next`
  that reaches the run, and resets `stop_nudges` when the seat changes, as
  the seal does. A named agent takes the seat from a previously sealed or
  stamped one: the stamp is positive evidence about this command, and the
  most recent driver is the one the hooks should hold.
- **No agent half** (the session's own loop) leaves `driver_agent` as it is.
  A lead that runs `next` on a delegated driver's behalf is ordinary, and
  unseating the driver on every such lap would reopen the hole ADR-0009's
  sticky rule closed.

### 4. Why this is not the environment stamp ADR-0013 retired

ADR-0013 retired a stamp read from process variables because every such
variable describes the enclosing session, so a delegated agent's `next` named
the wrong party. `HEADSIGN_ACTOR` is not process-scoped. The engine attributes
each `tool.call` to its loop, the module writes the value for that one
command, and the shell forgets it before the next command runs. The trap
ADR-0013 named, two mechanisms resolving one name in different orders, is
avoided by reading both variables in one function with one stated order.

### 5. The claim ceremony stays

`headsign claim` and the `SubagentStop` seal are unchanged. They remain the
path on Codex, on a Claude Code without function hooks, on a managed Claude
Code where a user-tier module may not run, and for a teammate until
measurement says what its loop carries. Where the module loads, a delegated
agent that runs `next` is seated by that command and the ceremony is
redundant. The skill says so in one sentence and keeps the ceremony's
instructions.

### 6. Gate commands inherit the variable

ADR-0033 lets every command a gate runs inherit headsign's own environment.
A gate check that runs `headsign status` therefore sees `HEADSIGN_ACTOR` too.
`status` writes nothing, so nothing is recorded by that route. The test
suite strips the variable where it spawns the CLI, as it strips
`CLAUDE_CODE_SESSION_ID`.

## The future bet

- **Assumed change.** Function hooks ship enabled by default, and `tool.call`
  keeps carrying `agentId` for a subagent's loop and a rewritable `command`
  for Bash.
- **Expected value.** On Claude Code, a delegated agent drives a run by
  running `next`, with no claim, no turn end spent on a seal, and no seat
  taken by whichever agent stopped first. The skill's longest rule becomes
  a fallback.
- **Uncertainty.** Teammates are unmeasured. If a teammate's loop reports the
  lead's session and no `agentId`, a teammate's `next` stamps `last_drive`
  with the lead's session and leaves `driver_agent` alone; the lead's `Stop`
  then matches and the teammate is not held. That is the pre-ADR-0027
  behavior for that case, and the claim ceremony still covers it.
- **Reason to reconsider.** A teams-enabled interactive session that logs
  `$.session.id()` and `agentId` from a teammate's Bash call. If a teammate
  carries its own `agentId`, this decision covers teammates and the ceremony
  can be retired on this host. If it carries none, the module needs a
  teammate-specific source or the ceremony stays.

## Consequences

- `state.json` gains no field. `driver_agent` and `last_drive` keep their
  shapes and their readers.
- `src/` reads `HEADSIGN_ACTOR` in one function beside the one reader of
  `CLAUDE_CODE_SESSION_ID`.
- The plugin's module carries two hooks on `tool.call` for Bash: the stamp,
  registered first, and the pane's refresh, which reads the command after the
  prefix.
- Codex behavior is unchanged: no module loads, no variable is set, and the
  ADR-0028 §4 boundary holds there as written.
