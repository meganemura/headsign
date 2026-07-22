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
entry.

### Human gates in v1

No dedicated feature. `checks: [{run: "test -f .headsign/approved"}]` plus
escalation covers it; a dedicated `type: approval` is deferred to v2 if
real usage demands it.

## Consequences

- Anyone who reads GitHub Actions can read a headsign workflow.
- Requests for conditions, matrices, or reusable fragments are rejected by
  pointing here.
