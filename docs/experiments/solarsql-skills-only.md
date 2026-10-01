# A skills-only migration trial in solarsql

Date: 2026-10-01.

This trial uses one authorized task in an existing solarsql Codex session.
The session uses the current checkout's authoring skills and a project-local
skill. The prior headsign run remains aborted.
The scope includes migration and one local bug fix, with independent review.
It excludes publication and further tickets.

## What the migration exposed

The earlier generated skill reproduced phases and progress state in Markdown.
Its commands also disagreed about evidence paths and revision hashes.
The revised skill expresses outcomes, constraints, available checks, and method
improvement. It uses the project's queue and separates mutation checks from
task progression.

The first new mutation checker ran successfully against the existing baseline.
That success established the current invocation, not the whole migration.
An independent review found four missing contracts:

- The approval hash omitted new, untracked files that could enter the commit.
- Completion omitted the update that stops resolved mutations from returning
  as allowed failures during later work.
- New mutation tasks lacked instructions to create the checker's required inputs.
- Implementation review remained, but required review of proposed priorities
  and acceptance criteria had been dropped.

The lead returned these findings to the working session during the task.
The session identified the cause: it had moved commands without preserving
their evidence and review responsibilities. It revised the local skill and
support scripts before continuing verification.

An isolated check of the repaired helpers found two further defects.
The revision helper failed on an unstaged deletion.
The baseline update removed source records required by the specified recheck.
The latter test used a local report stub; it tested baseline handling, not
the mutation engine. The lead returned both failures during the same task.
The session repaired both helpers. Independent checks then confirmed matching
approval and commit hashes for deletion, successful post-update verification,
and rejection when a later task reintroduced the resolved mutation.

The product reproduction also needed care. The original SQL example failed
when SQLite executed its trigger, despite successful trigger creation.
The working session initially narrowed acceptance to the resulting diagnostic.
The lead supplied an executable SQL variant that retained the original defect.
The session added that case to preserve the intended successful build outcome.

## Changes to the authoring skills

The three authoring skills now preserve input preparation and updates needed
for later checks, and verify those paths during migration.
They also preserve the review's subject and include new deliverables within
that subject.
These requirements fit the existing migration and evidence guidance.
They do not prescribe a mutation tool, baseline format, queue, or phase graph.

The general lesson is to migrate a check's required property and supporting
evidence together. A successful command against an existing task can miss
defects in task creation, completion, or later reuse.

## Product verification

The product change limits the trigger rollback check to the trigger body.
It shares the existing parser for the body boundary with migration analysis.
Regression tests cover a valid WHEN subquery, an invalid unqualified column,
and SQLite's execution of the valid trigger.

Mutation checks exposed missed cases and redundant conditions.
The session repaired them before final review.
The final measurement retained the three previously allowed survivors.
The unit suite passed 1,141 tests. The targeted Miniflare suite passed three.
The type check, example build check, architecture check, and diff check passed.
An independent reviewer approved the resulting revision.

Local commit `e717e482e92b48c118bf5c938f9e5cc9749e8fda` contains the reviewed
product change. Its parent and artifact hash match the recorded review.
The baseline update and subsequent mutation verification also passed.
The ticket was closed, and the worktree was clean.
The session stopped after that task and did not publish the commit.

## Evaluation limits

This is an assisted trial, not an unattended success-rate measurement.
The lead selected a bounded task and supplied independent migration findings.
It also supplied the valid SQL variant and helper test results.
The session received the old workflow's context as well as the new skills.
Those conditions limit conclusions about a fresh session or autonomous repair.
The session began with GPT-5.6-Sol at low effort and later showed GPT-6-Sol
at medium effort. This trial does not compare models.

Structural validation checks the skill files and their references.
Actual task results and tests of the migrated helpers supply different evidence.
Further use must establish whether the skills reduce repeated corrections and
required human intervention.
