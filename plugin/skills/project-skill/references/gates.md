# Copying gates

A gate is one or more shell commands. Exit 0 advances. Anything else does
not. That is the whole advance model.

The fence is low freedom. Copy the shell string exactly, as the user wrote
it or as the named file spells it. Do not paraphrase, do not add flags, and
do not split a command that contains `&&` or `||` into two gates. Tell the
agent to run the line whole. A lone failing half is not a failed gate.

The lines above the fence are high freedom. They name the work that
produces what the gate reads. They do not fix the path step by step. That
work is not a gate. When the action's name is easy to confuse with the
check (`commit` and `committed`, `close` and `closed`), say the action is
not the gate.

## Commands to copy

Lead with the commands the user named, or the scripts they pointed at.
Copy each command into one fence, one command per line, in the order given.
All of them must exit 0.

The heading names where an exit 0 goes. Under the fence, one line says a
non-zero exit returns to the work above the fence, unless the user named a
different return.

A budget the user stated beside a command is one sentence next to that
line. It is not an extra command.

Below the fence, quote stderr you have actually seen, each with the repair.
A read-only gate may be run once to learn that string. Do not run a command
that writes, commits, or claims a ticket just to discover its message. Read
the checker instead. Do not invent a message.

## When the user names a file

Copy the shell command strings out of that file into the fence, as written,
in file order. Do not add a command the file does not contain. Do not
reconstruct the file's schema. A budget stated beside a command in that file
is the same one-sentence budget, not an extra command. A destination stated
beside a command becomes the heading, or the return line. It does not become
a second gate.

## What is not a gate

A command that is standing policy, or that CI runs, but that the user did
not name as a gate, goes in the tool menu. Say it is not a gate. Human-ready
Done may still require CI green and AI review complete. That sentence is
Goals, not a fence.

A checklist titled Gate, with no shell command that can exit, is not a gate.
Put it under Constraints. A "completion criterion" written as prose, with no
shell string, is the same. It is not a gate.

The same command does not appear again in the tool menu.

## Reviews

When the work asks for an independent reviewer, the work line names the
verdict files and says the author of the change does not write the approval.
A rejected, stale, or empty verdict is a non-zero exit back to the producer,
once the checker's own messages say so. A command the user named that checks
the verdict is a gate. Copy that string exactly. Waiting on review comments
is not a gate and not a procedure in this file.
