# ADR-0026: Giving the quiet stop a second place to look

- Status: accepted
- Date: 2026-08-01
- Amends [ADR-0025](0025-a-stop-that-passed-and-a-stop-that-never-ran.md):
  `unheld`'s log detail gains a second value, `by=CLAUDE_PROJECT_DIR`,
  alongside `by=stop_hook_active`; `state.json`'s `last_stop` carries which of
  the two caused a given stop, not only the disposition; and the `status`
  wording for `unheld` splits by cause instead of hardcoding one.
- Amends [ADR-0006](0006-stop-hook-backstop.md) in three places: the bounded
  walk-up's residual-limitation paragraph now names the second walk it
  gained; the paragraph that called a stable second starting point "a
  question … not answered here" is answered; and the count "three of the
  four facts are load-bearing" becomes four, because the fourth — the hook
  process's own `PWD` — is now the refused alternative and carries the
  argument for refusing it.

## Context

headsign's two stop-boundary hooks (ADR-0006) find the run they are
evaluating by walking up from the directory a turn ended in, stopping at the
first enclosing `.git`. A session whose directory has drifted outside that
run's tree — `cd`'d past the boundary, or started somewhere else entirely —
finds nothing there, and the hook returns having written **nothing at all**:
no log line, no `last_stop`. From outside, that is indistinguishable from a
hook that never ran, a plugin that failed to install, or a `node` that could
not start. A report described exactly that: a turn ended, nothing nudged it,
and there was no way to tell which of those had happened.

ADR-0006 already named this branch and refused two remedies for it: widening
the walk (which would cross the worktree boundary the walk exists to
respect), and signalling loudly from a place the walk cannot reach (which
would be noise in every session on the machine, to catch one). What it left
open was a third kind of remedy — a second place to look, tried only where
the first comes up empty — and named the one thing that would make it
possible: "a signal from the harness naming the project a session belongs
to, independently of where its shell has wandered." This ADR is that
remedy.

## Decision

### 1. The hook gains a second starting point, and it records without holding

When the walk from the session's own directory finds nothing, the hook tries
once more from a second starting point. Found there, it writes one line and
returns — it does not hold the turn.

This answers two questions that are independent rather than one that is a
spectrum: *is the turn held*, and *is it recorded*. The report asked for a
point on only the second axis — it wanted a trace, not to be stopped — so
recording without holding is not a compromise between doing nothing and
doing everything; it is the thing that was asked for.

Holding is refused on its own terms. `Stop` has no exception to ADR-0006's
fail-open rule today — the one exception that ever existed moved to
`SubagentStop` with ADR-0010 — so holding on a guessed run would be its
first. And the hook cannot tell a session that stepped out for one command
from one that has legitimately moved on for the day: the benefit of holding
lands on the first, the false alarms land on the second, and this change is
for the first only.

Recording is a different kind of cost, and a small one. This path only runs
when the second starting point *did* find a run, so there is a
`.headsign/log` to append to and a `last_stop` to stamp, exactly as on every
other path that writes. It is not the volume problem ADR-0006 refused when
it declined to signal from the fully-silent branch — that branch fires in
every session on the machine, including ones that have never heard of
headsign. This one fires only where a run was actually found.

### 2. The second starting point is `CLAUDE_PROJECT_DIR`, not a variable headsign owns

Claude Code sets `CLAUDE_PROJECT_DIR` to the session's project root, and the
hook reads it. Nothing changes about how environment reaches this code:
`stophook.ts` already takes `env` as an argument — the shape `render.ts` and
`engine.ts` also use — and this reads one more key off the same object.

**Rejected: a variable headsign names and owns**, the shape
`HEADSIGN_OBSERVER` already uses. Refused on reach, not on correctness — the
two are a wash, since a directory can be misconfigured under either name.
The difference is who has to act: a headsign-owned variable is an absolute
path, which cannot be committed with the project, so every person on every
machine would have to set it by hand, in advance, for a hazard they have not
yet met. A fix that only reaches someone who already knows about the gap
does not reach the next person, and the next person is the point.

**Rejected: the hook's own working directory (`process.cwd()`)**, already an
argument to the function and thrown away on every real invocation —
`cli.ts` passes it in, `stophook.ts` falls back to it only when the payload
omits `cwd`, and ADR-0006's own measurements record it as the project root
in all four observed hook runs. It needs no variable at all, which makes it
the cheaper choice on paper. It is refused anyway, because nothing documents
what a hook's own working directory *is*: an observed regularity with no
documentation behind it is the exact shape of the `stop_hook_active` mistake
ADR-0006 exists to avoid repeating. `CLAUDE_PROJECT_DIR` is documented; a
hook's own `PWD` is not.

