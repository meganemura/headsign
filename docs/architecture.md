# Architecture

> A headsign is the destination display on the front of a train. This one is
> for agent loops: each iteration, the agent asks where it's bound; headsign
> runs the gates and answers — proceed, retry, or terminus.

headsign is a **phase gate** for coding agents. Claude Code drives the work;
headsign holds the workflow state and decides transitions. The judgment is
always deterministic (shell exit codes) — the LLM never participates in the
verdict, it only reads it.

## The loop

```
┌──────────────┐  headsign next   ┌──────────────────────────┐
│ Claude Code  │ ───────────────▶ │ headsign CLI             │
│ (drives,     │                  │ 1. read  .headsign/state │
│  does the    │ ◀─────────────── │ 2. run   gate checks     │
│  work)       │  ADVANCE/RETRY/  │ 3. write .headsign/state │
└──────────────┘  COMPLETE/       │ 4. exit                  │
                  ESCALATE        └──────────────────────────┘
```

There is no long-running process. Every invocation starts, reads state,
judges, writes state, exits. Claude's single discipline is: **do the work,
run `headsign next` and obey the first-line token.**

## Components

```
plugin/                          # what gets distributed (Claude Code plugin)
  .claude-plugin/plugin.json
  skills/workflow/SKILL.md       # the discipline taught to Claude
  hooks/hooks.json               # the two stop-boundary hooks (the backstop)
  dist/headsign.mjs              # single-file bundle (committed; see ADR-0005)
src/                             # TypeScript sources (bundled into dist/)
docs/                            # this file + ADRs

consumer repository:
  .headsign/workflow.yaml        # workflow definition (committed)
  .headsign/state.json           # run state (never committed)
```

## Module map

