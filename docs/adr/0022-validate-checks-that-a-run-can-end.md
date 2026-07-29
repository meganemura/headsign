# ADR-0022: `validate` checks that a run can end, not only that its phases can be reached

- Status: accepted
- Date: 2026-07-30

## Context

`headsign validate` asked one structural question about the graph: is every
phase reachable from `entry` (ADR-0011). It never asked the other one — can the
run stop.

That second question has a trap in it. `max_attempts` counts a phase's failures
*since it last passed*, and `engine.ts` clears the count on a pass. So the
counter an author naturally reaches for cannot bound a loop whose every edge is
taken on a **pass**: each lap through the loop resets it. For such a graph
`limits.max_total_iterations` is the only backstop that exists, and it is
optional with no default.

`example.headsign/sweep.yaml` is precisely that shape — a queue worked one item
per lap, turning back through `record → apply` for as long as entries remain —
and `docs/workflow-reference.md` says in prose that the ceiling "sits above the
whole thing as the backstop". Prose is not a check. A sweep written without that
line validated clean, and the only thing that could stop the resulting run was
somebody noticing.

## Decision

**1. A new warning, on one narrow condition.** `validate` warns when all three
hold: a cycle exists using **pass edges only**; every phase on it is reachable
from `entry`; and `limits.max_total_iterations` is absent. Pass edges are the
string form of `on_pass` and every `to:` of a k-way `on_pass`, minus `$end`.

**2. A warning, not an error** — ADR-0011's reason unchanged: a half-written
phase or an edge commented out for a minute must not stop the run being used to
write it. `validate` still exits 0, and `start` still prints it once, while the
person who wrote the file is there.

**3. Silence when a ceiling is declared.** `max_total_iterations` is the answer
to a graph that turns forever (ADR-0017), so a bounded run gets no advice about
it. This is what keeps every workflow shipped in this repository — all of which
declare one — free of the new warning.

**4. Cycles that need a failure edge to close are left alone.** In `verify
--fail--> apply --pass--> verify`, each lap costs `verify` one attempt and
`verify` never passes, so its `max_attempts` really does bound the loop.
Deciding when such a cycle is *un*bounded means enumerating the cycles and
checking that nobody on one carries `max_attempts` — more machinery for a
verdict that would produce false positives on the workflows people actually
write.

**5. Found the plain way, not with Tarjan.** Ask each phase whether it can walk
back to itself over pass edges, then group two such phases together when each
can reach the other. Phase counts are in the tens, so the cost of asking one
phase at a time is irrelevant, and ADR-0016's fitness function — can this be
explained to a middle-school reader — is not.

**6. The message carries its reason.** It is long by the standards of the
other warnings, deliberately: told only that the graph loops, an author reaches
for `max_attempts`, which is the one thing that cannot help.

## Alternatives considered

**Make it an error.** A workflow that cannot stop is arguably broken. Rejected
under §2, and for a second reason: a cycle with no ceiling is a legitimate thing
to have half-written on disk while you decide what the stopping condition should
be, and `validate` is the tool you use *while* deciding.

**Default `limits.max_total_iterations` to some number instead of warning.**
Cheaper for the author, and it would make the trap unreachable. Rejected: the
right ceiling is a fact about the work — the sweep's is the length of its queue,
a review loop's is three — and a default would be a number headsign invented,
enforced as an escalation the author never wrote. ADR-0017 made the ceiling
recoverable precisely because reaching it can mean "the run turned out bigger
than someone guessed"; a guess headsign made itself would make that message a
lie about who guessed.

**Warn on any cycle with no ceiling, fail edges included.** Simpler to state and
catches strictly more. Rejected under §4: it fires on the review/implement loop
in half the shipped examples, where `max_attempts` is doing exactly the job the
warning would be telling the author to do differently. A warning that is usually
wrong teaches people to stop reading warnings.

## Consequences

- Every workflow in `example.headsign/` and `.headsign/` already declares a
  ceiling, so none of them changed and none of them warn. That was checked by
  running `validate` over all ten.
- `unreachable()` and the new check share one walk helper (`reachableFrom`), so
  "reachable from entry" is computed one way for both questions.
- The trap itself is unchanged and still real: `max_attempts` cannot bound a
  pass cycle. What changed is that the file now says so at the moment someone
  writes one, instead of the reference page saying it to whoever reads that
  paragraph.
