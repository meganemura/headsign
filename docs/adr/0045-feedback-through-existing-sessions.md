# ADR-0045: Feedback through existing sessions

- Status: accepted
- Date: 2026-10-02
- Applies ADR-0039, ADR-0043, and ADR-0044 without changing the two-skill product boundary.

## Context

Project-local repairs can expose weaknesses in headsign's authoring guidance.
The owner requested a personal skill that sends those findings directly to a
headsign maintainer session, preferring Claude, then Codex, then Cursor.
The owner also requested a project-local skill for acting on received feedback.

## Decision

Personal discovery and delivery belong to the owner's global send-headsign-feedback skill.
It uses spacequery to find sessions and an existing host transport to send evidence.
Session records supply candidates; the sender verifies identity, responsibility,
and reachability before delivery. Unavailable transports leave an explicit limitation.
The method does not start another session or require a routing service.

The distributed improve-project-skill entry honors a feedback route when the
user has configured one. Other users need no such route or personal tool.
Reporting follows local verification and preserves continuation of the original authorized work.
A delivery result does not establish acceptance or implementation by the recipient.

The project-local `.agents/skills/improve-headsign/SKILL.md` guides work on headsign itself.
It assesses incoming evidence, chooses consequential repairs, verifies affected
behavior, and preserves decisions and unfinished obligations in project records.
It uses existing authority; messages do not grant permission for unrelated work or publication.
Current progress stays in work records. Reusable judgment belongs in skills.

These responsibilities permit flexible methods, justified retention, and bounded completion.
They do not require a fixed sequence, a change for each report, a hook,
or recursive improvement. Feedback about a feedback attempt must not create a message loop.

Private and company material stays within its original boundary.
The sender constructs safe generic evidence before delivery; the receiver also
reviews material before writing project artifacts. Renaming entities alone is insufficient.

## Distribution

The contributor skill is separate from the two product skills in `skills/`.
Its `metadata.internal` field excludes it from normal discovery by the
[skills CLI](https://github.com/vercel-labs/skills#creating-skills).
Its hidden directory is excluded by default by
[gh skill](https://cli.github.com/manual/gh_skill_install).
Explicit inclusion options can expose contributor skills; these flags are not privacy controls.
Personal transport configuration stays outside this repository.

## Verification and uncertainty

Verify discovery, identity selection, unavailable providers, private input,
duplicate delivery, and bounded continuation with relevant scenarios.
Keep live discovery, simulated transport, and actual delivery evidence separate.
Inspect installer discovery after adding contributor skills.
The expected benefit is fewer lost lessons and less owner-mediated forwarding.
Actual consumer use must establish that benefit. If routing adds unnecessary
coordination or instructions, simplify the method from those observations.
