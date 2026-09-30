# Section order

The generated `SKILL.md` uses this order. Gates stay in that file. Each gate
is a shell command in the body. Exit 0 advances. Anything else does not.
The fence is low freedom: the exact shell string. The work above it is high
freedom: the agent chooses the path.

1. Frontmatter `description`. It says when to use the skill, and that exit 0
   of a command in Gates is the only advance.
2. When to use. When the work needs a single owner, a gitignored file such
   as `loop.json` records it. If that file shows the job already has an
   owner, do not start a second loop. That sentence is not a gate.
3. Goals. Three outcomes, and no step list that restates the gates:
   - **Done.** Finish at human-ready: every local gate has exited 0, CI is
     green, and AI review is complete. Include a local commit when a gate
     requires one. No push unless the user asked for one. The agent may
     loop until Done. Wait and fix actuators are swappable.
   - **Impossible.** The acceptance criteria contradict a preserved contract,
     or the only way through a gate is to weaken a check. Do not call that Done.
   - **Needs human.** Authority or information the agent does not have, or a
     check that cannot pass without inventing work. Standing CI the checkout
     cannot run is this, until a command exists.
4. Gates. One heading per advance. The heading names where exit 0 goes. See
   `gates.md`. A prose completion line is not a heading here.
5. Tool menu. Commands that help produce what a gate reads, and that are not
   themselves gates. Standing CI that is not a local advance is labeled here
   as not a gate, when it is named at all.
6. Constraints. What the agent must not do to make a gate exit 0. Include a
   short out-of-scope list: what this skill does not do, with a pointer at
   AGENTS.md, a sibling skill, or `optimize-skill-workflow`.
7. Evidence. The files and fields a gate reads, when they do not fit on the
   gate's work line.
8. Self-improve, when the skill looks back. Not a shell gate. The record's
   first line is exactly one of `NO_CHANGE`, `APPLIED`, `PROPOSED`, `DEFERRED`,
   the same four words the `optimize` skill uses. One pass. Prefer a check,
   a script, or a gate over a longer explanation. When look-backs show the
   same gate keeps being ignored, `PROPOSED` names hook enforcement that
   holds the turn until the gate has passed. headsign is one example.
   Another host's hook is the same proposal. Do not propose that hook before
   those look-backs.

A domain section (mutation records, review rules) belongs after the tool menu
only for facts that do not fit under the gate that reads them. If the same
rule is on the gate, delete it from the later section.
