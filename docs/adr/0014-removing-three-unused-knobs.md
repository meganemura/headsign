# ADR-0014: Removing three unused knobs — phase `env:`, `on_exhausted:`, and `on_fail: abort`

- Status: accepted
- Date: 2026-07-27
- Revised: 2026-07-28 — [ADR-0015](0015-strict-schema-and-version-0-1.md) is
  the separate record that "Alternatives considered" below says rejecting
  unknown keys would need, and it changes one claim made here: a file still
  carrying `env:` or `on_exhausted:` no longer loads with the field ignored.
  Both now fail `validate` as unknown keys, so all three of this ADR's
  removals are caught rather than two of them landing quietly. The reasoning
  for the removals themselves is unaffected.
- Supersedes: three pieces of vocabulary from
  [ADR-0003](0003-workflow-yaml-vocabulary.md) — the per-phase `env:`
  borrowed from the CI dialect, the `on_exhausted:` field, and `abort` as an
  `on_fail` value — and, in [ADR-0002](0002-single-question-and-output-contract.md),
  the transition table's `on_exhausted` row and the `abort` entry in
  `on_fail`'s allowed values. Everything else in both ADRs stands. The
  `ABORT` token itself is untouched: it is still one of the six answers, and
  `headsign abort` is still the command that produces it.

## Context

Three fields in the v1 schema were measured against the seven workflows
shipped in `example.headsign/`, which are the most complete authored corpus
headsign has:

| Field | Uses | Distinct values used |
|---|---|---|
| phase `env:` | 0 | — |
| `on_exhausted:` | 11 | 1 (`escalate`, the default) |
| `on_fail: abort` | 0 | — |

None of the three is carrying a decision. `env:` was never reached for at
all; `on_exhausted` was written eleven times and every one of them spelled
out the default; `abort` sat in `on_fail`'s token set without a single
workflow choosing it.

That is a count, not a reason. Each field costs a type, a validation rule,
a branch, a row in the README's field table, and a paragraph in each
language's documentation — and each is also one more thing a workflow
author has to decide about before writing a phase. The reason to remove
them is that for each one there is a plainer thing that says the same, or a
better answer to the same question. This ADR records those replacements,
because a removal whose replacement isn't written down is just a
subtraction someone will propose undoing.

ADR-0001's budget note applies here in its intended direction: the guideline
is a design-smell detector, and the smell it is detecting is a knob nobody
turns.

## Decision

### 1. Phase `env:` is removed — write it in the shell

`env:` let a phase declare a mapping of variables that headsign merged over
its own environment for that phase's checks, its `ready:` probe, and its
routes' `when:` predicates.

**The replacement is the shell the author is already writing.** Every one
of those fields is a string handed to `/bin/sh -c`, and the shell has had a
spelling for this since before CI YAML existed:

```yaml
        - run: "FOO=bar npm test"
```

That is one line instead of three, it sits next to the command it applies
to rather than several fields above it, and it needs no knowledge of
headsign to read. It also composes in ways the mapping could not: a value
computed by a command substitution, a variable set for one check in a gate
but not the next.

What this gives up is declaring a variable **once** for every command in a
phase. A phase with three checks that all want `NODE_ENV=test` now writes it
three times. That repetition is visible, which is the trade being made: the
mapping's convenience was that a check's environment could be changed from
somewhere the check's own line doesn't mention. Nothing in the shipped
corpus paid for that convenience, and a workflow that genuinely wants one
setting everywhere can export it around `headsign` itself.

The removal also lets `gate.ts` state something simpler than it could
before: every command headsign runs inherits headsign's own environment,
unmodified. `runGate`, `isReady`, and `resolveRoute` lose their env
parameter and their string-coercion of it.

### 2. `on_exhausted:` is removed — exhaustion always escalates

`on_exhausted` chose what happens when a phase's `max_attempts` runs out:
`escalate` (the default) or `abort`.

**The replacement is that there is nothing to write.** A run whose budget
is spent now always ends `ESCALATE: <phase>: max_attempts (<n>) exhausted`,
which is what all eleven declarations in the corpus asked for.

This is not only an appeal to the count. The two values differ in exactly
one respect — whether a person is asked — and a spent budget is the
canonical moment to ask one. `max_attempts` exists to catch a run that is
working and getting nowhere (ADR-0012 restated this when it made the
counter count judgments), and the whole value of catching it is that
somebody finds out. `abort` there meant "notice that the run is stuck, then
end it without telling anyone", which is a strange thing to have made
declarable and a stranger thing to reach for.

