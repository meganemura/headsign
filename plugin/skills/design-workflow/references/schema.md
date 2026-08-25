# The workflow schema, in full

Read this when you need a field that `SKILL.md` does not cover, when you are
writing a phase that branches, or when `validate` rejected something you do
not recognize. Everything needed for a simple workflow is already in
`SKILL.md`; nothing here repeats it except where the exact rule matters.

## Every field, by level

**The schema is closed.** A key it does not define is an error at every
level, and the message lists what that level allows — `phase 'implement':
unknown key 'max_atempts' (allowed: description, clear, ready, gate,
on_pass, on_fail, max_attempts)`. There is no did-you-mean guess to lean on,
and there is no silent skipping: a misspelled field stops the file rather
than running a workflow its author did not write.

### Top level

| Key | Type | Required | Notes |
|---|---|---|---|
| `version` | number | yes | Must be exactly `0.1`. Not "at least" — a file written for an older schema needs its fields checked against the current one, not its version line renumbered |
| `name` | string | yes | The label in `headsign status` and in `.headsign/log` |
| `entry` | string | yes | Must name a defined phase |
| `phases` | mapping | yes | Non-empty; each key is a phase name |
| `limits` | mapping | no | Only `max_total_iterations` |

### Phase

| Key | Type | Required | Notes |
|---|---|---|---|
| `description` | string | yes | Handed to the agent verbatim on entry to the phase |
| `gate` | mapping | yes | Only `checks` |
| `on_pass` | string or list | yes | A phase name, `$end`, or a list of routes (below). Cannot be `retry` |
| `on_fail` | string | no | `retry` (default), a phase name, `$end`, or `escalate` |
| `max_attempts` | positive int | no | Failures of this phase since it last passed. Unlimited if omitted. Exhausting it always answers `ESCALATE` and ends the run |
| `clear` | list of strings | no | Paths deleted on **entry** to the phase. Relative, and no `..` |
| `ready` | string | no | A shell probe. Until it exits 0, `next` answers `PENDING` without running the gate |

### Gate, check, route, limits

| Level | Keys |
|---|---|
| `gate` | `checks` (non-empty list) |
| check | `name` (optional), `run` (required), `timeout` (optional, seconds, positive, default 120) |
| route | `when` (optional — see below), `to` (required), `timeout` (optional, default 120) |
| `limits` | `max_total_iterations` (positive int) |

Checks run with `/bin/sh -c`, in order, and **the first failure stops the
gate** — so put the cheap check that gives the clearest message first. Every
command inherits headsign's own environment; **there is no `env:` field at
any level**, so a check that needs a variable sets it inside its own `run:`
string (`run: "FOO=bar npm test"`), exactly as you would at a prompt.
`HEADSIGN_WORKFLOW_FILE` arrives regardless, in every check's, `ready:`'s and
route `when:`'s environment, holding the workflow path this run recorded,
exactly as recorded — relative when the run was started by name, absolute when
it was started with an absolute `--workflow`. It is there for the gate that has
to read its own file, which is what a workflow shipped with blanks in it needs
to check that somebody filled them in.

Deliberately absent, in case you are reaching for them out of CI habit:
`needs:`, `${{ }}` expressions, matrices, triggers, and a per-phase `env:`.
A route's `when:` is not `if:` in disguise either — it is a shell command
judged by its exit code, never an expression to evaluate.

## What `validate` rejects, and what it only warns about

Errors exit 3 and the workflow will not run. Warnings print to stderr and
exit 0, so a run in progress is never stopped by one.

**Errors worth knowing before you meet them:**

- `on_pass: retry` — a pass has to go somewhere; `retry` is a failure token.
- `max_attempts` together with `on_fail: escalate` — `escalate` ends the run
  on the very first failure, so the attempt budget could never be reached.
  One of the two is always dead; remove one.
- A `clear:` entry that is absolute or contains `..`.
- `on_pass`/`on_fail`/`to:` naming a phase that is not defined, or an
  `entry:` that is not defined.
- In a list-form `on_pass`: a last entry that **has** a `when:` (nothing
  would be the default), or an earlier entry that **lacks** one (everything
  after it would be unreachable).

**The one warning:** a phase unreachable from `entry`. That is deliberate —
a half-written phase, or an edge commented out for a minute, must not stop
the run you are in the middle of.

**And what `validate` cannot see at all:** the inside of any shell string.
It never runs a check, so a typo'd command or a missing binary passes
validation cleanly. The semantic traps it also cannot see are listed in
`SKILL.md`. One trap of the shell's own lives inside that blind spot, and is
why the boundary is worth stating rather than merely admitting: on macOS
`/bin/sh` is bash 3.2, where a variable immediately followed by a non-ASCII
character loses both its value and that character's leading byte — so write
`${var}`, not `$var`, whenever non-ASCII text follows it.

