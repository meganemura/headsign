# Architecture Decision Records

The *why* behind headsign, one decision per file. For the overview and the
module map, start with [../architecture.md](../architecture.md); these ADRs
record the reasoning each choice rests on.

| ADR | Decision |
|---|---|
| [0001](0001-thin-harness.md) | Thin harness — Claude drives, the CLI only holds state and judges; the non-goals that keep it small *(its 500-code-line budget retired by 0016)* |
| [0002](0002-single-question-and-output-contract.md) | One question (`headsign next`), the first-line token contract, and the phase transition table |
| [0003](0003-workflow-yaml-vocabulary.md) | The `workflow.yaml` vocabulary (what's borrowed from CI, what's refused), plus `clear:` and why `description` is advisory *(its `env:`, `on_exhausted:`, and `on_fail: abort` removed by 0014)* |
| [0004](0004-state-attempts-and-cache.md) | `state.json` shape, per-phase attempts, cwd-only resolution, and the concurrency lock *(its tree-hash cache retracted by 0012)* |
| [0005](0005-distribution-and-toolchain.md) | TypeScript + esbuild single-file bundle, and the minimal-dependency policy |
| [0006](0006-stop-hook-backstop.md) | The Stop-hook backstop — the pause-note exit gate, the nudge counter demoted to insurance, fail-open, and the subdirectory walk-up |
| [0007](0007-verdict-authorship.md) | Verdict authorship — measured vs judged gates, the three tiers of a judged one (who writes the verdict file), and how to move the pen out of the worker's hand |
| [0008](0008-multi-session-ownership.md) | Multi-session runs — driver ownership, the observer opt-out, and the read-only `status` command *(its environment-derived driver stamp and the Stop hook's owner match retracted by 0013)* |
| [0009](0009-claim-handshake.md) | The claim handshake — session identity is hook-side knowledge; `headsign claim`, the Stop hook's adoption gate, and sticky `claimed` ownership *(superseded by 0010)* |
| [0010](0010-subagent-stop-identity.md) | Sealing driver identity on `SubagentStop` — the event ADR-0009 got wrong, and the delegated-agent backstop *(its identifier-kind decision retracted by 0013)* |
| [0011](0011-k-way-routing-on-pass.md) | k-way routing on `on_pass` — a list of `when:`/`to:` routes, why a per-check `on_fail` was refused, why a broken `when:` stops the run, and unreachable phases demoted to warnings |
| [0012](0012-removing-the-tree-hash-cache.md) | Removing the tree-hash cache — why the free probe was right before `status` existed, what it hid, `max_attempts` now counting judgments, and `last_failure` |
| [0013](0013-claim-only-driver-identity.md) | Claim-only driver identity — retiring the environment stamp: why `Stop` now compares nothing, `driver_agent`, the two-valued `driver:` line, and what a single identity path gives up |
| [0014](0014-removing-three-unused-knobs.md) | Removing three unused knobs — phase `env:` (write it in the shell), `on_exhausted:` (exhaustion always escalates), and `on_fail: abort` (ending a run for good is `headsign abort`'s job) |
| [0015](0015-strict-schema-and-version-0-1.md) | Rejecting unknown keys and renumbering the schema to `version: 0.1` — why a typo is an error rather than a warning, why no did-you-mean guess, and why a pre-1.0 schema change requires editing the file |
| [0016](0016-explainability-as-the-fitness-function.md) | Explainability replaces the line budget — why the count never fired, failures recorded rather than stopping the sweep, notes vs graph, and the rule for a run that rewrites its own workflow |
| [0017](0017-three-budgets-and-the-recoverable-ceiling.md) | Three budgets, one of which can fire on a healthy run — `limits.max_total_iterations` escalates without ending the run, the `ceiling` log event, and why the other two escalations stay terminal |
| [0018](0018-cli-engine-seam.md) | The `cli.ts`/`engine.ts` seam — the order a lap asks its questions in is a routing rule, so `start`/`next`/`abort`/`claim`/`status` move; refusals become an exhaustively-switched kind, the lock is released in a `finally`, and `engine.ts` stops claiming to be pure |
| [0019](0019-readme-as-one-page-and-the-three-document-layers.md) | The README is the page before you enter — documentation splits into three layers by the moment it is read, the README carries boundaries rather than syntax, and its demonstration is a picture bound to commands that exist *(its middle layer corrected by 0020)* |
| [0020](0020-writing-the-workflow-as-its-own-skill.md) | Writing the workflow is a second skill — the seam is intent rather than whether `.headsign/` exists, gates sort into unfakeable/anchored/fakeable, authoring stops at the file; and a correction to 0019: the layer that writes has two readers, so the reference page is the person's and the skill ships the agent's |
| [0021](0021-a-command-that-never-ran-is-not-an-answer.md) | A command that never ran is not an answer, in all three places headsign runs one — an unrunnable check or `ready:` probe refuses the lap (exit 3) and moves nothing, while a timeout stays an ordinary failure |
| [0022](0022-validate-checks-that-a-run-can-end.md) | `validate` asks whether the run can end, not only whether every phase can be reached — a cycle of pass edges with no `limits.max_total_iterations` is warned about, because `max_attempts` clears on a pass and cannot bound one |
| [0023](0023-pinning-the-graph-a-run-is-walking-under.md) | A run pins the rules it walks under — a fingerprint per reachable phase plus `limits`, `description` excluded; a change is reported once as an ESCALATE that ends nothing, restoring the file is free, asking again accepts and counts it, and `COMPLETE` says how many *(amends 0016 §5 and 0017)* |
| [0024](0024-the-log-survives-a-restart.md) | The log survives a restart — `start` no longer truncates it, so an aborted run's stated reason outlives the next one; the `start` line is the seam, and anchoring on the second field makes it a marker a script can trust *(revises 0004)* |
| [0025](0025-a-stop-that-passed-and-a-stop-that-never-ran.md) | Telling a stop that passed from a hook that never ran — the `unheld` log event and a `last_stop` field written in the same locked write, why the already-continuing flag is not called a loop guard, the flagged check gains a body without ever reaching the adoption gate, and two `status` lines *(amends 0002, 0004, 0006, 0008; its §7 — nudges stay unlogged — retracted a day later by field use, and the log gains `held`)* |
| [0026](0026-a-second-place-to-look.md) | Giving the quiet stop a second place to look — a bounded second walk from `CLAUDE_PROJECT_DIR` once the first finds nothing, why it is Claude Code's variable and not a headsign-owned one or the hook's own `PWD`, records without ever holding the turn, and marks every line `by=CLAUDE_PROJECT_DIR` *(amends 0006, 0025)* |

Each file states its context, the decision, and the consequences. When a
decision changes, amend the relevant ADR rather than adding a new one, unless
the change is large enough to be its own record.
