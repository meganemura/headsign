# What goes in the comments

Read this when you are writing the workflow file's comments. Steps named
here are the steps in `procedure.md`.

**The rule is a purpose, not a list: write down what a reader cannot get by
reading the file.** A workflow file states what happens. It does not state
why this shape, why this number, or how much a gate is actually worth — and
those answers exist only in the conversation that produced them, which does
not survive. The comments are the only place they can live.

**Three things are required, and every file carries all three.**

1. **The shape, in the header** — the phases and the edges, in ASCII. This is
   the picture from step 3; putting it here gives it a life after the
   conversation that produced it.
2. **What a gate proves and what it does not** — required on **every
   fakeable gate and every anchored one** (step 1's line), because those are
   the two a reader will over-trust; an anchored gate's line says what its
   anchor is and which check guards it, since without that it cannot be told
   from a fakeable gate holding a `git` command. Also worth a line wherever
   the position is not obvious from the command: a check on a document can be
   any of the three, and the reader should not have to work out which for
   themselves.
3. **A mark that a command was composed** rather than lifted from the
   repository. Whoever reads this file next needs to know which lines to
   check against the project and which to check by running them. Commands
   taken from the repository need no mark.

**Those three are the floor, not the ceiling.** Anything else a reader would
otherwise have to guess at belongs here too. In particular, **the reasoning
behind any number in the file**:

- The ones step 4 asks you to record — why the ceiling is 20, why this
  `timeout:` is 300, and why a `timeout:` is *absent*, with the measurement
  that made the default sufficient or the note that it could not be
  measured. Step 4 tells you to write these down; here is where they go.
- Any threshold you chose inside a check's own command — why the
  description has to be 40 characters and not 10, why three sections and not
  two. A number picked in conversation is invisible in the `run:` string
  that ends up holding it.

**Never drop a check because its reason has nowhere to go.** If the only
thing standing between a check and the file is that you cannot see where to
put its justification, the answer is a comment above it, not a smaller
workflow. A formatting rule that quietly deletes design decisions is worse
than a file with one comment too many.

**A note that holds uniformly goes in the header, once.** If fifteen of
sixteen checks were composed, marking all fifteen restates the file's own
shape and buries the one line that matters; write "every check below is
composed unless noted otherwise" in the header and mark the exception.
The same applies to any other note that is true everywhere. Repetition at
that scale is the bulk the next rule is about.

**What is forbidden is restating what is already on the page.** `# this
phase does the implementation` above `implement:` tells a reader what
`implement:` already told them. The test is the purpose above: could a
reader get this from the YAML? If yes, it is bulk, not explanation — and
bulk is not harmless, because it is what makes the real comments hard to
find.

**These go in comments, not in `description:`.** `description:` is handed to
the working agent verbatim at run time; comments are never read by headsign
at all. Everything above is addressed to a different reader — the person
deciding whether to trust this workflow, and whoever comes back later to
change it — and mixing it into `description:` muddies the instruction the
agent is actually meant to follow.

**Write them in the repository's language, not this project's.** headsign's
own convention is English comments, but you are writing into somebody else's
repository: match the language of the comments and README you find there,
and if that does not settle it, match the language the conversation is in.

**The rule generalizes, and it splits by destination: what stays in the
repository takes the repository's language, what is handed to a person takes
the language you are talking in.** Comments and any file you leave behind
follow the repository. The hand-over report of step 8 in `procedure.md`, and
the questions in `asking.md`, follow the conversation — they are read once,
by the person in front of you, and translating them into the repository's
language serves nobody.
