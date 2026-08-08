# Comment sweep

One section per file swept by `.headsign/comments.yaml`. Each comment block in
`src/` is sorted into exactly one of three: (1) it restates the mechanics the
code already shows, and goes; (2) it restates a rule stated somewhere else, and
becomes the shortest pointer to that place; (3) it earns its place beside this
code for a reason someone can read, and stays untouched.

**The two lists under each file are the point of this file.** `Kept` says why a
block stays — how it stands to whatever else discusses the same thing. `Also
discussed at` says where those others are. Together they are something no single
file can show you: a rule that has drifted into three homes is only visible from
above all three. The counts are bookkeeping; the lists are the product.

That framing is the third one this sweep has used, and the change is worth
recording because it cost six rounds on one file. The first two asked the
pruner to certify that a kept block was the **only** home of its decision.
That claim is about the whole tree, it is usually false here — a test's
section comment states a rule as fully as an ADR paragraph does — and the
search used to verify it was drawn from the comment's own wording, so it could
never find the paragraph that says the same thing differently. Meanwhile the
judge, searching adversarially, found real duplicates every single round. The
enumeration moved to the party that was already producing it, and the pruner
now states a relation instead of an absolute. **`src/state.ts`'s section below
predates that change** and still reads in the old vocabulary; it has not been
re-audited.

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

---

## src/stophook.ts

Comment lines 364 → 190. Deleted 1, turned into pointers ~40, kept 14.

Six rounds of review. Rounds 1 and 5 caught defects the sweep itself introduced
— a pointer headline saying `held` is logged for nudges 1-5 when the line below
it logs `stalled` on the fifth, and a headline crediting `withRunLock`'s five
call sites with a distinction that belongs to the two hooks upstream of
`noteGateThenNudge`. Rounds 2, 3 and 4 were the standard failing, not the work;
that story is in the header above.

### Where the rules now live

`.headsign/` lock protocol and the cwd-only rule — ADR-0004. The exit-note
gate, the bounded walk-up, the nudge cap and why the driver check precedes the
gate — ADR-0006. The two-beat claim and the adoption gate — ADR-0009,
ADR-0010. Owner comparison and the identifier split — ADR-0010 §3, ADR-0013.
`last_stop`, the already-continuing flag, and the `held`/`stalled` split —
ADR-0025 §4/§5 and §7's retraction. The `CLAUDE_PROJECT_DIR` second walk —
ADR-0026. `last_drive` and what an absent stamp means — ADR-0027 §2/§3/§9.

### Kept — and how each stands to the rest

- **`isObserver`.** ADR-0013 says why the check merged here; ADR-0025 says why
  `status` became a second caller. Neither says why the second caller does not
  reopen the first decision, and that is what this paragraph holds.
- **`resolveDriveSession`.** `src/engine.ts:504-514` states the same fact and
  then names *this* function as where it must live. The pointer runs both ways;
  editing one without the other strands the pair.
- **`resolveAgentId` / `resolveSessionId`.** Why these are two functions over
  two id spaces rather than one. ADR-0010 argues the spaces; the split itself
  is decided here.
- **`withLastStop`.** The shape constraint — an absent `cause` key versus a
  present `undefined` — which the ADRs discuss in behaviour, not in shape.
- **`fallbackUnheld` ¶1.** Why the second walk reuses `findRunDir` rather than
  a looser search. ADR-0026 and the reference manual say the walk is bounded
  the same way; the reuse is the reason it is.
- **`fallbackUnheld` ¶2.** ADR-0027 §9 quotes this comment verbatim and calls
  it the invariant's statement in code — so the wording here is the referent.
- **`pauseAndAbortHint`.** Why the message depends only on `runDir`/`startDir`.
- **`NOT_DRIVING_HINT`.** Why the observer relay comes last, after the
  pause/abort hint.
- **`withRunLock`'s "Vanished, or ended".** `src/engine.ts:598-616` implements
  the same guard on the `next` side. A reader is on one side or the other, and
  each side needs the note beside its own implementation.
- **`StampedLogEvent`.** The fourth-argument carrier. Nothing else in the tree
  mentions `__nowIso`.
- **"Either the pause was recorded…".** What a failed lock means for a
  one-shot note.
- **The loop-guard block.** Tests pin the `"x" + 1` coercion behaviour; this
  states the mechanism. A reader asking why the guard expression is that
  elaborate needs the mechanism, not a test name.
- **The final-reminder phrase.** `.headsign/notes/quiet-stop-corrections.md`
  quotes this comment's own words when it discusses the dilution rule, which
  makes this wording the thing being referred to.
- **`evaluate`'s "resolved once here, OUTSIDE the closure".** Paired with the
  same shape at the `fallbackAgentId` site.

### Also discussed at — found by the judge, not claimed by the sweep

Only the entries where the second home is somewhere a reader would not look:

- **`resolveDriveSession` → `src/engine.ts:504-514`**, which names this
  function as the one place the claim may live. The strongest pair in the file,
  and the sweep did not find it; a search on the identifier did.
- **`fallbackUnheld` ¶1 → `docs/workflow-reference.md:280-282`, `:301-305`**,
  which say the second walk is bounded "the same way" in entirely different
  words. A search keyed on `findRunDir` cannot reach them — the same blind spot
  that cost this lap three rounds, still live.
