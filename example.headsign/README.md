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
| [router.yaml](router.yaml) | request intake that dispatches one of three kinds of work | classify (agent writes one word) → fix-bug / write-docs / implement → review (rejection re-enters classify) |
| [sweep.yaml](sweep.yaml) | one mechanical change applied across many files (codemod, migration) | survey (build the work queue) → apply one item → verify → record (round again while the queue has work) → report |

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
- branching a pass three ways with a list-form `on_pass`, where the agent
  writes down its judgment and the `when:` predicates pick an edge that was
  declared in the file (router)
- turning a cycle with data rather than a counter (sweep `record`): the
  branch sends the run back to `apply` while the queue still has items and
  leaves for `report` when it doesn't, so the loop ends because the work
  ran out, not because a limit was hit

This repository dogfoods headsign: `.headsign` at the repo root is a
symlink to this directory, so `headsign start` here runs the
`headsign-dev` workflow, `headsign start release` runs the release one,
`headsign start triage` runs one feedback ticket end to end, and
`headsign start router` runs the branching one.
The `.gitignore` in this directory keeps run state (`state.json`, `lock`,
`log`, `tmp/`) out of the repository.

## The shapes, drawn

One flowchart per file in the table above: the phases are the nodes, and
the routes each phase declares are the edges. Read them for where a run
can go — straight on, back, around, or out.

Two things are deliberately left out, because they are true of nearly
every node and would bury the shape. Staying put: `on_fail: retry` (the
default) keeps the run in the phase it is already in. Giving up:
exhausting `max_attempts` hands the run to a human, since `on_exhausted`
defaults to `escalate`. So every edge drawn below is one that moves the
run — including `release.yaml`'s `on_fail: escalate`, where handing the
decision to a person IS the route.

**workflow.yaml** — the smallest loop: review sends work back.

```mermaid
flowchart TD
  implement["implement"] -- "pass" --> review["review"]
  review -- "pass" --> done["$end"]
  review -- "fail" --> implement
```

**tdd-feature.yaml** — a straight line whose loop-back lands on green.

```mermaid
flowchart TD
  spec["spec"] -- "pass" --> red["red"]
  red -- "pass" --> green["green"]
  green -- "pass" --> refactor["refactor"]
  refactor -- "pass" --> review["review"]
  review -- "pass" --> done["$end"]
  review -- "fail" --> green
```

**bugfix.yaml** — no loop-backs at all, and its comments say why.

```mermaid
flowchart TD
  reproduce["reproduce"] -- "pass" --> fix["fix"]
  fix -- "pass" --> harden["harden"]
  harden -- "pass" --> done["$end"]
```

**docs.yaml** — a rejected doc re-enters drafting, not outlining.

```mermaid
flowchart TD
%% the style phase's node id is phase-style: `style` alone is a mermaid keyword
  outline["outline"] -- "pass" --> draft["draft"]
  draft -- "pass" --> phase-style["style"]
  phase-style -- "pass" --> review["review"]
  review -- "pass" --> done["$end"]
  review -- "fail" --> draft
```

**release.yaml** — the human gate: a NO-GO ends in a person's hands.

```mermaid
flowchart TD
  prepare["prepare"] -- "pass" --> verify["verify"]
  verify -- "pass" --> approve["approve"]
  approve -- "pass" --> ship["ship"]
  approve -- "fail" --> escalate["escalate"]
  ship -- "pass" --> done["$end"]
```

**triage.yaml** — two ways to end: nothing to do exits at the first gate.

```mermaid
flowchart TD
  triage["triage"] -- "pass" --> implement["implement"]
  triage -- "fail (nothing to do)" --> done["$end"]
  implement -- "pass" --> review["review"]
  review -- "pass" --> respond["respond"]
  review -- "fail" --> implement
  respond -- "pass" --> done
```

**router.yaml** — the branch: `when:` picks one of three kinds of work.

```mermaid
flowchart TD
  classify["classify"] -- "when: route is fix-bug" --> fix-bug["fix-bug"]
  classify -- "when: route is write-docs" --> write-docs["write-docs"]
  classify -- "default" --> implement["implement"]
  fix-bug -- "pass" --> review["review"]
  write-docs -- "pass" --> review
  implement -- "pass" --> review
  review -- "pass" --> done["$end"]
  review -- "fail" --> classify
```

**sweep.yaml** — the loop: it turns while the queue still has items.

```mermaid
flowchart TD
  survey["survey"] -- "pass" --> apply["apply"]
  apply -- "pass" --> verify["verify"]
  verify -- "pass" --> record["record"]
  verify -- "fail" --> apply
  record -- "when: queue not empty" --> apply
  record -- "default (queue empty)" --> report["report"]
  report -- "pass" --> done["$end"]
```
