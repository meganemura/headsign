# Editing a workflow, and the shapes that are not what they look like

Open this when you change a workflow file, when `validate` rejects a key, or
when you are choosing `on_pass` routes or an `on_fail` destination. Authoring
a workflow from scratch is the `design-workflow` skill. Rule 6, including
what a reported graph change requires, is `stopping.md`.

- **You can write the workflow too, not just run it.** A workflow is one
  YAML file; `headsign validate --workflow <path>` checks it statically —
  no gate runs, no state is touched — so drafting or editing one is safe at
  any time. **A run pins the rules and not the words**, which decides what
  you hear when you edit the file a run is walking: change `gate`, `ready`,
  `clear`, `on_pass`, `on_fail`, `max_attempts` or `limits` and the next
  `next` reports it once before it runs the gate; change a `description`, a
  comment, or the formatting and the run says nothing, because those sit
  outside the pin by design. So silence after an edit tells you which half
  you edited, and `stopping.md` has what to do with the report when there is
  one. Errors (exit 3) must be fixed; warnings print to stderr and
  still exit 0, so a phase nothing routes to yet won't stop the run you are
  in. Two things a phase cannot declare: an environment (a check that needs
  a variable writes it into its own `run:` string, e.g. `run: "FOO=bar npm
  test"` — there is no `env:` field), and "end the run here" on failure
  (`on_fail` goes as far as `escalate`, which stops and asks a person, and
  exhausting `max_attempts` always escalates too). On macOS, `/bin/sh`
  (bash 3.2) can mangle a `run:` string where a variable is immediately
  followed by a non-ASCII character — not just Japanese text, any
  non-ASCII (accents, arrows, emoji) — by eating that character's leading
  byte and passing a corrupted string on. Brace the variable (`${var}`,
  not `$var`) whenever non-ASCII text directly follows it; text earlier
  in the string is unaffected, and so are `zsh`, `dash`, and `LC_ALL=C`.
- **The schema is closed: a key it doesn't define is an error.** `validate`
  rejects any unknown key at any level and prints what that level allows —
  `phase 'implement': unknown key 'max_atempts' (allowed: description,
  clear, ready, gate, on_pass, on_fail, max_attempts)` — so a misspelled
  field stops the file instead of quietly doing nothing. Fix the key against
  the list in the message; there is no did-you-mean guess to lean on.
  `version:` must be exactly `0.1`, and a file written for an older schema
  needs its fields checked, not just its version line renumbered.
- **No gate can abort a run — only a person can.** `ABORT` is what
  `headsign abort <reason>` produces, so a run that reads `ABORTED` was
  ended deliberately, by you on the user's instruction or by the user. A
  run headsign itself stopped always reads `ESCALATED`.
- **A phase can branch to one of several phases.** Its `on_pass` is then a
  list instead of a phase name: each entry has a `when:` shell command and a
  `to:`, the first `when:` that exits 0 decides where the run goes, and the
  last entry — the one with no `when:` — is the default. Routes are read
  only after the gate passes. If you are the one writing such a phase, keep
  every `when:` a cheap, side-effect-free predicate (typically a `grep` of a
  file the gate already checked): they run on the success path and several
  may run before one matches, so put the real work in the gate. A `when:`
  that cannot run at all — bad command, timeout — stops the run with exit 3
  rather than guessing a destination; fix the command.
- **`on_fail: retry` and `on_fail: <this same phase>` are not the same
  thing.** `retry` stays in the phase: you keep working on the same failure,
  with the files that phase produced left where they are. Naming the phase
  itself leaves and re-enters it, which prints `ADVANCE` and runs that
  phase's `clear:` (deleting the files it lists). Re-entering is right when
  starting the phase fresh is the point — a stale review verdict has to go
  — and wrong when the work should simply continue. **What re-entry does not
  reset is `max_attempts`.** That count is failures of the phase since it
  last *passed*, so a phase you leave on a failure and come back to — by
  naming itself, or through another phase, or around a longer route — resumes
  the count where it stopped, and `headsign status` shows it as `attempt
  n/max` while the run is in that phase. A budget of 2 is spent by two
  rejections however many phases sat between them.
