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

Size: `src/` measured **1,113 code lines** on 2026-07-28 (tests excluded, and
counting code only — the deliberately dense AI-friendly comments and blank
lines don't count; raw `wc -l` is ~1945). That is a measurement, not a
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
| `src/cli.ts` | argv parsing, command dispatch, printing, process exit code — one typed command becomes one `engine.ts` call, and the value it answers with becomes text and a status. Also the one clock read (`localIso(new Date())`), passed down as an argument | routing rules — *including the order `next` asks its questions in* (ADR-0018) — the YAML schema, what any operation does to a run |
| `src/workflow.ts` | load + validate `workflow.yaml`; owns the schema types, and the fingerprint of the *rules* a run is walking under (ADR-0023) — a fact about the schema and the reachability walk, both of which are this module's | state.json, gates, git |
| `src/state.ts` | read/write `state.json` (atomic write); owns the state shape, the graph pin's three fields included | routing rules, YAML |
| `src/gate.ts` | run one phase's checks (shell, timeout, output tail); resolve which route of a list-form `on_pass` matched, by running its `when:` commands the same way (ADR-0011) | what a route target means, state, git |
| `src/engine.ts` | one operation on a run — `start`, one lap of `next`, `abort`, `claim`, `status` — carried out and reported as a value. The ONLY place routing rules live, *the order a lap asks its questions in included* (ADR-0018); inside it, `step()` is still the pure transition function (workflow, state, gate result, resolved route) → (new state, outcome), and a resolved route still arrives as data rather than being evaluated here | argv, how an answer is worded, what it exits with, the clock |
| `src/render.ts` | outcome → text. The ONLY place the output contract is written | how outcomes were computed |
| `src/stophook.ts` | Stop and SubagentStop hooks: stdin JSON → allow/block; the `HEADSIGN_OBSERVER` opt-out, the one env signal headsign reads (ADR-0013) | workflow.yaml, gates |

`render.ts` owns the entire outcome contract (the START/ADVANCE/RETRY/COMPLETE/ESCALATE/ABORT
strings and `validate`'s output); the `ERROR:` messages (exit code 3, for usage/config
problems like bad argv, a workflow that fails to load, or an operation that refuses) are a
separate, deliberately unceremonious channel, not part of that contract. `cli.ts` prints
every one of them, whether it worded the message itself (bad argv) or an `engine.ts` refusal
handed it the words.

## Data flow of `headsign next`

Steps 1–7 are one function, `engine.ts`'s `next` — the order below *is* part
of the routing rules, which is why it lives with them (ADR-0018). It takes
the concurrency lock after step 1 (parsing YAML is the widest window another
process could act in, so the parse happens outside the lock) and releases it
in a `finally`, then hands its answer back to `cli.ts`, which prints it and
chooses the exit code.

1. Load `workflow.yaml` (path recorded in state) and `state.json`. Any load
   error → exit 3.
2. If status is terminal (`complete` / `escalated` / `aborted`), reprint the
   terminal outcome idempotently and exit — a finished run stays finished
   however many times it is asked.
3. Compare the workflow's rules against the fingerprint this run pinned —
   before anything reads a rule, since the ceiling, the probe, the gate and
   `step()` all do. A difference is reported once (ESCALATE, run stays
   `running`); asking again accepts and counts it (ADR-0023).
4. If `limits.max_total_iterations` is reached → ESCALATE, without writing
   state: the run stays `running`, so raising the limit and asking again
   resumes the same phase (ADR-0017). Checked before the gate, so standing at
   that wall costs no iteration.
5. Run the current phase's checks in order; stop at the first failure.
   There is no cache in front of this step: every `next` that gets here
   judges, and a failure costs an attempt (ADR-0012). A check that could not
   be run at all — no exit code to read — is not a failure: the lap refuses
   with exit 3 and writes nothing, as does a `ready:` probe that could not be
   run (ADR-0021).
6. If they all passed and this phase's `on_pass` is a list of routes, run
   the routes' `when:` commands in order and resolve which one matched
   (ADR-0011). A `when:` that could not be run at all → exit 3.
7. Route per the transition table (ADR-0002), persist state, and answer;
   `cli.ts` prints the outcome and exits with the contract code.

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
- [ADR-0018](adr/0018-cli-engine-seam.md) — the seam between `cli.ts` and `engine.ts`: the order of a lap is a routing rule, so the five run operations move
- [ADR-0021](adr/0021-a-command-that-never-ran-is-not-an-answer.md) — an unrunnable check or `ready:` probe refuses the lap instead of failing it; a timeout stays a verdict
- [ADR-0022](adr/0022-validate-checks-that-a-run-can-end.md) — `validate` warns on a pass-edge cycle with no ceiling: `max_attempts` clears on a pass, so it cannot bound one
- [ADR-0023](adr/0023-pinning-the-graph-a-run-is-walking-under.md) — a run pins the rules it walks under; a change is reported once and counted when accepted
- [ADR-0024](adr/0024-the-log-survives-a-restart.md) — `start` stops truncating `.headsign/log`; the `start` line is the seam between runs
