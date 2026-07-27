# Explaining well

Advice for the `explain` phase of `fitness.yaml`. First edition, deliberately
short — the `improve` phase is what makes it longer.

## What this is for

Not a grade. The point is what you notice *while* breaking the function down.
A function you cannot say plainly is usually a function doing two things, or
one thing under a name that hides which.

## The one failure mode to watch

Restating a hard word with a harder one hides the complexity instead of
finding it. **Hidden complexity lives exactly where the plain retelling
refuses to come out** — the clause you keep leaving in jargon is the clause
worth reading the code again for.

## The bar

A reader who has read your explanation and nothing else can say what you pass
the function and what happens: what comes back, what it changes on disk, and
what it does at the edges (empty input, missing file, a value nobody
declared). If they would have to open the source to answer that, the
explanation is not there yet.

## What the improve phase adds here

This file is grown by `improve`, one run at a time. Add, with concrete
examples:

- an explanation that was approved, and the specific move that made it land
- an explanation that was rejected, quoting where the reader lost the thread
  and what they still could not predict

Keep the examples; a rule without the case that produced it gets softened
back into a platitude on the next pass.
