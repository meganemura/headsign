---
name: workflow
license: MIT
description: >-
  Drive a headsign phase-gate workflow. Use when the repository contains
  .headsign/workflow.yaml and the user asks to start, continue, or resume a
  workflow run — or when .headsign/state.json shows a run in progress (e.g.
  when recovering after compaction). Do not use in repositories that have no
  .headsign directory.
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

(If the package is installed via npm, `npx headsign` — or a PATH-installed
`headsign` — works too.)

If the bundled path above does not exist, this file is a copy running
outside its plugin (e.g. placed in `.claude/skills/`) — the bundle only
ships with the plugin. Use `npx headsign` or a PATH-installed `headsign`
if available; otherwise stop and tell the user to either install the
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
2. To begin a workflow: `headsign start`. It prints the first phase's
   instructions.
3. **Whenever you are unsure what to do, think a phase's work is finished, or
   have just recovered from compaction — run `headsign next` and obey the
   first-line token.** That one habit is the whole protocol.
4. `RETRY` → the output shows exactly which check failed and its last output.
   Fix that, then run `headsign next` again. `ADVANCE` → follow the printed
   instructions of the new phase. If `ADVANCE <phase>` is followed by a line
   like `--- gate failed: ... → routed to <phase> ---`, the *previous*
   phase's gate rejected the work and routed you here — read that line, it's
   why you're back.
5. **Never end the run on your own judgment while the answer is anything
   other than `COMPLETE`.** If you are genuinely stuck — or the user asks to
   stop mid-run — record why with `headsign abort <reason>` and report to
   the user; that's a legitimate exit, but it's permanent: the run cannot be
   resumed. To *pause* rather than end — stepping away to resume later —
   write one line explaining why to `.headsign/tmp/stop-note` and stop
   again: the Stop hook passes immediately, and `headsign next` picks the
   run back up later from the same phase. `ESCALATE` means stop working and
   ask the user for direction.
6. If the current phase's gate reads a verdict file (a review phase), spawn
   a reviewer subagent restricted to read-only tools (Read/Grep/Glob) and
   have it REPORT exactly `APPROVED` or `REJECTED` (with reasons). Then
   *you* write that reported verdict, verbatim, to the verdict file and run
   `headsign next` — the reviewer stays unable to touch code or the
   verdict, so the judgment and the work stay separated.

## Notes

- A phase's printed instruction may tell you to use a specific skill or
  spawn a subagent — do what it says.
- `headsign start`/`next`/`abort`/`status` operate on the current
  directory's `.headsign/` only — run them from the directory that owns the
  workflow (the repo or git-worktree root), not a subdirectory. The Stop
  hook is the exception: it finds the run from any subdirectory up to the
  repo/worktree root, so it still fires even if the session's cwd has
  drifted.
- Exit codes are verdicts, not errors: 1 = RETRY/PENDING, 2 = ESCALATE/ABORT.
  Read the text, don't treat non-zero as a tool failure. PENDING = the gate
  can't be evaluated yet — not a failure. Produce the artifact it's waiting
  on (e.g. the reviewer's verdict file), then run `headsign next` again;
  don't retry-loop on it. Exit 3 is different — a real usage/config error
  (unknown command, wrong directory, a workflow that no longer defines the
  current phase, another `next` already running). Fix the invocation, the
  directory, or the workflow file; don't loop-retry on it.
- `headsign status` is a different kind of command, on purpose: it never
  judges, so its first-line vocabulary is separate from `next`'s tokens —
  `RUNNING` / `COMPLETE` / `ESCALATED` / `ABORTED`, capitalized like a
  report, not `ADVANCE`/`RETRY`/`PENDING`/`ESCALATE`/`ABORT`. Its exit code
  doesn't follow the 1=RETRY/PENDING, 2=ESCALATE/ABORT rule above either:
  it's 0 whenever state could be read at all (even `ESCALATED`/`ABORTED`),
  and 3 only when there's no run to read. Use it whenever you want to look
  without the risk of touching anything — see the discipline's first rule,
  above, for when that's required rather than optional.
- `headsign next` is cheap and safe to call at any moment: if nothing changed
  in the working tree it reprints the last verdict without consuming an
  attempt.
- Lock contention from parallel subagents is normal — wait briefly and
  retry once; the error message itself carries the recovery.
- If `headsign next` keeps printing `(unchanged)` even though you changed
  something, the change was probably in a git-ignored file *outside*
  `.headsign/` that the tree-hash doesn't watch (build outputs, coverage
  reports, …) — everything under `.headsign/` (including `tmp/`) is always
  watched regardless of `.gitignore`. Touch or save any git-tracked file to
  force a fresh evaluation, but that forces re-*judgment*, not a free
  retry: if the gate still fails after the touch, it's a real, counted
  attempt.
