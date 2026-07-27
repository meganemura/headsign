# ADR-0015: Rejecting unknown keys, and `version: 0.1`

- Status: accepted
- Date: 2026-07-28
- Amends [ADR-0003](0003-workflow-yaml-vocabulary.md): `version:` now reads
  `0.1` rather than `1`, and `validate` rejects any key the schema does not
  define. Takes up the record [ADR-0014](0014-removing-three-unused-knobs.md)
  said this change would need: its `env:` and `on_exhausted:` removals landed
  quietly because unknown keys were ignored, and they no longer are.

## Context

Two things in the schema were saying something we do not mean. They get one
record because they are the same mistake pointed at two different places:
**a file that disagrees with the schema should stop, not proceed quietly.**

### Unknown keys were ignored

`validate` checked the keys it knew and walked past the rest. A phase
declaring `max_atempts: 3` loaded, validated, and ran — with no attempt
budget at all, because the field headsign reads is `max_attempts` and
nothing in the file spelled it. The author wrote a limit, read `OK:
workflow 'feature-dev' (3 phases)`, and got a phase that will retry forever.

headsign's whole claim is that a run follows the map deterministically.
Silently skipping the parts of the map it cannot read contradicts that: the
run is deterministic with respect to a workflow its author did not write.

ADR-0014 sharpened this by removing three fields. `on_fail: abort` was
caught, because `on_fail` survived as a field with a token set. `env:` and
`on_exhausted:` were not: a file still carrying them loaded, the phase's
commands saw none of the declared variables, and an `on_exhausted: abort`
escalated instead. Both are leftovers from a change made the day before this
one, which is the shortest possible half-life for this kind of drift.

### `version: 1` claimed a stability we do not have

The schema has taken breaking changes in consecutive days — k-way `on_pass`
routes (ADR-0011), three fields removed (ADR-0014), and now this. A major
version of `1` is a promise about compatibility, and there is nothing behind
it. Every workflow file in existence carries that number at the top, which
makes it the most-read claim the project publishes about its own schema.

## Decision

### 1. An unknown key is an error at every level

`validate` rejects any key the schema does not define, at every level:

| Level | Allowed keys |
|---|---|
| top level | `version`, `name`, `entry`, `phases`, `limits` |
| phase | `description`, `clear`, `ready`, `gate`, `on_pass`, `on_fail`, `max_attempts` |
| gate | `checks` |
| check | `name`, `run`, `timeout` |
| route (an `on_pass` list entry) | `when`, `to`, `timeout` |
| limits | `max_total_iterations` |

The message names where the key was found and prints what that level
accepts:

```
INVALID: .headsign/workflow.yaml
- phase 'implement': unknown key 'max_atempts' (allowed: description, clear, ready, gate, on_pass, on_fail, max_attempts)
```

That table lives in `src/workflow.ts` as a single object the validators read
— one list per level, and nothing else enumerates keys — so a field cannot
be added to the schema and forgotten by the rejection rule.

### 2. It is an error, not a warning

`validate` has a warning channel, and an unreachable phase uses it
(ADR-0011): a run can proceed with one, because the file is merely
unfinished — a phase written before the edge that reaches it, or an edge
commented out for a minute. The author knows what they left half-done.

An unknown key is the opposite case. Nothing is unfinished; the author
believes they declared something, and the thing they declared will not
happen. Warning and proceeding would print that fact into stderr and then
run the workflow anyway, which is where a `max_atempts` typo does its
damage: the run continues, no budget applies, and the warning scrolls past
in a loop nobody is watching. So the run stops before it starts, with exit 3
like any other invalid workflow.

### 3. No did-you-mean guess

An edit distance against the allowed keys would turn `max_atempts` into
"did you mean `max_attempts`?". We list the level's allowed keys instead,
and stop there.

A guess is right often enough to be trusted and wrong often enough to
mislead: nothing in the schema is within a character of `on_error`, and the
key a reader would want suggested there (`on_fail`) is a guess about intent
rather than about spelling. A reader handed the allowed list reaches the
right key just as fast and is looking at the schema while doing it. It is
also one less thing to keep calibrated as the schema changes.

### 4. `version` is `0.1`, matched exactly

The only accepted value is `0.1`. Anything else fails, including `1`, with
one line (wrapped here):

```
version must be 0.1 (the schema is pre-1.0 and still changing; a file
written for the old 'version: 1' needs its fields checked against the
current schema, not just the number changed)
```

The message spends its length on the one thing a terse version error gets
wrong. `version: 1` was not a different number for the same schema — it was
a schema with a per-phase `env:`, an `on_exhausted:`, and `abort` as an
`on_fail` value, and a file written against it can be wrong in ways changing
the digit will not fix. Now that unknown keys are rejected, `validate` names
those ways too, one line each and in the same report as the version error,
so a single run lists every edit the file needs.

### 5. While pre-1.0, a schema change requires an explicit edit

`0.2` will be matched exactly too, and so will every version after it until
`1.0`. There is no "accept anything below the current version" rule and no
migration shim.

This is the same decision as rejecting unknown keys, applied to the file as
a whole rather than to one key: when headsign's schema and a workflow file
disagree, the disagreement surfaces at `validate` rather than at some later
moment when a phase does not do what its author wrote. The cost is that a
schema change makes every existing workflow file fail until someone edits
it — one line if nothing else changed, and the changelog's Upgrading note
says what else did. That cost is the point. It is paid by a person reading
an error message, which is the cheapest place to pay it, and it buys the
guarantee that a file which loads was read against the schema it runs on.

After `1.0`, a compatible-version rule (accept `1.x`) becomes possible,
because there would then be a promise that `1.x` schemas mean the same
things. Nothing here presumes that shape; it is deferred.

## Alternatives considered

**Warn on unknown keys instead of rejecting.** Rejected in Decision 2, and
ADR-0014 rejected the same shape for its removed fields: a knob that is
read, reported, and then disregarded is exactly the drift this record is
undoing.

**Reject unknown keys only at the phase level.** Phases are where authoring
happens and where the typo risk concentrates, so this catches most of the
value for a fraction of the table. Rejected because the exceptions are
arbitrary to explain and to remember — `checks` is a level someone edits
constantly, and a `timeout` misplaced onto the `gate` instead of the check
is a realistic mistake with a silent outcome. A rule that holds everywhere
needs no rule about where it holds.

**Accept `1` as an alias for `0.1` for one release.** Rejected: the number
is exactly the thing that should stop being trusted. A file saying `1` was
written against a schema with three fields that no longer exist, and quietly
accepting it re-creates the silence this ADR removes, on the field that
declares which schema is in force.

**Keep `version: 1` and lean on the changelog.** Rejected because the
changelog is read once and the file is read every time. The version line is
where a reader forms their expectation of stability, and the honest value
there costs nothing to write.

## Consequences

- **Breaking for every workflow file**, twice over: `version: 1` must become
  `version: 0.1`, and any key the schema does not define — including a
  leftover `env:` or `on_exhausted:` from ADR-0014 — now fails `validate`
  with exit 3 instead of being ignored. `headsign validate` on each file
  reports both, and the errors name what to delete. The eight workflows in
  `example.headsign/` are updated.
- **A typo is caught before the run starts**, and the phase that would have
  run without its budget does not run at all.
- `validate`'s two channels now split along a stated line: a warning is a
  file its author has not finished, an error is a file that says something
  headsign cannot do.
- `src/` grows by the key table and the check that reads it;
  [architecture.md](../architecture.md) carries the current count and is the
  one place it is written down.
