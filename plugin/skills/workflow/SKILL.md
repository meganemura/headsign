---
name: workflow
license: MIT
description: >-
  Drive a headsign phase-gate workflow. Use when the repository has a
  .headsign/ directory holding one or more workflow files — workflow.yaml, or
  named ones like fitness.yaml run with `headsign start fitness` — and the
  user asks to start, continue, or resume a run, or when .headsign/state.json
  shows a run in progress (e.g. when recovering after compaction). Do not use
  in repositories that have no .headsign directory.
---

# headsign workflow

headsign is a phase gate: you do the work, deterministic shell checks decide
the phase transitions. You never judge for yourself whether a phase is done —
the gate does.

When this skill runs inside its Claude Code plugin, the CLI is bundled with
it and no install is needed. `headsign <cmd>` below means:

```
node "${CLAUDE_SKILL_DIR}/../../dist/headsign.mjs" <cmd>
```

(A PATH-installed `headsign` works too, and so does `npx headsign` once the
package is installed. Check which you have before reaching for either —
`command -v headsign` names a PATH copy if one exists. **`npx headsign` with
nothing installed does not fail; it installs from the registry**, at a version
npm chooses rather than the one this plugin ships, and that copy will read and
write the same `.headsign/state.json` the bundled one has been driving.)

If the bundled path above does not exist, this file is a copy running
outside its plugin (e.g. placed in `.claude/skills/`) — the bundle only
ships with the plugin. Use a PATH-installed `headsign`, or `npx headsign`
on the terms above; otherwise stop and tell the user to either install the
plugin or `npm install` the package. Do not guess at other paths.

## The discipline