### 3. Every record that rests on the variable says so

A stop resolved by `CLAUDE_PROJECT_DIR` writes `by=CLAUDE_PROJECT_DIR` in the
log line's detail slot, the way the existing `unheld` line already carries
`by=stop_hook_active` — the slot's rule (`render.ts:352`) is to name the
upstream token verbatim, so one string reads the same from the log line
through headsign's source to something a person can print themselves.

This is load-bearing, not decoration, and the reason is specific to this one
dependency. Of everything headsign trusts Claude Code for, `CLAUDE_PROJECT_DIR`
is the only one that can be *wrong while headsign still appears to be
working*: a missing `${CLAUDE_PLUGIN_ROOT}` means nothing runs at all, a
missing `stop_hook_active` strands a session visibly, and an absent
`CLAUDE_PROJECT_DIR` just means the fallback never fires and nothing is
lost — all three announce themselves, one way or another. Present but naming
the wrong project announces nothing: the log fills in, `status` reports a
stop, and every one of those facts is about the wrong run. The mark is what
turns that quiet wrongness into something a reader can see and discount.

### 4. The second starting point is consulted only after the first walk finds nothing

**Rejected: consulting `CLAUDE_PROJECT_DIR` first**, which is the tidier
rule and would fix something real: a session driving run A while standing in
repository B, which has its own run, is nudged about B today — an existing,
undocumented ambiguity this change does not touch (see "What is deliberately
not being done", below). Root-first is refused because `CLAUDE_PROJECT_DIR`
names a root and the walk from it only goes up, so it cannot see a run
*below* that root. headsign's own fan-out example creates children with
`git worktree add .worktrees/<item>`, and `git worktree add ../wt-feature`
is equally ordinary; under root-first, a session working in either child
would have every stop attributed to the parent's run instead of its own.
Counting the conditions decides it: what root-first fixes needs three things
at once (a second allowed directory, that directory being a separate
checkout, that checkout also running headsign); what it breaks needs one (a
session working in a worktree of its own project).

After-ordering buys a narrower, checkable property instead: every case that
produces a nudge today produces the same nudge, and every case that writes a
line today writes the same line. The fallback only replaces the branch that
today writes nothing.

**Rejected: refusing to act when the two disagree**, which "do not proceed
through ambiguity" might seem to recommend. In the fan-out arrangement the
two disagree on every turn by design — a child worktree's cwd names the
child, its `CLAUDE_PROJECT_DIR` names the parent — so refusing on
disagreement would refuse permanently in the setup that most needs a
backstop. That rule is about not inventing an answer where none is
declared; here the cwd walk declares one, and always has.

### 5. On the fallback path, every free check still runs and nothing else does

On the branch that today returns having found nothing, the fallback now:
reads the record, confirms `status === "running"`, confirms the stop could
belong to this run (the recorded-driver test for `Stop`, the driver match
for `SubagentStop`) — then writes one line and returns. It never opens the
pause note, never touches the claim marker, never increments
`stop_nudges`, and never reads `stop_hook_active`.

The line is the one `stophook.ts:317` already draws for its own reordering:
everything read-only is free, and cost begins the moment the pause note is
opened. Skipping `stop_hook_active` is not an oversight — on a path that can
never block, both of that flag's guarantees (never held, never spends a
one-shot resource) already hold by construction, so the flag has nothing
left to decide.

The driver check is kept even though its usual reason — keep a bystander
from consuming the driver's pause note — does not apply to a path that
consumes nothing. It survives on a second reason: a claimed run's driver is
an agent, and `Stop` is a session's turn ending, so on a claimed run a
fallback stop is a *certain* bystander, and `last_stop` holds only the most
recent stop — writing here would overwrite the record with the most to
lose.

**Rejected: reporting what would have happened** — "this would have been a
pause", "this would have been reminder 3 of 5". The pause version cannot be
known without opening the note, which the design above already refuses to
do. The other two are technically legal — the nudge count can be read
without incrementing it, the claim marker tested without consuming it — and
are refused anyway: every other event word the log holds records something
that happened, and a log where most lines mean *this happened* and one means
*this would have* cannot be read at a glance, which is the only thing this
new line is for.

### 6. The line reuses `unheld`, with a second cause

