# ADR-0001: Thin harness — Claude drives, the CLI holds state

- Status: accepted
- Date: 2026-07-23

## Context

Existing agent workflow tools cluster at two poles:

- **Heavy runners** (takt, Microsoft Conductor): an outer process owns the
  loop and invokes the LLM as a subordinate. Powerful, but the harness code
  is large, and the agent loses ownership of conversation and context.
- **Marker-driven flows** (jdi): the LLM signals phase transitions in its own
  output. Lightweight, but transitions depend on LLM output parsing, so
  accuracy cannot be guaranteed.

This project started from the experience that the heavy pole is too heavy
for everyday use, and the light pole is unreliable at exactly the one moment
that matters: the transition decision.

## Decision

1. **Claude is the principal.** Claude Code keeps the conversation, the
   context, and the work. The CLI is a place to ask a question, not a runner.
   It never runs long; each invocation reads state, judges, writes state,
   exits.
2. **Judgment is 100% deterministic.** Phase transitions are decided solely
   by shell exit codes of user-authored checks. The LLM reads the verdict;
   it never produces it. This is the essential difference from
   marker-driven tools.
3. **Lightness is a requirement, not a preference.** Core implementation
   budget: 500 lines total for `src/` — counting code only (comments and
   blank lines excluded), since this repo's dense AI-friendly comments push
   raw `wc -l` noticeably higher. Every feature proposal must answer "does a
   thin harness need this?" — if the budget breaks, the design is wrong.
   (Amended by [ADR-0016](0016-explainability-as-the-fitness-function.md):
   the number is retired — it was passed twice over without stopping a single
   proposal — and replaced by an explainability sweep that names the function
   it fails on. The question every proposal must answer is unchanged.)
4. **Thin Harness, Fat Skills.** Intelligence lives in SKILL.md (procedure)
   and gate commands (user-authored shell). The CLI is a state transition
   machine and nothing else.

## Non-goals (explicit, to resist gravity)

- worktree/clone isolation or parallel execution (use takt alongside if needed)
- LLM provider abstraction, model selection, personas (Claude Code subagents
  already do this)
- template engines or expression evaluation
- MCP server (CLI + skill suffices until proven otherwise)
- dashboards / TUI
- task queues / issue tracker integration
- additional *judging* commands (`gate`, dry-run variants, …) — the question
  is `next`, singular. Wanting a second question is a sign the design is
  drifting. (Amended by [ADR-0008](0008-multi-session-ownership.md): this
  entry originally rejected `status` by name, too. Once multi-session use
  became a normal mode of operation, a strictly read-only `status` was added
  for sessions that are *not* driving the run — the driving session still
  gets exactly one question, and `status` never judges or transitions.)

## Consequences

- Feature requests that need orchestration, parallelism, or expression
  languages are answered by "compose with other tools", not by growth here.
- The 500-line budget was enforced in review as a design smell detector, not
  a hard compiler limit. It is retired by
  [ADR-0016](0016-explainability-as-the-fitness-function.md), which records
  what a detector that never fires actually measures.
