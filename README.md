# headsign

[日本語](README.ja.md)

> A headsign is the destination display on the front of a train. This one is
> for agent loops: each iteration, the agent asks where it's bound; headsign
> runs the gates and answers — proceed, retry, or terminus.

**headsign is a tiny phase gate for coding agents.** Claude Code drives the
work and keeps the conversation; headsign holds the workflow state and decides
phase transitions. The verdict is always deterministic — shell commands and
their exit codes — the LLM never participates in the judgment, it only reads
it.

The whole discipline an agent needs fits in one sentence: **when in doubt, run
`headsign next` and obey the first line of the answer.**

```
$ headsign next
RETRY 2/5 implement
--- gate failed: unit tests (bundle exec rspec, exit 1) ---
Failures:
  1) Billing::Invoice#total ...
Fix the failure above, then run `headsign next` again.
```

## Why

- **Thin harness, fat skills.** The intelligence lives in your workflow's gate
  commands (shell you write) and the skill that teaches the loop discipline.
  The CLI is a state machine — no long-running process; each invocation reads
  state, judges, writes state, exits.
- **Deterministic transitions.** Tools that let the LLM signal "phase done" in
  its own output can't guarantee the one decision that matters. Here a phase
  advances only when its checks exit 0.
- **One question.** No `status`, no `gate`, no dashboard. `next` both judges
  and, on failure, prints the remaining-work list — the failing check and its
  output.
- **Claude stays in charge.** Unlike outer-loop runners that invoke the LLM as
  a subordinate, headsign is a place Claude asks a question, not a process
  that owns Claude.

## Install (Claude Code plugin)

```
/plugin marketplace add meganemura/headsign
/plugin install headsign@headsign
```

The plugin ships three things: the bundled CLI (no npm install, no build), a
`workflow` skill teaching the discipline, and a Stop hook that keeps the agent
from silently quitting mid-workflow.

## Quick start

1. Commit a workflow to your repository:

```yaml
# .headsign/workflow.yaml
version: 1
name: feature-dev
entry: plan

phases:
  plan:
    description: Write the spec to docs/spec.md, including acceptance criteria.
    gate:
      checks:
        - name: spec exists
          run: "test -s docs/spec.md"
        - name: acceptance criteria present
          run: "grep -q '## Acceptance' docs/spec.md"
    on_pass: implement
    max_attempts: 3

  implement:
    description: Implement per the spec, test-first.
    gate:
      checks:
        - name: unit tests
          run: "bundle exec rspec"
          timeout: 300
    on_pass: review
    max_attempts: 5

  review:
    description: >
      Have a read-only reviewer subagent report APPROVED or REJECTED, then
      write that verdict yourself to .headsign/tmp/verdict.
    clear: [.headsign/tmp/verdict]
    ready: "test -f .headsign/tmp/verdict"
    gate:
      checks:
        - name: review approved
          run: "grep -qx APPROVED .headsign/tmp/verdict"
    on_pass: $end
    on_fail: implement     # rejection loops back
    max_attempts: 3        # three rejections → escalate to the human

limits:
  max_total_iterations: 20
```

The `run:` commands above are examples. Replace `bundle exec rspec` with whatever your project actually uses (`npm test`, `pytest`, `go test ./...`, …); a check is just a shell command judged by its exit code.

> **Trust:** a workflow's `run:` commands are shell that `headsign next` executes on your machine, exactly like a `Makefile` target or an npm `postinstall` script. Treat a `.headsign/workflow.yaml` from a repository you didn't write as you would any other executable code in it: read it before running `headsign start` or `headsign next`, and don't run headsign in a repository you don't trust. The same goes for `.headsign/state.json` and `.headsign/lock`: a cloned repository can contain a committed state file or lock, so a `.headsign/` you didn't create is untrusted input, just like the workflow. The same holds on a team: a change to `.headsign/` arrives on a teammate's PR and runs automatically in your loop, so weigh it as heavily as a change to CI configuration.

2. Ask Claude to start the workflow. It runs `headsign start`, works the
   phase, and keeps asking `headsign next` until the answer is `COMPLETE` —
   or `ESCALATE`, which means the decision comes back to you.

Run state lives in `.headsign/state.json` (auto-gitignored). Because all
state is external, the loop survives context compaction: recovery is just
`headsign next`.

