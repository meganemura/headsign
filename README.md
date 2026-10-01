# headsign

Skills that help a coding agent create and improve a project's way of working.

Give the agent the outcome, constraints, and checks the project can run.
The agent chooses the method, uses those checks, and improves the method when
feedback exposes a weakness. It applies useful repairs to the current work
and verifies the affected results before it finishes.

headsign provides two ordinary skills. They use the host's existing tools
and the project's commands. They require no headsign CLI, workflow state,
hooks, npm installation, or build step.

| Skill | Use it when |
|---|---|
| [create-project-skill](skills/create-project-skill/SKILL.md) | Create a local skill from repository evidence or supplied commands. |
| [improve-project-skill](skills/improve-project-skill/SKILL.md) | Improve an existing local skill from work feedback and evidence. |

## Install

For an update from v0.16.0 or an older plugin, read the migration guide in Documentation below.

Choose either installer. These commands install the available skills for Codex
at user scope from the selected revision:

```sh
gh skill install meganemura/headsign --all --agent codex --scope user
```

```sh
npx skills add meganemura/headsign --skill '*' --agent codex --global
```

For Claude Code, replace `codex` with `claude-code`.
For project scope, use `--scope project` with `gh skill`, or omit `--global`
with `npx skills`. To select one skill, replace `--all` with its name for
`gh skill`, or replace `'*'` after `--skill` for `npx skills`.

`gh skill` uses the latest GitHub Release. Add `--pin v0.17.1` to select this
release. `npx skills` uses the repository's default branch;
use `https://github.com/meganemura/headsign/tree/v0.17.1` as its source to
select this release.
See the [gh skill manual](https://cli.github.com/manual/gh_skill_install)
and [skills CLI documentation](https://github.com/vercel-labs/skills).

You can also copy a complete directory from `skills/` into your host's
skill directory. Keep its references beside `SKILL.md`.
Check an existing destination before replacing it.

When using several agent hosts, check each installed path and any symlink target.
An installed copy can differ from the authoring checkout, even after installation
from a local path. A shared installation can also differ from that checkout.
Confirm which files the agent loads and which source the installer updates;
an update record alone does not establish the loaded contents.
Preserve local edits before replacing copies or links.

## Use a skill

Ask your agent to use the skill by name. For local development, give it the
checkout's `SKILL.md` path and keep the references beside it. For example:

> Use create-project-skill to create a local skill for this repository.
> Discover the checks it can run. Preserve our required outcomes and constraints.
> Include responsibility for improving the method during work and at completion.

Creating a skill and doing the work it describes are separate tasks.
To authorize both, add:

> Then use the new skill to complete the task we agreed on.

Installing these skills does not disable an older plugin's hooks.
Read the migration guide before replacing a CLI-based setup.

## What the skills ask of the agent

Checks supply evidence about the work. A model still judges whether that
evidence addresses the requested outcome. Passing tests does not establish
that a review covered the whole change or that every requirement is met.

When review findings repeat, the agent should assess why its method missed
them, repair that method, and apply the repair before resubmission.
Critical review of the complete diff is one possible repair. Required
independent review remains independent.

Improvement stays within the task's authority and remaining budget.
The agent can retain a useful method. It must preserve explicit constraints,
honor a stop, and seek authority for work beyond the request.
These are responsibilities expressed in skills; they do not guarantee perfect
model judgment.

[Documentation](docs/README.md) covers local skills, migration, design decisions,
and the lessons from headsign's earlier workflow runtime.

## License

[MIT](LICENSE)

---

[Japanese](README.ja.md)
