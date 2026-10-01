# Changing headsign

These instructions govern headsign itself. Consumer projects keep their own
goals, constraints, and commands.

For incoming feedback or changes to headsign's skills, use the project-local
[improve-headsign skill](.agents/skills/improve-headsign/SKILL.md).
Its responsibilities guide judgment; adapt the method to the evidence and task authority.

Before changing skills, packaging, or product guidance, read
[ADR-0039](docs/adr/0039-design-for-the-model-that-improves-the-method.md),
[ADR-0043](docs/adr/0043-local-skills-improve-during-work.md), and
[ADR-0044](docs/adr/0044-skills-only-distribution.md).
Use [the ADR index](docs/adr/README.md) for historical reasons.

Carry these principles into each change:

- Give the model objectives, constraints, facts, and authority to choose a method.
- Require method assessment during work when evidence exposes a weakness, and at completion.
- Apply useful repairs to the current work and verify affected results.
- Choose consequential improvements; retaining a useful method is valid.
- Preserve requested outcomes, explicit budgets, independent review, and the user's ability to stop.
- Keep skills small. Explain any added instruction and consider what better models let us remove.
- State future assumptions and uncertainty separately from observed behavior.

headsign distributes two plain skill directories under `skills/`:
`create-project-skill` and `improve-project-skill`.
Do not restore plugin packaging, a CLI, workflow state, hooks, or npm publishing
as a routine repair. A design change to this boundary requires an explicit
amendment to ADR-0044 and the user's authority.

Follow [Maintenance](docs/maintenance.md). Run the contributor check with
Node 24:

```sh
node scripts/check.ts
```

Read the changed skills and required references as one set. For behavioral
changes, exercise relevant scenarios and report what the check cannot establish.
Check current guides for instructions that conflict with the new behavior.
Keep the English and Japanese guides aligned.

When delegating, include relevant ADR paths, ownership, and task constraints.
Ask reviewers to check policy alignment and observable behavior.

Before handover, explain design alignment and the behavior verified. A routine
fix needs a short explanation. If an accepted decision changes, amend it
explicitly instead of overriding it in a skill.

## Distribution authority

Run the same check as CI before treating a revision as ready.
No npm release or runtime build belongs to this repository's current process.
Keep existing published artifacts and tags intact.
Git tags and CHANGELOG identify releases; no package manifest carries a version.

Obtain explicit approval immediately before external publication, a tag push,
or changes to registry status. Preparation and local verification can proceed
under the existing task authority.
