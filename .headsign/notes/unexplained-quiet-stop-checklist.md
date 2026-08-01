# A turn ended and nothing nudged me: what to capture

For the agent driving a headsign run that notices, on resuming, that its previous
turn ended **without** being pushed back to `headsign next` — and that it took a
human saying "continue" to get going again.

The file exists because this happened once here with no explanation. The second
sighting, captured by following it, **was** explained: the session's cwd had
left the repository, which the hooks are bounded by. That cause is reproduced and
now has its own row below.

What is still open is the first sighting's own hypothesis — that an interrupted
turn is not a stop-boundary event at all — which no evidence has yet confirmed or
ruled out. So keep working through this: it closed one question by being followed
exactly, and the table below now answers most of what it used to leave open.

Hand this to the agent, or work through it yourself. Everything here is
read-only.

## Read this first: the evidence is perishable

Two things overwrite what you need, and both are things you are about to do.

- **`last_stop` in the run record holds only the most recent stop.** Your next
  turn end replaces it.
- **`headsign next` resets `stop_nudges`** and writes a transition line.

So the **first** thing to run on resuming, before `headsign next` and before any
other work, is `headsign status`. It judges nothing, spends no attempt, takes no
lock, and is safe at any time. Then read the log. Only then get back to work.

Do not try to reproduce it by ending a turn deliberately. A probe is not free:
one that comes back as an ordinary nudge spends one from the cap, one that passes
while your own pause note is armed consumes the note, and one that lands under
another agent's armed claim marker consumes that marker.

## Capture these, in this order

### 1. The version actually running

```sh
headsign version
```

Not the version in your checkout — the one the **hook** runs. A plugin copy is
version-scoped, so the CLI on your `PATH` and the bundle the hook executes can be
different builds. `unknown command` means the copy predates `version` itself,
which is **not** the same as predating everything below — `unheld` and the
`last stop:` line shipped one release earlier. So an `unknown command` answer
narrows the build without discarding the evidence you may still have: such a
build has no `held` line, but `unheld` and `last stop:` may well be there.

### 2. `headsign status`, verbatim

Paste the whole output. Three lines matter now.

`last stop:` — record **both** the disposition and the timestamp:

```
last stop: held, and pointed back to headsign next — at <t>
last stop: not held — Claude Code had already resumed the turn
(stop_hook_active) — at <t>
last stop: not held — the session was not standing in the run's tree
(CLAUDE_PROJECT_DIR) — at <t>
last stop: paused by a note — at <t>
last stop: not held — the nudge cap is spent — at <t>
```

If there is no `last stop:` line at all, say so — that is a finding, not a
missing detail. The two `not held` lines look similar and mean different
things — capture the parenthetical verbatim, `(stop_hook_active)` or
`(CLAUDE_PROJECT_DIR)`; this checklist tells them apart below.

`last moved:` — present only if the run has a session on record in
`last_drive` (absent for a run this release predates, one driven from
outside Claude Code, or one whose state was hand-edited). Record its
timestamp:

```
last moved: <t> — turn ends from any other session pass without a nudge
```

It names when this run was last **moved** — when some session most recently
ran `start` or `next` against it — a different question from `last stop:`'s
*attributed turn end*. Compare it to when your own turn ended: if `last
moved:` is stamped by a session other than yours, your stop matched no
recorded mover and passed silently, by design. This is the one cause below
with **no trace anywhere else** — not in `.headsign/log`, not in a stale
`last stop:` — the timestamp comparison is the only evidence there is.

`observer:` — if that line is present, `HEADSIGN_OBSERVER` is set in this
environment and **the whole question is answered**: turn ends from here are never
held, by design.

### 3. The current run's slice of `.headsign/log`

```sh
N=$(grep -n '^[^ ]* start ' .headsign/log | tail -1 | cut -d: -f1)
tail -n +"$N" .headsign/log
```

The anchored form matters — a naive `grep ' start '` is fooled by an `abort …
reason="let's start over"` line. Paste the slice, or its last dozen lines.

What is being read out of it: whether a `held` line sits at the turn that ended,
and what the line before any `unheld` is.

### 4. Where the session was standing when the turn ended

`pwd` first, and then whether the session had `cd`'d anywhere during that turn
and not come back. And the question that decides whether this is even possible
here: **does this session work across more than one directory?** Claude Code
refuses a `cd` outside the session's allowed working directories, so a session
confined to the run's tree cannot drift out of it. One that has a second
directory — added at startup or later — can, and that is the arrangement to look
for. A session *started* outside the tree is silenced the same way, unless
`CLAUDE_PROJECT_DIR` resolves it (next paragraph).

