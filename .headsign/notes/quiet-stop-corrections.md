# What the challenging changed, question by question

Written for someone reading this without `challenge.md` in front of them —
that file is deleted on the way into the next question.

## Should a stop that passes through quietly be recorded in .headsign/log at all, or should the whole fix be headsign status plus the docs?

Four things moved. The landing did not (still: yes, log it), but the reasons
did, and one of the beliefs it started from was simply false.

**The belief that was false: "nothing is written when a stop is allowed."**
The first explanation opened with that, and built its whole argument on
answer A being a bend in ADR-0004's rule. It is not. `noteGateThenNudge` in
`src/stophook.ts` handles the pause note before it ever reaches the nudge
logic, and that path deletes the note, resets `stop_nudges`, appends a
`paused` line, and returns `block: false` — an *allowed* stop that writes a
log line. headsign has shipped a logged pass-through since ADR-0006's
exit-note revision. The other two hook events go the other way: `stalled` and
`claimed` are both written on a block. So the question is not "may an allowed
stop be logged" but "are the other allowed stops like the pause note".

**A count claimed without counting, which inverted the argument once fixed.**
The explanation said nine of the eleven log event words mark a run moving.
Six do (`start`, `advance`, `complete`, `retry`, `escalate`, `abort`); five do
not (`ceiling`, `graph-changed`, `paused`, `stalled`, `claimed`). "Log only
real transitions" therefore covers barely half its own vocabulary — and every
one of the five exceptions was admitted on the same stated ground, which
ADR-0004 words as "the only trace its own kind of … event otherwise leaves
behind" and, for `ceiling`, "it is logged anyway, because … nothing else
records it." That is the reporter's argument verbatim. It went from a quoted
objection in the draft to the main line of reasoning in the rewrite.

**One category that should have been four.** The draft reasoned about "the
allowing side" as a single thing and then priced the volume of logging "it".
The allows are four unrelated situations sharing a return value: headsign has
no run in hand (observer, unparseable input, no state, already ended); a run
is in hand but nobody has been identified yet (Claude Code's
`stop_hook_active`); the stopper is a bystander (a session while an agent
drives, a subagent that does not match the driver); and it is the driver's own
stop and headsign chose quiet (pause note, exhausted cap, lock held). Only the
middle two are "headsign would have held this and did not". The volume
objection turns out to be an objection to logging the other two, which nobody
proposed — so scoping the answer shrinks the cost to the driver's own turns.

**A "cannot" that was not true.** "A log line cannot be misread the way that
field was." Every write the hook makes goes through the run's lock and is
skipped entirely when the lock is held, so a *missing* pass line does not
prove the hook did not run. Weakened to "harder to misread", with the
best-effort write named as the residual trap that any documentation of the new
line has to carry.

**One point that was two.** `stop_nudges` fails the reader twice, at different
depths: it is never incremented by a loop-guard pass (a coverage gap), and it
is reset to 0 by every real `headsign next` — unconditionally, inside
`step()`, before the pass/fail branch — so it reads 0 for most of a normally
driven run's life. The second is the worse one, because it makes the field
misleading about the very case it does cover. The draft had them as one
sentence about fields having no history.

**An aside the challenge turned up that is not about this question.** The
plugin bundle driving this run (`0.1.0`) still truncates `.headsign/log` on
`headsign start`; the working tree is `0.3.0` and appends. So the previous
run's log was erased when this run started, and — more to the point — the
reporter is very likely on that same released build. Whatever is decided here
does not reach them until a release.

## If pass-throughs are logged, do all of the pass reasons get a line, or only the stops on a run the stopper could plausibly be driving?

The landing held (**only the loop-guard pass gets a line**) but the criterion
behind it was wrong in a way that would have shipped a second gap unnoticed.

**A "trace" that is not always there.** The draft dismissed the lock-held pass
— a stop that passes because another process was mid-lap — on the grounds that
the concurrent lap wrote its own `advance` or `retry` line, so the moment is
recorded under a different name. Not always. `engine.ts` takes the lock at the
top of `next` and holds it through the whole evaluation, and the readiness-probe
branch answers `PENDING` while writing neither state nor log — ADR-0004 makes
that silence deliberate. So a stop landing inside a `PENDING` lap leaves nothing
anywhere, exactly like the loop-guard pass. `grilling.yaml` declares `ready:` on
two of its five phases, so this is an ordinary shape.

