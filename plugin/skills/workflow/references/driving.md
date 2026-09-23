# Driving, claiming, and finding the run

Open this before you claim, before you answer a nudge, or when more than one
session may be touching the run. Rule numbers match the procedure in
`SKILL.md`. `headsign status` is the command that looks without judging.

1. **First, check whether this session is the driver.** If this session did
   not run `headsign start`, and hasn't been explicitly asked (by the user,
   or by the session that did) to continue an existing run — do not run
   `headsign next` or `headsign abort`. A repository can have more than one
   coding-agent session open on it at once (a lead plus teammates, or a
   subagent working alongside the session that spawned it), and only the
   one driving the run should touch it: obeying a nudge you weren't meant to
   answer can burn a retry or advance a phase nobody asked you to touch.
   Want to know what's happening without touching anything? Run `headsign
   status` — it's read-only, and safe to call at any time. It also prints the
   current phase's instructions, in the same block `next` uses. **If you are
   delegating the work to someone who does not run headsign — a subagent, a
   teammate — that block is what you hand them.** They cannot see the gate's
   requirements any other way, and requirements you paraphrase from memory are
   the ones that come back as a gate failure a lap later.
2. **If you are a delegated agent and were entrusted with driving a run,
   claim it first — don't just start calling `next`.** This applies when
   you are a teammate (Claude Code's agent-teams feature) or a subagent:
   you share the spawning session's process and environment, so no command
   you run can say who you are, and `headsign next` records no driver at
   all. (One exception: in a Claude Code session with function hooks
   enabled, the plugin's module names the caller of each `headsign` command,
   and a subagent's own `next` seats it as driver — the claim below is then
   redundant, and still correct.) Instead: run `headsign claim`, then end
   your turn. The seal happens
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
   `SubagentStop` sends your turn ends back to `headsign next`, this run is
   yours to drive. Read which message you got: a `SubagentStop` nudge fires only
   on a positive match, but `Claim confirmed …` means an armed marker just
   seated you — if you did not run `headsign claim`, you have taken a seat
   another agent was asking for, so say so and let it claim again. The test
   only works in this direction and only for delegated agents: ending
   quietly proves nothing (not having claimed, the host's
   already-continuing flag, an exhausted nudge cap, a pause note,
   `HEADSIGN_OBSERVER`, a directory the walk-up resolved only via
   `CLAUDE_PROJECT_DIR`, or a run this session simply never touched while
   someone else was last recorded moving it, all end turns quietly), and a
   session gets nudged on any run nobody has claimed and no session has yet
   been recorded moving, whether or not it is driving — once a session's
   `start` or `next` has recorded it, only that session is.
   A Stop nudge that says headsign cannot tell who drives the run does not
   confirm that you drive it. If you neither started the run nor were asked to
   continue it, do not run `next` or `abort`; end your turn.
   A nudge
   arrives roughly **once per exchange**, not once per turn end. When the
   hook holds a turn, the host flags the continuation, so the ending of
   *that* turn passes quietly — recorded as an `unheld` line in
   `.headsign/log` and on `headsign status`'s `last stop:` line. The
   window is one turn wide and closes when the turn ends.
   A probe is not free either: one that comes back as an ordinary nudge
   spends one from the cap, one that passes while your own pause note is
   armed consumes the note, and one that lands under another agent's armed
   marker consumes that marker. Probe deliberately, not by habit.

When delegated work takes longer than a wait call, inspect its progress and
remaining scope before intervening. A wait timeout is not a failed task.
Continue useful independent work or wait again when progress is sound. Narrow
or redirect a task when its observed work warrants it; preserve its findings
and required review coverage when you do.

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

- **When `start` reports an existing run, inspect it before continuing.**
  Run `headsign status`, read the phase instructions, and inspect its artifacts
  and any existing delegated work. If authorized, finish the missing work and
  call `next` when it is ready for judgment. The gate can be expensive, and
  failure spends an attempt and an iteration. Do not use it merely to discover
  whether anyone started working. Ending the run loses its position; the next
  `start` also removes everything under `.headsign/tmp/`.
