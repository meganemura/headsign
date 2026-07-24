# ADR-0006: Stop hook — the one guarantee

- Status: accepted
- Date: 2026-07-23

## Context

SKILL.md is instruction, not enforcement. The single hard guarantee —
"Claude does not silently stop mid-workflow" — is carried by one Stop hook.
Stop hooks fire on every session stop, including sessions that have nothing
to do with headsign, so the hook must be a near-no-op in the common case
and must never wedge a session.

## Decision

The hook is the hidden `stop-hook` subcommand of the bundled CLI (single
artifact, no second file to keep in sync). Logic, in order:

1. Locate `.headsign/state.json` by walking up from the session's cwd,
   bounded by the enclosing git worktree/repo root (see "Bounded walk-up"
   below). If none is found → **exit 0**, immediately. This early return is
   written first: sessions not using headsign must pay nothing.
2. Read hook JSON from stdin. If `stop_hook_active` is true → **exit 0**.
   (Legacy field: "Claude is already continuing as a result of a stop
   hook". Honored when present; see loop guard below for why we do not
   rely on it.)
3. If state parses and `status == "running"`:
   - If `state.stop_nudges >= 3` → **exit 0** (loop guard, below).
   - Else increment `state.stop_nudges`, persist, and **exit 2** with
     stderr: "headsign workflow '<name>' is still running (phase: <p>).
     Run `headsign next` and follow its verdict."
4. Any other status (`complete` / `escalated` / `aborted`) → **exit 0**.
   Escalated and aborted are *correct* endings — they mean "hand back to
   the human", and blocking them would defeat their purpose.
5. Any error (unreadable state, bad JSON) → **exit 0**. Fail open: a
   corrupt state file must never trap the user in a session that cannot
   stop.

### The self-owned loop guard (`stop_nudges`)

As of 2026-07-23 the official hooks documentation no longer documents
`stop_hook_active`, and documents no other mechanism preventing a Stop
hook from blocking forever. Rather than bet the worst failure mode (an
unstoppable session) on an undocumented field, headsign owns its guard:

- state carries `stop_nudges` (int). The hook increments it on every block.
- `headsign next` resets it to 0 whenever it **really evaluates** a gate
  (a cached "tree unchanged" reprint does not reset — no work happened).
  `headsign start` initializes it to 0.
- A PENDING answer (ADR-0002) does not reset it either — a `ready:` probe
  that hasn't passed yet is not an evaluation, and treating it as one would
  let a review that never returns a verdict still rack up three nudges and
  reach the hook's fail-open, silently giving up the one guarantee this
  ADR exists to provide.
- The hook refuses to block once `stop_nudges` reaches 3.

Effect: as long as Claude responds to nudges by actually working, the
backstop keeps nudging indefinitely (real evaluations reset the counter,
and runaway loops terminate through `max_attempts` /
`max_total_iterations` → escalated, which the hook lets pass). But if
three consecutive nudges produce no gate evaluation at all, the session is
wedged in a way more nudging cannot fix — fail open and hand it to the
human.

Hook exit-code facts this depends on (verified against docs 2026-07-23):
blocking requires exit 2 specifically (other non-zero codes are
non-blocking errors); on exit 2 for a Stop hook, stderr is fed back to
Claude as the reason to continue.

## Consequences

- Guarantee holds even if Claude never reads SKILL.md.
- A user who genuinely wants out mid-run has two clean exits: have Claude
  run `headsign abort <reason>`, or delete `.headsign/state.json`.
- "Hook never interferes with normal sessions" is carried entirely by step
  2, and covered by `tests/acceptance.test.ts`'s test titled "stop-hook: a
  directory that has never used headsign exits 0".

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
calls up the path, no `git` subprocess), so it stays the near-no-op step 1
requires.

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
