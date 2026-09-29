# Section order

The generated `SKILL.md` uses this order. Gates stay in that file.

1. Frontmatter `description`. It says when to use the skill, and that exit 0
   of a command in Gates is the only advance.
2. When to use. When the work needs a single owner, also say: do not run two
   ownership loops at once. The thin ownership file is how that is known.
   That sentence is not a gate.
3. Goals. Three outcomes, and no step list that restates the gates:
   - **Done.** What is true when the last gate has passed, including a local
     commit when the workflow's commit gate requires one. No push unless the
     user asked for one.
   - **Impossible.** The acceptance criteria contradict a preserved contract,
     or the only way through a gate is to weaken a check. Do not call that Done.
   - **Needs human.** Authority or information the agent does not have, or a
     check that cannot pass without inventing work.
4. Gates. One heading per advance, `Phase → next`. See `gates.md`.
5. Tool menu. Commands that help produce what a gate reads, and that are not
   themselves gates.
6. Constraints. What the agent must not do to make a gate exit 0.
7. Evidence. The files and fields a gate reads, when they do not fit on the
   gate's work line.
8. Self-improve, when the skill looks back. Not a shell gate. The record's
   first line is exactly one of `NO_CHANGE`, `APPLIED`, `PROPOSED`, `DEFERRED`,
   the same four words the `optimize` skill uses for a finished run. One pass.
   Prefer a change that makes a later gate decide more clearly over a longer
   explanation. `PROPOSED` names a change a person must accept. When look-backs
   show the same gates keep being ignored, that proposal names hook enforcement
   (headsign or another host hook) and the next step.

A domain section (mutation records, review rules) belongs after the tool menu
only for facts that do not fit under the gate that reads them. If the same
rule is on the gate, delete it from the later section.
