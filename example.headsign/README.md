# Example workflows

Ready-made `workflow.yaml` files for common roles, each written by that
role's discipline and validated against the shipped CLI. Copy the ones you
want into your repository's `.headsign/` directory (one workflow per file),
adapt the `run:` commands to your project's tooling (marked with swap-me /
SWAP comments), and start one with:

```
headsign start              # .headsign/workflow.yaml
headsign start tdd-feature  # .headsign/tdd-feature.yaml
```

| File | Role | Shape |
|---|---|---|
| [workflow.yaml](workflow.yaml) | headsign's own development (the default here) | implement (CI-mirroring gates) → review soft gate |
| [tdd-feature.yaml](tdd-feature.yaml) | test-first feature developer | spec → red (test must exist AND fail) → green → refactor → review |
| [bugfix.yaml](bugfix.yaml) | on-call bug fixer | reproduce (failing regression test, path recorded) → fix (repro + full suite) → harden (root-cause note) |
| [docs.yaml](docs.yaml) | technical writer | outline (audience named) → draft → style (mechanical lint) → reader review |
| [release.yaml](release.yaml) | release engineer | prepare (versions/changelog/clean tree) → verify (CI mirror) → approve (human GO file) → ship (tag at HEAD) |
| [triage.yaml](triage.yaml) | headsign's own feedback intake (pull-based queue) | triage (judge one ticket; a no-work run ends clean) → implement → review → respond |

Things these examples demonstrate beyond the Quick start:

- expressing "this test must FAIL" honestly with `!` (tdd-feature `red`,
  bugfix `reproduce`)
- a human go/no-go gate the agent must not self-satisfy (release `approve`)
- the async-review trio `clear:` + `ready:` + a verdict grep (every review
  phase)
- why some loop-backs are deliberately not wired, with the reasoning kept
  in comments (bugfix `fix`)
- gating a phase on a run-local completion marker with `ready:` — the agent
  declares "I am done here" rather than the queue being probed — and ending
  a run with nothing to do cleanly via `on_fail: "$end"` (triage)

This repository dogfoods headsign: `.headsign` at the repo root is a
symlink to this directory, so `headsign start` here runs the
`headsign-dev` workflow, `headsign start release` runs the release one, and
`headsign start triage` runs one feedback ticket end to end.
The `.gitignore` in this directory keeps run state (`state.json`, `lock`,
`log`, `tmp/`) out of the repository.