## Routing: a phase that branches

Some phases exist to decide where the work goes next. Write that as a
list-form `on_pass`: each entry has a `when:` (a shell command) and a `to:`,
and the last entry, which carries no `when:`, is the default.

```yaml
  classify:
    description: >
      Read the request and write exactly one of fix-bug, write-docs, or
      implement to .headsign/tmp/route.
    clear: [.headsign/tmp/route]
    ready: "test -s .headsign/tmp/route"
    gate:
      checks:
        # The gate checks the shape of the artifact; the routes below only
        # read it. Anything unexpected fails here rather than silently
        # landing on the default.
        - name: the route names a kind this workflow knows
          run: "grep -qx -e fix-bug -e write-docs -e implement .headsign/tmp/route"
    on_pass:
      - when: "grep -qx fix-bug .headsign/tmp/route"
        to: fix-bug
      - when: "grep -qx write-docs .headsign/tmp/route"
        to: write-docs
      - to: implement          # no when: — the default, and always last
```

The rules in full:

- Routes are resolved **after the gate passes**, and never on the failure
  path. A router phase whose own gate fails is an ordinary failing phase.
- The `when:` commands run in order and **the first to exit 0 wins**. If
  none matches, the last entry's `to:` is taken.
- `to:` names a phase or `$end`.
- A `when:` that **cannot be run at all** — fails to spawn, or times out —
  stops the run with exit 3 rather than falling through to the default. A
  non-zero exit is an answer ("not this one"); a command that never ran is
  not, and what is being decided here is where the run goes.
- **Keep every `when:` a cheap, side-effect-free predicate** — typically a
  `grep` of a file the gate already checked. Routes run on the success path,
  and several may run before one matches. The real work belongs in the gate,
  which runs once and reports what failed.

The judgment can still be the agent's while the transition stays headsign's:
the agent decides by writing a file, headsign decides by running the
commands you wrote. It never takes a phase name out of the agent's output or
out of that file, so what the agent writes can only pick among destinations
the workflow already declares.

An `ADVANCE` reached this way prints the route that was taken (`--- routed:
when "grep -qx fix-bug .headsign/tmp/route" → fix-bug ---`, or `--- routed:
default → implement ---`), and the same goes into `.headsign/log`, so the
run's history says why it went one way rather than the other.

## The less common branches

**`ready:` — a phase that waits.** When a gate depends on something slower
than the loop (a reviewer subagent still reading a diff, a person glancing
at a pull request), a `next` that arrives too early would spend a counted
attempt on a gate with nothing to judge — and, if that phase also lists the
awaited file under `clear:`, the re-entry that follows could delete a
verdict that landed a second later. A `ready:` probe (`test -f
.headsign/tmp/verdict`) turns that early call into `PENDING`: no attempt
spent, `clear:` not run, artifact intact.

**`on_fail: escalate` — stop and ask a person.** Use it where a failure
means a human decision is due rather than more work. It fires on the first
failure, which is why it cannot be combined with `max_attempts`.

**`on_fail: $end` — a failure that legitimately ends the run.** Rare, and
worth a comment saying why finishing is the right answer to a failing gate.

**`limits.max_total_iterations` — the recoverable ceiling.** Two of the
three roads to `ESCALATE` end the run: exhausting `max_attempts`, and an
`on_fail: escalate` route. The ceiling is the third and does **not** — it
means the run turned out bigger than the number someone typed, which can be
true of a run doing nothing wrong. So it answers `ESCALATE` while leaving
the run `running`: raising the number and calling `headsign next` picks up
at the same phase, with attempts and `.headsign/tmp/` intact.

**No gate can abort a run.** `on_fail` goes as far as `escalate`, and
exhausting `max_attempts` escalates too. `ABORT` comes only from a person
running `headsign abort <reason>`, so an aborted run is always one somebody
ended on purpose.

**Cheap early gates are a design requirement on you, not a service headsign
provides.** Every `next` runs the current phase's gate again, and a fresh
`headsign start` after an abort replays the workflow from the entry phase.
Write early gates as fast, idempotent checks — does a file exist, does lint
pass — rather than as work with real side effects, and re-running costs
almost nothing.

## What a run answers, so you can predict your file

| First line | Exit | Meaning |
|---|---|---|
| `ADVANCE <phase>` | 0 | Gate passed, or a failure was routed — the new phase's instructions follow |
| `RETRY n[/max] <phase>` | 1 | Gate failed, staying put — the failing check and its output follow |
| `PENDING <phase>` | 1 | `ready:` has not passed; no attempt spent |
| `COMPLETE` | 0 | Terminus |
| `ESCALATE <reason>` | 2 | A person's judgment is needed |
| `ABORT <reason>` | 2 | The run was aborted by a person |

Exit 3 is a usage or configuration error, not a verdict.
