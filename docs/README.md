# Documentation

The one entry point into headsign's docs. Four pages, by what you came for:

To change headsign itself, start with [AGENTS.md](../AGENTS.md) and its required
[design policy](adr/0039-design-for-the-model-that-improves-the-method.md).

| Page | For |
|---|---|
| [Workflow reference](workflow-reference.md) | Writing a `.headsign/workflow.yaml`, and what each CLI command answers |
| [Architecture](architecture.md) | How the tool is put together — the loop, the module map, the invariants |
| [Architecture Decision Records](adr/README.md) | The *why* behind each decision, one per file |
| [Maintenance](maintenance.md) | Releases, distribution channels, and repository settings that live outside the tree |

The plugin ships three skills:

| Skill | For |
|---|---|
| [design-workflow](../plugin/skills/design-workflow/SKILL.md) | Design or revise phases, checks, and routes |
| [workflow](../plugin/skills/workflow/SKILL.md) | Drive a run and collect observations |
| [optimize](../plugin/skills/optimize/SKILL.md) | Assess the procedure and apply or propose improvements |

`workflow` and `design-workflow` keep the long procedure in `references/` next to the entry. Read the entry first, then open the reference it names. `optimize` is the whole skill.

[Optimization by default](workflow-reference.md#optimization-at-the-boundary)
explains the runtime behavior and its limits.
[Local plugin development](maintenance.md#local-plugin-development) explains
how to test a checkout while preserving an existing run.
Ready-made workflows live in [example.headsign/](../example.headsign/).

The [README](../README.md) is the page before all of these: what headsign is,
and whether you want it.
