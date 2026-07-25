# ADR-0006: Stop hook — the exit-note gate, with a nudge cap as safety net

- Status: accepted
- Date: 2026-07-23
- Revised: 2026-07-25 (exit-note gate replaces the bare nudge-count backstop
  as the primary mechanism; nudge cap demoted to a safety net, N raised
  3 → 5; two tree-hash-document misreadings fixed — see the end of this ADR;
  observer opt-out and driver owner-match added to the decision order —
  see ADR-0008; the claim-adoption gate added ahead of owner match, the one
  exception to this ADR's fail-open rule for new branches — see ADR-0009;
  that gate then **moved out of this hook entirely** onto a sibling
  `SubagentStop` hook, leaving `Stop` with no claim-related branch except
  an unconditional pass-through — see ADR-0010)

## Context

SKILL.md is instruction, not enforcement. The single hard guarantee —
"Claude does not silently stop mid-workflow" — is carried by one Stop hook.
Stop hooks fire on every session stop, including sessions that have nothing
to do with headsign, so the hook must be a near-no-op in the common case
and must never wedge a session.

### Three actors, one signal

A Stop-hook firing while a run is `running` can mean three different
things, and the original design (below, "the nudge-count backstop")
handled all three with the same one knob — a consecutive-block counter:

1. **A human deliberately pausing** — stepping away for the day, or
   context-switching to something else, with every intention of picking
   the run back up with `headsign next` later. This is the common case in
   practice, and it is entirely legitimate.
2. **An agent silently departing** — giving up, going off-script, or being
   interrupted by its own harness — without saying why, and without a
   human necessarily watching.
3. **A stuck loop** — the agent keeps trying `headsign next`-adjacent
   things but never a real gate evaluation, or is wedged in a way that
   nudging cannot fix.

Collapsing all three onto "how many times has this stopped in a row" left
three structural holes: (a) a deliberate pause and a silent departure are
indistinguishable in `state.json` — both just look like "blocked N times,
then let through"; (b) a silent departure leaves no trace once the nudges
run out — the log (ADR-0004) says nothing happened; (c) `stop_nudges` is a
raw counter with no expiry, so it can carry residue across a day boundary
— an agent that got nudged once late in the evening and returns fresh the
next morning starts already partway to the fail-open threshold, for a
reason that has nothing to do with the new day's behavior.

## Decision

**Make the exit condition an artifact.** Actor 1 (a deliberate pause) gets
a first-class, immediate way to say so: write one line of reason to
`.headsign/tmp/stop-note` and stop. The hook treats a non-empty note as a
deliberate, self-explaining pause — it passes immediately (no nudge
consumed, no waiting for a cap), leaves a `paused` line in the log so the
departure has a trace, and resets `stop_nudges` to 0 so the counter never
carries pause-residue into a later, unrelated stall. This is a recursive
application of the same idea the rest of headsign already runs on: *make
the boundary itself a deterministic gate*, the same way `next` turns "is
this phase done" into a shell exit code instead of an LLM's self-report.
Here, the Stop boundary's own question — "is this a deliberate pause or
something else?" — gets the same treatment: a file, not a feeling.

The nudge-count cap (originally the whole mechanism) is **demoted to a
safety net**: the case where even writing one line to a file didn't
happen — actor 3, a genuinely stuck loop, or a departure so abrupt no note
was left. It still exists because a hook that can block forever is a worse
failure mode than a hook that occasionally lets a stuck session go, but it
is now the fallback, not the primary path, and its threshold (`N=5`,
raised from `N=3`) is an arbitrary safety value, not a principled number —
there is no formula behind it, it is just "enough nudges that a
functioning agent has had several real chances to respond, not so many
that a stuck session drags on."

The hook is the hidden `stop-hook` subcommand of the bundled CLI (single
artifact, no second file to keep in sync). Logic, in order:

1. **Observer opt-out.** If `isObserver(env)` (`HEADSIGN_OBSERVER` set to
   any non-empty value) → **exit 0**, immediately, before stdin is even
   parsed. This check needs neither stdin nor `.headsign/state.json`, so a
   session that has opted out costs nothing to recognize (ADR-0008).