**Which forced the criterion to grow a clause.** "Does this leave no trace
today" was doing all the work and answered *whether a gap exists* while saying
nothing about *whether it can be closed*. The second clause is: can headsign
record it at the moment it happens, with counters that are true? The lock-held
pass fails that — not because an append needs the lock (it does not; an append is
safe unlocked) but because `logLine` builds `a=`/`i=` from the state it is handed,
and the only state on that path is a pre-lock read the running lap is in the
middle of superseding. The line would be stamped now and counted then. Two
clauses is what keeps the list one row long instead of two.

**A grouping that hid the most interesting row.** "Nobody has claimed the run"
was filed with the bystander passes and refused as one. It is not one: a
delegated agent stopping on an unclaimed run may be an unrelated subagent, or it
may be the agent actually driving the run that forgot to `headsign claim` — a
trap `docs/workflow-reference.md` documents as failing "quietly rather than
loudly". It still gets no line, but the real reason is that at that branch
headsign **cannot tell the two apart**: every subagent stop on an unclaimed run
arrives there, so the line would fire for every reviewer and searcher too.
Undecidable, not unimportant. The draft had the right answer for the wrong
reason, which is the kind of thing that gets reversed later by whoever notices
the reason is wrong.

**Credit given for an inference that was not made.** The draft said the reporter
ruled the nudge cap out from the absence of a `stalled` line. They ruled it out
from `"stop_nudges": 0`. The distinction matters because it is the difference
between the log having served them and the log having been beside the point. The
inference itself does hold — `stalled` is appended in the same locked write that
increments the counter to 5, so the counter cannot reach the cap without the line
— but only in one direction: absence proves the cap innocent, presence proves
nothing about now, because the log outlives the run that wrote it and every real
`next` resets the counter.

**Two over-claims, weakened.** "The lock-held pass cannot be logged" became
"would have to be written outside the lock, under stale counters". And the
objection to logging the observer path went from "it would touch the run's files"
to the sharper version: `HEADSIGN_OBSERVER` is checked before the input is parsed
and before the walk-up runs, so writing there means adding back the work the
short-circuit exists to skip. An uncounted claim about how many bystander lines
there would be relative to the driver's own was dropped.

## Should nudges 1 through 4 get their own log lines too, or does only the cap-tripping nudge stay worth a permanent record?

The landing held (**nudges 1–4 stay silent**) but both arguments the draft rested
on turned out to be weak, and the argument that actually carries it was missing.

**"A nudge is the loudest thing headsign does" is false where it matters most.**
A blocked stop exits 2 with its message on stderr, which Claude Code hands back to
the model — visible to the user for a `Stop`, and the reporter's own observation
table proves it. But `SubagentStop` delivers that message to the delegated agent
and to nobody else: not the user, not the lead session that delegated the run. On
exactly the configuration ADR-0010 exists to support, a nudge is invisible to
everyone except the agent receiving it. The draft's central claim does not survive
that.

**The volume objection was overstated by about half.** The draft said logging
nudges adds a line for "very nearly every turn of the run". Trace one exchange: the
turn ends and the hook nudges; the agent continues, the turn ends again, and the
platform's flag passes it. Two turn ends per exchange, one of each. So nudge lines
add *one extra line per exchange*, on the same order as the three `advance` lines a
question already writes. ADR-0004's phrase for the current rule is "spam
prevention", but that judgement was made when nudges were the whole mechanism and
no pass line existed — it is not a measurement of the log being designed here. The
decision should not, and no longer does, rest on volume.

**What carries it instead: nudges 1–4 are the mechanism working, and `stalled` is
the mechanism having failed.** Only the failure is news, and it is already logged,
carrying `nudges=5` — the one value of the counter anybody has ever wanted to read
back. The intermediate counts are reset unconditionally by every real `headsign
next` inside `step()`, so they describe a window that has closed before anyone
looks. The draft reached the right answer without ever naming the audience that
made it a real question: a user whose delegated agent drives the run cannot see its
nudges at all, and `stalled` is the only thing that tells them the reminding
stopped working.

**An inference the draft leaned on harder than headsign itself does.** "The
platform sets that flag because a stop hook blocked" was treated as fact. ADR-0006
calls `stop_hook_active` a "Legacy field" and records that "as of 2026-07-23 the
official hooks documentation no longer documents `stop_hook_active`" — which is the
stated reason `stop_nudges` exists at all. So the defensible reading of a pass line
is narrower: *some* stop hook held this turn and headsign then stood down. In a
repository with more than one stop hook, headsign may not have been the one that
held it. That belongs in whatever documents the line.