1. **First, check whether this session is the driver.** If this session did
   not run `headsign start`, and hasn't been explicitly asked (by the user,
   or by the session that did) to continue an existing run — do not run
   `headsign next` or `headsign abort`. A repository can have more than one
   Claude Code session open on it at once (a lead plus teammates, or a
   subagent working alongside the session that spawned it), and only the
   one driving the run should touch it: obeying a nudge you weren't meant to
   answer can burn a retry or advance a phase nobody asked you to touch.
   Want to know what's happening without touching anything? Run `headsign
   status` — it's read-only, and safe to call at any time.
2. **If you are a delegated agent and were entrusted with driving a run,
   claim it first — don't just start calling `next`.** This applies when
   you are a teammate (Claude Code's agent-teams feature) or a subagent:
   you share the spawning session's process and environment, so no command
   you run can say who you are, and `headsign next` records no driver at
   all. Instead: run `headsign claim`, then end your turn. The seal happens
   at your own turn end — that is the only moment headsign can learn which
   delegated agent you are — and the hook confirms it in its message,
   naming the workflow and phase. **Do not run `headsign next` before you
   have seen that confirmation.** If some other agent got adopted by
   mistake (it ended a turn while your marker was armed and could name
   itself), run `headsign claim` again from the agent that should be
   driving: a new claim re-arms the marker, and that agent is a real
   contender for it because its own turn end always fires the event that
   seals. Another agent naming itself first can take this marker too, so
   re-claim until the confirmation names the agent you meant. A session
   driving a run on its own does not need `claim` at all: `start` stamps it
   as the run's mover the moment the run begins, every `next` it runs
   re-stamps it, and while nobody has claimed the run the hook nudges that
   stamped session — exactly the backstop that session wants. A second
   session merely standing in the same directory, once the first has run
   `start` or `next`, is not nudged for a run it never touched — it does
   not learn a run is there by being nudged about it; a run with no session
   on record (one begun before this behavior shipped, one driven from a
   terminal rather than a session, or one whose state was hand-edited)
   still falls back to nudging whichever session stops there. Skipping the
   claim
   fails silently rather than loudly: the run stays unclaimed, so every
   later nudge goes to a *session* — usually the idle one that delegated to
   you — while nothing holds your own turns at all. (Nothing records them
   either: `unheld` is written only for a stop headsign can attribute, so an
   unclaimed run leaves no line for your turn ends.) And if you need to check whether
   you are the driver, don't read it off `headsign status` — it reports
   whether some delegated agent holds the run, never whether that agent is
   you. As a delegated agent, the reliable signal is the hook itself: if
   your turn ends are being pushed back to `headsign next`, this run is
   yours to drive. Read which message you got: an ordinary nudge fires only
   on a positive match, but `Claim confirmed …` means an armed marker just
   seated you — if you did not run `headsign claim`, you have taken a seat
   another agent was asking for, so say so and let it claim again. The test
   only works in this direction and only for delegated agents: ending
   quietly proves nothing (not having claimed, Claude Code's
   already-continuing flag, an exhausted nudge cap, a pause note,
   `HEADSIGN_OBSERVER`, a directory the walk-up resolved only via
   `CLAUDE_PROJECT_DIR`, or a run this session simply never touched while
   someone else was last recorded moving it, all end turns quietly), and a
   session gets nudged on any run nobody has claimed and nobody has yet
   moved, whether or not it is driving — once someone has moved it, only
   that session is. A nudge
   arrives roughly **once per exchange**, not once per turn end. When the
   hook holds a turn, Claude Code flags the continuation, so the ending of
   *that* turn passes quietly — recorded as an `unheld` line in
   `.headsign/log` and on `headsign status`'s `last stop:` line. The
   window is one turn wide and closes when the turn ends.
   A probe is not free either: one that comes back as an ordinary nudge
   spends one from the cap, one that passes while your own pause note is
   armed consumes the note, and one that lands under another agent's armed
   marker consumes that marker. Probe deliberately, not by habit.
3. To begin a workflow: `headsign start`, or `headsign start <name>` when
   `.headsign/` holds more than one — `<name>` is the file's basename, so
   `headsign start fitness` runs `.headsign/fitness.yaml`. Either way it
   prints the first phase's instructions. If `start` reports it cannot read
   `.headsign/workflow.yaml`, this repository names its workflows rather than
   keeping a default: list `.headsign/` and start the one you were asked for.
4. **When you have done work you think finishes the phase — or have just
   recovered from compaction and need to know where the run stands — run
   `headsign next` and obey the first-line token.** That one habit is the
   whole protocol. `next` is a judgment, not a peek: it runs the phase's
   gate, and a failure spends one of that phase's attempts. When you only
   want to look, run `headsign status` (rule 1) — it judges nothing and
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
   sent to is the one printed on line 1 — read the line, don't infer the
   move.
6. **Never end the run on your own judgment while the answer is anything
   other than `COMPLETE`.** If you are genuinely stuck — or the user asks to
   stop mid-run — record why with `headsign abort <reason>` and report to
   the user; that's a legitimate exit, but it's permanent: the run cannot be
   resumed, and a later `headsign start` rewrites `.headsign/state.json` whole.
   What it does not end is `.headsign/log`: the reason you type outlives the
   run, and so does everything logged before it. So ending a run deliberately
   costs the run, not its history. To *pause* rather than end — stepping away
   to resume later — write one line explaining why to
   `.headsign/tmp/stop-note` and stop again: the stop-boundary hook passes
   immediately, and `headsign next`
   picks the run back up later from the same phase. The hook consumes the
   note, so one note covers one turn end — if the wait runs over several
   exchanges, write it again before each turn that ends still waiting. `ESCALATE` means stop
   working and ask the user for direction. Two kinds of `ESCALATE` do not end
   the run, and both leave it `running` so the user can answer and have you
   continue from the same phase. One reads `max_total_iterations (<n>)
   reached`: the user can raise that limit. The other reads `the workflow's
   rules changed under this run` — the workflow file was edited while the run
   was walking it, which headsign allows but reports once; the user either
   puts the file back or tells you to run `headsign next` again, which accepts
   the change and counts it (the count is named at `COMPLETE`). If *you* made
   that edit, say so plainly when you report it. Report either one and wait for
   direction like any other escalation — but because the run is still open, the
   hook will push you back to `headsign next`, so write the pause note above
   before you stop.
7. If the current phase's gate reads a verdict file (a review phase), spawn
   a reviewer subagent restricted to read-only tools (Read/Grep/Glob) and
   have it REPORT exactly `APPROVED` or `REJECTED` (with reasons). Then
   *you* write that reported verdict, verbatim, to the verdict file and run
   `headsign next` — the reviewer stays unable to touch code or the
   verdict, so the judgment and the work stay separated.

## Notes

- A phase's printed instruction may tell you to use a specific skill or
  spawn a subagent — do what it says.
- `headsign start`/`next`/`abort`/`status`/`claim` operate on the current
  directory's `.headsign/` only — run them from the directory that owns the
  workflow (the repo or git-worktree root), not a subdirectory. Each git
  worktree is therefore its own independent run: its state lives in that
  worktree's `.headsign/`, and a run in another worktree of the same
  repository neither shares it nor sees it. The stop-boundary hooks are the
  exception, but a bounded one: they find the run from any subdirectory of it,
  so drift *inside* the repository is harmless. Drift *out* of it is narrower
  than it used to be. The walk up from the session's own directory still stops
  at the first enclosing `.git`; if that finds no run, the hook tries once
  more from Claude Code's `CLAUDE_PROJECT_DIR` — the project root, independent
  of where the session has wandered. Find a run there and the hook writes one
  line (`unheld`, detail `by=CLAUDE_PROJECT_DIR`) and `headsign status`'s
  `last stop:` line says so — the turn is never held on this path, only
  recorded. Find nothing there either — `CLAUDE_PROJECT_DIR` unset, or naming
  somewhere with no run — and the hook still writes nothing anywhere, exactly
  as before: on that turn's own evidence it looks like a backstop that is not
  installed. One case stays exactly as it was, and is worth naming because it
  is easy to mistake for the one this just fixed: if the checkout the session
  drifted into has its *own* run, the first walk finds that one and nudges
  about it — a real nudge, about the wrong run.
  Reaching another checkout takes more than a stray `cd`: Claude Code refuses to
  `cd` outside the session's allowed working directories. So this needs a session
  that has more than one — a second directory added when it started, or added
  later — and it is only a risk if yours does. If a turn ends unheld and you
  cannot say why, check `last stop:` for which of the two it names, and if
  this session works across more than one directory, check which one it was
  standing in.
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
- **You can write the workflow too, not just run it.** A workflow is one
  YAML file; `headsign validate --workflow <path>` checks it statically —
  no gate runs, no state is touched — so drafting or editing one is safe at
  any time. Errors (exit 3) must be fixed; warnings print to stderr and
  still exit 0, so a phase nothing routes to yet won't stop the run you are
  in. Two things a phase cannot declare: an environment (a check that needs
  a variable writes it into its own `run:` string, e.g. `run: "FOO=bar npm
  test"` — there is no `env:` field), and "end the run here" on failure
  (`on_fail` goes as far as `escalate`, which stops and asks a person, and
  exhausting `max_attempts` always escalates too). On macOS, `/bin/sh`
  (bash 3.2) can mangle a `run:` string where a variable is immediately
  followed by a non-ASCII character — not just Japanese text, any
  non-ASCII (accents, arrows, emoji) — by eating that character's leading
  byte and passing a corrupted string on. Brace the variable (`${var}`,
  not `$var`) whenever non-ASCII text directly follows it; text earlier
  in the string is unaffected, and so are `zsh`, `dash`, and `LC_ALL=C`.