2. Read and parse the hook JSON from stdin — the payload carrying `cwd`,
   `session_id`, and `stop_hook_active`. This happens before locating state
   because the walk-up below needs the payload's `cwd`, not the checks
   further down that read `session_id`/`stop_hook_active` off the same
   already-parsed object.
3. Locate `.headsign/state.json` by walking up from the parsed payload's
   `cwd` (falling back to the invocation cwd if that field is absent),
   bounded by the enclosing git worktree/repo root (see "Bounded walk-up"
   below). If none is found → **exit 0**, immediately. This early return is
   written first among the state-dependent checks: sessions not using
   headsign must pay nothing.
4. If `stop_hook_active` is true → **exit 0**. (Legacy field: "Claude is
   already continuing as a result of a stop hook". Honored when present;
   see loop guard below for why we do not rely on it.)
5. If state parses and `status == "running"`:
   1. **Claimed-run pass-through (ADR-0010).** If `state.driver_source`
      is exactly `"claim"` → **exit 0**. The stored `driver_session` is
      then an *agent* id sealed by the `SubagentStop` hook, and a `Stop`
      firing carries a session id: this session is, by construction, not
      the driver, so the comparison in step 5.2 is not merely doomed but
      meaningless. `Stop` does not read, consume, or act on
      `.headsign/tmp/claim` at all — the adoption gate ADR-0009 placed
      here moved to the sibling hook (see "The `SubagentStop` sibling",
      below).
   2. **Owner match.** `hookSid` = the stdin payload's `session_id`
      (non-empty after `trim()`), falling back to `HEADSIGN_SESSION_ID`
      from env if stdin didn't carry one; `driver` = `state.driver_session`
      (valid only as a non-empty string). If **both** resolve and
      disagree → **exit 0** immediately: no state write, the stop-note (if
      any) is left unconsumed, no output at all. If either side is
      unresolved, skip this check and fall through unchanged — the same
      fail-open direction as everything else in this list: a new way to
      pass a session through, never a new way to block one (ADR-0008; see
      "Why owner match precedes the exit-note gate", directly below, for
      why this must run before step 5.3).
   3. **Exit-note gate.** Read `<runDir>/.headsign/tmp/stop-note`. If it
      exists and is non-empty after `trim()`: take its first line
      (trimmed, truncated to 120 characters), **delete the note**, reset
      `state.stop_nudges` to 0, append a `paused` line to `.headsign/log`
      (ADR-0004), and **exit 0**. An absent note, or one that is empty or
      whitespace-only after trimming, is treated exactly like "no note" —
      it falls through to the nudge flow below.
   4. **Nudge / loop-guard fallback.** If `state.stop_nudges >= 5` →
      **exit 0** (see "the safety-net loop guard", below). Else increment
      `state.stop_nudges`, persist it, and if that increment just reached
      5, append a `stalled` line to `.headsign/log`. Either way, **exit 2**
      with stderr naming both remaining exits — `headsign next` to keep
      going, the stop-note to pause, `headsign abort <reason>` to end for
      good — and, only on the nudge that reaches 5, appending "This is the
      final automatic reminder." right after the verdict sentence.
6. Any other status (`complete` / `escalated` / `aborted`) → **exit 0**.
   Escalated and aborted are *correct* endings — they mean "hand back to
   the human", and blocking them would defeat their purpose.
7. Any error (unreadable state, bad JSON) → **exit 0**. Fail open: a
   corrupt state file must never trap the user in a session that cannot
   stop.

### The `SubagentStop` sibling

A delegated agent — a teammate under Claude Code's agent-teams feature,
or a subagent — **does not fire this hook when its turn ends**; it fires
`SubagentStop` instead (measured; see
[ADR-0010](0010-subagent-stop-identity.md)). Everything above therefore
describes the backstop for *sessions* only. A second hidden subcommand,
`subagent-stop-hook`, runs a sibling evaluation of the same shape, over
the same helpers — observer opt-out, `stop_hook_active`, the bounded
walk-up, the exit-note gate, the nudge cap and its shared `stop_nudges`
counter all behave identically — with two differences:

