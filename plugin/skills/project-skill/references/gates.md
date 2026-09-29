# Copying gates

A gate is one or more shell commands that already exist. Exit 0 advances.
Anything else does not.

## From a workflow file

For each phase, copy every `gate.checks` entry's `run` string into one fence,
one `run` per line, in file order. All of them must exit 0. Do not paraphrase
the command, and do not split a `run` that contains `&&` or `||` into two gates.

- `on_pass: <phase>` is the heading's destination.
- `on_fail: <phase>` is one line under the fence: a non-zero exit returns there.
- `on_pass` with a `when:` probe stays one fence. Say what an exit 0 on each
  side of `||` means. Tell the agent to run the line whole. A lone failing
  half is not a failed gate.
- `timeout:` is a budget sentence next to that line. It is not an extra command.

Above the fence, one or two lines name the work that produces what the gate
reads. That work is not a gate. When the action's name is easy to confuse with
the check (`commit` and `committed`, `close` and `closed`), say the action is
not the gate.

Below the fence, quote stderr you have actually seen, each with the repair.
A read-only gate may be run once to learn that string. Do not run a command
that writes, commits, or claims a ticket just to discover its message. Read
the checker instead. Do not invent a message.

## What is not a gate

A command that is standing policy, or that CI runs, but that no `run` names,
goes in the tool menu. Say it is not a gate.

The same `run` string does not appear again in the tool menu.

## Reviews

When the phase asks for an independent reviewer, the work line names the
verdict files and says the author of the change does not write the approval.
A rejected, stale, or empty verdict is a non-zero exit back to the producer,
once the checker's own messages say so.

## No workflow file

Use only commands the user named, or scripts they pointed at. Label the result
as the user's checks. Do not add a command because a similar repository has
one.
