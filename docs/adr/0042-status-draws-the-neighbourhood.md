# ADR-0042: `status` draws the neighbourhood

- Status: accepted
- Date: 2026-09-16
- Amends [ADR-0031](0031-when-the-run-entered-the-phase.md): the record gains
  a second field stamped at the same boundary as `phase_entered_at`, and
  `status` prints it.
- Relates to [ADR-0011](0011-k-way-routing-on-pass.md): a route list is drawn
  one row per route, `when:` beside it, the default marked.
- Relates to [ADR-0030](0030-the-token-line-is-the-contract-and-nothing-else-is.md):
  the picture is a non-contract part of `status`, and it moves the `workflow:`
  line off line 2.
- Relates to [ADR-0040](0040-the-run-pane-is-a-claude-only-overlay.md): the
  pane shows the picture as text, and this is why the picture is the CLI's and
  not the pane's.
- Relates to [ADR-0017](0017-three-budgets-and-the-recoverable-ceiling.md):
  the lap count in the box is the number that ceiling counts.
- Revised: 2026-09-19 (Decision 2: the box also carries the run's lap count,
  `laps/ceiling` or `lap N`. The first line keeps the phase's attempts; the
  two numbers answer different questions.)

## Context

A run is a walk over a graph, and `status` said only where the run stands. A
reader who wants to know where it came from and where it can go next opens the
workflow file and finds the phase by hand.

The run pane ([ADR-0040](0040-the-run-pane-is-a-claude-only-overlay.md)) made
the gap visible. It draws what `status` prints, and it may not read
`state.json` or the workflow file, so it could not draw the graph on its own.
The place that has both the record and the workflow is the CLI.

Three facts decide the previous phase. `.headsign/log` records every
transition, but ADR-0031 already ruled the log out as a source for `status`:
it is internal state, and ADR-0004 makes `status` the one reader of the run
record. `state.json` records when the run entered its phase, but not from
where. The lap that stamps `phase_entered_at` holds the phase it is leaving in
hand.

## Decision

**1. `state.json` records `phase_entered_from`.** It is stamped in the same
branch as `phase_entered_at`, from the phase the lap is leaving, so every
ADVANCE writes it, a RETRY leaves it alone, and a self-route writes the
phase's own name. `start` writes null: the entry phase was entered from
nowhere. A record that predates the field reads as null, with the tolerance
every field of the record already has.

**2. `status` draws the neighbourhood under the token line**, framed by one
blank line on each side, ahead of every `label:` line:

```
RUNNING review (attempt 1/8)

  implement
      │
  ╔════════════════╗
  ║ review   45/80 ║
  ╚════════════════╝
      ├─ pass ─▶ close
      └─ fail ─▶ implement

workflow: beads-loop
```

The phase above is `phase_entered_from`, omitted when null. The box is the
current phase and, at its right, how far along the run is (revised
2026-09-19): `total_iterations` against `limits.max_total_iterations` as
`45/80` when the workflow declares the ceiling, and `lap 45` when it does
not, so a bare number never has to be guessed at. The count is the run's
laps, every gate the run has judged, which is what the ceiling counts too; it
is not the phase's attempts, which the first line carries. Each pass route is
one row; a `when:` is printed beside its
arrow in full, and the trailing default is marked `default`. The fail row
names the `on_fail` the lap would use, default included: `retry` and a
self-route both draw the phase's own name, so a loop reads as one more box to
fall into, and `(N attempts left)` follows only when `max_attempts` is
declared. `escalate` and `$end` are printed as words.

**3. Top to bottom, not left to right.** Three columns would need their widths
agreed, and the first long `when:` would break the alignment. Vertically, each
row is its own line and a condition of any length sits beside its arrow
without moving anything else. The connector column is fixed whatever the name's
length, so every workflow gets the same shape.

**4. `render.ts` draws, `engine.ts` resolves.** The renderer is handed a flat
shape: the previous phase or null, the pass routes as a list, the fail target
as a word, the attempts left when there is a limit. A string `on_pass` arrives
as a one-route list. The renderer never reads the schema.

**5. Absent means byte-identical.** The picture and both blank lines print only
when the workflow is readable and still defines the phase, the condition
`attemptUnknown` reports. (`description` is optional per phase, so a phase
without one still gets its picture.) A run headsign cannot describe
prints what it always printed.

## What is deliberately not being done

**Drawing the whole graph.** Every phase and every edge would need a layout
algorithm and would not fit a pane. The three rows a reader needs at a glance
are where the run came from, where it stands, and where it can go next.

**Drawing in the pane.** The pane would have to open `state.json` and the
workflow file, which ADR-0040 §3 forbids. Drawing in the CLI also gives the
picture to a terminal reader and to Codex.

**A history of previous phases.** One field, the last entry, answers the
question. A list would be the report on a run that ADR-0031 declined.

## Consequences

- `status`'s `workflow:` line is no longer line 2 for a run with a readable
  workflow. ADR-0030 says the token line is the contract and nothing else is,
  and the reference pages say the same; the changelog carries the change.
- A long `when:` wraps in a narrow pane. The box and the connectors are on
  their own lines, so the structure survives the wrap.
- Tests that compared a whole `status` transcript gained the picture. The
  render tests pin each row shape: no previous phase, a route list with a
  `when:` and a default, `retry` with and without a limit, an explicit
  self-route, `escalate`, `$end`, and a one-letter phase name.