- Its identifier is the payload's `agent_id`, not `session_id`, and it
  has no env fallback: the environment a delegated agent sees belongs to
  the session that spawned it, so there is nothing there to fall back
  *to*.
- Where this hook now has the claimed-run pass-through (step 5.1), the
  sibling has the adoption gate ADR-0009 wrote and this ADR used to
  host — marker present plus a resolved agent id → adopt, seal
  `driver_session`/`driver_source`, log `claimed`, and block with the
  confirmation. Marker present but no agent id → leave the marker, fall
  through. Its own owner match then passes through on
  `driver_source !== "claim"` as well as on a confirmed different agent,
  so an unrelated subagent's stop is never held *by the owner match*; the
  adoption gate above is the one exception, and holds by design.

**Why the adoption gate still precedes owner match** (it does, in the
sibling): a `.headsign/tmp/claim` marker means someone is *in the middle
of* being adopted, and `state.driver_session` at that moment is whatever
it was *before* — very possibly a stale value the claimant disagrees
with. Had owner match run first, the claimant's own stop would be read as
a confirmed mismatch against that stale stamp and waved through, the
marker would never be consumed, and the handshake would never complete:
the one agent `headsign claim` was trying to hand ownership to would look
to the hook exactly like a bystander. Adoption first intercepts that
case — a claim in progress is resolved before any comparison against the
very stamp the claim exists to replace.

**The fail-open exception moved with the gate.** Blocking on a resolved
claim is still the one branch in either hook that departs from this ADR's
"new branches only ever let a stop through" rule, and it is still narrow
and deliberate: it is not aimed at a bystander guessing wrong about
whether it drives, it is the direct, requested answer to an agent that
just ran `headsign claim` and was told, in that command's own output, to
expect exactly this confirmation. What changed is only where it lives.
`Stop` itself is now back to blocking for exactly one reason — the nudge.
See ADR-0010 for the full sibling design, the measurements behind it, and
the honest limits that remain (the adoption race, narrowed).

### Why owner match precedes the exit-note gate

The exit-note gate (step 5.3) treats `.headsign/tmp/stop-note` as a
one-shot resource: the first stop to find it non-empty consumes (deletes)
it and passes. Had a bystander's stop been able to reach that gate before
ownership was checked, an observer's completely unrelated turn-ending
could read and delete a note the *driver* wrote to pause deliberately — the
driver's own next stop would then find no note, fall through to the nudge
path, and either get nudged for a pause it already declared, or contribute
to exhausting the nudge cap for a stall that never happened. Running owner
match first means only a stop that is either the driver's, or one the hook
cannot rule out as the driver's, ever reaches the note at all — a bystander
whose identity is confirmed is waved through a step earlier and never
touches it. See ADR-0008 for the full multi-session design this step
belongs to.

### Why the note must be consumed

The note is deleted the moment it is read as a pause signal, not left in
place. If it weren't consumed, writing it once would be a permanent free
pass: every future stop, forever, would find the same note still sitting
there and pause without ever nudging again — silently disabling the
backstop for the rest of the run. That is exactly the staleness bug a
stale cached verdict would be (ADR-0004's tree-hash cache exists to avoid
the analogous problem for gate re-evaluation): a signal that was true once
must not be read as still true indefinitely. Consumption is what makes the
note mean "I am pausing *now*", not "I paused once, a while back".

### Net-zero tree change, cache intact

