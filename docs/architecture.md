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
judges, writes state, exits. Claude's single discipline is: **when in doubt,
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

Core budget: `src/` targets roughly **500 lines of code** (tests excluded,
and counting code only — the deliberately dense AI-friendly comments and
blank lines don't count). It currently sits at **984 code lines** (raw
`wc -l` is higher, ~1520, because of those comments) — roughly twice the
target, after the concurrency lock, the git-root tree-hash fix,
ready:/PENDING, the transition log, multi-session driver ownership, and the
two stop-boundary hooks landed. Each was individually justified and none is
obviously removable, which is exactly the shape of drift ADR-0001 says to
watch: at 2× the guideline, the next feature proposal should face the "does
a thin harness need this?" question with real suspicion, and a proposal that
adds a *third* identity mechanism should probably be answered by
consolidating the first two instead. Recount with:

```sh
for f in src/*.ts; do grep -vE '^\s*//' "$f" | grep -vE '^\s*$'; done | wc -l
```

The 500 figure is a guideline, not a hard cap: per ADR-0001 it "is a design
smell detector, not a hard compiler limit" — a number drifting past it is a
signal to periodically check for design bloat, not a fact to fix by deleting
lines.

| Module | Responsibility | Must NOT know about |
|---|---|---|
| `src/cli.ts` | argv parsing, command dispatch, printing, process exit code | routing rules, YAML schema |
| `src/workflow.ts` | load + validate `workflow.yaml`; owns the schema types | state.json, gates, git |
| `src/state.ts` | read/write `state.json` (atomic write); owns the state shape | routing rules, YAML |
| `src/gate.ts` | run one phase's checks (shell, env, timeout, output tail) | routing, state, git |
| `src/treehash.ts` | working-tree fingerprint for the attempts cache; all git interaction | everything else |
| `src/engine.ts` | the transition function: (workflow, state, gate result) → (new state, outcome). The ONLY place routing rules live | child_process, printing |
| `src/render.ts` | outcome → text. The ONLY place the output contract is written | how outcomes were computed |
| `src/stophook.ts` | Stop and SubagentStop hooks: stdin JSON → allow/block | workflow.yaml, gates |

`render.ts` owns the entire outcome contract (the START/ADVANCE/RETRY/COMPLETE/ESCALATE/ABORT
strings and `validate`'s output); `cli.ts`'s `ERROR:` messages (exit code 3, for usage/config
problems like bad argv or a workflow that fails to load) are a separate, deliberately
unceremonious channel, not part of that contract.

## Data flow of `headsign next`

1. Load `workflow.yaml` (path recorded in state) and `state.json`. Any load
   error → exit 3.
2. If status is terminal (`complete` / `escalated` / `aborted`), reprint the
   terminal outcome idempotently and exit. `next` is safe to call at any time.
3. If `limits.max_total_iterations` is reached → ESCALATE.
4. Cache check: if the working tree is unchanged since the last **failed**
   evaluation of this same phase, reprint the cached RETRY without counting
   an attempt (ADR-0004).
5. Run the current phase's checks in order; stop at the first failure.
6. Route per the transition table (ADR-0002), persist state, print the
   outcome, exit with the contract code.

## Where the intelligence lives

Thin Harness, Fat Skills. The CLI is a state machine; everything smart lives
outside it:

- **SKILL.md** teaches Claude the loop discipline (five rules, no more).
- **Gate checks** are user-authored shell commands — tests, linters, grep
  for a reviewer's verdict file. headsign only reads their exit codes.
- **Stop-boundary hooks** are the backstop: skills are instructions, not
  guarantees. If the run's driver tries to stop while a run is `running`,
  the hook (exit 2) sends it back to `headsign next` (ADR-0006). Two events
  are watched because a driver can be either a session (`Stop`) or a
  delegated agent (`SubagentStop`), and only the latter's payload can name
  such an agent at all (ADR-0010).

## Design records

- [ADR-0001](adr/0001-thin-harness.md) — thin harness: Claude drives, CLI holds state; non-goals
- [ADR-0002](adr/0002-single-question-and-output-contract.md) — one question (`next`), output contract, transition table
- [ADR-0003](adr/0003-workflow-yaml-vocabulary.md) — YAML vocabulary: what we borrow, what we refuse
- [ADR-0004](adr/0004-state-attempts-and-cache.md) — state shape, per-phase attempts, tree-hash cache
- [ADR-0005](adr/0005-distribution-and-toolchain.md) — TypeScript, esbuild single-file bundle, dependency policy
- [ADR-0006](adr/0006-stop-hook-backstop.md) — Stop hook semantics
- [ADR-0007](adr/0007-verdict-authorship.md) — verdict authorship: the gate-hardness scale
- [ADR-0008](adr/0008-multi-session-ownership.md) — multi-session runs: driver ownership, observers, `status`
- [ADR-0009](adr/0009-claim-handshake.md) — the claim handshake (superseded by ADR-0010)
- [ADR-0010](adr/0010-subagent-stop-identity.md) — sealing driver identity on `SubagentStop`