A turn that ends while the session sits in *another git repository* is no
longer always passed in complete silence, since 2026-08-01. The hook's walk
up from the session's own directory still stops at the first enclosing
`.git` and, finding no run there, now tries once more from
`CLAUDE_PROJECT_DIR` — the project root Claude Code gave the session,
independent of where it has since `cd`'d. A run found that way is not held —
it is a stop marked `unheld`, detail `by=CLAUDE_PROJECT_DIR`, with its own
`last stop:` sentence (section 2, above). Two shapes are still fully silent:
`CLAUDE_PROJECT_DIR` unset, or naming a directory with no run either. A third
shape is not silent at all and is worth ruling *in*, not out: if the other
checkout has **its own** run, the first (cwd) walk finds that one before
`CLAUDE_PROJECT_DIR` is ever tried, and the session gets a real nudge about a
run it is not driving — see "A session can be nudged about the wrong run",
below. Running `git` commands against another checkout is the ordinary way
any of this happens.

Rule this out first: even where it no longer explains full silence, it
explains a `last stop:` line naming `CLAUDE_PROJECT_DIR`, or a nudge about
the wrong run, and on one turn's evidence alone the fully-silent shape still
looks exactly like a broken installation.

### 5. The wall-clock time the turn ended

Approximate is fine. It is compared against the timestamps above, and minutes are
enough resolution.

### 6. Two facts only the human or the transcript has

- **Was the turn interrupted?** Did the person press Esc, or did the turn end on
  its own? The transcript records an interruption explicitly; look, and ask if it
  is ambiguous.
- **Had any nudge appeared earlier in the same turn?** A nudge blocks the ending,
  so a turn that was nudged and then continued is a different situation from one
  never held at all. Quote the nudge if there was one.

### 7. Whether the hook fires at all in this session

The cheapest evidence: **did a nudge arrive during this run, at any point?** One
nudge anywhere proves the hook is installed and firing, which removes the largest
alternative in a single stroke. If none ever arrived, say that instead — it points
somewhere quite different.

## Reading what you captured

In any build that logs `held` — check with `headsign version` against the
changelog if unsure — every nudge leaves a line, which makes this much sharper
than it used to be: **if the hook ran and decided to hold your turn, the log says
so.**

| what you have | what it means |
| --- | --- |
| an `observer:` line in `status` | Answered. This environment opted out; turn ends here are never held. |
| `version` says `unknown command`, or predates the `held` line | The lines below may not exist in that build. Establish this before reading anything else. |
| a `held` line at the turn that ended | The hook ran and **did** hold you. If you did not see the nudge, the question is about your harness surfacing it, not about headsign. |
| an `unheld` line at that turn, detail `by=stop_hook_active` | The hook ran and was overruled by the platform. Expected, not a fault. Read the line before it: a `held` means you were nudged first; a transition means a `next` had already run. |
| an `unheld` line at that turn, detail `by=CLAUDE_PROJECT_DIR` | Answered, and a different kind of answer from the row above: no stop hook overruled anything. Your session's own directory led the hook to no run; it found one instead from `CLAUDE_PROJECT_DIR`, Claude Code's project root, and wrote this line without ever holding the turn. See section 4. |
| `last stop:` stamped clearly **earlier** than the turn that ended, or absent, **and** no line in the log for it | The hook wrote nothing for that turn end. The rows below separate why. |
| a transition line timestamped inside the window when the turn ended | Another `headsign next` was probably mid-lap and holding the run's lock, so the hook could not write and let the turn end. Ordinary. |
| the run is claimed by an agent that is not you | You are a bystander to the backstop by design — a session, or a different agent. Nothing holds your turns until you take the seat. |
| the run is unclaimed, `last moved:` in `status` is stamped, and it names a time your session cannot account for (you never ran `start` or `next` that recently) | Answered, and there is nothing else to find: your stop matched no recorded mover and passed silently, writing no `unheld` line and no `last stop:` update — the timestamp comparison above is the only evidence this leaves. See section 2. |
| the session was in another git repository when the turn ended, and `last stop:` says `by=CLAUDE_PROJECT_DIR` | Answered — see the `unheld` / `CLAUDE_PROJECT_DIR` row above. Only reachable if the session has more than one allowed working directory, since Claude Code refuses a `cd` outside them. |
| the session was in another git repository when the turn ended, and there is no such line | Narrower than it used to be, not gone: this needs the walk from `CLAUDE_PROJECT_DIR` to have also found nothing — unset, or naming a place with no run. On that turn's own evidence, indistinguishable from an uninstalled backstop — though step 7, and the stop before it in `status`, do tell them apart. It needs one `cd` that was never undone, or a session that was never inside, *and* `CLAUDE_PROJECT_DIR` not reaching the run either. |
| a real nudge arrived, but for a workflow or phase that is not the one you expected | Not silence — a different, older, undocumented shape. The checkout the session drifted into has **its own** run, and the cwd walk finds that one before `CLAUDE_PROJECT_DIR` is ever tried. See "A session can be nudged about the wrong run", below. |
| none of the above, and the turn was **interrupted** | The leading hypothesis: an interrupted turn is not a stop-boundary event, so the hook was never invoked. This is the case that needs a second sighting. |
| none of the above, the turn ended **on its own**, and nudges do arrive elsewhere in this run | Not explained by anything known. **This is the most valuable sighting of all — report it.** |

