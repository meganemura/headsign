# Maintenance

headsign's maintained product is two ordinary skill directories.
Follow [AGENTS.md](../AGENTS.md) and the current
[design decisions](adr/README.md).

## Verify a change

Run the same check as CI from the checkout with Node 24:

```sh
node scripts/check.ts
```

This is a contributor command. Consumers copy skill directories and use their
project's tools; they do not install Node for headsign.

The check validates concrete repository properties. Read its output and
[scripts/check.ts](../scripts/check.ts) for the exact scope.
It cannot establish that a model will diagnose a procedural weakness or finish
a real task. For changed instructions, inspect the entry and required
references together, then exercise the behavior the change addresses.

Useful scenarios include repeated review findings despite passing local gates,
a check that cannot run, a changed artifact after review, an explicit stop,
and a repair that would exceed task authority. Choose scenarios relevant to
the change. Preserve required outcomes when repairing a check.

Keep the English and Japanese guides aligned. Amend an owning ADR when its
decision changes. Historical runtime ADRs retain their rationale under
ADR-0044; current instructions must point to the maintained skills.

## Evidence from use

Record the observed problem, chosen repair, affected verification, and remaining
uncertainty in the project's existing work record. Apply a useful repair to
the current work. Added instructions or records do not establish improvement.

Keep private source material within its original boundary. Generalize a
problem before moving it into this public repository. Use a fresh minimal
example and original wording. Public artifacts must make sense without private
tickets, internal logs, personal paths, or company information.

## Local skill use

Use the checkout's `SKILL.md` path and adjacent references for development.
An installed plugin is a separate copy; edits here do not update that copy.
Inspect its source and loaded revision when results differ.

Keep consumer work and records intact during migration. See
[Migration](migration.md) for the transition from old hooks and CLI commands.
Use [Distribution](releasing.md) for release preparation and external actions.
