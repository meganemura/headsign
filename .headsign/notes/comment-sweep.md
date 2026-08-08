# Comment sweep

One section per file swept by `.headsign/comments.yaml`. Each comment block in
`src/` is sorted into exactly one of three: (1) it restates the mechanics the
code already shows, and goes; (2) it restates a rule stated somewhere else, and
becomes the shortest pointer to that place; (3) it is the only home a decision
has anywhere in the tree, and stays untouched.

**The `Kept` lists are the point of this file.** Taken together they become
something the repository has never had: an index of the decisions that exist in
exactly one place, and would be lost by an edit nobody would think to question.
The counts are bookkeeping; the lists are the product.

The question each block is judged by is deliberately not "can the code be read
without this". Almost every (3) sits above readable code — that is what a
constraint comment is for. The question is: **if this block were gone, which
decision could no longer be recovered from anywhere in the tree?**

---

## src/state.ts

Comment lines 215 → 154. Deleted 1, turned into pointers 28, kept 13.

Judged by a reviewer that read the file as it now stands and the proposal, and
was barred from the file's git history — so it could not know what the removed
lines had said. It opened all 28 pointer destinations and confirmed each rule is
stated there. Verdict APPROVED.

### Where the 28 rules now live

- `.headsign/` path authority, atomic write, and the whole lock protocol
  (hard-link `tryCreate`, read-back to settle a race, `EPERM` means alive,
  stale-lock self-healing, ownership check on release) — ADR-0004
- Append-only log writes, and why `state.ts` does not invent a separator —
  ADR-0024
- `last_failure` named for what it holds rather than for the current state —
  ADR-0012 §3
- `driver_agent`'s rename, and why an empty string must not read as claimed —
  ADR-0013 §3
- `last_stop`, its `cause`, and the `unheld` reading — ADR-0025 §4, ADR-0026 §3/§6
- `last_drive`, what null means, and which stops it is compared against —
  ADR-0027 §2/§4/§5/§7
- The graph pin: a hash per reachable phase plus `$limits`, the report marker as
  a digest, and `COMPLETE` naming the count — ADR-0023 §1/§5/§8
- cwd-only resolution — ADR-0004, "Resolution: cwd only, never parent directories"

### Kept — decisions whose only home is this file

- **Module header, path authority.** `state.ts` is the one place the record,
  log and lock paths are spelled.
- **Module header, log I/O and terminator.** `appendLog` writes the bytes it is
  given and adds nothing, so a caller that omits a trailing newline runs into
  the next line.
- **Module header, absence vs damage.** Why `readState` answers "no record"
  with `null` and "damaged record" with a throw.
- **Module header, `Must NOT know about`.** This module knows neither routing
  rules nor the workflow schema.
- **`LastFailure.elapsed_seconds`.** Why the field is optional in all three
  shapes that carry it, and the condition for making it required.
- **`State.driver_agent`, TRANSITIONAL.** When the missing-field tolerance can
  be dropped. Four other comments point here rather than restate it.
- **`State.last_stop`, final paragraph.** What counts as damaged for
  `last_stop` and for `cause`, and `cause`'s own delayed-arrival fallback.
- **`State.last_drive`, "Two tolerances, on DIFFERENT clocks".** This
  tolerance expires against a different release than `driver_agent`'s.
- **Graph pin, reader tolerance.** The shape of the tolerance for each of the
  three fields.
- **Graph pin, TRANSITIONAL.** When those three can be dropped — written out
  rather than pointed, because the expiry differs from `driver_agent`'s.
- **`acquireLock`, `tryCreate`'s `finally`.** Why cleaning up the temporary
  file is allowed to be best-effort.
- **`acquireLock`, the `catch` around stealing a stale lock.** Why failing
  there is safe to ignore.
- **`releaseLock`'s `catch`.** Same, for release.

### Noted, not acted on

Two blocks kept as sole homes are not quite sole: the `Must NOT know about`
line is also a column in `docs/architecture.md`'s module table, and
`last_stop`'s delayed-arrival fallback is also described in `engine.ts`. Both
are over-keeping, which is the safe direction, and neither was changed.

A comment here points at `render.ts:352` for a rule that has since moved to
`render.ts:405-406`. ADR-0026 §3 cites the same stale line, so this is
repository-wide line-number drift rather than anything this sweep introduced.