`headsign start`, `next`, and `abort` resolve `.headsign/` in the current
directory only — they never search parent directories — so run them from the
repo or git-worktree root; each worktree then keeps its own independent run.
The one exception is the Stop hook, which walks up to find the run's
`.headsign/` (bounded by the worktree root) so the backstop still fires when
the session stopped in a subdirectory. That walk only goes up, though, so from
a directory above the run — a monorepo root, say — the hook won't find it and
stays silent; keep the session at the workflow's directory or below.

## Instructions vs. the gate

A phase's `description` is where you write what the agent should do in that
phase — including "use the `/foo` skill" or "have a read-only reviewer
subagent check it"; headsign hands it to Claude verbatim. A workflow
*choreographs* skills and subagent work into a gated sequence — it doesn't
*orchestrate* them, and it never forces which skill the agent uses. Only the
gate is enforced: the checks' exit codes are the sole thing that verifies the
result. To require a skill's use, gate its output (e.g. `grep` the file that
skill produces). A review/soft-gate phase should list its verdict file (e.g.
`.headsign/tmp/verdict`) under that phase's `clear:` so a verdict left over
from a previous pass can't be mistaken for the current one — headsign
deletes it on entry, and Claude writes a fresh one after the read-only
reviewer subagent reports its verdict.

A phase is only as meaningful as what its gate can check in shell. A test
gate proves nothing broke, not that the feature is done — judging "done" is
what a review gate is for, which is why the Quick start workflow above
carries both. Work a shell command can't judge — a design call, a UX
decision — needs either slicing into units a check can verify, or a
review-style soft gate to carry it. Size your phases to what the gate can
actually check, not to how the work naturally breaks down. And a review phase
is the agent's own review discipline, not a substitute for a human reviewing
the resulting PR.

## How a run flows

Three roles turn the loop: the agent (Claude) does the work and drives;
**headsign** runs the current phase's gate and answers with a token; the
**checks** are ordinary shell, so the verdict is deterministic. Each turn,
Claude obeys the token — `RETRY` means fix the reported failure and ask
again, `ADVANCE` means move to the printed phase, a fail-route (`gate failed
→ routed to …`) sends the work back, and `COMPLETE` ends the run. One pass
through the Quick start workflow:

```mermaid
sequenceDiagram
    autonumber
    actor C as Claude
    participant H as headsign
    participant S as gate checks

    C->>H: headsign start
    H-->>C: START plan (the phase's instructions)
    Note over C: writes docs/spec.md
    C->>H: headsign next
    H->>S: run plan's checks
    S-->>H: exit 1 (spec incomplete)
    H-->>C: RETRY 1/3 plan (failing check + output)
    Note over C: fixes the spec
    C->>H: headsign next
    H->>S: run plan's checks
    S-->>H: exit 0
    H-->>C: ADVANCE implement
    Note over C: implements, test-first
    C->>H: headsign next
    H->>S: bundle exec rspec
    S-->>H: exit 0
    H-->>C: ADVANCE review (clears .headsign/tmp/verdict)
    Note over C: read-only reviewer reports REJECTED.<br/>Claude writes it to .headsign/tmp/verdict
    C->>H: headsign next
    H->>S: grep -qx APPROVED .headsign/tmp/verdict
    S-->>H: exit 1 (REJECTED)
    H-->>C: ADVANCE implement (gate failed → routed back)
    Note over C: reworks. implement re-passes and<br/>ADVANCE review clears the verdict again.<br/>reviewer now reports APPROVED, Claude writes it
    C->>H: headsign next
    H->>S: grep -qx APPROVED .headsign/tmp/verdict
    S-->>H: exit 0
    H-->>C: COMPLETE
```

Every arrow from headsign is driven by a shell exit code, never the LLM's
own say-so. The Stop hook (not shown) is the backstop: if Claude tries to
stop while the run is `running`, it's pointed back to `headsign next`.

## The contract

Four commands; the agent routinely uses one:

| Command | Role |
|---|---|
| `headsign start [name] [--workflow path]` | initialize state, print the entry phase's instructions |
| `headsign next` | **the only question.** Run the current gate, transition, answer |
| `headsign abort [reason]` | record a human-directed stop |
| `headsign validate [name] [--workflow path]` | static check of the workflow file |