- **`pauseAndAbortHint` → `docs/adr/0006:352-357`**, which describes this
  function's own `runDir`/`startDir` branch.
- **`NOT_DRIVING_HINT` → `docs/workflow-reference.md:1294`**, which carries the
  reason for relaying the variable into a child's environment.
- **`isObserver`** is discussed in eleven places across `docs/`, `src/`,
  `tests/` and `.headsign/notes/`. The keep still holds — none of them answers
  the question this paragraph answers — but eleven is worth knowing.

### Noted, not acted on

- The `## Kept` entry for the loop-guard block cites lines 255-264; the block
  is at 242-251. The lines it cites are ones this lap pointerized.
- `withRunLock`'s call sites are at 116/231/256/264/388, not 116/230/255/263/387
  — four of those point at the comment line above the call.
- `resolveAgentId` is called three times in `evaluateSubagent`, not twice; the
  comment's "resolves it twice" counts the flagged and ordinary paths and omits
  the fallback branch. Kept unchanged, so this is pre-existing.
- Blocks in neither list: the module header's third paragraph (`:12-17`), the
  marker-consumed-inside-the-lock comment in `evaluateSubagent`'s closure, and
  six one-line inline comments. `:12-17` is quoted verbatim by
  `docs/adr/0025:274-275`, which makes it a strong keep nobody classified.
- `src/stophook.ts:55-56` reads as an absolute ("the one place that has to stay
  true"). It survives because the claim is grep-true and because
  `src/engine.ts:511-514` names the same place — the two are a pair, and
  rewriting one alone leaves the other pointing at nothing.

---

## src/gate.ts

Comment lines 102 → 88. Deleted 0, turned into pointers 7, kept 11.

Zero deletions was the outcome, not an omission — this file's comments had been
tightened by hand in recent work, so what was left was either a rule with a home
elsewhere or a reason with none.

Four rounds. Every rejection was the proposal's prose; the classification of the
blocks was judged sound in all four. Two of the four were caused by editing the
proposal with blind string replacement — a superseded sentence left standing next
to its replacement, and a sentence broken into nonsense. Read what a replacement
produced before moving on.

### Where the rules now live

`env:` removal and inherited environment — ADR-0014 §1. The three places headsign
runs a shell, and that a command which never ran is not an answer — ADR-0021,
whose Consequences name this module header as where that is stated at the call
site. `when:` ordering, first-match, the default last, and a broken `when:`
stopping the run — ADR-0011 §1/§5. The monotonic-clock exception to `cli.ts`'s
sole custody of the wall clock — ADR-0004, whose revision note also points back
here.

### Kept — and how each stands to the rest

- **Module header ¶1.** The three questions and their shared shape. ADR-0021
  names this header as the call-site statement of it.
- **Module header, `Must NOT know about`.** `docs/architecture.md`'s module
  table carries the same exclusion, wider by one item; this is the code-adjacent
  version. Over-keeping, which is the safe direction.
- **Module header, the clock paragraph.** ADR-0004's revision note points at
  this header; this points back. Rewrite one and the other points at nothing.
- **`CheckFailure.elapsedSeconds`.** `state.ts` names this field as expiring on
  a different criterion and gives the *order's* reason after the colon; this
  carries the criterion itself. The two divide one sentence.
- **`elapsedSecondsSince`.** Why it rounds to the precision `timeoutSeconds`
  uses, so the two can be compared without arithmetic.
- **`runGate`'s `maxBuffer` line, and the non-timeout `spawnError` branch.**
- **`ReadyResult`.** ADR-0021 §1 spells the three kinds out in prose; this is
  the same shape as a type, beside the arms that produce it.
- **`isReady`'s main comment.** The ADRs describe the outcome (`PENDING`,
  uncounted, `state.json` untouched); this binds the exit code to it.
- **The section divider, and `resolveRoute`'s unreachable fallback.**
  `workflow.ts:219-223` guarantees a validated list ends in an entry the loop
  returns from. That guarantee stops where `validate` stops; this comment
  answers for a hand-built `Route[]`, and `tests/gate.test.ts:210-213`
  constructs exactly that and runs the arm.

### Also discussed at — found by the judge

- **`tests/gate.test.ts:210-213`** — the only place the unreachable arm is
  actually executed, on a hand-built route list. The sweep did not find it.
- **`src/engine.ts:825-838`** — "the thing that could not be evaluated is the
  destination itself", the running side of `resolveRoute`'s refusal.
- **`docs/workflow-reference.ja.md:445`, `:452`, `:1074-1076`** — the same rules
  in Japanese. An English phrase search cannot reach them, which is the blind
  spot that cost this sweep several rounds.
- **`CHANGELOG.md:195-207`** — "a working directory that had gone away, output
  past the runner's buffer": the plain-language version of the errno branch.
- **`plugin/skills/design-workflow/references/schema.md:37`** — `ready:` and
  `PENDING` explained to a workflow author. Neither ADRs nor `docs/` reach it.
- **`.headsign/notes/explaining-well.md:84-91`** — pairs `isReady`'s lenient arm
  against `resolveRoute`'s refusal in entirely different vocabulary.
