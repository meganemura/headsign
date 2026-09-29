# Changing headsign

These instructions govern changes to headsign itself. They are not instructions
for a consumer repository that uses the plugin.

Before changing runtime behavior, skills, workflow vocabulary, or product
guidance, read [ADR-0039](docs/adr/0039-design-for-the-model-that-improves-the-method.md)
and the ADR that owns the behavior you will change.
Use [the ADR index](docs/adr/README.md) to locate that decision.
For optimization behavior, also read
[ADR-0038](docs/adr/0038-a-run-assesses-its-procedure.md).

Carry these principles into the change:

- Design for more capable future models. Give the model objectives, constraints,
  facts, and authority. Keep semantic judgment with the model.
- Keep optimization enabled by default. Create an opportunity to improve the
  method; do not force edits or reward completed assessment records.
- Choose consequential outcomes over convenient nearby edits. A larger proposal
  or a justified decision to retain the method can be the right result.
- Permit an explicit future bet. State the assumed change, expected value,
  uncertainty, and reason to reconsider it. Verify present behavior separately.
- Keep the harness small. Justify added runtime responsibilities and instructions;
  consider what a stronger model lets us remove.
- Preserve the user's requested outcomes, authority, budget, and ability to stop.
  Reversible procedural repairs can use existing task authority.

Before handing over a design change, explain how it follows these principles
and what observable behavior you verified. Scale the explanation to the change;
do not create a separate report for a routine fix. Check for instructions that
would make another agent follow an older, conflicting policy.

If the intended change conflicts with an accepted decision, identify the
conflict and amend that ADR explicitly. Do not silently override it through
code, a skill, or a local workaround. Preserve the user's authority over goals
and constraints when proposing an amendment.

Give delegated agents the relevant ADR paths and these constraints in their
task instructions. Ask reviewers to check policy alignment as well as behavior.
Follow [Maintenance](docs/maintenance.md) for validation and distribution.


<!-- ARCHSTRICT_START -->
## archstrict

In projects with an `archstrict.config.ts` (module-boundary/architecture linting), run `archstrict rules <path>` BEFORE creating a file or adding an import - it reports the module, tags, and constraints that would govern that path, even before it exists. Run `archstrict check` after editing to confirm.

The full rule reference (every rule's evidence/because/do shape, the config schema, the pre-edit query) is at `node_modules/archstrict/skills/archstrict/SKILL.md` when installed via npm - read it before configuring `archstrict.config.ts`, or when a violation's `do:` text alone isn't enough.

If there is no `archstrict.config.ts`, skip archstrict entirely - it may not be installed here.
<!-- ARCHSTRICT_END -->
