# ADR-0003: workflow.yaml vocabulary — what we borrow, what we refuse

- Status: accepted
- Date: 2026-07-23

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
  `- name:` + `run:`; per-check `timeout` (seconds); per-phase `env:`.
  If a v2 human gate ever lands, it uses CircleCI's `type: approval`
  vocabulary.

### Refused (and why)

- `needs:` / `requires:` — DAG/parallelism is the on-ramp to reinventing
  takt. headsign is a single-active-phase state machine.
- `${{ }}` expressions and `if:` — expression languages always metastasize.
  Routing is decided by gate pass/fail, a boolean, nothing else.
- `uses:` / orbs — reuse mechanisms have gravity.
- `on:` triggers — the trigger is always Claude itself.
- matrix — no.
- takt/jdi vocabulary (persona, provider, movement) — different layer.
- Conductor's Jinja2 templating — same reason as expressions.

CI-likeness is for reading familiarity only, never for semantics.

### Schema (v1)

```yaml
version: 1              # required, must be 1
name: feature-dev       # required
entry: plan             # required, must name a phase

phases:                 # required, at least one
  plan:
    description: …      # required; shown to Claude on START/ADVANCE
    clear: [.headsign/tmp/verdict]  # optional; deleted each time this phase is entered
    env: {K: V}         # optional; merged over process env for checks
    gate:               # required
      checks:           # required, non-empty
        - name: …       # optional; defaults to the run string
          run: "…"      # required; /bin/sh -c, judged by exit code
          timeout: 300  # optional seconds, default 120
    on_pass: implement  # required: phase name | $end
    on_fail: retry      # optional: retry(default) | phase | $end | escalate | abort
    max_attempts: 3     # optional; absent = unlimited
    on_exhausted: escalate  # optional: escalate(default) | abort

limits:                 # optional
  max_total_iterations: 20  # optional; global runaway backstop
```

`headsign validate` enforces: version/name/entry present, entry exists,
every routing target names a defined phase or an allowed token, checks
non-empty with `run` strings, timeouts positive, phases reachable from
entry, and `max_attempts` not paired with `on_fail: escalate`/`abort` (the
first failure would already end the run, so `max_attempts` could never be
reached).

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
