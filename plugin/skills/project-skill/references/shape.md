# Section order

The generated `SKILL.md` uses this order. Gates are shell fences in this
file. Exit 0 advances.

**Why and env, one source.** The `description` is the only when-to-use.
The command strings already named are the only gate commands. Do not copy
either into a second section.

1. Frontmatter `description`. When to use the skill, and that exit 0 of a
   command in Gates is the only advance.
2. When to use. Only a fact the description cannot hold. When the work
   needs one owner, a gitignored file such as `loop.json` records it. If
   that file shows an owner, do not start a second loop. That sentence is
   not a gate.
3. Goals. No step list.
   - **Done.** Finish at human-ready: every local gate has exited 0, CI is
     green, and AI review is complete. Include a local commit when a gate
     requires one. No push unless the user asked. The agent may loop until
     Done. Wait and fix actuators are swappable.
   - **Impossible.** Acceptance contradicts a preserved contract, or the
     only way through a gate is to weaken a check.
   - **Needs human.** Missing authority or information, a check that cannot
     pass without inventing work, or standing CI this checkout cannot run.
4. Gates. One heading per advance. The heading names where exit 0 goes.
   The fence is in this file.
5. Tool menu. Commands that help produce what a gate reads. A gate command
   is not repeated here. Standing CI the user did not name as a gate is
   labeled as not a gate, when it is named at all.
6. Constraints. What the agent must not do to force an exit 0. A short
   out-of-scope list points at where that work belongs.
7. Evidence. Files and fields a gate reads, when they do not fit on the
   gate's work line.
8. Self-improve, when the skill looks back. Not a shell gate. The record's
   first line is exactly one of `NO_CHANGE`, `APPLIED`, `PROPOSED`,
   `DEFERRED`. Prefer a check, a script, or a gate over a longer
   explanation. When look-backs show the same gate keeps being ignored,
   `PROPOSED` may name hook enforcement that holds the turn until the gate
   has passed. headsign is one example. Another host's hook is the same
   proposal. Do not propose that hook before those look-backs.

A domain section belongs after the tool menu only for a fact that does not
fit on the gate that reads it. If the same rule is on the gate, delete the
later copy.
