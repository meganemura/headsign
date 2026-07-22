# ADR-0002: One question (`next`), the output contract, and the transition table

- Status: accepted
- Date: 2026-07-23

## Context

Beads (`bd ready`) demonstrates that agent discipline compresses well when
there is exactly one question to ask. Splitting `status` / `gate` / `next`
into separate commands multiplies the rules an agent must remember and the
ways it can go wrong after compaction.

## Decision

### Four commands, one question

| Command | Role |
|---|---|
| `headsign start [name] [--workflow path]` | initialize state, show the entry phase's instructions |
| `headsign next` | **the only question.** Run the current gate, transition, answer |
| `headsign abort [reason]` | record a human-directed stop |
| `headsign validate [name] [--workflow path]` | static check of workflow.yaml |

A bare `<name>` resolves to `.headsign/<name>.yaml`; `--workflow <path>`
still takes an explicit path, and the two are mutually exclusive.

`next` is the only command that transitions state. RETRY output doubles as
the remaining-work list (the failing check and its output tail), which is
why no `status` command exists.

(A hidden `stop-hook` subcommand exists for the plugin's Stop hook — it is
plumbing invoked by Claude Code itself, not part of the agent-facing
surface. See ADR-0006.)

### Output contract

Line 1 is a machine-readable token; everything after is instruction text for
Claude. Output is English (public OSS tool; the token line is the contract,
so prose language is cosmetic).

```
START <phase>       exit 0   (from `headsign start`)
ADVANCE <phase>     exit 0
RETRY <n>[/<max>] <phase>   exit 1
COMPLETE            exit 0
ESCALATE <reason>   exit 2
ABORT <reason>      exit 2
```

Configuration/usage errors exit 3. (These are CLI exit codes; unrelated to
hook exit-code semantics.)

`next` is idempotent on terminal states: calling it after COMPLETE reprints
COMPLETE (exit 0); after escalation/abort it reprints that outcome (exit 2).
This is what makes "when in doubt, run `headsign next`" safe advice,
including right after `/compact`.

### Transition table (the whole routing rule set)

Evaluated on `headsign next` for the current phase P:

| Event | Route field | Allowed values | Effect |
|---|---|---|---|
| gate passes | `on_pass` (required) | phase name, `$end` | ADVANCE to phase / COMPLETE |
| gate fails, attempts < max | `on_fail` (default `retry`) | `retry`, phase name, `$end`, `escalate`, `abort` | RETRY / ADVANCE(with failure note) / COMPLETE / ESCALATE / ABORT |
| gate fails, attempts ≥ `max_attempts` | `on_exhausted` (default `escalate`) | `escalate`, `abort` | ESCALATE / ABORT |
| `limits.max_total_iterations` reached | — | — | ESCALATE (checked before evaluating) |

Notes:

- A fail-routed phase transition (e.g. review rejected → back to implement)
  emits **ADVANCE** with a "gate failed → routed to X" note. Claude only
  needs to know where to go; four tokens stay four.
- `max_attempts` absent means unlimited per-phase retries;
  `limits.max_total_iterations` is the global runaway backstop.
- Checks run in order and stop at the first failure; its `name` (or `run`
  text) plus a stdout/stderr tail become the RETRY message.

## Consequences

- The skill can teach one rule: obey the first-line token.
- Adding a fifth token or a fifth command requires revisiting this ADR —
  which is the intended friction.
