# Documentation

The one entry point into headsign's docs. Four pages, by what you came for:

| Page | For |
|---|---|
| [Workflow reference](workflow-reference.md) | Writing a `.headsign/workflow.yaml`, and what each CLI command answers |
| [Architecture](architecture.md) | How the tool is put together — the loop, the module map, the invariants |
| [Architecture Decision Records](adr/README.md) | The *why* behind each decision, one per file |
| [Maintenance](maintenance.md) | Releases, distribution channels, and repository settings that live outside the tree |

Two things worth knowing about the rest of the repository:

- The discipline an agent follows *while a run is in progress* is not in
  `docs/`. It ships with the plugin, as
  [plugin/skills/workflow/SKILL.md](../plugin/skills/workflow/SKILL.md), so
  that updating the plugin updates the discipline.
- Ready-made workflows for several roles live in
  [example.headsign/](../example.headsign/) — worth reading against a
  workflow you have already drafted.

The [README](../README.md) is the page before all of these: what headsign is,
and whether you want it.
