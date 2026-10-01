# Architecture Decision Records

## Current decisions

Read these before changing headsign's skills, packaging, or guidance.

| ADR | Decision |
|---|---|
| [0039](0039-design-for-the-model-that-improves-the-method.md) | Give the model objectives, constraints, evidence, and authority; make consequential improvement the default. |
| [0043](0043-local-skills-improve-during-work.md) | Assess the method during work and at completion; apply useful repairs and verify current results. |
| [0044](0044-skills-only-distribution.md) | Distribute two ordinary skills; retire the CLI, npm distribution, hooks, and runtime state. |

[AGENTS.md](../../AGENTS.md) states the development obligations.
[Workflow lessons](../workflow-lessons.md) brings earlier knowledge into
current skill design.

## Historical runtime decisions

The following records preserve the earlier CLI's reasons, observations,
alternatives, and contracts. ADR-0044 supersedes their runtime and distribution
contracts for current headsign. Follow their implementation instructions only
when studying the corresponding historical version.

Source paths mentioned inside these records refer to the retired tree.
The [v0.15.4 source](https://github.com/meganemura/headsign/tree/v0.15.4)
and its [documentation](https://github.com/meganemura/headsign/tree/v0.15.4/docs)
preserve that context. Later historical amendments remain dated in each record.

| ADR | Historical decision |
|---|---|
| [0001](0001-thin-harness.md) | Thin harness — Claude drives, the CLI holds state |
| [0002](0002-single-question-and-output-contract.md) | One question (`next`), the output contract, and the transition table |
| [0003](0003-workflow-yaml-vocabulary.md) | workflow.yaml vocabulary — what we borrow, what we refuse |
| [0004](0004-state-attempts-and-cache.md) | State shape, per-phase attempts, and the tree-hash cache |
| [0005](0005-distribution-and-toolchain.md) | Distribution and toolchain — single-file bundle, minimal dependencies |
| [0006](0006-stop-hook-backstop.md) | Stop hook — the exit-note gate, with a nudge cap as safety net |
| [0007](0007-verdict-authorship.md) | Verdict authorship — why soft gates are soft |
| [0008](0008-multi-session-ownership.md) | Multi-session runs — driver ownership, observers, and status |
| [0009](0009-claim-handshake.md) | The claim handshake — session identity is hook-side knowledge |
| [0010](0010-subagent-stop-identity.md) | Sealing driver identity on SubagentStop — the event ADR-0009 got wrong |
| [0011](0011-k-way-routing-on-pass.md) | k-way routing on `on_pass` |
| [0012](0012-removing-the-tree-hash-cache.md) | Removing the tree-hash cache — every `next` is a judgment |
| [0013](0013-claim-only-driver-identity.md) | Claim-only driver identity — retiring the environment stamp |
| [0014](0014-removing-three-unused-knobs.md) | Removing three unused knobs — phase `env:`, `on_exhausted:`, and `on_fail: abort` |
| [0015](0015-strict-schema-and-version-0-1.md) | Rejecting unknown keys, and `version: 0.1` |
| [0016](0016-explainability-as-the-fitness-function.md) | Explainability as the fitness function, and the rules for a workflow that edits itself |
| [0017](0017-three-budgets-and-the-recoverable-ceiling.md) | Three budgets, one of which can fire on a healthy run — the global ceiling escalates without ending the run |
| [0018](0018-cli-engine-seam.md) | The seam between `cli.ts` and `engine.ts` — the order of a lap is a routing rule, so the five run operations move |
| [0019](0019-readme-as-one-page-and-the-three-document-layers.md) | The README is the page before you enter — documentation splits into three layers |
| [0020](0020-writing-the-workflow-as-its-own-skill.md) | Writing the workflow is a skill of its own — and the layer that writes it has two readers |
| [0021](0021-a-command-that-never-ran-is-not-an-answer.md) | A command that never ran is not an answer — in all three places headsign runs one |
| [0022](0022-validate-checks-that-a-run-can-end.md) | `validate` checks that a run can end, not only that its phases can be reached |
| [0023](0023-pinning-the-graph-a-run-is-walking-under.md) | Pinning the graph a run is walking under |
| [0024](0024-the-log-survives-a-restart.md) | The log survives a restart, and the `start` line is the seam |
| [0025](0025-a-stop-that-passed-and-a-stop-that-never-ran.md) | Telling a stop that passed from a hook that never ran |
| [0026](0026-a-second-place-to-look.md) | Giving the quiet stop a second place to look |
| [0027](0027-recording-who-drove-a-run.md) | Recording who drove a run |
| [0028](0028-codex-as-a-second-principal.md) | Codex as a second principal |
| [0029](0029-status-answers-for-the-file.md) | `status` answers for the file, not only for the record |
| [0030](0030-the-token-line-is-the-contract-and-nothing-else-is.md) | The token line is the contract, and nothing else is |
| [0031](0031-when-the-run-entered-the-phase.md) | When the run entered the phase |
| [0032](0032-the-gate-says-how-far-it-got.md) | The gate says how far it got |
| [0033](0033-the-one-variable-headsign-sets.md) | The one variable headsign sets |
| [0034](0034-a-record-is-one-line.md) | A record is one line, and `logLine` is what keeps it one |
| [0035](0035-a-phase-name-has-to-be-a-key.md) | A phase name has to be a name the run's own maps can hold |
| [0036](0036-a-request-for-a-second-question.md) | A request for a second question, and the four answers it gets |
| [0037](0037-session-start-discovers-a-run.md) | A running run introduces itself at session start |
| [0038](0038-a-run-assesses-its-procedure.md) | A run assesses its procedure at the boundary |
| [0040](0040-the-run-pane-is-a-claude-only-overlay.md) | The run pane is a Claude-only overlay on the shared plugin |
| [0041](0041-a-command-that-names-its-caller.md) | A command that names its caller |
| [0042](0042-status-draws-the-neighbourhood.md) | `status` draws the neighbourhood |

When a current decision changes, amend its ADR explicitly.
A new instruction cannot silently override an accepted decision.
Preserve the original reason and state what changed.
