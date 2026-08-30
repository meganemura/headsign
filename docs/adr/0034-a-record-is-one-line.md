# ADR-0034: A record is one line, and `logLine` is what keeps it one

- Status: accepted
- Date: 2026-08-30
- Amends [ADR-0004](0004-state-attempts-and-cache.md): its `.headsign/log`
  section says a run is recorded as one line per event. It did not say what
  makes that true of a line composed from text somebody typed.

## Context

`.headsign/log` is read with `tail` and `grep`. Both of those tools work on
lines, and every reading instruction in the reference tells a person to count
`held` lines since the last transition, or to look at the last line for
`stalled`. The file's whole usefulness rests on one event being one line.

Several fields in a line carry free text: `reason="…"` on `escalate`, `abort`
and `ceiling`, `note="…"` on `paused`, `check="…"` on `retry` and on a
fail-routed `advance`, `routed-when="…"` on a routed one, `workflow=` on
`start`, and the phase name in every line's head.

Two of those producers keep the text on one line already, and say so where they
build it: `engine.checkIterationLimit` composes its ceiling reason as a single
line, and `stophook` truncates a pause note to its first line before it reaches
`render`. Nothing did that for the others.

`headsign abort <reason>` takes its reason from the command line and joins the
arguments as typed. `headsign abort $'broke\nbadly'` wrote this:

```
2026-08-30T10:00:01+09:00 abort plan a=0 i=0 reason="broke
badly"
```

That is two lines in the file for one event. The second carries no timestamp,
no event word and no counters, so every reader of the file has to skip past it,
and a `grep -c` over the events counts one that never happened. The same door
is open through a `run:` or a `name:` written with a line break in it, and
through a phase name, since the schema asks a name to be a non-empty string and
nothing more.

Found by a property-based test asking one thing of every event at once: that
the composed line ends once and breaks nowhere else.

## Decision

`render.logLine` replaces every carriage return and line feed in the finished
line with the two-character escape a reader already knows (`\r`, `\n`), then
appends the single terminator.

Applied to the whole composed line rather than inside each arm of `logDetail`:
the head carries author-written text too (the phase name), and an arm added
later cannot forget a rule that is not written in it.

The escape is for **reading**, not for reading back. Nothing parses a value out
of these lines again — the run record is `state.json`, and the log is the
history a person reads — so a reason containing the literal two characters `\n`
and one containing a line break print the same, and that ambiguity is accepted
rather than answered with a quoting scheme.

Only the two characters that end a line are touched. A tab, a quote or a
control character inside free text is somebody's text, and this function's job
is the record's shape.

## What is deliberately not being done

**Sanitising at the producers instead.** `cli.ts` could strip the reason it
reads from the command line, and `validate` could reject a `run:` written with
a line break. Both would work today and both leave the rule in as many places
as there are producers, which is how the two that already keep it ended up
being the only two.

**Rejecting the input.** A person who typed a line break into an abort reason
meant the words, not the break. Refusing the abort would leave a run open over
a formatting detail.

**Escaping what `next` prints to stdout.** The output contract is the first
token line ([ADR-0030](0030-the-token-line-is-the-contract-and-nothing-else-is.md)),
and everything after it is prose meant to be read as prose. A multi-line reason
there breaks nothing, so nothing there changes.

## Consequences

A record is one line, whichever event it is and whatever text it carries. The
reading instructions in the reference hold without a caveat.

An abort reason typed with a line break appears in the log as
`reason="broke\nbadly"`. The words survive; the shape of the file does too.

`render.ts` keeps its standing as the only place the log line format is
written. The rule now lives with the format instead of with the callers.
