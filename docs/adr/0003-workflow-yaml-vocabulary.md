# ADR-0003: workflow.yaml vocabulary — what we borrow, what we refuse

- Status: accepted
- Date: 2026-07-23
- Revised: 2026-07-27 (three fields are removed by
  [ADR-0014](0014-removing-three-unused-knobs.md): the per-phase `env:`
  borrowed below, `on_exhausted:`, and `abort` as an `on_fail` value. The
  schema block and the `validate` list below are updated in place; ADR-0014
  records what replaces each. Everything else here — the borrowed and
  refused lists, `clear:`, and `description` being advisory — stands.)
- Revised: 2026-07-28 ([ADR-0015](0015-strict-schema-and-version-0-1.md)
  renumbers `version:` from `1` to `0.1` and makes a key the schema does not
  define an error rather than something `validate` walks past. Both are
  applied to the schema block and the `validate` list below; the vocabulary
  itself is unchanged.)

## Context

The schema should be readable on first contact by someone who knows CI YAML,
without importing CI's pipeline semantics. Three references, in priority
order, plus an explicit refusal list.

## Decision

### Borrowed

- **Microsoft Conductor**: `entry` point, deterministic first-match routing,
  `$end` terminator, exit-code-driven branching, validate-before-run.
- **goose recipes**: gate = a list of shell checks; `max_attempts` /
  exhaustion handling; a global iteration limit (`max_turns` →
  `limits.max_total_iterations`).
- **CI dialect common core (GitHub Actions / CircleCI)**: check steps as
  `- name:` + `run:`; per-check `timeout` (seconds); per-phase `env:`
  *(removed by ADR-0014 — nothing authored ever used it, and `FOO=bar cmd`
  in the `run:` string says the same in the shell the author is already
  writing)*. If a v2 human gate ever lands, it uses CircleCI's
  `type: approval` vocabulary.

### Refused (and why)

- `needs:` / `requires:` — DAG/parallelism is the on-ramp to reinventing
  takt. headsign is a single-active-phase state machine.
- `${{ }}` expressions and `if:` — expression languages always metastasize.
  Every routing decision is a shell exit code, never an expression headsign
  evaluates itself. ADR-0011 later widened *how many* destinations that can
  choose between — `on_pass` may list `when:`/`to:` routes — but a `when:`
  is the same kind of thing a gate check is: a command, judged by its exit
  status. Nothing here parses a condition.
- `uses:` / orbs — reuse mechanisms have gravity.
- `on:` triggers — the trigger is always Claude itself.
- matrix — no.
- takt/jdi vocabulary (persona, provider, movement) — different layer.
- Conductor's Jinja2 templating — same reason as expressions.
- **Gate indirection** — a pattern where the agent writes its own judge
  script at run time (e.g. `.headsign/tmp/gate.sh`) and the workflow's gate
  calls that script rather than checking something fixed. This makes the
  same agent author both the code under test and the judgment of it,
  losing the separation a gate exists to provide — a gate an agent can
  rewrite is not a gate, it's a suggestion the agent can also grade. Two
  correct alternatives cover the real need: (a) split the work into its
  own phase or workflow with a fixed, reviewed gate, rather than trying to
  make one gate cover every case; or (b) commit a stable judgment script
  and reference it from `workflow.yaml` — once it's committed, it goes
  through the same review as any other code, not around it.

CI-likeness is for reading familiarity only, never for semantics.

### Schema (pre-1.0)

```yaml
version: 0.1            # required, must be exactly 0.1 (ADR-0015)
name: feature-dev       # required
entry: plan             # required, must name a phase

phases:                 # required, at least one
  plan:
    description: …      # required; shown to Claude on START/ADVANCE
    clear: [.headsign/tmp/verdict]  # optional; deleted each time this phase is entered
    gate:               # required
      checks:           # required, non-empty
        - name: …       # optional; defaults to the run string
          run: "…"      # required; /bin/sh -c, judged by exit code
          timeout: 300  # optional seconds, default 120
    on_pass: implement  # required: phase name | $end | list of when:/to: routes (ADR-0011)
    on_fail: retry      # optional: retry(default) | phase | $end | escalate
    max_attempts: 3     # optional; absent = unlimited; exhaustion always escalates

  review:
    description: …
    ready: "test -f .headsign/tmp/verdict"  # optional; PENDING (not a failure,
                                             # not counted) while this fails
    gate:
      checks:
        - run: "grep -qx APPROVED .headsign/tmp/verdict"
    on_pass: $end

limits:                 # optional
  max_total_iterations: 20  # optional; global runaway backstop
```

`headsign validate` enforces: version exactly `0.1`, name/entry present,
entry exists, every routing target names a defined phase or an allowed
token, checks non-empty with `run` strings, timeouts positive, phases
reachable from entry, `max_attempts` not paired with `on_fail: escalate`
(the first failure would already end the run, so `max_attempts` could never
be reached), and `ready`, when present, is a non-empty shell string. It also
rejects any key not named in the block above, at every level — a misspelled
`max_atempts` is an error, not a field quietly skipped (ADR-0015). `ready`
adds no routing edge and takes no part in the reachability check — it
gates whether the phase's own gate runs at all, it never sends the run
anywhere (see ADR-0002's transition table for its place in evaluation
order, attempts/state semantics, and why the fifth token was worth it).

### Human gates in v1

No dedicated feature. `checks: [{run: "test -f .headsign/approved"}]` plus
escalation covers it; a dedicated `type: approval` is deferred to v2 if
real usage demands it.

### `description` choreographs; the gate enforces

`description` is free-form text handed to the agent verbatim as the phase's
instruction (printed on START/ADVANCE). It may name a skill to use or a
subagent to spawn — a workflow choreographs skills and subagent work into a
gated sequence. But it is advisory: headsign never parses it and never forces
the agent to follow it. The only enforced thing is the gate — the checks'
exit codes decide whether the phase passes. To require that a skill actually
ran, gate its output rather than trusting that the instruction was followed.
This keeps the split clean: the `description` (and the skills it names) is the
"fat skills" half; the CLI only runs the checks.

A check that reads an agent-produced artifact, like a review verdict file at
`.headsign/tmp/verdict`, can go stale across loop-backs in a
review-implement cycle: `on_fail: implement` sends the run back to fix
things, but the old verdict is still sitting on disk when `review` is
entered again, and a leftover `APPROVED` would let the gate pass without a
fresh review ever happening. Listing that artifact under the phase's
`clear:` fixes this — headsign deletes it every time the phase is entered,
so the check has nothing to read until the agent produces it fresh for the
current pass. It also keeps a later soft-gate → hard-gate migration clean:
swap the check's `run:` for something stronger, and just drop `clear` if
the artifact is no longer needed. `.headsign/tmp/` is itself emptied and
auto-gitignored at `start`, so it's the natural place for this kind of
transient, run-scoped artifact.

## Consequences

- Anyone who reads GitHub Actions can read a headsign workflow.
- Requests for conditions, matrices, or reusable fragments are rejected by
  pointing here.