Size: `src/` measured **983 code lines** on 2026-07-28 (tests excluded, and
counting code only — the deliberately dense AI-friendly comments and blank
lines don't count; raw `wc -l` is ~1661). That is a measurement, not a
target. ADR-0001's budget of roughly 500 code lines is retired by
[ADR-0016](adr/0016-explainability-as-the-fitness-function.md): `src/` went
past twice the number without the guideline stopping a single feature
proposal, while every design problem actually found in the ADR-0008..0015
run was found because an explanation would not come out straight. Recount
when you want the current number:

```sh
for f in src/*.ts; do grep -vE '^\s*//' "$f" | grep -vE '^\s*$'; done | wc -l
```

What replaced it asks the question the count could not: **can each function
here be explained to a middle-school reader?** `.headsign/fitness.yaml`
sweeps `src/*.ts` function by function and fails on the ones nobody can
explain, by name — so a failure points at a place instead of at a total. The
question every feature proposal still has to answer is ADR-0001's: does a
thin harness need this?

| Module | Responsibility | Must NOT know about |
|---|---|---|
| `src/cli.ts` | argv parsing, command dispatch, printing, process exit code | routing rules, YAML schema |
| `src/workflow.ts` | load + validate `workflow.yaml`; owns the schema types | state.json, gates, git |
| `src/state.ts` | read/write `state.json` (atomic write); owns the state shape | routing rules, YAML |
| `src/gate.ts` | run one phase's checks (shell, timeout, output tail); resolve which route of a list-form `on_pass` matched, by running its `when:` commands the same way (ADR-0011) | what a route target means, state, git |
| `src/engine.ts` | the transition function: (workflow, state, gate result, resolved route) → (new state, outcome). The ONLY place routing rules live — a resolved route arrives as data and is applied here, never evaluated here | child_process, printing |
| `src/render.ts` | outcome → text. The ONLY place the output contract is written | how outcomes were computed |
| `src/stophook.ts` | Stop and SubagentStop hooks: stdin JSON → allow/block; the `HEADSIGN_OBSERVER` opt-out, the one env signal headsign reads (ADR-0013) | workflow.yaml, gates |

`render.ts` owns the entire outcome contract (the START/ADVANCE/RETRY/COMPLETE/ESCALATE/ABORT
strings and `validate`'s output); `cli.ts`'s `ERROR:` messages (exit code 3, for usage/config
problems like bad argv or a workflow that fails to load) are a separate, deliberately
unceremonious channel, not part of that contract.

## Data flow of `headsign next`

1. Load `workflow.yaml` (path recorded in state) and `state.json`. Any load
   error → exit 3.
2. If status is terminal (`complete` / `escalated` / `aborted`), reprint the
   terminal outcome idempotently and exit — a finished run stays finished
   however many times it is asked.
3. If `limits.max_total_iterations` is reached → ESCALATE, without writing
   state: the run stays `running`, so raising the limit and asking again
   resumes the same phase (ADR-0017). Checked before the gate, so standing at
   that wall costs no iteration.
4. Run the current phase's checks in order; stop at the first failure.
   There is no cache in front of this step: every `next` that gets here
   judges, and a failure costs an attempt (ADR-0012).
5. If they all passed and this phase's `on_pass` is a list of routes, run
   the routes' `when:` commands in order and resolve which one matched
   (ADR-0011). A `when:` that could not be run at all → exit 3.
6. Route per the transition table (ADR-0002), persist state, print the
   outcome, exit with the contract code.

## Where the intelligence lives

Thin Harness, Fat Skills. The CLI is a state machine; everything smart lives
outside it:

- **SKILL.md** teaches Claude the loop discipline (seven numbered rules; if
  it needs an eighth, prefer sharpening one of the seven).
- **Gate checks** are user-authored shell commands — tests, linters, grep
  for a reviewer's verdict file. headsign only reads their exit codes.
- **Stop-boundary hooks** are the backstop: skills are instructions, not
  guarantees. If the run's driver tries to stop while a run is `running`,
  the hook (exit 2) sends it back to `headsign next` (ADR-0006). Two events
  are watched because a turn can end in two ways: `Stop` for a session,
  `SubagentStop` for a delegated agent. Only `SubagentStop` carries an
  identifier that can name its stopper, so it is the only event that can
  record a driver — and, since ADR-0013, the only one that compares
  anything. `Stop` nudges whoever stops while nobody has claimed the run,
  and passes every session once someone has.

## Design records

- [ADR-0001](adr/0001-thin-harness.md) — thin harness: Claude drives, CLI holds state; non-goals
- [ADR-0002](adr/0002-single-question-and-output-contract.md) — one question (`next`), output contract, transition table
- [ADR-0003](adr/0003-workflow-yaml-vocabulary.md) — YAML vocabulary: what we borrow, what we refuse
- [ADR-0004](adr/0004-state-attempts-and-cache.md) — state shape, per-phase attempts, cwd-only resolution, the lock
- [ADR-0005](adr/0005-distribution-and-toolchain.md) — TypeScript, esbuild single-file bundle, dependency policy
- [ADR-0006](adr/0006-stop-hook-backstop.md) — stop-boundary hook semantics (both events)
- [ADR-0007](adr/0007-verdict-authorship.md) — verdict authorship: measured vs judged gates, and the three tiers of a judged one
- [ADR-0008](adr/0008-multi-session-ownership.md) — multi-session runs: driver ownership, observers, `status` (its env stamp retracted by ADR-0013)
- [ADR-0009](adr/0009-claim-handshake.md) — the claim handshake (superseded by ADR-0010)
- [ADR-0010](adr/0010-subagent-stop-identity.md) — sealing driver identity on `SubagentStop`
- [ADR-0011](adr/0011-k-way-routing-on-pass.md) — k-way routing on `on_pass`: `when:`/`to:` routes, and unreachable phases as warnings
- [ADR-0012](adr/0012-removing-the-tree-hash-cache.md) — removing the tree-hash cache: every `next` judges, `max_attempts` counts judgments
- [ADR-0013](adr/0013-claim-only-driver-identity.md) — claim-only driver identity: the environment stamp retired, `Stop` compares nothing
- [ADR-0014](adr/0014-removing-three-unused-knobs.md) — removing three unused knobs: phase `env:`, `on_exhausted:`, `on_fail: abort`
- [ADR-0015](adr/0015-strict-schema-and-version-0-1.md) — unknown keys rejected, and the schema renumbered to `version: 0.1`
- [ADR-0016](adr/0016-explainability-as-the-fitness-function.md) — explainability replaces the line budget; the rule for a run that rewrites its own workflow
- [ADR-0017](adr/0017-three-budgets-and-the-recoverable-ceiling.md) — three budgets; the global ceiling escalates without ending the run
