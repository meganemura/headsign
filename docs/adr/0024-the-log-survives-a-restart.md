# ADR-0024: The log survives a restart, and the `start` line is the seam

- Status: accepted
- Date: 2026-07-30
- Revises: [ADR-0004](0004-state-attempts-and-cache.md)'s `.headsign/log`
  section (the log is no longer run-scoped)

## Context

`start` truncated `.headsign/log` before writing its first line, so the file
held exactly one run. That was deliberate in ADR-0004 — "a previous run's
history must not bleed into a new one" — and it is what lets the README print a
whole run with one `cat`.

The file is also gitignored. Those two facts together are the problem: the log
is the **only** copy of what happened, and the thing that erases it is the
ordinary next command. `headsign abort <reason>` is the one place a person's
stated reason for stopping is recorded anywhere; the next `headsign start`
deleted it.

The sharper version showed up next to [ADR-0023](0023-pinning-the-graph-a-run-is-walking-under.md).
Loosening a gate mid-run is now reported once, counted, and named at
`COMPLETE`. Going around — `abort`, edit the workflow, `start` again — reset the
pin, reset `accepted_graph_changes` (a fresh `start` rewrites `state.json`
whole), and emptied the log. **The detour left less trace than the sanctioned
path.** A record that is easiest to avoid by taking the long way round is not
doing its job.

## Decision

**1. `start` no longer truncates the log.** Every write to `.headsign/log` is
an append, and the file accumulates runs in the order they happened.

**2. `initLog` is deleted, not replaced.** `appendLog` already creates the file
and its directory, and `start` appends its own first line, so once the
truncation went there was nothing left for an initializer to do.

**3. Nothing is inserted to mark the seam between runs.** Each run already
opens with a `start` line, and inventing a separator would be *framing*, which
`render.ts` owns and `state.ts` does not. The line format is unchanged, to the
byte.

**4. That marker is machine-usable, which is what makes §3 enough.** The event
word is always the second whitespace-separated field, and free text (`reason=`,
`check=`) always comes after `a=` and `i=`. So an anchored match cannot be
fooled by content:

```sh
# the current run, and follow it
N=$(grep -n '^[^ ]* start ' .headsign/log | tail -1 | cut -d: -f1)
tail -n +"$N" -f .headsign/log
```

A naive `grep ' start '` **is** foolable — `abort … reason="let's start over"`
matches it — which is exactly why the anchored form is the one the
documentation shows.

**5. No rotation, no size cap, and no `headsign log` command.** A run is
tens of lines and the file is gitignored and disposable. A command would be the
seventh, and its only job would be to undo a problem a different design
choice — one file per run — would have created: `tail -f` works on this file
today and keeps working across runs, where per-run files would break it and
then need a command to find the newest one. If unbounded growth ever becomes a
real complaint, that is the moment to add rotation.

## Alternatives considered

**Archive the previous log to `log.1` at `start`.** Keeps one run per file and
one generation of history. Rejected: it answers "what did the last run do" and
not "what have the last five done", and it adds a file whose lifetime nobody
would think about again.

**Carry one summary line of the previous run into the new log.** Cheapest, and
it preserves the one-`cat`-one-run property exactly. Rejected once the anchored
slice above turned out to be a one-liner: carrying a summary keeps *some* of
the record on the grounds that keeping all of it is unreadable, and it isn't.

**Insert a blank line or a `---` before each `start`.** Considered and dropped
after the slicing was tested. It buys readability that the one-liner already
gives, it raises the question of who owns framing (see §3), and it would make
the log format differ from every example already written down. Not changing the
format at all is worth more than the blank line.

**A `headsign log` command with follow support.** Rejected under §5.

## Consequences

- **`abort`'s reason outlives the next `start`.** So does everything else about
  a run that ended: the phase it stopped on, its attempt counts, and — after
  ADR-0023 — every `graph-changed` line it recorded.
- **`cat .headsign/log` now prints every run in the directory.** The README's
  worked example changes from `cat` to `tail`; the lines it shows are
  unchanged, because the format is unchanged.
- **The escape hatch is still open, and that is fine.** Anything that can run
  `abort` can also delete the log. What this closes is the gap where the
  *documented* recovery path happened to erase the record on the way past.
  Nothing here is a lock, for the reasons ADR-0023 §6 gives.
- The diff is negative: a function and its one call site removed, two tests
  deleted, one inverted, three added.