## What is already known, so it is not re-derived

- A nudge arrives roughly **once per exchange**, not once per turn end. When the
  hook holds a turn, the platform flags the continuation, so the ending of *that*
  turn passes quietly and is recorded as `unheld`. The window is one turn wide.
- A **missing** line proves less than it looks. The hook's writes are best-effort
  and skipped while the run's lock is held.
- An `unheld` line with detail `by=stop_hook_active` means *some* stop hook held
  the turn and headsign then stood down — not necessarily that headsign was the
  hook that held it. An `unheld` line with detail `by=CLAUDE_PROJECT_DIR` means
  something different: no stop hook held anything; your session's own directory
  led nowhere, and headsign found the run from `CLAUDE_PROJECT_DIR` instead.
- `stop_nudges` in the run record is not the place to look. It is never
  incremented by a platform pass, and every real `headsign next` resets it.
- headsign's own nudge cap and the platform's flag are **different mechanisms**.
  "The loop guard" is headsign's name for the cap; the platform's is the
  already-continuing flag. The log tells them apart: `stalled` for the cap,
  `unheld` for the flag.
- **A run someone else last moved leaves your stop no trace, anywhere,
  since 2026-08-01.** `Stop` compares the payload's session against
  `last_drive.session` before it ever reaches the log-writing branches
  below; a mismatch passes silently, writing nothing to `.headsign/log` and
  nothing to `last_stop`. The only signal is `last moved:` in `headsign
  status`, and it names a time, never a session — see section 2. A run with
  no session recorded in `last_drive` (one begun before this shipped, one
  driven from a terminal rather than a session, or one whose state was
  hand-edited) is unaffected by this and still nudges whichever session
  stops there — and one `start` or `next` from an environment that names no
  session clears an existing stamp, putting the run back in that state.
- **The hooks are bounded by the enclosing repository, with one narrow
  exception since 2026-08-01.** Drift inside the run's own repository is
  harmless. Drift out of it — into a sibling clone, a docs repo, anywhere a
  `cd` left the session — used to be silent unconditionally; now it is silent
  only if `CLAUDE_PROJECT_DIR` also fails to resolve the run. This was the
  cause of the sighting this file originally captured, confirmed by
  reproduction at the time: a turn ending in another checkout produced no
  line, no `last stop:`, and exit 0. Reproducing that today additionally
  needs `CLAUDE_PROJECT_DIR` to be unset or to name somewhere with no run —
  otherwise it now leaves an `unheld` line marked `by=CLAUDE_PROJECT_DIR`
  instead of nothing.
- **A session can be nudged about the wrong run.** If the checkout a session
  drifted into runs its own headsign workflow, the cwd walk finds *that* run
  first and nudges about it — a real nudge, correctly formatted, just not
  about the run the session is driving. This is shipped behaviour, not new,
  and `CLAUDE_PROJECT_DIR` does not change it: the cwd walk is always tried
  first, and only reaches `CLAUDE_PROJECT_DIR` when it finds nothing.
  Undocumented before now, and there is no fix for it here — only `pwd` and
  the workflow name printed in the nudge tell it apart from the run you
  expected.
- **A run claimed by an agent that has gone leaves its successor unheld.**
  headsign cannot detect a dead driver, so the seat stays filled. If you took
  over a run and are not the recorded driver, that alone explains the silence —
  and `headsign claim` from a delegated agent is how to take the seat.

## Where to send it

Into a headsign issue, with sections 1–7 pasted as captured rather than
summarised. Include your own reading of the table too, but **keep it visibly
separate from the evidence**: the previous sighting was diagnosed partly from a
hypothesis nobody had checked, and keeping what was seen apart from what was
inferred is how that stops repeating.