Writing the note and then having the hook delete it returns
`.headsign/tmp/` — and therefore the working tree, since `.headsign/tmp/`
is inside the tree-hash's watched set (ADR-0004) — to exactly what it was
before the pause: net zero. Nothing about the phase's last real evaluation
changed, so the tree-hash cache (ADR-0004's `shouldUseCache`) still
matches when work resumes. Concretely: pause today, run `headsign next`
tomorrow morning, and if nothing else changed in the meantime it reprints
the cached verdict — no attempt was burned by the act of pausing. This is
the same property the whole cache exists to protect: watching `next`
(here, watching *the ability to pause cleanly*) must not cost anything.

### The `paused` / `stalled` log events

ADR-0004 states the log records "transitions only" — `start`, `retry`,
`advance`, `complete`, `escalate`, `abort`, one line per real evaluation.
This ADR adds an explicit, narrow exception: `paused` (exit-note consumed)
and `stalled` (the nudge cap trips) are not `step()` transitions, but they
are logged anyway because they are the *only* record a departure of type 1
or type 3 (above) leaves behind. Both are deliberately rare by
construction — `paused` fires once per note write-and-consume cycle,
`stalled` fires exactly once per cap-trip (the 1st-through-4th nudge, and
every pass-through after the cap has tripped, stay silent) — so this stays
a targeted exception, not a reopening of "log everything the hook
touches". See ADR-0004 for the line format
(`<ts> paused <phase> a=<n> i=<n> note="<first line>"` /
`<ts> stalled <phase> a=<n> i=<n> nudges=5`).

A third hook-boundary event, `claimed`, joins this exception list by
ADR-0009's claim handshake — logged once per adoption, with an empty
detail field (no identifier). It belongs to the adoption gate, which
since ADR-0010 lives in the `SubagentStop` sibling rather than in this
hook, not to the exit-note gate or the nudge cap this ADR owns, so its
full design lives in ADR-0009/ADR-0010 and ADR-0004; it is named here
only so this section's "two events" does not read as still current.
`paused` and `stalled` themselves can now be appended by either hook —
whichever one is evaluating the actual driver's stop.

### The safety-net loop guard (`stop_nudges`)

As of 2026-07-23 the official hooks documentation no longer documents
`stop_hook_active`, and documents no other mechanism preventing a Stop
hook from blocking forever. Rather than bet the worst failure mode (an
unstoppable session) on an undocumented field, headsign owns its guard:

- state carries `stop_nudges` (int). The hook increments it on every block
  that isn't resolved by a note.
- `headsign next` resets it to 0 whenever it **really evaluates** a gate
  (a cached "tree unchanged" reprint does not reset — no work happened).
  `headsign start` initializes it to 0. The exit-note gate resets it too
  (above) — a deliberate pause is not evidence of a stuck loop, so it must
  not leave residue behind for a later, unrelated stall to inherit.
- A PENDING answer (ADR-0002) does not reset it either — a `ready:` probe
  that hasn't passed yet is not an evaluation, and treating it as one would
  let a review that never returns a verdict still rack up nudges and
  reach the hook's fail-open, silently giving up the one guarantee this
  ADR exists to provide.
- The hook refuses to block once `stop_nudges` reaches 5.

Effect: as long as Claude responds to nudges by actually working, or pauses
cleanly with a note, the backstop keeps nudging indefinitely (real
evaluations and note-based pauses both reset the counter, and runaway
loops terminate through `max_attempts` / `max_total_iterations` →
escalated, which the hook lets pass). But if five consecutive nudges
produce no gate evaluation and no note at all, the session is wedged in a
way more nudging cannot fix — fail open, leave the `stalled` line as
evidence, and hand it to the human. Because the note-based exit resets the
counter, a night of one-off pauses does not quietly erode tomorrow's
budget the way a bare counter without an expiry would — the residue
problem the three-actor analysis identified above is mitigated exactly at
the boundary where a real pause is distinguished from a real stall.

Hook exit-code facts this depends on (verified against docs 2026-07-23):
blocking requires exit 2 specifically (other non-zero codes are
non-blocking errors); on exit 2 for a Stop hook, stderr is fed back to
Claude as the reason to continue.

## Consequences

- Guarantee holds even if Claude never reads SKILL.md.
- A user who genuinely wants out mid-run has three clean exits, named on
  every block: pause with a stop-note (resumable, immediate, logged), have
  Claude run `headsign abort <reason>` (permanent), or delete
  `.headsign/state.json` (permanent, unlogged, last resort).
- "Hook never interferes with normal sessions" is carried entirely by step
  3, and covered by `tests/acceptance.test.ts`'s test titled "stop-hook: a
  directory that has never used headsign exits 0".
- **Detecting an unattended stall from the outside** (e.g. a monitoring
  agent, not the one that was working): if `status` is `"running"` and the
  log's tail shows a `stalled` line (equivalently, `stop_nudges >= 5`),
  the working agent has walked away without a note; re-drive the run with
  `headsign next`.

### Bounded walk-up (the hook's one exception to cwd-only)

Unlike the rest of headsign (see ADR-0004's resolution contract), the hook
does not stop at a bare cwd-only lookup. It reads the session's cwd from
the Stop-hook stdin `cwd` field (falling back to the invocation cwd if that
field is absent), then walks up from there looking for
`.headsign/state.json`, bounded by the enclosing git worktree/repo root:
the walk stops at the first directory containing a `.git` entry — a
directory in a normal checkout, a *file* in a linked worktree — whether or
not a run is found there. This lets the backstop fire from any
subdirectory of the run's project, while never crossing into a sibling or
parent checkout's run, preserving the git-worktree parallel-run
independence ADR-0004 exists to protect. The walk is fs-only (`existsSync`
calls up the path, no `git` subprocess), so it stays the near-no-op step 3
requires. The exit-note gate and the note path shown in the block message
both operate on the *found* run directory (`runDir`), not the session's
own cwd (`startDir`) — when they differ, the message shows
`<runDir>/.headsign/tmp/stop-note` (and keeps the existing "cd there"
guidance) rather than the plain relative form, so the human or agent
writing the note knows exactly where to put it.

Residual limitation, by design and not a bug: if a run's `.headsign/`
lives outside the current `.git` root — cwd has been `cd`'d past the repo
boundary, or the run's `.headsign/` genuinely lives elsewhere — the hook
still won't find it and exits 0.

Equally by design, the walk only ever goes up: if the session's cwd sits
*above* the run's directory — a monorepo root, with the run's `.headsign/`
in a package below — walk-up never descends to it, so the hook finds no run
and exits 0. Keep the session in the directory that owns the workflow, or
below it, for the backstop to fire.

This walk-up is hook-only. `next`, `start`, and `abort` remain strictly
cwd-only, exactly as ADR-0004 describes; they still error with "no run in
progress here" if invoked from the wrong directory.

## Superseded text (kept for history)

The original (2026-07-23) version of this ADR described a bare
nudge-count backstop with `N=3` as the sole mechanism, and no note-based
pause. That text is fully replaced by the Decision section above; this
note exists only so a reader following an old link understands what
changed and why (see "Three actors, one signal", above, for the "why").

## Misreadings fixed in the tree-hash documents (2026-07-25)

An external review of ADR-0004 and SKILL.md's tree-hash notes surfaced two
places where the prose read more ambiguously than the code behaves:

1. **What the tree-hash actually watches inside `.headsign/`.** The
   caveat about gitignored files not being watched applies only to files
   *outside* `.headsign/`. Everything under `.headsign/` (including
   `tmp/`, and by extension the exit-note gate's `stop-note`) is always
   part of the tree-hash fingerprint regardless of `.gitignore`, per
   ADR-0004's `headsignEntries`; only `state.json`, `lock`, and `log`
   are excluded, and for the unrelated reason that headsign itself
   rewrites them (see ADR-0004). A verdict, or a stop-note, written under
   `.headsign/tmp/` is therefore always detected — this is also why the
   pause-then-resume flow above reliably lands on a cache hit instead of
   an accidental cache miss.
2. **`touch` is not a free retry.** Touching a tracked file to force
   re-evaluation (SKILL.md's advice for a stale-looking cache) forces the
   *evaluation* to happen again, not a free pass on its outcome — if the
   gate still fails, that is a real, counted attempt against
   `max_attempts`, exactly as a from-scratch failure would be.
