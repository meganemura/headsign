# ADR-0010: Sealing driver identity on SubagentStop — the event ADR-0009 got wrong

- Status: accepted
- Date: 2026-07-25
- Supersedes: [ADR-0009](0009-claim-handshake.md)

## Context

ADR-0009 reasoned its way correctly to a conclusion and then handed the
job to the wrong hook. Its conclusion — *only a hook, reading its own
stdin, can know which of several turn loops sharing a process just
stopped; the CLI cannot, in principle* — survives this ADR intact and is
restated below. What did not survive is an assumption ADR-0009 made
without measuring it: that a **delegated agent** (a teammate under Claude
Code's agent-teams feature, or a subagent) ends its turn by firing the
`Stop` hook, and that the firing carries an identifier belonging to that
agent rather than to the session it was spawned under.

Both halves of that assumption were checked directly, in this repository,
on 2026-07-25. The second half was already known to be shaky (ADR-0009's
own correction to ADR-0008). The first half turned out to be simply
false — and it is the half the whole handshake rested on.

The measurements, stated as shapes rather than values (the identifiers
themselves are per-run and carry nothing worth recording here):

1. For a lead session — one turn loop, nothing delegated — everything
   ADR-0008 assumed still holds: ending the turn fires `Stop`, and the
   payload's `session_id` equals the `CLAUDE_CODE_SESSION_ID` that
   session's own Bash tool reads.
2. A delegated agent's Bash environment carries the *lead's*
   `CLAUDE_CODE_SESSION_ID`, not one of its own — the process-granularity
   ADR-0009 recorded, re-confirmed.
3. It also carries the lead's `CLAUDE_PID`. The two are literally the
   same OS process, so nothing derived from the process — pid, ppid,
   environment, cwd — can tell them apart. This is not a gap in what
   headsign reads; it is a gap in what exists to be read.
4. A full dump of a delegated agent's environment contains **no**
   agent-specific identifier under any name. There is nothing to reach
   for, not even something undocumented.
5. **A delegated agent's turn end does not fire the `Stop` hook at all.**
   With a claim marker armed, letting such an agent finish its turn
   adopted nobody: no confirmation, no state write, and the marker still
   sitting there afterwards. It was consumed only when the *lead* stopped,
   seconds later — sealing the lead's identifier as the run's driver. The
   exact inversion the handshake existed to prevent, reproduced from first
   principles.
6. **`SubagentStop` fires at every delegated agent's turn end**, not only
   at the end of its final one: sending the agent another message and
   letting it finish again fires the hook again, carrying the same
   identifier as the first time. The event trails the agent's own idle
   signal by roughly a second.
7. The `SubagentStop` payload carries `session_id` (the lead's, per fact
   2), `agent_id` — specific to the delegated agent, and stable across
   that agent's turns — `agent_type`, and `hook_event_name`.
   `SubagentStart` carries the same shape.
8. `stop_hook_active` behaves as ADR-0006 assumes: while it is set, the
   following `Stop` firing passes through.

Facts 5 and 6 are the entire correction. ADR-0009's mechanism — a marker
armed by a command that cannot know who it is, sealed by a hook that
can — is sound, and this ADR keeps it whole. It was waiting at a door the
delegated agent never walks through. Fact 7 supplies the door it does:
`agent_id` is precisely the identifier facts 2–4 say cannot be found
anywhere on the CLI side, delivered by the same party, for the same
reason, that ADR-0008's `session_id` is delivered to `Stop`.

Moving the seal also recovers a backstop nobody had noticed was missing.
While `Stop` was the only hook headsign registered, a delegated agent
that quietly gave up mid-run — the actor ADR-0006's whole design exists
for — was never nudged, because no hook fired for it. Every nudge a
delegated agent could ever have received was, in fact, going to whichever
session stopped later.

## Decision

### 1. Only `SubagentStop` seals a claim; `Stop` never looks at the marker

The adoption gate ADR-0009 put in the `Stop` hook moves, unchanged in
spirit, into a new `SubagentStop` evaluation. `Stop` is left with no
knowledge of `.headsign/tmp/claim` whatsoever: it does not read the
marker, does not consume it, does not adopt on it, and does not pass
through because of it.

This is what makes the failure structural rather than merely unlikely. A
lead session's stop cannot take a seat meant for a delegated agent by
racing it, because the event that seats anyone does not fire for the lead
at all. ADR-0009 tried to make the right party win a race; this ADR
removes the wrong party from the track.

The new hook's decision order, in the shape ADR-0006 uses for `Stop`
(step numbering is this hook's own):

1. **Observer opt-out.** `isObserver(env)` → pass, before stdin is
   parsed, exactly as `Stop` does (ADR-0008).
2. Parse the payload — `agent_id`, `cwd`, `stop_hook_active`. Unparseable
   stdin fails open (pass).
3. `stop_hook_active` true → pass.
4. Locate `.headsign/state.json` by the same bounded walk-up `Stop` uses
   (stdin `cwd` preferred, invocation cwd as fallback; ADR-0006). Not
   found → pass.
5. `status !== "running"` → pass. Unreadable state → pass.
6. Resolve this firing's agent id: the payload's `agent_id`, trimmed,
   when it is a non-empty string; otherwise none. There is deliberately
   no env fallback here — the whole point of this hook is that the
   environment cannot answer this question (facts 2–4).
7. **Adoption gate.** If `.headsign/tmp/claim` exists *and* an agent id
   resolved: delete the marker, write `driver_session` = that agent id,
   `driver_source` = `"claim"`, reset `stop_nudges` to 0, append a
   `claimed` line to `.headsign/log`, and **block** with the confirmation
   naming the workflow and phase, plus the same pause/abort exit guidance
   every other block carries. If the marker exists but no agent id
   resolved, leave the marker in place and fall through — a firing that
   cannot say who it is must not consume a one-shot marker meant for
   someone specific. This gate runs **before** owner match, for the
   reason ADR-0009 and ADR-0006 already give: the stamp the claim exists
   to replace must not be allowed to wave the claimant through first.
8. **Owner match.** `driver_source !== "claim"` → pass (the run is driven
   by a session via the env stamp; a subagent stopping underneath it is
   by definition not the driver). `driver_source === "claim"` but the
   resolved agent id differs from `driver_session` → pass (a different,
   unrelated agent). Only the recorded driver reaches step 9.
9. **Exit-note gate.** Identical to `Stop`'s (ADR-0006): consume a
   non-empty `.headsign/tmp/stop-note`, reset `stop_nudges`, log
   `paused`, pass.
10. **Nudge / cap.** Identical to `Stop`'s, including the shared
    `stop_nudges` counter, the cap, the single `stalled` line when the
    cap trips, and the `cd`-to-the-run-directory guidance when the run
    directory differs from the session's own cwd.

Because the two evaluations share everything below the adoption gate,
they share an implementation file (`src/stophook.ts`, whose remit widens
from "the Stop hook" to "the stop-boundary hooks") rather than acquiring
a parallel module that would drift from it.

### 2. `driver_source` already says which kind of identifier is stored

The stored driver is now sometimes a session id and sometimes an agent
id. Rather than record that in a new field, this ADR observes that
`driver_source` **already determines it**, one to one:

| `driver_source` | What `driver_session` holds | Which event can match it |
|---|---|---|
| `"env"` | a session id, stamped by the CLI from the environment (ADR-0008) | `Stop` |
| `"claim"` | an **agent id**, sealed by `SubagentStop` (this ADR) | `SubagentStop` |
| `null` | nothing | neither — every stop is nudged, as before ownership existed |

So `state.json`'s shape does not change. Only the meaning of the
`"claim"` row does, from "a session id that a Stop firing supplied" to
"an agent id that a SubagentStop firing supplied".

A separate `driver_kind` field was considered and rejected: it would be a
second source of truth for something the first already fixes, and two
fields that *can* disagree eventually do — at which point every reader
needs a rule for which one wins, and every writer needs to remember to
update both. The one-to-one mapping above needs no such rule, and it is
enforced by construction, since the only writer of `"claim"` is the only
reader of an agent id.

There is no released-version compatibility to weigh: `claim` exists only
in `[Unreleased]` and shipped in no release. A run created by a
*development* copy from before this change can hold the old combination —
`driver_source: "claim"` with a session id inside — and it degrades
safely: `Stop` passes through on `"claim"` by rule 4 below, and
`SubagentStop` compares an agent id against a session id and finds a
mismatch, so nobody is nudged. Fail-open, not misfire. Running `headsign
claim` again (or `headsign start`) restores the invariant.

### 3. `SubagentStop` blocks only the agent recorded as driver

`SubagentStop` fires for **every** delegated agent in the process tree,
including agents that have nothing to do with the run: a read-only
reviewer subagent a review phase spawned, an implementer working a
different task, a helper the user asked something unrelated. Step 8 above
is the absolute safety condition of this design — block on the recorded
driver's own turn end, and unconditionally pass on everyone else's.

Getting this wrong would be worse than the bug being fixed. A hook that
held the turn of any agent that happened to stop would turn headsign from
a backstop for the one agent driving a run into a tax on every agent in
the session, including agents whose users never asked headsign anything.
The nudge cap would also be back to being exhaustible by bystanders —
precisely the correctness bug ADR-0008 was written to close, re-opened
one layer down.

This is why the match here must be *positive*, and why that differs from
`Stop`'s owner check on purpose. There, an unresolvable identifier still
nudges: the session stopping in the run's own directory is very likely
its driver, so absence of proof is read as "can't rule this out." Here
the prior runs the other way — most subagent stops belong to agents with
no headsign role at all — so a stop that cannot name itself is treated as
*not* the driver and passes untouched. The same fail-open instinct
(ADR-0006) points at opposite branches once you ask what an unnamed
stopper is most likely to be.

### 4. `Stop` passes through unconditionally on a claimed run

Ahead of its own owner-match comparison, `Stop` gains a single early
return: if `driver_source === "claim"`, pass, full stop.

```ts
// The stored driver is an agent id sealed via SubagentStop (ADR-0010): a Stop event
// carries a session id, which can never be that agent — so this session is, by
// construction, not the driver. Return before the comparison below rather than relying
// on two unrelated id spaces happening not to collide.
if (state.driver_source === "claim") return { block: false };
```

The comparison one line below would, in practice, reach the same verdict:
a session id and an agent id are drawn from different id spaces and will
not be equal. But "will not be equal" is an empirical property of two
identifier formats that neither this project nor its users control, and
the whole reason this ADR exists is that an unstated assumption about
someone else's identifiers held right up until it didn't. Stating the
intent — *these are different kinds of name, so the question is not even
asked* — costs one line and cannot be invalidated by a change to either
format. It also documents itself at the exact place a future reader would
otherwise have to re-derive it.

## Honest weakness: the adoption race, narrowed and now self-repairing

The handshake still is not deterministic. Between `headsign claim` arming
the marker and the intended agent's own turn end, **another delegated
agent** can finish a turn first and be adopted instead. That window is
real and is named here rather than hidden behind the confirmation
message.

Two things changed about it, though, and the second matters more than the
first:

- The field of possible wrong winners shrank from "any session or agent
  sharing this run directory" to "another delegated agent that happens to
  end a turn in this window". The lead session — the wrong winner
  observed in practice, because a lead very often stops shortly after
  handing work off — is no longer eligible at all (Decision 1).
- **Retrying now converges on the right answer.** Under ADR-0009,
  re-running `headsign claim` from the intended teammate led to the same
  outcome as the first attempt, every time: that teammate's turn end
  fired nothing, so the marker waited for a session that *could* fire
  `Stop`, and the lead was seated again. The advice "a new claim always
  wins" was true about markers and false about outcomes. Here, the
  intended agent's own turn end is *guaranteed* to fire `SubagentStop`
  (fact 6) — so a re-claim from the right agent is not a retry of a
  coin flip, it is a step toward a fixed point that is correct by
  construction.

That is the difference between a race with a bias toward the wrong
result and a race whose loser can always fix it by trying again.

## Dependency risk: `agent_id` is not a public API

`SubagentStop`'s `agent_id` is undocumented in the same way
`CLAUDE_CODE_SESSION_ID` is (ADR-0008), and this decision is made with
that named rather than hidden. It is relied on because no public
equivalent exists, and because facts 2–4 rule out every alternative
source.

If a future Claude Code release stops supplying it, renames it, or
changes what it contains, the degradation is safe and quiet: step 6
resolves nothing, step 7 leaves the marker in place instead of adopting,
and a run therefore never acquires a `"claim"` driver. Ownership stays
whatever the env-based stamp produced, `Stop` keeps behaving exactly as
ADR-0008 describes, and the system falls back to nudging every stop on a
running run. That is the same direction ADR-0008 chose to degrade
toward — more nudges, never a wrong or silent one — so this decision
takes no version pin, no shim, and no detection beyond a plain
non-empty-string check.

If `SubagentStop` itself were to stop firing, the result is the
pre-ADR-0010 world: claims never seal, and delegated agents are not
nudged. Nothing wedges.

## Relationship to ADR-0009

This ADR **supersedes** ADR-0009. Everything ADR-0009 established about
*why* the CLI cannot name itself, why the procedure has two beats, why
the adoption gate must precede owner match, why the marker is one-shot
and consumed, why adoption is fail-open on an unresolvable identifier,
why claimed ownership is sticky against later env stamps, and why the
`claimed` log line carries no identifier — all of that is carried forward
here unchanged. What is superseded is narrow and total: the event that
seals, and therefore the kind of identifier that gets sealed.

ADR-0009's "Honest weakness" section is also superseded, and was, in
hindsight, an under-statement rather than an over-statement: it described
a narrow, self-repairing race, when the actual behavior in an agent-teams
process tree was a systematic hand-off to the wrong party that repeated
attempts could not correct. ADR-0009 carries a note to that effect.

## Consequences

- The plugin registers two hooks (`plugin/hooks/hooks.json`), and the CLI
  grows a second hidden subcommand, `subagent-stop-hook`, alongside
  `stop-hook` (ADR-0002). Both stay plumbing invoked by Claude Code, not
  part of the agent-facing command surface.
- `Stop` no longer has any branch that blocks except the nudge itself:
  ADR-0006's "new branches only ever let a session through" rule is
  restored for that hook, and the one deliberate exception to it — the
  block that confirms an adoption — now lives on `SubagentStop`, where it
  answers an agent that just ran `headsign claim` and was told to expect
  it.
- Delegated agents gain the backstop they never had: a delegated driver
  that stops mid-run is nudged on its own turn end, and the pause note
  and abort exits work identically from there.
- `headsign status` reports `driver: a delegated agent` for a claimed run
  (replacing ADR-0009's `claimed`). The CLI still cannot judge whether
  that agent is the caller — less than ever, now that the stored value is
  not even the same kind of name as anything the CLI can resolve — so it
  states the fact it has instead of guessing.
- `state.json` is unchanged in shape; `.headsign/log`'s `claimed` event
  is unchanged, including its empty detail field (ADR-0004). What the
  hidden `driver_session` value *is* changed; what any artifact looks like
  did not.
- **For a delegated agent, the nudge itself is the reliable test of "am I
  this run's driver".** `SubagentStop` holds an agent on a positive match
  with the stamped driver (Decision 3), so an ordinary nudge at a turn end
  is first-hand proof of ownership — delivered by the one party that can
  tell the actors apart, at the one moment it can. The test reads the
  *message*, not merely the fact of being held: the adoption gate also
  holds, and it holds whoever stops first under an armed marker without
  consulting the stamped driver at all, so a `Claim confirmed` reply to an
  agent that never ran `headsign claim` reports a seat taken, not a seat
  owned. Documentation offering this test has to say which reply counts. No
  command can offer the equivalent, because facts 2–4 are about what the
  CLI is able to read at all.

  The test is one-directional, and does not extend to `Stop`. A quiet turn
  end proves nothing: the nudge cap may have tripped, a pause note may have
  been consumed, or `HEADSIGN_OBSERVER` may be set — and a delegated agent
  that never claimed is passed by `driver_source !== "claim"` before its
  identity is ever considered. `Stop`'s owner check, meanwhile, rules a stop
  out on identifier grounds only when both identifiers resolve and disagree,
  so on a run with no stamped identifier it nudges every session in the
  directory (Decision 3's asymmetry, and ADR-0008's fail-open rule): being
  held there means the run is running, not that the holder owns it. Documentation that offers this test must carry the
  delegated-agent scope with it; stated bare, it is the same kind of
  overclaim as the `status` line this ADR's follow-up corrected.
- `headsign status`'s `driver:` line inherits that limit and is worded to
  admit it. While `driver_source` is `"env"`, the line is a comparison of
  environment-resolved session identifiers, and a delegated agent resolves
  the identifier of the session that spawned it (fact 2) — so a match
  narrows the driver to *that session or an agent it delegated to* and can
  go no further. Reported field experience was a delegated agent reading
  the older wording, `this session`, as confirmation that it held the run
  when the stamp in fact belonged to its parent. The line now states the
  boundary of what the comparison establishes rather than the stronger
  claim it cannot support.
- Having a hook write a whoami-style breadcrumb file — so a caller could
  read back which agent it is — was considered and rejected. For the only
  question that actually gets asked, *am I the driver of this run*, the
  nudge already answers it exactly, and a breadcrumb would buy that same
  answer at the price of another piece of state to write, keep fresh,
  invalidate, and clean up, in a project whose first rule is that a thin
  harness stores only what it needs to decide with (ADR-0001).
