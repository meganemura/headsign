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

1. If `.headsign/state.json` does not exist in cwd → **exit 0**, immediately.
   This early return is written first: sessions not using headsign must pay
   nothing.
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
- Acceptance scenario 7 ("hook never interferes with normal sessions") is
  carried entirely by step 2.