`unheld` already means "headsign saw this stop and deliberately did not hold
it"; a fallback stop is exactly that, so it gets the same word rather than a
fifth disposition. **Rejected: a new disposition word** — every candidate
("elsewhere", "unlocated") names where the *session* was, and that is the
detail slot's subject, not the disposition's.

What the detail slot already had to say — `by=stop_hook_active` — was
hardcoded into `LAST_STOP_WORDING`'s `unheld` sentence, so `status` could
report "not held — Claude Code had already resumed the turn" without asking
which cause it was; there was only one. Splitting the cause means
`last_stop` in `state.json` has to carry it too, not only the disposition —
otherwise `status` would describe a fallback stop as something Claude Code
did, when it is something headsign found on its own second try. This is a
state-shape consequence of the decision above, not a separate one: once
`unheld` has two causes, the record has to be able to say which.

### 7. The variable may never become something headsign guarantees on

> Never let a Claude Code value decide whether headsign's records are right
> while headsign still appears to be working.

This is narrower than it could have been written. "Never let a Claude Code
value be load-bearing for a guarantee" is already false of this codebase:
the entire backstop is load-bearing on `${CLAUDE_PLUGIN_ROOT}` resolving in
`plugin/hooks/hooks.json`, without which the hook does not run at all. What
makes `${CLAUDE_PLUGIN_ROOT}` safe to depend on and `CLAUDE_PROJECT_DIR`
different is not the data type — both are paths — but how a failure
announces itself. `${CLAUDE_PLUGIN_ROOT}` failing is total and immediate;
`stop_hook_active` failing strands a session visibly; `CLAUDE_PROJECT_DIR`
*absent* costs nothing, since the fallback simply never fires. Only
`CLAUDE_PROJECT_DIR` *present and naming the wrong project* is a failure
that announces nothing on its own — headsign keeps working, and is quietly
wrong about which run it wrote to.

The design pays the rule above by construction rather than by promise:
`CLAUDE_PROJECT_DIR` is consulted only after the first walk finds nothing,
never holds a turn, spends none of the run's one-shot resources, and marks
every line it produces (§3). The worst a wrong value can do under this
design is put one correctly-labelled line in one run's log.

The fact this whole design rests on — that `CLAUDE_PROJECT_DIR` is present
in a real hook's environment and holds the project root — was measured, not
assumed, and the four observations behind it, along with the rule for
deciding when a fact like this needs measuring at all, are recorded in
[ADR-0006](0006-stop-hook-backstop.md)'s bounded walk-up section rather than
repeated here.

## What is deliberately not being done

- **Holding a turn on the fallback path** — refused in §1, for the fail-open
  reasons ADR-0006 already gives.
- **Fixing the shipped ambiguity this change extends.** A session driving
  run A while standing in repository B, which has its own run, is nudged
  about B today — undocumented, and the same species of wrongness this ADR
  is otherwise careful about. This change extends that ambiguity by exactly
  one case (§4) rather than introducing it, and resolves neither the old
  case nor the new one. It is now written down — in the reference manual,
  the `workflow` skill, and the diagnostic checklist — rather than left to
  be rediscovered, and it needs a decision of its own.
- **Reporting what would have happened** on the fallback path — refused in
  §5.
- **A headsign-owned environment variable**, and **the hook's own working
  directory**, as the second starting point — both refused in §2.

## Consequences

- The `unheld` disposition now has two shipped causes, and every place that
  prints or logs it has to say which: `render.ts`'s `logDetail`,
  `LAST_STOP_WORDING`, and `state.json`'s `last_stop`.
- The residual limitation ADR-0006 already named — a run whose `.headsign/`
  lives outside the current `.git` root goes unfound and unrecorded — is
  narrower, not gone. `CLAUDE_PROJECT_DIR` names a root, and this second
  walk, like the first, only goes up from it, so a run held *below* that
  root (a package, a worktree added outside the checkout) is still
  unreached, and a session whose own project genuinely has no run stays
  exactly as silent as before.
- The documents that described the old, fully-silent shape of this gap —
  the `workflow` skill, both reference manuals, and
  `.headsign/notes/unexplained-quiet-stop-checklist.md` — now say a drifted
  session leaves a line, and where to find it, while keeping the residual
  silence and the shipped neighbour-run ambiguity written down rather than
  implied fixed.
- `docs/workflow-reference.md`'s environment-variable table gains a second
  row, `CLAUDE_PROJECT_DIR`, read only by the stop-boundary hooks and only
  on the branch that today writes nothing.
