# The problem a quiet stop left behind

The design run recorded in `quiet-stop-plan.md` started from field feedback. This
file used to hold that report as it arrived, which was a mistake:
`docs/maintenance.md` requires the underlying problem to be restated in general
terms and the general problem to be the thing fixed. What follows is that
restatement. Nothing here is anyone's words but ours.

## What a driver runs into

A session drives a run and advances several phases within one turn, ending turns
without running `headsign next` each time. The stop-boundary backstop exists for
exactly that mistake — but the nudge arrives only on some turn endings, in a
pattern that looks arbitrary from inside the session.

It is not arbitrary. Once a stop hook has held a turn, Claude Code marks the
continuation, and headsign passes the next stop through rather than holding a turn
the platform has already resumed. That behaviour is correct and not in question.

## Why it was worth a report

The pass wrote nothing anywhere — no log line, no field in the run record, nothing
in `headsign status`. So a driver could not tell these apart:

- the hook ran, found the platform's flag, and stood down; or
- the hook is not installed, or is not firing at all.

The first needs no action. The second is a broken setup. Documentation cannot
separate them, because the question is about one machine right now rather than
about the design — only a mark the hook left can answer it. Absent that mark, the
reasonable next step is to go and audit the hook registration, which is wasted
work.

## The second half, which was worse

Looking for an explanation, a driver finds `stop_nudges` in the run record and
reasons from it. The name matches one of the documented reasons a turn can end
quietly, so a value of 0 reads as "not that one, then". That inference is sound
and the field is not:

- it is never incremented by a platform pass, so it cannot answer the question
  being asked of it; and
- every real `headsign next` resets it, so on a run being driven it reads 0 or 1
  whatever happened.

The documentation named four reasons a turn can end quietly, the record exposed
one of them, and the exposed one was not the cause. A field that looks like an
answer is worse than no field, because a reader stops looking.

## What came of it

[ADR-0025](../../docs/adr/0025-a-stop-that-passed-and-a-stop-that-never-ran.md)
— the `unheld` log event, the `last_stop` field, and two `status` lines. The
design reasoning, including the parts that were wrong and were corrected while
writing it, is in `quiet-stop-plan.md` and `quiet-stop-corrections.md` beside this
file.

A follow-up report on the same area is worth knowing about when reading those: the
first thing the new line ran into was that `unheld` could not be read on its own,
because the *held* stops around it were still invisible. ADR-0025 §7 carries that
retraction.
