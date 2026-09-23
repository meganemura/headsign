# Ways of writing it that look right and are wrong

Read this before you hand a workflow over, and whenever a file validates but
you are not sure it will behave. `validate` catches misspelled keys and
undefined destinations on the first run of it. **These it cannot catch**, and
they are what a workflow author actually walks into. A file with any of them
validates clean and misbehaves later.

1. **`on_fail: retry` and `on_fail: <this same phase>` are not the same
   thing.** `retry` stays: the answer is `RETRY`, the work continues on the
   same failure, and the phase's `clear:` does **not** run. Naming the phase
   itself leaves it and re-enters it: the answer is `ADVANCE`, and `clear:`
   runs, deleting what it lists. Re-entering is right when starting fresh is
   the point — a stale review verdict has to go — and wrong when the agent
   should keep working on the same failure.

   **`on_fail:` can also name a phase further back, and for a loop with a
   progress gate that is often the right answer.** A loop where one phase
   checks that something decreased has a phase upstream that produces the
   material the decrease comes from. When the progress gate fails because the
   remaining items need that upstream phase to do more work, `retry` is the
   wrong partner: the agent is being told to try again on a phase that has
   nothing left to work with, and the phase it needs is only reachable by
   passing the gate that is blocking it. Sending the failure upstream instead
   makes the loop's own repair path part of the graph.
   Two things to hold while writing it. The route back re-enters that phase, so
   its `clear:` runs — which is usually what you want, and is worth checking
   rather than assuming. And the graph then has two ways of going backwards, a
   conditional `on_pass` for ordinary laps and an `on_fail` for a blocked one;
   that is allowed and `validate` accepts it, but the ceiling is what keeps it
   finite, so a loop with both wants `limits.max_total_iterations` set on
   purpose rather than left off.
2. **`clear:` runs on entry to a phase, and only then.** So a review phase
   that lists its verdict under `clear:` but sets `on_fail: retry` clears the
   verdict exactly once, when it is first entered, and never again: the
   rejected verdict it is supposed to throw away stays on disk while the
   agent retries against it, and the gate goes on reading last time's answer.
   That combination validates clean, and where a verdict is involved it is a
   mistake. Decide which of the two behaviours you meant.

   **The same pairing is right when the file is written once and must not
   move.** A phase that lists `.headsign/tmp/base` under `clear:` and then
   records this run's base commit in it wants precisely this: cleared when
   the phase is entered, written once, then left alone through every retry,
   so that the anchored checks downstream keep measuring against one fixed
   point instead of a point that walks forward with the work. Clearing on
   entry is what makes a genuine re-entry take a fresh base; `retry` is what
   stops a retry from moving the mark mid-phase. The test is what the
   `clear:` is there for — if what you need gone is **last time's verdict**,
   `retry` is the wrong partner for it; if what you need kept is **this run's
   anchor point**, it is the right one.
3. **Without `ready:`, calling `next` too early costs an attempt on a gate
   that had nothing to judge.** Any phase whose gate waits on something
   slower than the loop — a reviewer subagent still reading, a human at a
   pull request — wants a `ready:` probe. An early `next` then answers
   `PENDING` instead: no attempt spent, `clear:` not run, and the artifact
   left where it is instead of being deleted by a re-entry a moment before
   it arrives.
4. **A list-form `on_pass` is read only after the gate passes, and never on
   the failure path.** Routes are how a *passing* phase picks among several
   destinations. A router phase whose own gate fails is an ordinary failing
   phase, and no `when:` will ever see it — failure routing is `on_fail`'s
   job alone.
