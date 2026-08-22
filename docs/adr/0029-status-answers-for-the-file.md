# ADR-0029: `status` answers for the file, not only for the record

- Status: accepted
- Date: 2026-08-23
- Amends [ADR-0023](0023-pinning-the-graph-a-run-is-walking-under.md) §8: the
  two `status` lines it added report `state.json`. A third line reports the
  workflow file, compared against the pin at the moment `status` is called.

## Context

A run pins the rules it walks under, and a lap reports a difference once
(ADR-0023). The record is therefore written by `next`, and only by `next`. A
person or a program that edits the workflow file and does not run a lap leaves
`state.json` holding nothing about that edit.

`status` reported the record and stopped there, so its output was the same
before and after such an edit. A report from the author of headsign-view, a
read-only viewer of a run, carried the measurement:

```
$ headsign start                      # a workflow with one phase, entry=a
$ headsign status
RUNNING a (attempt 0)
workflow: pin
driver: not delegated yet — no agent has claimed this run

$ # add phase b to workflow.yaml; run no lap
$ headsign status
RUNNING a (attempt 0)
workflow: pin
driver: not delegated yet — no agent has claimed this run
```

That viewer draws the graph a run is walking. It reads no field of
`state.json`, because ADR-0004 makes `status` the one reader of that file and a
second reader outside the tool would break on every internal rename. Under that
rule the viewer had one question it could not ask, and the question decides
whether the picture is true: **is the file on disk the graph this run pinned?**

What it did instead was compare file modification times, and mark the picture
"cannot confirm" whenever `workflow.yaml` was newer than `state.json`. A
timestamp is metadata about a write, and the pin is a hash of parsed rules, so
the two answer different questions and agree only by luck. The viewer was
guessing, and it was guessing because the public surface held no answer.

## Decision

**1. `status` gains one more `graph:` line, computed rather than read.** It
hashes the rules on disk from where the run stands — the same
`graphFingerprint(wf, phase)` a lap takes, scoped the same way by ADR-0023 §3 —
and compares that with the pin in the record.

**2. The line appears in the two cases where the file says something the record
does not.**

- `graph: the file no longer matches the rules this run pinned — …` for a file
  edited with no report standing. This is the measured gap above.
- `graph: the file matches the rules this run pinned again — …` for a file put
  back while a report still stands. ADR-0023 §5 makes restoring free and
  silent, and this line is where that restore becomes visible before a lap runs.

When the file and the record agree, `status` prints neither line and its output
stays byte-identical to what it was — the rule ADR-0023 §8 set for the lines it
added, applied to this one.

**3. Absence means "nothing to add", and the reader can decide the question from
the lines alone.** A run with no readable workflow has nothing to compare, and
so does a run started before the pin existed. Both print nothing, and both are
already visible in the same output: an unreadable workflow degrades the attempt
count to `n/?` and drops the `--- phase: ---` block. So a reader that sees the
phase block, and sees neither the standing-question line nor the
no-longer-matches line, is looking at a file that matches the pin.

**4. `status` still judges nothing.** The comparison runs no gate, starts no
process, writes no file and takes no lock. The workflow was already loaded to
resolve the phase's `description` and `max_attempts`, so the addition is one
hash and one comparison in memory. Looking stays free, which is what protects
the division of labour ADR-0002 draws: want a decision → `next`; want to look →
`status`.

## What is deliberately not being done

**A `headsign graph` command that prints the pinned graph.** It answers more
than the question, and it would put a second rendering of the workflow on the
public surface, which then has to stay true as the schema moves before 1.0. The
question asked was whether the file matches; one line answers it.

**Reporting *which* rules differ.** `next` names the phases that moved, because
a person deciding whether to restore or accept needs them. A reader who is
looking rather than deciding needs the yes or no, and a list of phase names in
`status` would duplicate the ESCALATE message that the next lap prints anyway.

**Telling a second edit from the reported one.** A file edited again after a
report differs from the pin and also differs from what was reported. `status`
treats it as the reported case and says nothing extra; the next lap reports the
new difference, which ADR-0023 §5 already guarantees through the marker digest.
Splitting that case here would add a third reading for a state that resolves
itself on the following lap.

## Consequences

A read-only consumer can now answer the question that decides whether its
picture is true, using only the documented output of `status`. headsign-view
replaces its modification-time comparison with these lines.

`status` computes one fact rather than only restating recorded ones. That is a
new kind of work for the command, and the boundary that keeps it honest is the
one in decision 4: it may read and compare, and it may not run anything a
workflow author wrote. A future line that needs a shell command belongs in
`next`.

The output contract grows by two possible lines. Both are conditional, so every
run that neither edited its workflow nor restored it prints what it always
printed.
