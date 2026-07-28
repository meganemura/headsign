# Seam sweep, first run — findings before it was folded

Swept 3 of 11 seams. Folded because the seam question had no written bar for what
counts as an assumption, so every further result would have depended on the writer
remembering an unwritten rule.

## Approved
- cli.ts>render.ts (on the second attempt, once the bar was applied by hand)

## Finding: the working directory is declared by nobody

cli.ts>engine.ts
  Undeclared assumption: the working directory.
  engine.ts's five operations each work in a directory the caller picks, look for the
  run there and nowhere else, never search upward, and never check the choice against
  anything. Its header declares the clock ("nothing here reads the clock") and rules
  out argv, stdout/stderr and exit codes — and says nothing about a directory, who
  chooses it, or that it is taken on trust. It cannot be derived by exclusion either:
  "must not know about argv" rules out parsing a name into a path and says nothing
  about discovering or checking a directory.
  Rejected three times; the second and third attempts quoted the whole header. Not a
  writing problem — the fix is a line in engine.ts's header.

Confirmed again at cli.ts>state.ts, where the judge rejected for the same reason.
The rule this is about — cwd only, never search upward — is explained to users in
README.md and in the workflow skill, and appears in no module's contract.
