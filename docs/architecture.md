# Architecture

headsign distributes instructions. The host runs the model and its tools;
the consumer project supplies commands that check the work.

| Part | Responsibility |
|---|---|
| `skills/create-project-skill/` | Create a local skill from repository evidence or supplied commands. |
| `skills/improve-project-skill/` | Diagnose and repair an existing project-local skill. |
| `scripts/check.ts` | Check repository structure, packaging, and documentation links for contributors. |
| `docs/` | Explain current use and preserve design knowledge. |

Each `SKILL.md` defines when it applies, its responsibility, and its required
references. References sit beside the skill so a copied directory remains
usable. The generated local skill belongs to the consumer project.

The model chooses the method and when to use relevant checks. Requirements,
explicit constraints, and independent-review obligations remain binding.
The skill requires assessment during work when feedback exposes a weakness,
and at completion. A useful repair must reach the current work and receive
appropriate verification.

## Work and delegation

A project skill describes the work's requirements and available checks.
The agent chooses how to reach completion for the task it receives.
Delegated tasks can use the same skill or different skills when their
responsibilities need different guidance. Choose the boundary by the deliverable,
edit ownership, shared resources, and evidence the receiving agent must return.

The parent remains responsible for the requested result and verification after
integration. Shared files, the Git index, generated output, and test databases
can require coordination even when agents edit different source files.
Delegation stays within the user's authority and budget and the host's limits.
Each agent uses skills within its host execution context. Safe concurrency
depends on those ownership and resource boundaries.

## Distribution

Installers discover the ordinary `skills/` directories.
Git tags and CHANGELOG identify releases. The host owns execution, account
usage, and permissions. Consumer tests retain their own runtime requirements.

[ADR-0039](adr/0039-design-for-the-model-that-improves-the-method.md),
[ADR-0043](adr/0043-local-skills-improve-during-work.md), and
[ADR-0044](adr/0044-skills-only-distribution.md) govern this design.
The [v0.15.4 architecture](https://github.com/meganemura/headsign/blob/v0.15.4/docs/architecture.md)
describes the retired runtime.
