# Preserve command meaning

Read named scripts or files and repository instructions before copying commands.
Copy shell strings exactly, including flags and compound expressions such as
`&&` or `||`. State their working directory and required environment. Preserve
the source so later changes can be checked against the actual contract.
Do not infer a mandatory execution order from a list; preserve actual
dependencies and any order the user explicitly requires.

Distinguish checks from work that produces evidence, queue actions, and standing
CI. A gate has an executable check and a property its success establishes.
A successful command does not establish unrelated completion requirements.
Human judgment remains explicit when it cannot be reduced to a command.
Do not place the same command in both Gates and a tool menu.

Inspect before running. Verify availability and behavior in proportion to risk;
do not replay a commit, publication, ticket mutation, or destructive action
just to observe its message. Report what was executed and what was inspected.
Keep unavailable commands visible as gaps instead of inventing replacements
or claiming the associated requirement is satisfied.

For named workflow files, extract outcomes, checks, evidence, approvals, and
explicit budgets rather than copying their state transitions. Past counters
describe a previous run; they do not grant fresh authority. Preserve useful
project helpers regardless of directory name. If a helper depends on a retired
runtime, identify a verified replacement or report the migration gap before removal.
Verify affected input creation and completion updates, not just one invocation.
Do not invent replacement queue or ownership infrastructure.

When the request is only to copy commands, do not silently add or change them.
Explain missing coverage. If broader work is authorized, implement and verify
a needed check before making it a required gate. Later agents may improve
checks within task authority while preserving the requested outcome.