The two states are not interchangeable downstream either: `status` reports
`ESCALATED` versus `ABORTED`, and the log records which one ended the run.
Fixing exhaustion to `escalate` means an `ABORTED` run is now always the
result of a person's `headsign abort`, which makes that reading of `status`
sharper than it was.

### 3. `on_fail: abort` is removed — `headsign abort` is the way to end a run

`abort` leaves `on_fail`'s token set, which becomes `retry` (the default),
a phase name, `$end`, and `escalate`.

**The replacement is the command of the same name, which is unchanged.**
`headsign abort <reason>` ends a run for good and records the free-text
reason the caller gives it. That is the same door, and the only difference
between it and the removed token is who opens it: a person, deliberately,
with a reason worth reading — versus a gate, automatically, with a canned
`<phase>: gate failed (on_fail: abort)`.

The two shared a name and did not share a meaning, which is the second
reason to drop the token rather than the command. `abort` in a workflow
file read as "this failure ends the run", and the value it should have been
compared against is `escalate`, which ends the run *and asks*. A workflow
author choosing between "end it" and "end it and tell someone" has no case
for the first: nothing else is watching a headsign run, so a silent end is
an end nobody hears.

Two consequences of the token set shrinking:

- The dead-config validation ADR-0003 records keeps its `escalate` arm and
  loses its `abort` arm: `max_attempts` alongside `on_fail: escalate` is
  still rejected, because the first failure already ends the run.
- `abort` is no longer reserved as an `on_fail` value, so a phase actually
  *named* `abort` is now a legal fail-route target. That falls out of the
  ordinary rule (a token, or a defined phase name) rather than being chosen
  for its own sake.

`engine.ts` still produces the `ABORT` outcome — for a run whose state says
`aborted`, which `headsign abort` writes and `next` reprints idempotently —
so the output contract's six tokens are still six.

## Alternatives considered

**Keep `on_exhausted` and delete only its `abort` value.** This leaves a
field with one legal value, which is a field that only exists to be typed
out. It also leaves the eleven corpus declarations reading as if they had
chosen something. Rejected: the point is to remove the decision, not to
narrow it.

**Deprecate rather than remove: accept the fields, warn, and ignore them.**
Rejected because `validate`'s warning channel is for things a run can
proceed with despite the author not having finished the thought (ADR-0011's
unreachable phases), and a leftover knob that is read, reported, and then
disregarded is exactly the shape of drift this ADR is undoing.

The schema does not reject unknown keys, though, and two of the three
removals therefore land quietly rather than loudly. `on_fail: abort` fails
`validate` with `on_fail 'abort' is not a valid route`, because `on_fail`
survives as a field with a token set. `env:` and `on_exhausted:` become
unknown keys, so a file still carrying them loads and runs with them
ignored — a phase's variables are absent from its commands, and an
`on_exhausted: abort` escalates instead. Rejecting unknown keys outright
would catch both, and is deliberately not done here: it is a change to how
every field in the schema is validated, not part of removing three of them,
and it would need its own record. The changelog's Upgrading note says to
delete the two fields, which is the whole of the migration.

**Keep `env:` for the `when:`/`ready:` probes only.** Those two are the
fields where inlining is least pleasant, since the whole string is the
predicate. Rejected because a field that applies to some of a phase's
commands and not others is harder to explain than either having it or not,
and `FOO=bar test "$FOO" = bar` works in a predicate exactly as it does in
a check.

## Consequences

- Three fewer things in the v1 schema, and one fewer branch on the failure
  path. `src/` gets smaller; [architecture.md](../architecture.md) carries
  the current count and is the one place it is written down.
- **Breaking for workflow files.** A workflow declaring `on_fail: abort`
  fails `validate` (exit 3) and will not load. One declaring `env:` or
  `on_exhausted:` still loads and runs, with the field ignored: the phase's
  commands see none of the declared variables, and an `on_exhausted: abort`
  escalates. All three are removals from the file, not rewrites of it — see
  the changelog's Upgrading note.
- A run that ends `ABORTED` was ended by a person. Nothing headsign judges
  can produce that status any more, which makes `status`'s terminal line and
  the log's `abort` event unambiguous about who ended the run.
- Every command headsign spawns now inherits headsign's own environment and
  nothing else. Together with ADR-0012 (which removed the only thing that
  spawned `git`), what the tool runs is fully described by one sentence:
  `/bin/sh -c`, on the strings the workflow file contains, in the run's
  directory.
