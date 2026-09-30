# Copying gates

The entry states the gate. This file is how to copy one string.

**Env is the source of truth.** Copy the shell string exactly, as the user
wrote it or as the named file spells it. One command per line, in the
order given. All of them must exit 0. Do not paraphrase, do not add flags,
and do not split a command that contains `&&` or `||`. The agent runs the
line whole.

The lines above the fence name the work that produces what the gate reads.
The agent chooses how. That work is not a gate. When the action's name is
easy to confuse with the check (`commit` and `committed`), say the action
is not the gate.

The heading names where an exit 0 goes. Under the fence, one line says a
non-zero exit returns to the work above, unless the user named a different
return. A budget stated beside a command is one sentence next to that
line, not an extra command.

Below the fence, quote stderr you have actually seen, each with the
repair. A read-only gate may be run once to learn that string. Do not run
a command that writes, commits, or claims a ticket just to learn its
message. Read the checker. Do not invent a message.

## When the user names a file

Copy the shell strings out of that file, as written, in file order. Do not
add a command the file does not contain. Do not reconstruct its schema. A
budget or a destination stated beside a command becomes the one-sentence
budget, the heading, or the return line. It does not become a second gate.

## What is not a gate

Standing policy, or CI the user did not name as a gate, goes in the tool
menu. Say it is not a gate. A checklist titled Gate, or a completion line
with no shell string, goes under Constraints.

The same command does not appear again in the tool menu.

## Reviews

When the work asks for an independent reviewer, the work line names the
verdict files and says the author of the change does not write the
approval. A command the user named that checks the verdict is a gate. Copy
that string. Waiting on review comments is not a fence.