Multiple workflows can live as separate files under `.headsign/` (one
workflow per file); pick one with `headsign start <name>` (→
`.headsign/<name>.yaml`), or pass `--workflow <path>` for an explicit path.

`next` answers with a machine-readable first line, then instructions:

| First line | Exit | Meaning |
|---|---|---|
| `ADVANCE <phase>` | 0 | gate passed (or fail-routed) — new phase instructions follow |
| `RETRY n[/max] <phase>` | 1 | gate failed — failing check + output tail follow |
| `PENDING <phase>` | 1 | the gate can't be judged yet (`ready:`) — attempt not counted; do the work, then `next` again |
| `COMPLETE` | 0 | terminus |
| `ESCALATE <reason>` | 2 | human judgment needed |
| `ABORT <reason>` | 2 | run was aborted |

Exit 3 is a configuration/usage error. `next` is idempotent on finished runs,
and calling it on an unchanged working tree just reprints the last verdict —
probing never costs an attempt.

### Routing (workflow.yaml)

| Field | Values | Default |
|---|---|---|
| `on_pass` | phase name, `$end` | — (required) |
| `on_fail` | `retry`, phase name, `$end`, `escalate`, `abort` | `retry` |
| `max_attempts` | positive int; counts failures of this phase since it last passed | unlimited |
| `on_exhausted` | `escalate`, `abort` | `escalate` |
| `limits.max_total_iterations` | positive int; global runaway backstop | none |

Checks are CI-familiar `- name:` / `run:` / `timeout:` steps run with
`/bin/sh -c` (first failure stops the gate); phases may set `env:`.
Deliberately absent: `needs:`, `if:`, `${{ }}`, matrices, triggers — routing
is decided by pass/fail and nothing else.

### Async review (when review takes a while)

A review phase's gate often depends on something slower than the loop
itself — a reviewer subagent still reading the diff, a human glancing at a
PR. Calling `next` before that verdict exists would, without `ready:`,
burn a counted attempt on a gate that had nothing to judge yet — and since
that phase's verdict file is also listed under `clear:` (recommended
above), a verdict that lands a moment later could be discarded by that
same early call's next re-entry, silently losing a real review. Give the
phase a `ready:` probe (e.g. `test -f .headsign/tmp/verdict`) and an early
`next` answers `PENDING` instead: no attempt spent, `clear:` not run,
verdict left intact for the `next` that actually finds it.

### The backstop

Skills are instructions, not guarantees. A Stop hook reads
`.headsign/state.json`; while a run is `running` it blocks the agent from
stopping and points it back to `headsign next`. Escalated, aborted, and
completed runs pass through — those are correct endings. The hook fails open
(never traps a session) and caps itself at three consecutive nudges with no
real evaluation in between. Pausing and ending are different exits. To break
for the day, leave the run `running` and just stop — after those three nudges
the hook lets the session end, and tomorrow `headsign next` picks the run back
up from the same phase.
`headsign abort <reason>` is the other exit: it ends the run for good, not a
pause — the run can't be resumed, and a fresh `headsign start` begins again
from the entry phase, replaying every phase's gate from scratch. Keeping
that replay cheap is a design requirement on the workflow, not something
headsign does for you: write early phases' gates as fast, idempotent
checks (does a file exist, does lint pass) rather than ones with real
side effects or long unrepeatable work, and a fresh start after an abort
costs almost nothing. A workflow whose early gates are slow or non-idempotent
makes its own re-runs expensive — that's the workflow author's cost to
manage, by writing cheap gates, not a cost headsign can absorb on its
behalf.

## Non-goals

No DAGs or parallel phases, no worktree isolation, no provider abstraction,
no personas, no template/expression language, no MCP server, no TUI. If the
harness needs to be clever, the cleverness is in the wrong place.

## Development

```
npm install
npm test          # node:test, no framework
npm run typecheck
npm run build     # esbuild → plugin/dist/headsign.mjs (committed artifact)
```

Node ≥ 20 to run; Node ≥ 22.6 to develop (tests run TypeScript natively).
The design is documented in [docs/architecture.md](docs/architecture.md),
with the rationale for each decision in [docs/adr/](docs/adr/README.md).

## License

MIT
