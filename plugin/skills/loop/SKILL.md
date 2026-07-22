---
name: loop
description: >-
  Drive a headsign phase-gate workflow. Use when the repository contains
  .headsign/workflow.yaml and the user asks to start, continue, or resume a
  workflow run — or when .headsign/state.json shows a run in progress (e.g.
  when recovering after compaction). Do not use in repositories that have no
  .headsign directory.
---

# headsign loop

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
   other than `COMPLETE`.** If you are genuinely stuck, record why with
   `headsign abort <reason>` and report to the user. `ESCALATE` means stop
   working and ask the user for direction.
5. If the current phase's gate reads `.headsign/verdict` (a review phase),
   spawn a reviewer subagent restricted to read-only tools (Read/Grep/Glob)
   and have it write exactly `APPROVED` or `REJECTED` to `.headsign/verdict`,
   then run `headsign next`.

## Notes

- Exit codes are verdicts, not errors: 1 = RETRY, 2 = ESCALATE/ABORT. Read
  the text, don't treat non-zero as a tool failure.
- `headsign next` is cheap and safe to call at any moment: if nothing changed
  in the working tree it reprints the last verdict without consuming an
  attempt.
- `headsign validate` checks `.headsign/workflow.yaml` statically — useful
  right after writing or editing a workflow.
- If `headsign next` keeps printing `(unchanged)` even though you changed
  something, the change was probably in a git-ignored file the tree-hash
  doesn't watch (build outputs, coverage reports, …) — touch or save any
  git-tracked file to force a fresh evaluation.