**A grouping used in the two previous answers, now with its exception.** "All five
non-transition log words were admitted because nothing else records the event" is
true of four. `graph-changed` is different: ADR-0023 §8 deliberately put that event
where people would see it — `COMPLETE` and `status` — *because* "`.headsign/log` is
gitignored and never reaches a pull request". Its log line carries the **detail**
(which phase keys moved), not an otherwise-unrecorded event. The family is "the log
carries what nothing else carries", and a nudge line would carry neither an
unrecorded event nor an unrecorded detail.

## Should the disposition of the last stop be stored in state.json, or read back out of the log when something needs it?

The landing held (**the log is the record; no copy in `state.json`**) but the
question had been framed from the reporter's mock-up rather than from the design,
and one of the three costs charged against reading the log turned out not to exist.

**Two options were missing from "there are only two sources".** A **marker file**
the hook overwrites — one line in `.headsign/tmp/` — needs no lock, no schema, no
tolerant read and no parser, and is cheaper than either candidate that was on the
page. And **no source at all**: `status` could print a fixed sentence about a nudge
being followed by a silent turn end. The marker file is refused by the same
principle that refuses the state field (it is a second copy of what the log already
records) plus ADR-0004's definition of `tmp/` as "scratch space for the workflow,
not headsign-internal state the way `state.json` and `lock` are". The no-source
option is not a store and belongs to the next question — but it had to be named, or
that question gets walked into with two options when it has three.

