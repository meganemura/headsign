# Stopping, pausing, escalation, and graph changes

Open this before you abort, pause, accept a graph change, or restart, and
when an `ESCALATE` arrives. Rule numbers match `SKILL.md`.

6. **Never end the run on your own judgment while the answer is anything
   other than `COMPLETE`.** If you are genuinely stuck — or the user asks to
   stop mid-run — record why with `headsign abort <reason>` and report to
   the user; that's a legitimate exit, but it's permanent: the run cannot be
   resumed, and a later `headsign start` rewrites `.headsign/state.json` whole.
   What it does not end is `.headsign/log`: the reason you type outlives the
   run, and so does everything logged before it. So ending a run deliberately
   costs the run, not its history. **The rest of what it costs is nothing**, and
   this is worth knowing before you have to decide in a hurry: `state.json` is
   gitignored, so ending a run leaves every tracked file exactly as it was, and
   the artifacts the run already wrote are untouched — committed ones by
   definition. One place empties, and it empties at the next `start` rather than
   at the abort: `.headsign/tmp/`, which a run begins by deleting whole, so
   marks and notes kept there go when the replacement run starts. What you lose
   is the position: the phase, the attempt counts, the walk back to here. So
   the only real question is how expensive this workflow's earlier gates are to
   pass again, which you can read off the workflow file you are holding.
   To *pause* rather than end — stepping away
   to resume later — write one line to `.headsign/tmp/stop-note` **naming what
   you are waiting for**, and stop again. **If you cannot name it, you are not
   blocked** — continue the phase's work, then call `headsign next` when ready. The stop-boundary hook passes
   immediately, and `headsign next`
   picks the run back up later from the same phase. The hook consumes the
   note, so one note covers one turn end — if the wait runs over several
   exchanges, write it again before each turn that ends still waiting. Read the
   `ESCALATE` reason before you act. A terminal escalation stops work and goes
   to the user. A budget change also needs the user. A reported graph repair
   can continue under existing authority as described below. **Some kinds end the run and some do
   not, so read which one you got before deciding anything** — `headsign status`
   answers it directly, since a run that ended reads `ESCALATED` rather than
   `RUNNING`. Two kinds leave it `running`, so the user can answer and have you
   continue from the same phase. One reads
   `max_total_iterations (<n>) reached`: the user can raise that limit. The
   other reads `the workflow's rules changed under this run` — the workflow file was edited while the run
   was walking it, which headsign allows but reports. If the current task
   authorizes a reversible repair, you can make that repair when it preserves
   the required outcome and the user's constraints. Report what changed and
   which authority covers it. Then run `headsign next --accept-graph-change`
   as a separate action to accept the reported graph. Otherwise, ask the user
   to restore the file or authorize the change. The acceptance is counted and
   named at `COMPLETE`.
   **A bare `next` never accepts it, however many times you run it** — it
   reports the same change again and spends nothing, so do not try to get past
   this by asking twice. If *you* made that edit, say so plainly when you report
   it. **Some edits are not reported,
   and silence there means "not a pinned key", never "not noticed"** — so do
   not read it as permission you were granted, or as a report that failed.
   What is pinned is the rules of every phase this run can still reach, plus
   `limits`: `gate`, `ready`, `clear`, `on_pass`, `on_fail`, `max_attempts`. A
   phase's `description` is not — rewriting the instructions you were handed is
   invisible to this by design, and so are comments, formatting, and any phase
   the run can no longer reach. **Also unreported: the contents of anything a
   check runs.** `run: "sh checks/thing.sh"` pins that string, not the script,
   so editing that script mid-run changes what the gate decides with nothing
   said. If you need such a change on the record, abort and start again rather
   than editing under the run.

   **The kinds that DO end the run set the status to `escalated`, and no `next`
   continues one.** Starting over re-walks from the entry phase, so they cost
   what `abort` costs, arrived at by other means. There are two. One reads
   `max_attempts (<n>) exhausted`: the phase spent its whole budget. The other
   reads `gate failed (on_fail: escalate)`, which is a workflow that chose to
   hand the first failure of that phase straight to a person — a deliberate
   design, not a mishap, and one this repository's own workflows use.

   **Starting over is `headsign start` on its own.** An ended run does not
   have to be cleared out of the way first: `headsign abort` on one is
   refused — `already escalated; nothing to abort`, exit 3 — because there is
   nothing left for it to end, and that refusal changes nothing, so a run
   recovered that way was recovered by the `start`. The `start` rewrites
   `state.json` whole, which is also what puts every phase's attempt count
   back to zero.

   **If the gate cannot represent the legitimate work, diagnose the procedure.**
   Do not spend attempts just to force an escalation, or manufacture unrelated
   work to satisfy the gate. A rejected proposal may need a return route; a
   validation task may need evidence rather than a code edit. Repair the
   workflow within existing authority and accept any reported graph change
   separately. If repair needs a new decision, report the blocker and pause.
   Before a necessary restart, preserve useful reasons and evidence outside
   `tmp/`; a new `start` removes that directory. For a nonterminal
   escalation that needs a budget decision or missing authority, report it
   and wait. Write the pause note above before stopping while the run is open.
   An authorized graph repair follows the separate acceptance call described
   above and can continue without that wait.
