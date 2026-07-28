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

### "Optional" is a debt; pay it in the same breath

Every time you write that something is optional, you have promised to say what
happens when it is left out. A reader who is told a field may be absent, and
then told the answer is keyed on that field, has to invent the missing case —
and everything they invent is consistent with what you wrote.

*The cases.* Both rejections in the first module-level sweep were this, and
neither was a confusing sentence — both were something true that was never
said, sitting next to something that was.

The explanation pinned one time limit at "an unchangeable 120 seconds" and
left the other two unstated:

> a caller reasonably assumes time limits are fully specified everywhere. They
> are not. A check written without seconds, or a slow question in a
> destination list, has no stated bound

Then it called a label optional and, two paragraphs later, said the failure
report names the check "by label":

> The command text, an empty name, a position in the list, and the string
> "undefined" are all consistent with what is written

The fix that worked is structural rather than diligent: **one section that
enumerates every optional field and every empty input with its answer.** It
forces each "optional" already written to be settled in a place where a
missing one is conspicuous. The attempt that added it was approved.

### Describe what the module is told, never why it was told

A cause the module cannot observe is not part of its boundary. Writing one in
produces a sentence that contradicts the module's own opening, and a reader
who notices cannot tell which half to believe.

*The case.* `render.ts` reads no files — its explanation says so in the second
paragraph — and then explained an attempt count printed as `2/?` by saying the
workflow file "could not be read". The judge:

> This contradicts the opening promise that the module "reads no files and
> writes none": if it never reads the workflow file, it cannot be the thing
> that failed to look the limit up

What it is actually handed is a flag meaning "I could not determine the
limit". The corrected version says exactly that, and adds that the module is
never told why and does not care.

### When two conditions could both apply, say which is checked first

The same debt as "optional", in a different currency. Describing two outcomes
in two places, each true under its own condition, leaves a reader unable to
predict the case where both hold.

*The case.* `render.ts` again, same rejection. One section said an attempt
count reads `2/?` when a limit could not be determined; another said it reads
a bare `2` when there is no limit. The judge:

> the same input state, two different outputs, with nothing to tell a caller
> which one they will get

The fix was one numbered rule with the precedence in it — the flag wins, then
a limit, then bare — rather than two accurate sentences in separate sections.

### At module scale, the enemy is omission, not confusion

A boundary explanation can hide something by never mentioning it, and a judge
who has read only the explanation cannot see a subject that was never raised
— it can only see the edge of a gap that something else pointed at.

*The case.* The module-level explanation of `gate.ts` **dropped a detail the
per-function explanation of the same code had got right**: that a check with
no label is reported by its own command text. At function scale it was
obvious; at module scale it fell out. The judge caught it only because the
word "optional" was still there to catch it on.

So do not rely on being thorough. Rely on the shape above, which turns
completeness into a list somebody can check.

### Name what the function does not police

Most functions have an edge something else is responsible for. Say so and
stop; do not speculate about where the checking happens.

*The case.* Three of the four `gate.ts` explanations end this way — an empty
check list passes, an empty readiness command succeeds, a default entry in the
middle of a list silently orphans everything below it. "Something earlier in
the program is responsible for refusing this" kept those sentences short and
kept the explanation about this function.

## Writing about a seam rather than a module

### Contracts say what a module owns; the gaps are always what it requires

Ownership is easy to write down, because it is what the author was thinking
about while writing the code. Requirements live in the caller's habits, and
that is exactly why a unit of one module cannot see them.

*The case.* Seventeen declarations were added across six modules to make
eleven seams pass. Every one was already true and none changed behaviour, and
almost every one was a requirement rather than an ownership claim: who chooses
the directory, what shape the arguments arrive in, that a write replaces
rather than merges, that an append adds no terminator, that nothing is
remembered between calls, that a caller must hold the lock.

### Two of them were not gaps but contradictions

Look for these before looking for silence — they are rarer and worse, because
a reader who believes the contract is actively misled.

*The cases.* `render.ts` declared "must NOT know about … state" while reading
the state to print its counters; the judge found the collision inside the
quoted contract itself. `gate.ts` wrote "Both are 'run shell, read exit
code'" — a word that closes a list at two — while having three jobs, the
readiness probe named nowhere.

### The bar: could the caller get it wrong and the callee not notice?

Assumptions that are true of every function taking arguments are not
assumptions worth declaring. "The values are consistent with each other" is
the ordinary meaning of taking arguments, and no contract anywhere declares
it.

*The case.* Measured, not asserted. `cli.ts>render.ts` was rejected on one
attempt for exactly that, and approved on the next with the bar applied.
Without the bar every seam fails and the report is noise; the first attempt at
this sweep was folded after three items for that reason.

### Quote the whole field, not the line the gate checks

*The case.* The gate verifies the opening line of each header field verbatim.
The first seam quoted only those opening lines, was rejected for an assumption
the contract did declare three lines further down, and argued from words the
quote did not contain — which the judge noticed and said so.

## Writing about a module rather than a function

Two sentences open a module's explanation: what it is for, and what it
deliberately does not do. The second is the one that resists faking. A purpose
can always be stretched to cover a mess — "this handles workflow things" — but
a thing with no shape has nothing it obviously must not do.

*The case.* `gate.ts` was a deliberate test of that, because its row in
`docs/architecture.md` is two clauses joined by a semicolon: run the phase's
checks, *and* resolve which route matched. It was not flagged as unfocused,
and the reason is instructive rather than lenient. The unifying sentence held
— *runs shell commands on behalf of a phase and reports their exit codes, and
never decides what those codes mean* — and its exclusion half excluded real
things: state, version control, what a destination name means. A vaguer
purpose could not have produced that list.

### A big module does not have a big boundary

Do not size the explanation by the file. `cli.ts` is the largest module in
`src/` — 490 lines, about twenty named functions, and **zero exports**, so
nothing in the language marks what is observable. It was approved on the
**first attempt**, in a page.

The reason is worth carrying: a caller of `cli.ts` is a person typing a
command, so the surface is six commands, one directory, six first-line words
with their exit codes, a second vocabulary for one of them, one shape of
failure, and the files one command rewrites. The twenty functions never come
up, because a caller cannot see one.

Where a contract has already been written down somewhere — here, ADR-0002 —
the explanation's job is to *find* it, not to invent it. Sizing the effort by
the line count is how a writer talks themselves into touring the internals.

Three moves made it land first time, all borrowed from earlier rejections
rather than invented: the optional-and-empty section written up front; the two
vocabularies stated as deliberate ("on purpose", both times) so a reader does
not read one as a mistake; and the destructive step named plainly — `start`
deletes the whole scratch directory, written as "anything you left there is
gone" rather than "the directory is reinitialised".

## An observation, not yet a rule

The two functions that needed a justification paragraph to become predictable
encode a *policy* — which way to fail when the world breaks. The two that
needed none are mechanisms. Explaining a mechanism takes a list of steps;
explaining a policy takes the alternative and its cost.

Whether that says anything about the code is not yet known: both policies here
were chosen deliberately and are argued in the source. Check it against a
module where they were not.
