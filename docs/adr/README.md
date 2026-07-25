# Architecture Decision Records

The *why* behind headsign, one decision per file. For the overview and the
module map, start with [../architecture.md](../architecture.md); these ADRs
record the reasoning each choice rests on.

| ADR | Decision |
|---|---|
| [0001](0001-thin-harness.md) | Thin harness — Claude drives, the CLI only holds state and judges; the non-goals that keep it small |
| [0002](0002-single-question-and-output-contract.md) | One question (`headsign next`), the first-line token contract, and the phase transition table |
| [0003](0003-workflow-yaml-vocabulary.md) | The `workflow.yaml` vocabulary (what's borrowed from CI, what's refused), plus `clear:` and why `description` is advisory |
| [0004](0004-state-attempts-and-cache.md) | `state.json` shape, per-phase attempts, the tree-hash cache, cwd-only resolution, and the concurrency lock |
| [0005](0005-distribution-and-toolchain.md) | TypeScript + esbuild single-file bundle, and the minimal-dependency policy |
| [0006](0006-stop-hook-backstop.md) | The Stop-hook backstop — the pause-note exit gate, the nudge counter demoted to insurance, fail-open, and the subdirectory walk-up |
| [0007](0007-verdict-authorship.md) | Verdict authorship — the gate-hardness scale (hard/semi/soft), why soft gates stay soft, and how to move the pen out of the worker's hand |
| [0008](0008-multi-session-ownership.md) | Multi-session runs — driver ownership stamped on `start`/`next`, the Stop hook's owner-match and observer opt-out, and the read-only `status` command |

Each file states its context, the decision, and the consequences. When a
decision changes, amend the relevant ADR rather than adding a new one, unless
the change is large enough to be its own record.
