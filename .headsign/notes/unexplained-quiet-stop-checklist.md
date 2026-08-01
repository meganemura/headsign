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
exactly, and the table now separates four answerable causes from the one that is
not.

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
different builds. If `version` answers `unknown command`, that copy predates
0.4.0 and none of the log lines below exist in it, which by itself explains a
great deal.

### 2. `headsign status`, verbatim

Paste the whole output. Two lines matter.

`last stop:` — record **both** the disposition and the timestamp:

```
last stop: held, and pointed back to headsign next — at <t>
last stop: not held — Claude Code had already resumed the turn (stop_hook_active) — at <t>
last stop: paused by a note — at <t>
last stop: not held — the nudge cap is spent — at <t>
```

If there is no `last stop:` line at all, say so — that is a finding, not a
missing detail.

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

`pwd`, and — more to the point — whether the session had `cd`'d anywhere during
that turn and not come back. A turn that ends while the session sits in *another
git repository* is passed in complete silence: the hook's walk up stops at the
first enclosing `.git`, finds no run there, and writes nothing. Running `git`
commands against another checkout is the ordinary way this happens.

This is the first thing to rule out, because it explains the whole symptom on its
own and leaves exactly the evidence a broken installation leaves.

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
| an `unheld` line at that turn | The hook ran and was overruled by the platform. Expected, not a fault. Read the line before it: a `held` means you were nudged first; a transition means a `next` had already run. |
| `last stop:` stamped clearly **earlier** than the turn that ended, or absent, **and** no line in the log for it | The hook wrote nothing for that turn end. The next three rows separate why. |
| a transition line timestamped inside the window when the turn ended | Another `headsign next` was probably mid-lap and holding the run's lock, so the hook could not write and let the turn end. Ordinary. |
| the run is claimed by an agent that is not you | You are a bystander to the backstop by design — a session, or a different agent. Nothing holds your turns until you take the seat. |
| the session was in another git repository when the turn ended | Answered, and this is the one to check first. The walk up stops at the first enclosing `.git`, so the hook found no run and wrote nothing. Indistinguishable from an uninstalled backstop, and it needs only one `cd` that was never undone. |
| none of the above, and the turn was **interrupted** | The leading hypothesis: an interrupted turn is not a stop-boundary event, so the hook was never invoked. This is the case that needs a second sighting. |
| none of the above, the turn ended **on its own**, and nudges do arrive elsewhere in this run | Not explained by anything known. **This is the most valuable sighting of all — report it.** |

## What is already known, so it is not re-derived

- A nudge arrives roughly **once per exchange**, not once per turn end. When the
  hook holds a turn, the platform flags the continuation, so the ending of *that*
  turn passes quietly and is recorded as `unheld`. The window is one turn wide.
- A **missing** line proves less than it looks. The hook's writes are best-effort
  and skipped while the run's lock is held.
- An `unheld` line means *some* stop hook held the turn and headsign then stood
  down — not necessarily that headsign was the hook that held it.
- `stop_nudges` in the run record is not the place to look. It is never
  incremented by a platform pass, and every real `headsign next` resets it.
- headsign's own nudge cap and the platform's flag are **different mechanisms**.
  "The loop guard" is headsign's name for the cap; the platform's is the
  already-continuing flag. The log tells them apart: `stalled` for the cap,
  `unheld` for the flag.
- **The hooks are bounded by the enclosing repository.** Drift inside it is
  harmless; drift out of it — into a sibling clone, a docs repo, anywhere a `cd`
  left the session — is silent. This was the cause of the first sighting this
  file was written for, confirmed by reproduction: a turn ending in another
  checkout produces no line, no `last stop:`, and exit 0.
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
