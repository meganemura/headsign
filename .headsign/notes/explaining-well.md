# Explaining well

Advice for the `explain` phase of `fitness.yaml`. Grown by `improve`, one run
at a time. Every rule below is followed by the case that produced it; keep the
cases, because a rule without one gets softened back into a platitude on the
next pass.

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

## Rules, each with the case that produced it

### Show a returned literal; never paraphrase one

When a function returns a fixed string, put the string in the explanation on
its own, and say that its punctuation is part of it. A paraphrase of a literal
is unpredictable by construction: no reader can recover the characters from
the meaning.

*The case.* `gate.ts:buildTail` returns a fixed marker when it had to cut the
output. Attempt 1 said "a line saying the output was truncated", and the judge
rejected it:

> given a 10,000 character input they can predict the last 4,000 characters,
> the trim, and the line break, but not the first line of the string that
> actually comes back.

Attempt 2 showed the marker in a fenced block and added "one character, `…`,
not three dots". Approved.

### Never state a count you have not counted

A wrong number in an otherwise exact description does not cost one wrong
number. It costs the reader's ability to use the precision anywhere else — and
precision was the only thing making the explanation predictable.

*The case.* That same attempt called `(no output)` "exactly those nine
characters". It is eleven. The judge:

> In a description that is otherwise exact to the character, the reader cannot
> tell which half of the sentence to trust: is the returned literal
> `(no output)`, or is it `no output` with the parentheses being the writer's
> quoting? Everything after this point is read with that doubt attached.

If you are not going to count it, do not claim a count — show the characters
and say the punctuation is part of them.

### State the order when the order changes the answer

Two steps that each look harmless can combine into a case nobody expects.
Number the steps, then draw the surprising consequence out yourself rather
than leaving the reader to compose it.

*The case.* `buildTail` cuts to the last 4,000 characters *and then* trims
blank space, so a command that printed a great deal and finished with 4,000
characters of blank lines is reported as having printed nothing. The approved
attempt said exactly that. The judge's approval named the move: the edges "are
each stated with their ordering made explicit".

### A surprising branch needs the reason it was chosen, not just its behaviour

Written as bare behaviour, a deliberate asymmetry reads as a bug. Give the
alternative and what it would have cost, and the same branch becomes
predictable.

*The case.* Two functions in `gate.ts` handle "the command could not run at
all" in opposite directions, and both explanations spent a paragraph on why.
`isReady` treats it as *ready*, because a broken probe answering "not ready"
would stall the run silently — a not-ready answer is not a failure and leaves
no mark. `resolveRoute` treats it as a *problem* and picks no destination,
because a failed question is a real answer while a question that never ran is
no answer, and the thing being decided is the destination itself. Both
approved first time.

### Name what the function does not police

Most functions have an edge something else is responsible for. Say so and
stop; do not speculate about where the checking happens.

*The case.* Three of the four `gate.ts` explanations end this way — an empty
check list passes, an empty readiness command succeeds, a default entry in the
middle of a list silently orphans everything below it. "Something earlier in
the program is responsible for refusing this" kept those sentences short and
kept the explanation about this function.

## An observation, not yet a rule

The two functions that needed a justification paragraph to become predictable
encode a *policy* — which way to fail when the world breaks. The two that
needed none are mechanisms. Explaining a mechanism takes a list of steps;
explaining a policy takes the alternative and its cost.

Whether that says anything about the code is not yet known: both policies here
were chosen deliberately and are argued in the source. Check it against a
module where they were not.
