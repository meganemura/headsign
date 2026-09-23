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

This file is the entry. It says when the skill applies, the constraints that
hold on every lap, and which reference to open. Open the one the situation
names. Do not load `references/` up front.

When this skill runs inside the headsign plugin in Claude Code or Codex, the
CLI is bundled with it and no install is needed. In Claude Code,
`headsign <cmd>` below means:

```
node "${CLAUDE_SKILL_DIR}/../../dist/headsign.mjs" <cmd>
```

In Codex, use the absolute SKILL.md path that Codex supplies for this skill.
Go up from `skills/workflow/SKILL.md` to the plugin root, then invoke
`dist/headsign.mjs` with Node. Do not assume a session environment variable
for the skill directory; the Codex contracts checked for this release did not
confirm one.

(A PATH-installed `headsign` works too, and so does `npx headsign` once the
package is installed. Check which you have before reaching for either —
`command -v headsign` names a PATH copy if one exists. **`npx headsign` with
nothing installed does not fail; it installs from the registry**, at a version
npm chooses rather than the one this plugin ships, and that copy will read and
write the same `.headsign/state.json` the bundled one has been driving.)

If the bundled path above does not exist, this file is a copy running
outside its plugin (for example, in `.claude/skills/` or `.agents/skills/`) — the bundle only
ships with the plugin. Use a PATH-installed `headsign`, or `npx headsign`
on the terms above; otherwise stop and tell the user to either install the
plugin or `npm install` the package. Do not guess at other paths.

When the user selects a local checkout, use its supplied bundle path and read
its current skills. An installed plugin is a cached copy; a source edit alone
does not update that copy. Keep an existing run when switching CLI copies.
Do not abort, restart, or edit its state just to enable optimization.

## The discipline

Keep useful observations about the workflow, skills, checks, host integration,
or headsign while you work. Do not treat routine waiting as a defect. When a
terminal verdict supplies an assessment path, use the bundled `optimize` skill
and record its disposition there. Report an escalation to the user first. Do
not delay that handoff for improvement work. An explicit request to stop takes
priority; use `DEFERRED` when appropriate and possible.

Optimization is enabled at `start` unless the user chooses `--no-optimize`.
Legacy and opt-out runs have no assessment path; do not invent one. Keep
mid-run observations outside `assessment.md`. If a retrospective already
produced useful findings, use them instead of repeating the investigation.

- Do not run `headsign next` or `headsign abort` unless this session ran
  `headsign start` or was explicitly asked to continue the run. `headsign
  status` is read-only and safe at any time. Hand a delegated worker who does
  not run headsign the current phase's instruction block from `status`. Do
  not paraphrase it.
- A delegated agent entrusted with the run runs `headsign claim`, ends the
  turn, and does not run `headsign next` until the hook confirms the claim.
  A session driving on its own does not claim. On Claude Code with function
  hooks, a subagent's own `next` can seat it; claiming is still correct.
- Obey the token on stdout's first line. A progress line may arrive first on
  a merged stream; read stdout on its own. `next` judges and can spend an
  attempt. To look, use `status`.
- Never end the run on your own judgment unless the token is `COMPLETE`. To
  stop mid-run, run `headsign abort <reason>`. To pause, write one line to
  `.headsign/tmp/stop-note` naming what you are waiting for. If you cannot
  name it, you are not blocked.
- `next` exit codes are verdicts, not tool failures: 0 advance/complete, 1
  retry/pending, 2 escalate/abort, 3 usage/config. `PENDING` means the gate
  cannot be evaluated yet. Exit 3 spends no attempt. Repair the invocation
  or the command, and do not loop-retry. `status` uses a different exit
  code; the vocabulary is in `references/verdicts.md`.
- A phase instruction that names a skill or a subagent is an instruction.
  Follow it.
- Lock contention from parallel subagents is normal. Wait briefly and retry
  once. The error message carries the recovery.

## Procedure

1. **Confirm you are the driver.** If you are not, stop at `status`. Open
   `references/driving.md` before you claim, before you answer a nudge, or
   when more than one session may be touching the run.
2. **Delegated driver.** Claim, then wait for the hook's confirmation
   (`references/driving.md`).
3. **Start.** `headsign start`, or `headsign start <name>` when `.headsign/`
   holds more than one file. `<name>` is the basename, so `headsign start
   fitness` runs `.headsign/fitness.yaml`. Either way it prints the first
   phase's instructions. If `start` cannot read `.headsign/workflow.yaml`,
   this repository names its workflows rather than keeping a default: list
   `.headsign/` and start the one you were asked for.
4. **Resume or compaction.** Run `headsign status` first. `RUNNING` means the
   run has not ended. Do the phase's unfinished work, then `headsign next`
   when that work is ready for the gate. A status check is not the work. On
   resume, `status` comes before `next`, because `next` resets the nudge
   counter.
5. **Obey the token.** `RETRY` means fix the check the output names, then
   `next`. `ADVANCE` means follow the new phase's instructions. A line
   `--- gate failed: ... → routed to <phase> ---` means the previous gate
   rejected the work. A line `--- routed: when "..." → <phase> ---` or
   `--- routed: default → <phase> ---` means the previous phase passed and
   its `on_pass` routes chose this one. The destination is stdout's first
   line. The full token, exit-code, and `status` vocabulary is in
   `references/verdicts.md`.
6. **Do not end the run yourself** except on `COMPLETE`, or by `abort` when
   you are stuck or the user asks to stop. Read an `ESCALATE` before acting.
   Some kinds leave the run `RUNNING`. Some set `ESCALATED`, and no `next`
   continues those. A reported graph change is accepted only by a separate
   `headsign next --accept-graph-change`. A bare `next` never accepts it.
   Open `references/stopping.md` before you abort, pause, accept a graph
   change, or restart.
7. **Review phase.** If the gate reads a verdict file, a read-only reviewer
   reports exactly `APPROVED` or `REJECTED`. You write that verdict only
   after `status` shows the review phase as current. Open
   `references/review.md` before you write a verdict file.

## Which reference

| Situation | Open |
|---|---|
| Who may call `next` or `abort`, claim, nudges, hooks, worktrees, a `start` that reports an existing run | `references/driving.md` |
| What `RETRY`, `ADVANCE`, `PENDING`, route lines, exit codes, and `status` words mean | `references/verdicts.md` |
| Abort, pause, escalation kinds, graph change, restart, a gate that cannot represent the work | `references/stopping.md` |
| Writing or repairing a review verdict | `references/review.md` |
| Editing the workflow file during a run, the closed schema, `on_pass` lists, `on_fail: retry` versus re-entry | `references/notes.md` |

Authoring or reshaping a workflow file is the `design-workflow` skill.
Assessing a finished run is the `optimize` skill.
