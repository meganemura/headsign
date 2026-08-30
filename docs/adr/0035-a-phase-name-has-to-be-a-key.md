# ADR-0035: A phase name has to be a name the run's own maps can hold

- Status: accepted
- Date: 2026-08-30
- Amends [ADR-0015](0015-strict-schema-and-version-0-1.md): its strict schema
  polices the keys a workflow may *write*. This adds the one rule about the
  keys a workflow may *invent* — its phase names.
- Relates to [ADR-0023](0023-pinning-the-graph-a-run-is-walking-under.md): the
  graph pin is one of the two maps that a phase name keys.

## Context

A phase name is chosen by the workflow's author and then used as a key of two
plain objects a run keeps: `state.attempts`, which counts a phase's failures,
and the graph fingerprint, which pins the rules the run is walking under.

JavaScript already puts names on every object. Two of them broke a run in ways
nothing reported:

A phase named `toString` counted nothing. `attempts['toString']` reads back the
function every object inherits, so `?? 0` never fires, `+ 1` concatenates
instead of adding, and the budget test compares a string to a number and is
false forever. Measured on a phase with `max_attempts: 2`:

```
attempts after 1 fail: {"toString":"function toString() { [native code] }1"}
attempts after 2 fails: {"toString":"function toString() { [native code] }11"}   outcome: RETRY
```

`max_attempts` never fires. The run retries until something else stops it.

A phase named `__proto__` was never pinned. `fingerprint['__proto__'] = hash`
sets a prototype instead of adding an entry, so the phase is absent from the
map, an edit to its rules matches nothing, and the run walks rewritten rules in
silence — the one thing ADR-0023 exists to prevent. The YAML parser hands such
a name over as an ordinary own property, so the name reaches all of this.

Both were found by property-based tests: the second by one asking that the pin
cover exactly the phases a run can still reach, the first by widening that
finding to the class it belongs to.

## Decision

`validate` rejects a phase whose name is already a property of `Object.prototype`.
The list is read off the prototype rather than typed out, so a name the language
adds later is covered without anybody remembering this rule:

```ts
const RESERVED_PHASE_NAMES = new Set(Object.getOwnPropertyNames(Object.prototype));
```

The error names the phase and asks for a rename.

The schema is the right place because it is the one boundary every phase name
crosses: `load` returns a workflow only when the error list is empty, so a
rejected name reaches neither map. Refusing the class outright, rather than the
two names that were found, follows ADR-0015's reading of a typo — a rule that
covers what nobody thought of is worth more than a list of what somebody did.

Two smaller changes ride along, in `workflow.ts` only:

- `graphFingerprint` and `canonical` build their maps with `Object.create(null)`.
  `graphFingerprint` is exported and called directly, so it keeps a guard of its
  own — the standing `engine.ts`'s `describePhase` has behind the same validation.
- `changedFingerprintKeys` asks `Object.hasOwn(saved, key)` instead of
  `key in saved`. `in` also answers for what an object inherits, so a key named
  after an object property read as present in a saved map that never carried it,
  and a newly reachable phase would have been reported as a changed rule rather
  than adopted in silence. This one is reachable independently of the name rule,
  because a saved map is JSON a person can edit.

## What is deliberately not being done

**Hardening every map instead of naming the rule.** `state.attempts` is built
and read in `engine.ts` and `render.ts` as well, and `state.json` round-trips
it. Fixing each site means finding each site, and the next map keyed by an
author's name starts the search again.

**Widening the rule to the `$limits` collision.** A phase literally named
`$limits` still shares a key with the fingerprint's own `limits` entry, and
that stays as ADR-0023 left it: the collision is deterministic, `limits` wins,
and the phase rides along with it. It is visible in the map and in the report.
The names refused here are the opposite — they produce a map that looks correct
and answers wrongly.

**A migration arm for old records.** No `state.json` in the wild can hold a
`__proto__` fingerprint key, because the behaviour being fixed *dropped* it; and
a `toString` attempts entry was never a number to be read back. There is nothing
tolerant to add, so nothing is added.

## Consequences

A workflow that names a phase `toString`, `__proto__`, `constructor`,
`hasOwnProperty` or any other property of `Object.prototype` is rejected at
`validate`, which `start` and every `next` already run. The message says the
name is the problem.

`max_attempts` fires for every phase a workflow can now declare, and the graph
pin covers every phase a run can reach.

Names that merely look reserved — `to_string`, `proto` — are ordinary names and
stay accepted.
