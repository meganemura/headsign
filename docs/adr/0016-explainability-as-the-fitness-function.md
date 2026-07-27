# ADR-0016: Explainability as the fitness function, and the rules for a workflow that edits itself

- Status: accepted
- Date: 2026-07-28

## Context

ADR-0001 gave `src/` a budget of roughly 500 code lines and called the number
"a design smell detector, not a hard compiler limit". As a detector it has
now failed, and it is worth being precise about how.

It never fired. `src/` measured 977 code lines on 2026-07-28 — roughly twice
the number — and no feature proposal was ever stopped by it. Every increase
was individually justified at the time and none of those justifications was
wrong. The number came down three times (ADR-0012, ADR-0013, ADR-0014) and
every one of those was a mechanism being removed for its own reasons, with
the line count reported afterwards rather than driving anything. A guideline
that has been passed twice over without changing a single decision is not
being ignored by accident; it is measuring something nobody acts on.

What did fire, repeatedly, was a different signal. Every design problem found
in the work behind ADR-0008 through ADR-0015 announced itself as an
explanation that would not come out straight:

- `last_eval` was renamed to `last_failure` because the sentence saying what
  the field held needed a "but" in the middle of it.
- The claim handshake (ADR-0009) was rebuilt on `SubagentStop` (ADR-0010)
  because the event it originally hung on could not be described without a
  caveat about which session the identifier belonged to.
- `driver_session` and `driver_source` collapsed into `driver_agent`
  (ADR-0013) once the honest description of the pair was "one of these says
  which mechanism wrote the other".
- The k-way branch was put on the pass path (ADR-0011) because the
  alternative had no sayable answer to "does routing spend an attempt?".

None of those was a length problem, and none of them would have been found by
counting anything. They were all found by trying to say what a thing does and
failing.

A count also cannot point. "You are at 2× the budget" names no function; it
leaves the reader to guess where the weight is, which is the same position
they were in before the measurement.

## Decision

1. **The fitness function is explainability, and it is a workflow, not a
   number.** `.headsign/fitness.yaml` sweeps `src/*.ts` one function at a
   time: the working agent writes an explanation aimed at a middle-school
   reader, a judge reads only that explanation, and the sweep records whether
   the function was explained or not. `report` fails — `on_fail: escalate` —
   if anything reached the end unexplained. **The value over a number is that
   a failure has an address**: not "the codebase is fat" but "this function
   is too complicated", by name.

   The obvious way to game an explanation is to restate a hard clause in
   harder words, and it is also the one thing a reader who has *only* the
   explanation cannot get past. So the question put to the judge is fixed in
   the workflow file and is about prediction — could you say what this
   function does, given nothing but this? — never about clarity. "Is this
   clear?" gets a polite yes; "what would you predict?" gets an answer that
   can be wrong.

2. **The 500-line budget is retired.** `docs/architecture.md` keeps the
   measured size as a dated observation rather than a target, because a
   measurement is still worth having and a target nobody enforces is not.
   ADR-0001's third principle keeps its actual requirement — every feature
   proposal answers "does a thin harness need this?" — and loses only the
   number it was attached to.

3. **An unexplainable function does not stop the run; it is recorded.** The
   sweep files it under `.headsign/tmp/unexplained` and moves to the next
   one. Stopping at the first miss would report "we got stuck on the first
   function" — a fact about the sweep — where continuing reports "these 3 of
   71 could not be explained", which is a fact about the code. It also
   guarantees the `learn` and `improve` phases run at all, which they would
   not if the first hard function ended the run.

4. **Advice lives in notes; the graph lives in the workflow.** ADR-0003
   settled that a `description` is stage direction and only gates decide.
   The consequence, taken seriously here: **advice is the only thing that can
   safely be rewritten while a run is in flight**, because nothing has been
   decided from it and it is read again on the next entry. So the standing
   advice lives in `.headsign/notes/*.md` — `what-headsign-protects.md` for
   what a change must not break, `explaining-well.md` for how to explain —
   and the workflow's descriptions point at those files instead of restating
   them. One rule, one place (and the notes are the place the `improve` phase
   is allowed to write).

5. **A run may rewrite its own workflow, and the rule for it is: protect only
   the phases you have not entered yet.** `headsign next` re-reads the
   workflow file on every single call, so the only definitions a run still
   depends on are the ones ahead of it. In `fitness.yaml` those are exactly
   `improve` (which may be re-entered) and `report`; the phases behind it can
   be rewritten freely, and the next `headsign start` will use the new graph.
   `improve`'s own gate checks that both names are still defined — two
   checks, one per name, so a failure says which one went missing.

   Two properties of the harness are what make this safe rather than
   reckless. A rewrite that breaks the file is not a silent loss: `next`
   fails to load it, exits 3 with the validation errors, and `state.json` is
   left exactly as it was, so the run resumes the moment the file parses
   again. And a rewrite cannot invent a destination — routing only ever picks
   among edges the file declares (ADR-0011), so the worst a bad edit can do
   is stop the run, never redirect it somewhere nobody wrote down.

   Structural changes are still not the agent's to make. `improve`'s
   description says that a change wanting a new phase or a different graph is
   written down as a proposal and left for a person.

6. **`.headsign/` is this repository's own work; `example.headsign/` is what
   ships.** They were the same directory (a symlink) until this decision, and
   the two roles had already pulled apart: `triage.yaml` resolves a private
   feedback repository through `git config --global headsign.feedbackDir`,
   which is a fact about this maintainer's machine and useless as a sample.
   It moved to `.headsign/`. What stays in `example.headsign/` is written to
   be copied — including `workflow.yaml`, which is now a generic minimal
   sample rather than headsign's own development loop, since it also serves
   as the demonstration of the default file name `headsign start` picks.

## Consequences

- The question asked of `src/` changed from "how big is it" to "can it be
  said plainly", and the answer names files and functions. A sweep is a long
  run (roughly three gate evaluations per function), which is the honest cost
  of an answer that points.
- `docs/architecture.md` and `docs/maintenance.md` no longer carry a target
  to drift from. The recount command stays in `architecture.md` as a
  measurement.
- Anything a workflow tells an agent to *know* now has one home in
  `.headsign/notes/`, and workflows reference it. Advice that gets restated
  inside a description will fall out of step with the note, which is the
  failure mode `what-headsign-protects.md` #5 is about.
- A self-editing phase is a pattern other workflows can copy, with its rule
  stated once here: name the phases ahead of you and gate on their existence.
  It is worth being plain about what that gate does *not* do — it proves the
  run can still reach its terminus, not that the rewrite was any good.
- The middle rung of ADR-0007 now has a shipped example: `fitness.yaml`'s
  `judge` has a subagent write the verdict file itself instead of reporting
  it back for transcription.
