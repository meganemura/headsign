# ADR-0028: Codex as a second principal

- Status: accepted
- Date: 2026-08-22
- Amends [ADR-0001](0001-thin-harness.md): Claude Code and Codex can each be
  the principal that owns the conversation and drives the CLI.
- Amends [ADR-0006](0006-stop-hook-backstop.md): the same Stop-boundary
  backstop runs on both hosts.
- Amends [ADR-0026](0026-a-second-place-to-look.md):
  `CLAUDE_PROJECT_DIR` remains a Claude Code fallback. Codex supplies `cwd`
  in the hook payload, so Codex needs no matching fallback variable.
- Amends [ADR-0027](0027-recording-who-drove-a-run.md): this research did not
  confirm a stable public session environment variable for ordinary Codex CLI
  commands, so Codex commands do not stamp `last_drive.session`.

## Context

ADR-0001 names Claude as the principal. The CLI, state, locks, logs, and gate
evaluation already take no dependency on a model host. The distribution layer
names Claude Code through its manifest, hook command, skill instructions, and
README.

Supporting Codex depends on one hard requirement: a process must run when an
agent tries to end a turn, and that process must be able to continue the turn.
Instructions alone cannot provide the backstop.

## Confirmed Codex contracts

The following facts were checked on 2026-08-22.

1. OpenAI's [Hooks documentation](https://learn.chatgpt.com/docs/hooks)
   defines `Stop` and `SubagentStop`. It gives each command hook `cwd` and
   `session_id`, and it defines exit code 2 plus stderr as a continuation
   response. A blocked `Stop` creates a new continuation prompt.
2. The same page defines `stop_hook_active` for both stop events. This matches
   the field that headsign already handles after a previous continuation.
3. OpenAI's [plugin packaging documentation](https://developers.openai.com/plugins/build/plugins)
   defines `.codex-plugin/plugin.json`, `skills/`, and the default
   `hooks/hooks.json`. It also defines `PLUGIN_ROOT` for plugin hook commands
   and `CLAUDE_PLUGIN_ROOT` alongside it. Calling the second one a
   compatibility name would undersell it: it is the name Codex's own plugin
   uses, measured below.
4. OpenAI's [skill documentation](https://learn.chatgpt.com/docs/build-skills)
   defines the same `SKILL.md` directory format. It states that Codex includes
   each skill path in its initial skill list.
5. OpenAI's [AGENTS.md documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
   defines project and user instruction layers. The
   [customization overview](https://learn.chatgpt.com/docs/customization/overview)
   relates AGENTS.md, skills, MCP, memories, and subagents. The
   [config basics](https://learn.chatgpt.com/docs/config-file/config-basic)
   page defines `~/.codex/config.toml`, and the
   [MCP page](https://learn.chatgpt.com/docs/extend/mcp) defines external tool
   configuration. The [custom prompts page](https://learn.chatgpt.com/docs/custom-prompts)
   marks custom prompts as deprecated and directs reusable workflows to skills.
6. OpenAI's [environment-variable reference](https://learn.chatgpt.com/docs/config-file/environment-variables)
   defines stable public variables that Codex reads. It defines location,
   installer, authentication, network, and diagnostic variables. It does not
   establish a session variable for a CLI child process.
7. The local command `codex --version` returned `codex-cli 0.147.0`.
   `codex --help` showed plugin support and hook-trust controls.
   `codex plugin add --help` confirmed the
   `codex plugin add headsign@headsign` selector form.
8. The current agent process exposed `CODEX_THREAD_ID` during `env` inspection.
   The public environment reference above does not establish its stability or
   its availability to ordinary Codex shell commands. This observation is not
   an implementation contract.

The research did not confirm a public Codex equivalent of
`CLAUDE_CODE_SESSION_ID` for `headsign start` and `headsign next`. The design
therefore does not read `CODEX_THREAD_ID` or another inferred variable.

## Decision

### 1. Claude Code and Codex are principals

Replace ADR-0001's host-specific principal with a coding-agent principal.
Claude Code and Codex each retain their conversation and context. headsign
remains a short-lived CLI that answers the agent's one question.

### 2. One plugin tree serves both hosts

Keep the Claude manifest at `.claude-plugin/plugin.json`. Add the Codex
manifest at `.codex-plugin/plugin.json`. Share `skills/`, `hooks/hooks.json`,
and `dist/headsign.mjs`.

**The hook command keeps naming one variable, `CLAUDE_PLUGIN_ROOT`, and that is
the correct name under Codex as well.** It reads like something a Claude-only
past left behind, so the reasoning is worth stating in full.

Codex defines both `PLUGIN_ROOT` and `CLAUDE_PLUGIN_ROOT` for plugin hook
commands, so either name resolves. Three measurements decided which to write
(2026-08-22, this machine):

- Codex's own first-party plugin registers its hooks with
  `${CLAUDE_PLUGIN_ROOT}`
  (`~/.codex/plugins/cache/openai-codex/codex/1.0.6/hooks/hooks.json`). The
  name headsign would be reaching past is the one the host's own plugin uses.
- Every other plugin installed under Codex on this machine does the same.
- headsign 0.6.1 — written before this decision existed, naming only the Claude
  variable — was already installed and enabled under Codex
  (`codex plugin list` reports `headsign@headsign  installed, enabled  0.6.1`).
  Nothing about the registration needed changing to reach that state.

Preferring the bare `PLUGIN_ROOT` was written first and then withdrawn. It buys
nothing measurable — the other name already works on both hosts — and it costs
something real: `PLUGIN_ROOT` is generic enough for an unrelated program to
export, and a hook that reads it first would then run a bundle out of whatever
directory that program named. A wrong plugin root is not a quiet failure, but it
is a failure with a confusing cause, and the alternative is one word longer.

Claude Code continues to supply its existing variable, unchanged.

Codex discovers `hooks/hooks.json` by its default plugin path, so the Codex
manifest does not repeat a hook path. The two manifests stay independent at
the host-specific edge.

### 3. Keep the existing stop-hook process contract

Do not add a Codex command or a second evaluator. Codex and Claude Code both
send the fields that the evaluators read. Both hosts accept exit code 2 and a
stderr reason as a request to continue.

The Codex `turn_id`, `model`, `permission_mode`, and transcript fields do not
change a headsign decision, so the evaluator ignores them.

### 4. Preserve the session-attribution boundary

Continue to stamp `last_drive.session` only from
`CLAUDE_CODE_SESSION_ID`. A hook payload arrives when a turn ends, after the
earlier `start` or `next` process has exited, so its `session_id` cannot stamp
those earlier commands.

On a Codex run with no `last_drive.session`, the Stop evaluator follows its
existing unknown-session rule and nudges. This keeps the backstop active. It
also means another Codex session in the same worktree can receive that nudge.
`HEADSIGN_OBSERVER=1` remains the explicit observer boundary.

If OpenAI later documents a stable session variable for ordinary commands, a
new ADR can decide whether it is equivalent at both write and compare points.

### 5. Keep skills portable

Keep one copy of each `SKILL.md`. Claude Code can use `CLAUDE_SKILL_DIR`.
Codex exposes the selected skill's absolute file path, so the skill instructs
Codex to resolve the bundled CLI relative to that path. The skill does not
invent a Codex skill-directory environment variable.

## Consequences

- Codex receives the CLI, both skills, and both stop hooks from one plugin.
- Claude Code keeps its manifest, marketplace, paths, and hook behavior.
- The CLI source needs no host branch for Codex hook input or output.
- Codex hook commands require the host's normal trust review before they run.
- Main-session ownership attribution is less precise on Codex until a public
  ordinary-command session contract exists.
