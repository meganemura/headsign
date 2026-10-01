# Move from the CLI to skills

This revision replaces headsign's runtime with three ordinary skills.
It does not change an installed package, plugin cache, active session, or
published release automatically.

## Preserve the work before changing its method

Read the consumer project's current instructions, workflow, active work record,
and relevant check scripts. Identify the requested outcome, remaining work,
explicit constraints, current owner, and evidence already obtained.
Preserve local changes and existing history, including ignored run records.

Separate product checks from runtime bookkeeping. A test command can usually
remain. A command that asks `headsign next` to advance needs replacement by
the underlying checks and a description of the required result.
Keep review independence, evidence freshness, task limits, and publication
authority even when their old phase names disappear.

Commands may rely on a working directory, environment, or temporary artifacts
that the runtime supplied. Give each retained command its actual prerequisites.
For example, a check that read `HEADSIGN_WORKFLOW_FILE` needs an explicit input
or a revised purpose when the YAML stops governing work.
Trace input preparation and completion updates as well as the check commands.
Verify that required evidence remains usable after those updates and during
later work. Preserve each required review's subject, including new files.

## Create or repair the local skill

Use [project-skill](../skills/project-skill/SKILL.md) when the source
commands are already named. Use
[create-skill-workflow](../skills/create-skill-workflow/SKILL.md) when
the checks need discovery, or
[optimize-skill-workflow](../skills/optimize-skill-workflow/SKILL.md)
when the project already has a suitable skill.

State the outcome, constraints, available gates, and completion evidence.
Carry improvement into the current work: diagnose a weak method, apply the
repair, and verify affected results. Avoid reproducing a phase graph,
transition tokens, counters, or state parser merely to resemble the old runtime.

Replace instructions to start, claim, advance, or abort headsign with the
project's actual task and ownership conventions. A previous run's completion
is historical evidence; it does not validate later edits.
Preserve the old work record and note how unfinished work continues.

Creating a skill does not itself authorize executing its task.
If the user authorized migration and continuation, proceed with both.
If the request covers authoring only, hand over the file and its verification.

## Remove the old integration deliberately

Inspect the consumer repository's host configuration and selected plugin source.
Remove only headsign-specific hook commands and runtime declarations within
the authorized migration. Preserve unrelated hooks and plugins.
Do not delete a whole host settings file to remove one registration.

An enabled older plugin can still register its bundled hooks even after manual
hook entries are removed. Uninstall that old plugin before adopting these skills.
Keep the chosen skills available through a skill installer, checkout paths,
or copied directories. The current release does not provide a plugin replacement.

An active session may retain previously loaded instructions or hooks.
Identify its loaded source before using it to test the new method.
Use a session with the old integration disabled when that source cannot change
within the current session. Do not treat an on-disk edit as proof of the
active session's configuration.

Retire the CLI dependency only after checking what invokes it.
Preserve the consumer's workflow files and records as history unless removal
is explicitly part of the task. A history file must not remain the current
instruction to start another headsign run.

## Verify the new method

Run the retained checks through the project's tools and inspect the results.
Exercise the local skill on an authorized task. Record what actually happened,
including any missed checks, repeated review findings, and required intervention.
Apply useful repairs and recheck the affected work.

Static inspection establishes the new instructions and configuration.
A successful task gives evidence for that task and model; it does not prove
that all later work will complete without intervention.

The latest installed or published version may still be a CLI release.
Existing npm artifacts and tags remain intact. Registry deprecation or a new
release is a separate external action that requires explicit approval.