- **The schema is closed: a key it doesn't define is an error.** `validate`
  rejects any unknown key at any level and prints what that level allows —
  `phase 'implement': unknown key 'max_atempts' (allowed: description,
  clear, ready, gate, on_pass, on_fail, max_attempts)` — so a misspelled
  field stops the file instead of quietly doing nothing. Fix the key against
  the list in the message; there is no did-you-mean guess to lean on.
  `version:` must be exactly `0.1`, and a file written for an older schema
  needs its fields checked, not just its version line renumbered.
- **No gate can abort a run — only a person can.** `ABORT` is what
  `headsign abort <reason>` produces, so a run that reads `ABORTED` was
  ended deliberately, by you on the user's instruction or by the user. A
  run headsign itself stopped always reads `ESCALATED`.
- **A phase can branch to one of several phases.** Its `on_pass` is then a
  list instead of a phase name: each entry has a `when:` shell command and a
  `to:`, the first `when:` that exits 0 decides where the run goes, and the
  last entry — the one with no `when:` — is the default. Routes are read
  only after the gate passes. If you are the one writing such a phase, keep
  every `when:` a cheap, side-effect-free predicate (typically a `grep` of a
  file the gate already checked): they run on the success path and several
  may run before one matches, so put the real work in the gate. A `when:`
  that cannot run at all — bad command, timeout — stops the run with exit 3
  rather than guessing a destination; fix the command.
- **`on_fail: retry` and `on_fail: <this same phase>` are not the same
  thing.** `retry` stays in the phase: you keep working on the same failure,
  with the files that phase produced left where they are. Naming the phase
  itself leaves and re-enters it, which prints `ADVANCE` and runs that
  phase's `clear:` (deleting the files it lists). Re-entering is right when
  starting the phase fresh is the point — a stale review verdict has to go
  — and wrong when the work should simply continue.
- `headsign status` is a different kind of command, on purpose: it never
  judges, so its first-line vocabulary is separate from `next`'s tokens —
  `RUNNING` / `COMPLETE` / `ESCALATED` / `ABORTED`, capitalized like a
  report, not `ADVANCE`/`RETRY`/`PENDING`/`ESCALATE`/`ABORT`. Its exit code
  doesn't follow the 1=RETRY/PENDING, 2=ESCALATE/ABORT rule above either:
  it's 0 whenever state could be read at all (even `ESCALATED`/`ABORTED`),
  and 3 only when there's no run to read. Use it whenever you want to look
  without the risk of touching anything — see the discipline's first rule,
  above, for when that's required rather than optional.
- Lock contention from parallel subagents is normal — wait briefly and
  retry once; the error message itself carries the recovery.
