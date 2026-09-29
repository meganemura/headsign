# Documentation

The one entry point into headsign's docs. Six pages, by what you came for:

To change headsign itself, start with [AGENTS.md](../AGENTS.md) and its required
[design policy](adr/0039-design-for-the-model-that-improves-the-method.md).

| Page | For |
|---|---|
| [Workflow reference](workflow-reference.md) | Writing a `.headsign/workflow.yaml`, and what each CLI command answers |
| [Project-local skills](project-local-skills.md) | A skill under `.agents/skills/` whose gates are product shell commands: exit 0 advances, and ownership and the queue are repository tools |
| [Architecture](architecture.md) | How the tool is put together — the loop, the module map, the invariants |
| [Architecture Decision Records](adr/README.md) | The *why* behind each decision, one per file |
| [Maintenance](maintenance.md) | Release checklist, distribution channels, and repository settings that live outside the tree |
| [Releasing](releasing.md) | npm Trusted Publisher: the one-time registry setup, and what a `v*` tag publishes |

The plugin ships these skills:

| Skill | For |
|---|---|
| [design-workflow](../plugin/skills/design-workflow/SKILL.md) | Design or revise phases, checks, and routes |
| [workflow](../plugin/skills/workflow/SKILL.md) | Drive a run and collect observations |
| [optimize](../plugin/skills/optimize/SKILL.md) | Assess a finished run and apply or propose improvements |
| [project-skill](../plugin/skills/project-skill/SKILL.md) | Write a project-local skill from shell commands you named, or from command strings in a file you name |
| [create-skill-workflow](../plugin/skills/create-skill-workflow/SKILL.md) | Invent that local skill from commands the repository can already run |
| [optimize-skill-workflow](../plugin/skills/optimize-skill-workflow/SKILL.md) | Revise an existing skill, including a gate no command can judge or a stale command |

`workflow`, `design-workflow`, `project-skill`, `create-skill-workflow`, and
`optimize-skill-workflow` keep the long procedure in `references/` next to
the entry. Read the entry first, then open the reference it names.
`optimize` is the whole skill. What `create-skill-workflow`,
`project-skill`, and `optimize-skill-workflow` each write, and how to follow
the file with the repository's own commands, is [Project-local
skills](project-local-skills.md).

[Optimization by default](workflow-reference.md#optimization-at-the-boundary)
explains the runtime behavior and its limits.
[Local plugin development](maintenance.md#local-plugin-development) explains
how to test a checkout while preserving an existing run.
Ready-made workflows live in [example.headsign/](../example.headsign/).

The [README](../README.md) is the page before all of these: what headsign is,
and whether you want it.