**The belief that the log format is private and unparsed was false, and it was
doing a third of the work.** The draft argued that teaching anything to read the log
would turn a free-form file into a contract. ADR-0024 §4 already declared the format
machine-usable in those words, committed to the invariants that make it so ("the
event word is always the second whitespace-separated field, and free text … always
comes after `a=` and `i=`"), published the anchored pipeline for slicing the current
run out of a multi-run file, and `tests/cli.test.ts` runs those exact pipelines
through a shell — including a test that the naive `grep ' start '` is foolable by an
`abort … reason="let's start over"` line. So the multi-run ambiguity has a documented
one-liner instead of being an open trap, and reading the log uses a guarantee that
already exists rather than creating one.

What survives as B's real cost is narrower: a pipeline a *person* runs is a promise
to users, whereas `engine.ts` parsing the log makes headsign depend on its own
output format internally — a format change would break the program, not a grep. And
the parser has no owner, since `render.ts` owns writing the format. Plus a
consequence: ADR-0024 chose no rotation because "a run is tens of lines", and a
`status` that scans to the last `start` line does work proportional to the whole
file.

**Three costs were lumped into one argument, letting the weakest do the talking.**
"A state field costs a hot-path write, a schema burden, and a duplicate" mixes a
runtime cost, a maintenance cost, and a design objection. Only the duplicate is
decisive, and only it does not get cheaper with a better implementation. The rewrite
leads with it; otherwise the answer reads as "that is expensive", which invites
someone to make it cheap and reopen it.

**One objection retired as unusable.** The draft leaned on ADR-0004 having deleted
`history` and `version` as "write-only bookkeeping". A last-stop field would have a
named, existing reader, so that ADR's rule — "design it together with its reader" —
is satisfied by it. The objection has to be duplication, not waste.

**A framing correction.** A state field is a *store* decision; reading the log is a
*consumer* decision. They are not two answers to one question, which is why
"neither, as a store" sounds like a dodge and is actually the answer.

## Should headsign status grow a line reporting how the previous stop was handled?

**This is the one lap where the landing moved.** The draft refused the line on a
principle that turned out not to apply; the rewrite leans toward adding it and hands
the call to a person.

**The attribution objection was wrong, and it was carrying the whole draft.** The
draft argued that `status` cannot say whose stop the last one was — the hook fires for
every session and subagent in the directory — and called that "the same gap that makes
`claim` necessary". It is not the same gap. The `claim` gap is about *identity*: the
CLI has no agent id to compare itself against. A `last stop:` line compares nothing;
it reports an event. And the event is well attributed once you work out where the
loop-guard check has to move for the line to name a phase: from `SubagentStop` it
would sit after a *positive match* against the recorded driver, so the line is the
driver's definitively; from `Stop` it would sit after the driver check, which returns
early on a claimed run, so the line belongs to a session stopping on an unclaimed run
— exactly the party the hook would otherwise have nudged. What is left is two sessions
open on one unclaimed run, an ambiguity `docs/workflow-reference.md` already documents
for the nudge itself: "every session in the directory is nudged, driver or not."

**The comparison with `stop_nudges: 0` was rhetoric, not analysis.** That field
misled the reporter because it does not cover the loop-guard case at all and is reset
by every `next` — not because of any confusion about whose turns it counted. Dropped.

**The `driver:` precedent points the other way.** The draft read it as headsign
refusing to print facts that invite the reader to think they are about themselves. In
fact headsign printed the line and wrote the limit into the manual — "It says nothing
about whether *you* are that agent, and cannot." That is a precedent for a
`last stop:` line with a documented caveat, not against one.

**"The parser has no owner" was false.** `render.ts` already owns the line format and
is where an inverse belongs. The real cost is narrower: its stated responsibility is
"outcome -> text", one-directional, so a reader amends that contract — and a format
change would then break the program rather than a user's grep.

**Two answers had been stapled into one.** The draft landed on "B together with D",
where D was "put the warning in the nudge message". D is a different question later in
this list. Stapling them made the refusal look better supported than it was: if D is
rejected later, B stands alone and the reporter's need is met only by "read the log".

**One thing the draft never asked, now answered.** Is a stop-boundary event a fact
about the *run* at all, given every other `status` line is? It is admissible: three of
the log's event words are stop-boundary events, and `paused`/`stalled`/`claimed` are
already recorded as things that happened to this run.

**Where it stands.** Costs of adding the line, honestly priced: headsign would read
its own output format for the first time; `status` would read a file ADR-0024 left
deliberately unrotated; and the output contract grows by one line, which ADR-0023
already did twice. Against that, a concrete need at the surface the reporter actually
used. No argument from the code settles it, so it goes to the person with a lean
toward adding it.

### AMENDMENT — the user reversed the answer above, and the challenge phase had missed why

Recorded separately because it is a different *kind* of correction from the rest of
this file: not something the challenging caught, but something a person caught after
the lap had closed.

The Q4 decision refused a `state.json` field on two grounds. Both were wrong.

**"A record field and a log line can diverge."** Only if the append is placed outside
the lock. `withRunLock` writes the record and appends the line in one locked
operation — the shape `paused` already uses — so both land or neither does.

**"It would be a second copy of the same fact."** That is not a smell here, it is the
pattern the whole record is built on: `claimed` with `driver_agent`, `paused` with the
`stop_nudges` reset, `stalled` with `stop_nudges: 5`, `graph-changed` with
`graph_change_reported` and `accepted_graph_changes`. Every stop-boundary and graph
event already has an event in the log and a current value in the record. ADR-0004 calls
state.json "the external memory". The refusal ran against the grain of the entire file.

The lap's challenge phase asked whether the *costs* had been grouped correctly and
whether the `history` analogy held — and never asked the one question that would have
caught this: **how do the record's existing fields relate to the log's existing
lines?** The lesson is specific: when refusing to add something on the grounds that it
duplicates, count the existing instances of that duplication first. Four of them were
sitting in the same file.

The real objection, which the false one had buried, is **staleness** — and it is the
actual lesson of `stop_nudges: 0`. A field written only on passes reads "passed
through at 23:06:51" long after a later nudge. So the field must be written on every
stop the hook processes and can attribute (nudge, loop-guard pass, pause, cap pass),
and not written where headsign cannot attribute or cannot write (observer, no run,
unparseable, bystander, held lock) — which leaves it stale only after a bystander's
turn end, the same limit `driver:` carries.

## Must the HEADSIGN_OBSERVER opt-out stay a complete no-op, or may it write a line to the run's log?

The landing held (**the hook stays a no-op; `status` reports the switch when the
calling environment has it set**), and the challenging mostly trimmed over-claims —
except for one option that had been missed entirely.

**A fourth option, found and rejected: warn at `headsign start`.** Better targeted
than any display, since it would fire at the moment the contradiction is created
rather than when somebody later wonders why nothing nudges them, and `start` already
writes warnings to stderr without changing its exit code. It fails because the
configuration it would warn about is **correct**: a lead session that sets
`HEADSIGN_OBSERVER`, runs `headsign start`, and delegates driving to an agent that runs
`headsign claim` is precisely the arrangement ADR-0010 exists to support. A warning
that fires on the recommended setup teaches people to ignore warnings. Worth recording
as rejected, because it is the kind of idea that comes back.

**"Cannot be wrong about whose setting it is" was too strong.** `status` is certain
about the environment of the process it runs in, which is normally the session's and
need not be — a variable exported in one terminal and a `status` run in another
disagree. The defensible claim is narrower: this is the only quiet-ending reason the
reader's own process can answer *about itself*, with no identifier to resolve.

**A third reason that was not one.** "A standing setting is not an event a log should
carry" was standing beside the two real reasons as an equal. An observer's turn end *is*
an event, and the log already carries configuration inside events — a `start` line's
detail is `workflow=<name>`. Demoted to a remark. What survives independently: writing
there would undo the short-circuit that makes the opt-out an opt-out, and it would
record a non-participant in the record of a run it opted out of.

**One cost the draft got for free and should not have.** Nothing in headsign except the
hook path reads the environment, and `engine.ts`'s `status(cwd)` takes only a
directory. Reporting the switch threads a new argument to a new place. It follows
`stophook.ts`'s established shape — "Nothing here reads the clock or the environment:
both arrive as arguments" — but it is a signature change, not a free lookup.

**A side finding, recorded rather than acted on:** `status` could also report that a
pause note is currently armed. That is a fact about the run rather than about the
reader, it is cheap to read, and nobody asked for it.

## Should the stop_hook_active check move to after the run and driver lookups so that a pass can name the phase it happened in?

The landing held (**move it down in `Stop`; give it its own body in `SubagentStop`**),
and the lap's real product was a reframing: the question's own axis — *how far down does
the check move* — is the wrong one.

**The finding.** Framed as movement, the flagged branch's safety is a property of where
it sits, so a later reordering of the hook's steps can silently reintroduce the bug that
makes this hard: in `SubagentStop` the claim-adoption gate consumes a one-shot marker
*and blocks*, so a flagged turn that reaches it gets a driver seated and gets held — on
the one turn the platform asked not to be held. Framed instead as "the check keeps its
guarantees and gains a body", the branch returns before that gate is ever in its path,
and no reordering can reach it. Same code, different property: one is safe by position,
the other by construction.

**A cost the draft charged and should not have, at nearly full price.** It said B makes
every bystander subagent pay a walk-up and record read on flagged stops. Bystanders
already pay exactly that on their *unflagged* stops — walk-up, record read, agent-id
resolution, marker test, driver comparison, then return having done nothing. So B imposes
no new class of work; it makes a flagged stop cost what an unflagged one already costs.
The genuinely new cost is one walk-up for a flagged subagent stop in a repository with no
run at all, where the hook pays nothing today: ADR-0006's "sessions not using headsign
must pay nothing" survives in substance, but becomes "almost nothing".

**A list of three that was a list of two.** "A flagged turn is never blocked, never
consumes the pause note, never consumes the claim marker" reads as three parallel
guarantees. Consuming the marker violates the other two *at once* — it spends a one-shot
resource and it blocks — so flattening it into the list hid why it is the dangerous one.
Now stated as two guarantees plus the single action that breaks both.

**A question the draft never asked, which a reviewer would have asked first.** Does
treating the two hooks differently violate ADR-0010's insistence that they behave
identically? No — that rule is about *observable behaviour*, and under this answer both
hooks record a loop-guard pass under the same condition, write the same line, and block
nothing. ADR-0010 itself says the two share "everything below the adoption gate", which
concedes that above it they do not. But the explanation has to say so, because an
asymmetry reads as a violation until it is addressed.

**One candidate compressed to a sentence.** "Record from a later point" was listed as a
fourth option and then dismissed; it is not an option at all. The hook process ends when
it returns, nothing carries a memory of the flagged turn into the next invocation, and
`next` knows nothing about stops.

## Should headsign's own output name the upstream stop_hook_active field, or describe Claude Code's loop guard in headsign's own words?

The landing held (**headsign's own event word, the field named bare in the log's detail,
prose in `status`**) and the lap's value was almost entirely in what it found about
names — including one the run itself had been getting wrong.

**The finding that matters: "loop guard" is already headsign's word for `stop_nudges`.**
ADR-0006's section is headed "The safety-net loop guard (`stop_nudges`)", `stophook.ts`
labels its branch "Loop guard (ADR-0006): a safety net for the case where the agent can't
even write a stop-note", and `engine.ts` describes the counter reset as clearing "the Stop
hook's loop guard". So using it for the platform's flag names a *sibling mechanism at the
same boundary that produces the same observable outcome* — a quiet pass. The exhausted cap
and the platform's flag are exactly the two things a reader of two silent stops has to tell
apart, and one name removes the only means. It is the error ADR-0004 avoided when it
refused to log the iteration ceiling as `escalate`. Note against this run itself: every
lap before this one used "loop guard" for the platform flag, so the wording in the earlier
decisions needs replacing when the plan is written.

**`pass` is disqualified with evidence, not taste.** `pass` is headsign's own internal
token for a gate succeeding — `GateVerdict`'s passing arm is named `pass` and `engine.ts`
branches on `gateResult.kind === "pass"`. The reporter's sketched event word would collide
with the program's word for the opposite kind of event.

**A rule stated wrongly, which would have produced wrong punctuation.** The draft called
the log's detail "the foreign slot" — where names from outside belong. It is not:
`nudges=5`, `state=reported` and `routed-default` are headsign's own tokens in that same
slot. What the detail separates is *quoted versus bare*, and `render.ts` says so for
`graph-changed` — those keys are bare because "they are identifiers … not free text like a
reason". `stop_hook_active` is an identifier, so it is `by=stop_hook_active`, never
quoted. Right conclusion, wrong rule, wrong form.

**A near-circular argument replaced with evidence.** "Output was never one thing" was
presented as the conclusion while being assumed. The evidential version: the log writes
`check="npm test" exit=1` where `status` renders `--- last failure: unit tests (npm test,
exit 1) ---`, and the log writes `routed-when="grep -q …"` where `next` prints `--- routed:
when "grep -q …" → simplify ---`. Two registers, already, for the same facts.

**A dated claim demoted, and a rule extracted from it.** "The field is undocumented" rests
on ADR-0006's "as of 2026-07-23", a claim with a date on it about a platform that revises
its docs. This explanation cannot update it. What survives is stronger for the purpose:
headsign cannot promise a name it does not own is documented anywhere — and the docs
sentence must therefore describe what headsign *does with* the field and never assert what
upstream's documentation currently says.

**A fourth candidate found and refused: name it in the documentation only.** Both outputs
would stay in headsign's register and the grep chain survives at one remove. It loses on a
small margin — the reader is holding a log line, the token's value is appearing where the
evidence is, and a detail slot that already takes bare identifiers costs nothing.

**Two names left deliberately unresolved**, to be settled when the plan is written: the
event word itself (not `pass`, not an `advance` synonym, and not suggesting headsign chose
to let go — it was overruled), and a term for the platform's mechanism that is not "loop
guard". ADR-0006's gloss of the field is available and is upstream's own phrasing: "Claude
is already continuing as a result of a stop hook."

## Should the nudge message itself warn the agent that its next turn end will probably pass silently?

The landing held (**no; the nudge stays as it is and the docs carry the window**) but
*both* reasons the draft rested on were demoted, and the answer now stands on a third.
This lap also turned up a finding about headsign's own safety net that has nothing to do
with the question asked.

**Two unit errors in the question itself.** "Your next turn end" is wrong — the nudge
*blocks* the ending and the model continues inside the same turn, so what passes silently
is the end of **this** turn. And "you will not be reminded again" is too broad: the window
is one turn wide, because the next user message starts a fresh turn whose ending is
unflagged. That is measured, not assumed — the third row of the reporter's own table is the
nudge reappearing after they spoke. The accurate sentence is narrow: *if you end this turn
without running `headsign next`, nothing will stop you*.

**Demoted reason 1: "headsign would promise behaviour it refuses to rely on."** ADR-0006
declines to "bet the worst failure mode (an unstoppable session) on an undocumented field"
— a refusal to depend on the field for *correctness*. Describing what the field does is not
depending on it: if it vanished, the sentence would become unnecessary rather than harmful,
because the action it recommends is the action the message already demands.

**Demoted reason 2: the dilution rule.** `stophook.ts` does restrict the final-reminder
phrase to the cap-tripping nudge so earlier nudges "keep pushing `headsign next`, not
dilute it". But that rule's case is urgency with no action attached, and the proposed
sentence attaches a reason to an action already present. Worse for the draft: the message
is a three-part composite with an already-conditional slot, so "there is no room" is false.
The addition is architecturally available; the rule discourages it and does not disqualify
it.

**The reason that carries it.** The window only bites an agent that ends its turn *without*
running `headsign next` — an agent that did not follow the instruction it was holding. The
failure mode is inattention, and a longer message is not the cure for inattention: each
clause added to a message read by something already skimming makes the first clause less
likely to land.

**And what was actually asked.** The reporter marked this section not a feature request
("仕様変更の要望ではありません") and asked for the fact to be *documented*. The
nudge-message idea is this run's invention. That does not make it wrong, but it means the
addition widens the change past the report on the strength of an idea its reporter did not
make — worth naming, since it let A and B look like an even contest between two of
headsign's own options.

**A finding about the cap, unrelated to the question and worth keeping.** Because a nudged
turn's own end is flagged and passes, five nudges cannot land inside one turn — they need
five separate *exchanges*. So `stop_nudges` reaching its cap means five exchanges with no
real `next`, while ADR-0006 chose N=5 as "enough nudges that a functioning agent has had
several real chances to respond, not so many that a stuck session drags on", which reads as
five consecutive stops. The safety net is looser than its own design note describes — not
broken, but slower to fire than intended. Carried into the documentation question.

Also confirmed dead: answer C ("only the first nudge of a streak"). The counter is reset by
every real `next`, so on a normally driven run every nudge *is* the first of its streak — C
is A wearing a test that always passes.

## Should the docs explain why stop_nudges reads 0 even on a run that has been nudged several times?

The landing held (**surfaces table and the expectation in the user-facing docs; the
counter's mechanics and the cap interaction in ADR-0006**) but the draft's central
justification was factually wrong, and one row of its own proposed table was unsound.

**The false claim: "nothing in the docs invites a reader into `state.json`."** The draft
argued that explaining `stop_nudges` would make an internal field into an interface by
accident, and that the reporter's detour into the record was unprompted. Both halves fail.
`docs/workflow-reference.md` names `driver_agent` in prose, and its graph-vocabulary table
has a row reading "the version of the graph a run is running under | `graph_fingerprint` in
`.headsign/state.json`" — a where-to-look table with field names in it. The move the
reporter made was a move the documentation taught. So the argument cannot be that the line
must not be crossed; it has been crossed twice. What survives is a distinction about
*which* fields: `driver_agent` and `graph_fingerprint` each answer a question a reader
legitimately has and can get nowhere else, while `stop_nudges` is a resetting counter whose
every event is already a log line.

**A row in the proposed table that does not do what the table promises.** "Nobody has
claimed the run, or the stopper is not the driver → no `claimed` line in the log; `driver:`
in `status`." The log half is unsound: since ADR-0024 the log holds every run in the
directory, so a `claimed` line may belong to a run that ended days ago, and the reading
only works against the current run's slice. The `status` half is sound but narrower than
the row implies — `driver:` reports whether *some* delegated agent holds the run, and the
manual is emphatic that "It says nothing about whether *you* are that agent, and cannot."
Every other row settles the reader's question; this one only narrows it, and the table has
to say so or it teaches the same over-reading that produced this report.

**An over-claim against ADR-0006, withdrawn.** The draft said the ADR "has been quietly
wrong about its own mechanism". It never claimed five consecutive stops: it gives the
reasoning ("enough nudges that a functioning agent has had several real chances to
respond") and calls N=5 "an arbitrary safety value, not a principled number". The reader
supplies the consecutive-stops reading because nothing mentions the interaction. So the
note to add is a missing interaction, not a correction.

**"Reads 0 or 1 and nothing else" corrected.** True while the run is being driven; the
counter climbs when nobody runs `next` across several exchanges — which is the case the cap
exists for, and saying it that way also tells a reader what a non-zero value means.

**The split re-grounded.** The draft divided the work by audience (users get the surfaces,
the ADR gets the mechanics), which invites "why not tell users too?" with no principled
answer. The real division is **lifetime**: where-to-look stays true across changes to any
counter, while a field's mechanics change when the field changes and so belong with the
design record that changes in the same commit.

**"The docs" was two documents.** The quiet-ending list exists twice with different depth —
the skill's rule 2 in a parenthesis, read by an agent about to drive a run, and the
reference manual in prose. Writing "the docs" flattened them; the skill gets the fifth
cause plus the one-line expectation, the manual gets the table.
