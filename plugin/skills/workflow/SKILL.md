---
name: workflow
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

The CLI is bundled with this plugin; no install is needed. `headsign <cmd>`
below means:

```
node "${CLAUDE_SKILL_DIR}/../../dist/headsign.mjs" <cmd>
```

(If a `headsign` binary is already on PATH, that works too.)

## The discipline

1. To begin a workflow: `headsign start`. It prints the first phase's
   instructions.
2. **Whenever you are unsure what to do, think a phase's work is finished, or
   have just recovered from compaction — run `headsign next` and obey the
   first-line token.** That one habit is the whole protocol.
3. `RETRY` → the output shows exactly which check failed and its last output.
   Fix that, then run `headsign next` again. `ADVANCE` → follow the printed
   instructions of the new phase. If `ADVANCE <phase>` is followed by a line
   like `--- gate failed: ... → routed to <phase> ---`, the *previous*
   phase's gate rejected the work and routed you here — read that line, it's
   why you're back.
4. **Never end the run on your own judgment while the answer is anything
   other than `COMPLETE`.** If you are genuinely stuck — or the user asks to
   stop mid-run — record why with `headsign abort <reason>` and report to
   the user; that's the legitimate exit either way, not just a last resort.
   `ESCALATE` means stop working and ask the user for direction.
5. If the current phase's gate reads a verdict file (a review phase), spawn
   a reviewer subagent restricted to read-only tools (Read/Grep/Glob) and
   have it REPORT exactly `APPROVED` or `REJECTED` (with reasons). Then
   *you* write that reported verdict, verbatim, to the verdict file and run
   `headsign next` — the reviewer stays unable to touch code or the
   verdict, so the judgment and the work stay separated.

## Notes

- A phase's printed instruction may tell you to use a specific skill or
  spawn a subagent — do what it says.
- `headsign start`/`next`/`abort` operate on the current directory's
  `.headsign/` only — run them from the directory that owns the workflow
  (the repo or git-worktree root), not a subdirectory. The Stop hook is the
  exception: it finds the run from any subdirectory up to the repo/worktree
  root, so it still fires even if the session's cwd has drifted.
- Exit codes are verdicts, not errors: 1 = RETRY, 2 = ESCALATE/ABORT. Read
  the text, don't treat non-zero as a tool failure. Exit 3 is different — a
  real usage/config error (unknown command, wrong directory, a workflow that
  no longer defines the current phase, another `next` already running).
  Fix the invocation, the directory, or the workflow file; don't loop-retry
  on it.
- `headsign next` is cheap and safe to call at any moment: if nothing changed
  in the working tree it reprints the last verdict without consuming an
  attempt.
- Lock contention from parallel subagents is normal — wait briefly and
  retry once; the error message itself carries the recovery.
- If `headsign next` keeps printing `(unchanged)` even though you changed
  something, the change was probably in a git-ignored file the tree-hash
  doesn't watch (build outputs, coverage reports, …) — touch or save any
  git-tracked file to force a fresh evaluation.
