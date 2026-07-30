# A turn ended and nothing nudged me: what to capture

For the agent driving a headsign run that notices, on resuming, that its previous
turn ended **without** being pushed back to `headsign next` — and that it took a
human saying "continue" to get going again.

This is an open investigation, not a documented behaviour. It exists because it
happened once in this repository, during the design run that produced
[ADR-0025](../../docs/adr/0025-a-stop-that-passed-and-a-stop-that-never-ran.md),
and the mechanism was never confirmed. One observation is an anecdote; the point
of this file is that the second one arrives with enough evidence to close the
question.

## Read this part first: the evidence is perishable

Two things overwrite what you need, and both are things you are about to do.

- **`last_stop` in the run record holds only the most recent stop.** Your next
  turn end replaces it.
- **`headsign next` resets `stop_nudges` to 0** and writes a transition line.

So the **first** thing to run on resuming, before `headsign next` and before any
other work, is `headsign status`. It judges nothing, spends no attempt, takes no
lock, and is safe at any time. Then read the log. Only then get back to work.

And do not try to reproduce it by ending a turn deliberately. A probe is not free:
one that comes back as an ordinary nudge spends one from the cap, one that passes
while your own pause note is armed consumes the note, and one that lands under
another agent's armed claim marker consumes that marker.

## Capture these, in this order

### 1. `headsign status`, verbatim

Paste the whole output. The line that matters is `last stop:`, and what matters
about it is **both the disposition and the timestamp**:

```
last stop: not held — Claude Code had already resumed the turn (stop_hook_active) — at <t>
last stop: held, and pointed back to headsign next — at <t>
last stop: paused by a note — at <t>
last stop: not held — the nudge cap is spent — at <t>
```

If there is no `last stop:` line at all, say so — that is a finding, not a
missing detail.

Also record whether an `observer:` line is present. If it is,
`HEADSIGN_OBSERVER` is set in this environment and **the whole question is
answered**: turn ends from here are never held, by design.

### 2. The current run's slice of `.headsign/log`

```sh
N=$(grep -n '^[^ ]* start ' .headsign/log | tail -1 | cut -d: -f1)
tail -n +"$N" .headsign/log
```

The anchored form matters — a naive `grep ' start '` is fooled by an `abort …
reason="let's start over"` line. Paste the slice, or its last dozen lines if the
run is long.

What is being read out of it: the timestamp of the last transition (`advance`,
`retry`, `complete`…) before the turn ended, and whether any `unheld` line exists.

### 3. The wall-clock time the turn ended, as near as you can put it

Approximate is fine — the comparison being made is against the timestamps above,
and minutes are enough resolution.

### 4. Two facts only the human or the transcript has

- **Was the turn interrupted?** Did the person press Esc, or did the turn end on
  its own? The transcript records an interruption explicitly; look for it, and if
  it is ambiguous, ask.
- **Had any nudge appeared earlier in the same turn?** A nudge blocks the ending,
  so a turn that was nudged and then continued is a different situation from a
  turn that was never held at all. Quote the nudge if there was one.

### 5. Whether the hook fires at all in this session

The cheapest evidence, and it costs nothing extra: **did a nudge ever arrive
during this run, at any point?** One nudge anywhere proves the hook is installed
and firing, which removes the largest alternative in one stroke. If none ever
arrived, say that instead — it points somewhere quite different.

## Reading what you captured

| what you have | what it means |
| --- | --- |
| an `observer:` line in `status` | Answered. This environment opted out; turn ends here are never held. |
| `last stop:` names a disposition, stamped at the turn that ended | The hook **ran** for that turn end. If the disposition is `not held … already resumed`, headsign was overruled by the platform — expected, not a fault. |
| `last stop:` stamped clearly **earlier** than the turn that ended, or absent | The hook wrote nothing for that turn end. Two candidates remain, and the next two rows separate them. |
| a transition line in the log timestamped inside the window when the turn ended | Another `headsign next` was probably mid-lap and holding the run's lock, so the hook could not write and let the turn end. Ordinary, and the reason a missing line never proves the hook did not run. |
| no transition line in that window, and the turn was **interrupted** | The leading hypothesis: an interrupted turn is not a stop-boundary event, so the hook was never invoked. This is the case that needs a second sighting to confirm. |
| no transition line, and the turn ended **on its own**, and nudges do arrive elsewhere in this run | Not explained by anything known. This is the most valuable sighting of all — report it. |
| no nudge ever arrived during the whole run | Look at the hook registration and the plugin install before anything else; the run may never have had a backstop. |

## What is already known, so it is not re-derived

- A nudge arrives roughly **once per exchange**, not once per turn end. When the
  hook holds a turn, the platform flags the continuation, so the ending of *that*
  turn passes quietly and headsign records it as `unheld`. The window is one turn
  wide and closes when the turn ends.
- A **missing** `unheld` line proves nothing on its own. The hook's writes are
  best-effort and skipped while the run's lock is held.
- `stop_nudges` in the run record is not the place to look. It is never
  incremented by a flagged pass, and every real `headsign next` resets it to 0,
  so on a run being driven it reads 0 or 1 whatever happened.
- headsign's own nudge cap and the platform's flag are **different mechanisms**.
  "The loop guard" is headsign's name for the cap; the platform's is "the
  already-continuing flag". A quiet pass can come from either, and the log tells
  them apart: `stalled` for the cap, `unheld` for the flag.

## Where to send it

Into a headsign issue, with sections 1–5 pasted as captured rather than
summarised. The read in the table above is worth including too, but as *your*
reading, kept separate from the evidence — the previous sighting was diagnosed
partly from a hypothesis that was never checked, and the way to avoid repeating
that is to keep what was seen and what was inferred visibly apart.