5. **An ordinary outcome that fails a gate is a gate asking the wrong
   question.** A gate decides whether the run may LEAVE the phase, not whether
   the work succeeded. A lap can end a way the workflow expects — the target
   turned out to be someone else's to decide, the queue came up empty, the item
   was taken off the board by something outside this run — and still fail a gate
   that was written to ask whether the work closed it.

   The failure edge does carry a run onward: `on_fail` takes `retry`, a phase
   name, `$end`, or `escalate`. What it cannot do is tell those outcomes apart.
   One destination serves every way the gate can fail, so a phase with two
   expected endings sends both to the same place. And each exit through it is
   recorded as a gate failure: the attempt is counted before `on_fail` is read,
   and `on_fail: $end` answers `COMPLETE` for a lap whose gate had just failed —
   unless that lap also spent the phase's last `max_attempts`, which escalates
   before `on_fail` is read at all.

   When no single destination fits, what is left is `headsign abort`. That
   ending stays distinct on the record — the log writes `abort`, `status` reads
   `ABORTED`, and the reason you typed is kept — but it is a person stopping the
   run rather than an edge the graph declared, and its reason is free text
   somebody wrote rather than a predicate that evaluated true.

   Restate the gate so the expected outcome PASSES it — "this lap's target is
   settled" rather than "the work closed it" — and put the branch on `on_pass`,
   where routes tell the cases apart. For a route whose `to:` names a phase the
   run advances, and `.headsign/log` keeps `routed-when="<the predicate that
   matched>"` — or `routed-default` for the last route, which validation
   requires to carry no `when:` — with the line naming the phase the run went
   to, so which ending happened is readable once the run is over.

   **A route to `$end` is the exception, on both counts.** The run ends rather
   than advancing, and the line is a bare `complete` naming the phase it ended
   FROM, with no route recorded on it at all. An ending taken that way is told
   apart by which endings the workflow declares, not by reading the log.

   The test for this one is a question about the phase rather than about the
   check: **is every way this gate can fail one you want handled on the failure
   edge — retried, or sent to the single phase it names?** If one of them is a
   thing you would rather route on, it belongs on the pass path. headsign's own
   feedback-triage workflow was written the other way once, with a rejected
   ticket, a deferred one and an empty queue all carried out of the run by
   `on_fail: $end` — one destination for three endings, each spending an attempt
   on its way out. Moving them to the pass path is what removed the question of
   whether ending cleanly costs an attempt.
6. **A `when:` must test that the destination can be *started*, not that
   work appears to exist.** These come apart, and the gap is expensive. A
   predicate that greps for units marked ready sends the run onward while
   every ready unit is blocked on something unfinished; the destination's gate
   then asks for a unit to have been picked, nothing can be picked, and the
   phase burns its `max_attempts` on empty laps — and exhausting them ends the
   run, so a mistake in one routing predicate is paid for by the whole walk.
   Write the predicate as the destination's own entry condition: not "is there
   something marked ready" but "is there something this phase could actually
   take". **And note what it will look like when you get it wrong**: the record
   will show a gate failing, over and over, in a phase where nothing is wrong
   with the work. Nothing in the run says "the routing sent you here by
   mistake", because nothing can tell — so a phase that keeps failing with an
   unchanged verdict is a reason to suspect the route that feeds it, not only
   the work in front of you.
7. **A description that assigns the work fixes the wrong thing.** "Spawn a
   subagent to clean this up" reads as an instruction and lands as a
   constraint: one worker per phase, in the order the file happens to list
   them, decided by an author who cannot see the change. Write what has to be
   TRUE when the gate runs — "the code does what it did before and reads
   better" — and leave the arrangement to the agent, which may use one
   worker, six, or one whose answer decides the rest. **The graph sequences
   checks; the agent sequences work.** A phase order fixes when a fact has to
   be proven, and nothing about who proves it or how many of them there are.

   **One thing is authority rather than arrangement, and it stays fixed: who
   holds the pen.** A review gate whose verdict the working agent authored
   proves nothing about the work, so a phase that gates on a verdict says what
   the verdict's author may see, what it may write, and that the working agent
   does not author it. Write that into the description whatever else you leave
   open — it is the difference between a soft gate and a decoration
   (`docs/adr/0007-verdict-authorship.md` in the headsign repository).
