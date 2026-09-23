# Verdicts, exit codes, and status

Open this when you have a token, a route line, an exit code, or a `status`
word and you need the full account. Rule numbers match `SKILL.md`.

4. **On resume or after compaction, first run `headsign status`.** Read the
   phase instructions and existing artifacts. `RUNNING` means the run has not
   ended; it does not report active agent processes. An unclaimed run can still
   have a main-session driver. If you are authorized to continue, do the phase's
   unfinished work, including any required delegation. A status check alone
   does not perform that work.

   **When the phase's work is ready for its gate, run `headsign next` and obey
   the token on stdout's first line** — merged
   with stderr, a progress line from the running gate may arrive first, so
   read stdout on its own. That one habit is the whole protocol. `next` is
   a judgment, not a peek: it runs the phase's gate, and a failure spends
   one of that phase's attempts. When you only want to look, run
   `headsign status` (rule 1) — it judges nothing and
   costs nothing. And when you want to know how your last turn end was
   handled, `headsign status` is the **first** command to run on resuming,
   before `headsign next`: `next` resets the nudge counter, and the record
   holds only the most recent stop.
5. `RETRY` → the output shows exactly which check failed and its last output.
   Fix that, then run `headsign next` again. `ADVANCE` → follow the printed
   instructions of the new phase. If `ADVANCE <phase>` is followed by a line
   like `--- gate failed: ... → routed to <phase> ---`, the *previous*
   phase's gate rejected the work and routed you here — read that line, it's
   why you're back. A line like `--- routed: when "<command>" → <phase> ---`
   (or `--- routed: default → <phase> ---`) means the opposite: the previous
   phase *passed*, and its `on_pass` routes chose this phase; the quoted
   command is the condition that matched. Either way, the phase you were
   sent to is the one printed on stdout's first line — read the line,
   don't infer the move.

- Exit codes are verdicts, not errors: 1 = RETRY/PENDING, 2 = ESCALATE/ABORT.
  Read the text, don't treat non-zero as a tool failure. PENDING = the gate
  can't be evaluated yet — not a failure. Produce the artifact it's waiting
  on (e.g. the reviewer's verdict file), then run `headsign next` again;
  don't retry-loop on it. Exit 3 is different — a real usage/config error
  (unknown command, wrong directory, a workflow that no longer defines the
  current phase, another `next` already running, or a check or `ready:` probe
  that could not be run at all). Fix the invocation, the directory, or the
  workflow file; don't loop-retry on it. A check that could not be run is not
  a failing check: headsign got no exit code, so the lap moved nothing and
  spent no attempt — repair the command rather than the work.

- **No gate can abort a run — only a person can.** `ABORT` is what
  `headsign abort <reason>` produces, so a run that reads `ABORTED` was
  ended deliberately, by you on the user's instruction or by the user. A
  run headsign itself stopped always reads `ESCALATED`.

- `headsign status` is a different kind of command, on purpose: it never
  judges, so its first-line vocabulary is separate from `next`'s tokens —
  `RUNNING` / `COMPLETE` / `ESCALATED` / `ABORTED`, capitalized like a
  report, not `ADVANCE`/`RETRY`/`PENDING`/`ESCALATE`/`ABORT`. Its exit code
  doesn't follow the 1=RETRY/PENDING, 2=ESCALATE/ABORT rule above either:
  it's 0 whenever state could be read at all (even `ESCALATED`/`ABORTED`),
  and 3 only when there's no run to read. Use it whenever you want to look
  without the risk of touching anything — see rule 1 in `SKILL.md` and
  `driving.md`, for when that is required rather than optional.
