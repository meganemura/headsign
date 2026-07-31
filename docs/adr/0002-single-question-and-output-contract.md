# ADR-0002: One question (`next`), the output contract, and the transition table

- Status: accepted
- Date: 2026-07-23
- Revised: 2026-07-28 (the transition table's failure rows are narrowed by
  [ADR-0014](0014-removing-three-unused-knobs.md): `on_fail` loses its
  `abort` value and `on_exhausted` is removed, so exhaustion always
  escalates. The table below is updated in place. The output contract is
  untouched — `ABORT` is still one of the six tokens, produced by
  `headsign abort` and reprinted idempotently by `next`.)
- Revised: 2026-07-28 —
  [ADR-0017](0017-three-budgets-and-the-recoverable-ceiling.md) makes the
  `limits.max_total_iterations` row non-terminal: it still answers
  `ESCALATE` (exit 2), but writes no state, so the run stays `running` and
  can be continued by raising the limit. The table row and the
  idempotent-on-terminal-states paragraph below are updated in place. The
  six tokens are unchanged.
- Revised: 2026-07-31 — `headsign status` gains two conditional lines
  ([ADR-0025](0025-a-stop-that-passed-and-a-stop-that-never-ran.md)), and
  two commands about the *tool* rather than a repository are added:
  `version` and `help`. Both are covered in the parenthetical below. The
  six tokens and the six commands are unchanged.

## Context

Beads (`bd ready`) demonstrates that agent discipline compresses well when
there is exactly one question to ask. Splitting `status` / `gate` / `next`
into separate commands multiplies the rules an agent must remember and the
ways it can go wrong after compaction.

## Decision

### Six commands, one (driver's) question

| Command | Role |
|---|---|
| `headsign start [name] [--workflow path]` | initialize state, show the entry phase's instructions |
| `headsign next` | **the only question a driving session asks.** Run the current gate, transition, answer |
| `headsign abort [reason]` | record a human-directed stop |
| `headsign validate [name] [--workflow path]` | static check of workflow.yaml |
| `headsign status` | read-only report of the current run, for a session that isn't driving it (ADR-0008) |
| `headsign claim` | arm a one-shot marker for the `SubagentStop` hook to adopt this delegated agent as driver (ADR-0009, ADR-0010) |

A bare `<name>` resolves to `.headsign/<name>.yaml`; `--workflow <path>`
still takes an explicit path, and the two are mutually exclusive.

`next` is the only command that transitions state. RETRY output doubles as
the remaining-work list (the failing check and its output tail), which is
why no *second driver command* exists.

`status` (added by ADR-0008, once multi-session use made a read-only
observation window necessary) does not reopen that question. It never runs
a gate and never transitions state, so it isn't a command competing with
`next` for "the one question" — it's for a session that has no question to
ask at all, only something to look at. Its own first-line vocabulary
(`RUNNING`/`COMPLETE`/`ESCALATED`/`ABORTED`) is a distinct, non-judging
report, not an extension of the token contract below — see ADR-0008 for its
output and exit-code contract. "One question" in this ADR's title and
decision has always meant *the driving session's* question; `status`
exists precisely for sessions that are not asking it.

`claim` (added by ADR-0009, once it turned out a session cannot in
principle discover its own identifier from inside its own process) also
does not reopen the question. It runs no gate, transitions no phase, and
answers no verdict — it only arms `.headsign/tmp/claim`, a marker for a
later hook firing to act on (ADR-0010 moved which firing that is, from
`Stop` to `SubagentStop`; the command itself is unchanged by that move,
which is the point of it arming a marker rather than stamping anything
itself). Its own first-line token, `CLAIM`, is a third distinct
vocabulary, exactly as separate from the ADVANCE/RETRY/… contract below
as `status`'s `RUNNING`/`COMPLETE`/… is. "The one judging question is
`next`" survives this addition unchanged, the same way it survived
`status`'s.

(Two hidden subcommands exist for the plugin's stop-boundary hooks —
`stop-hook` for `Stop` (ADR-0006) and, since ADR-0010, `subagent-stop-hook`
for `SubagentStop`. Both are plumbing invoked by Claude Code itself, not
part of the agent-facing surface, and neither is listed in `--help`.)

`help` and `version` are typeable, listed, and still do not make the six
eight — because the criterion was never "what an agent may type", which
`-h`/`--help`/no-args already strained. **The six take a repository as their
subject: a run, or a workflow file. These two take the tool.** Nothing they
print is about the state of anything in `.headsign/`, which is why neither
answers with a token from the contract below and why both always exit 0. Stated
precisely, because two looser versions are both false: `help` prints six of the
seven tokens in its own text — every one but `START`, which appears there only as
the lowercase command name. What it never does is *answer* with one: line 1 is not
a verdict and the exit code is not a verdict. And that last part is worth stating rather than
inferring: asking a tool what it is cannot be a usage error, so `headsign help`
exits 0 where `headsign --badflag` exits 3.

`version` exists because of a gap [ADR-0025](0025-a-stop-that-passed-and-a-stop-that-never-ran.md)
opened. An installed plugin copy is version-scoped, so a released fix does not
reach a machine whose copy is older, and that ADR's diagnostic advice — establish
which version is in play before reading the workflow or the gate — had no command
to answer it. It prints the bare version and nothing else: the command name has
already said which tool, and a bare value composes as well as it reads. The
number is substituted into the bundle at build time rather than read from
`package.json` at runtime, because the bundle ships through two channels and that
file is reliably present in only one of them.

**This ADR is the one place that reasoning is written.** Every other mention of it —
in `src/cli.ts`, the release runbook, the reference manual, the changelog — should
be a pointer here rather than a restatement, and the reason is empirical: it was
restated in nine places, and when it turned out to be wrong it was corrected in two
of them, leaving the other seven asserting the retracted version.

Two checks bind the reported number to `package.json`, and the useful difference
between them is *when* they fire rather than what they prove. An acceptance test
drives the **committed** bundle and compares its baked version against
`package.json`; it runs under `npm test`, so a bump without a rebuild fails on any
laptop and inside `prepublishOnly` — before anything leaves the machine. CI's
`npm run build` then `git diff --exit-code plugin/dist` catches the same mistake,
because the rebuild bakes the current version and so differs from a stale committed
bundle byte for byte. But CI runs *after* a push, and pushing to `main` is itself a
distribution moment for plugin users: that check is the second net, not the one that
prevents the mistake.

Two ways to get a version that is wrong rather than absent, both closed: an
identifier that was never substituted, and one substituted with the empty string.
The second is the one that got through review — `--define` with an empty value
still substitutes, so a `typeof` guard folds to `if (false)` and the command
prints a blank line and exits 0. The build script now refuses to run without a
version at all, and the guard treats an empty one as absent.

`help` is symmetry, and cheap: `-h`, `--help`, no arguments, and `help` are four
spellings of one text. `-v` is deliberately not a fifth spelling of `version` —
it reads as *verbose* in enough tools that claiming it now would foreclose the
more useful meaning later.

### Output contract

Line 1 is a machine-readable token; everything after is instruction text for
Claude. Output is English (public OSS tool; the token line is the contract,
so prose language is cosmetic).

```
START <phase>       exit 0   (from `headsign start`)
ADVANCE <phase>     exit 0
RETRY <n>[/<max>] <phase>   exit 1
PENDING <phase>     exit 1   (not ready yet — no attempt counted; see below)
COMPLETE            exit 0
ESCALATE <reason>   exit 2
ABORT <reason>      exit 2
```

Configuration/usage errors exit 3. (These are CLI exit codes; unrelated to
hook exit-code semantics.)

`next` is idempotent on terminal states: calling it after COMPLETE reprints
COMPLETE (exit 0); after escalation/abort it reprints that outcome (exit 2).
This is what makes "when in doubt, run `headsign next`" safe advice,
including right after `/compact`.

One producer of ESCALATE does not make a run terminal, and so is not covered
by that rule: reaching `limits.max_total_iterations` answers ESCALATE while
leaving `status: running`
([ADR-0017](0017-three-budgets-and-the-recoverable-ceiling.md)). Asking again
reprints the same answer, unchanged and uncounted, until a person either
raises the limit — after which `next` resumes the same phase — or ends the
run with `headsign abort`. The safety of "when in doubt, run `headsign next`"
is what the rule above exists for, and it survives here for the same reason:
the ceiling answers without moving the run.

### Transition table (the whole routing rule set)

Evaluated on `headsign next` for the current phase P:

| Event | Route field | Allowed values | Effect |
|---|---|---|---|
| `ready:` probe fails (phase declares `ready`) | `ready` (optional) | non-empty shell string | PENDING (see below) |
| gate passes | `on_pass` (required) | phase name, `$end` | ADVANCE to phase / COMPLETE |
| gate fails, attempts < max | `on_fail` (default `retry`) | `retry`, phase name, `$end`, `escalate` | RETRY / ADVANCE(with failure note) / COMPLETE / ESCALATE |
| gate fails, attempts ≥ `max_attempts` | — (fixed) | — | ESCALATE |
| `limits.max_total_iterations` reached | — | — | ESCALATE, run stays `running` (checked before evaluating; ADR-0017) |

Notes:

- A fail-routed phase transition (e.g. review rejected → back to implement)
  emits **ADVANCE** with a "gate failed → routed to X" note. Claude only
  needs to know where to go; that keeps a routing effect from costing a
  token of its own.
- `max_attempts` absent means unlimited per-phase retries;
  `limits.max_total_iterations` is the global runaway backstop. It is a wall,
  not an ending: the run stops in front of it, spends no iteration doing so,
  and continues if someone raises the number (ADR-0017).
- Checks run in order and stop at the first failure; its `name` (or `run`
  text) plus a stdout/stderr tail become the RETRY message.
- The `ready:` probe is evaluated before the gate — never inside it, and
  never inside `step()`. It is itself uncounted: no
  `attempts`/`total_iterations` change, `last_failure` and `stop_nudges`
  are untouched, and `state.json` is not written at all on this path. A
  phase with no `ready:` behaves exactly as before this ADR's revision —
  always "ready", straight to the gate.

## Consequences

- The skill can teach one rule: obey the first-line token.
- A sixth token or a sixth command still requires revisiting this ADR — the
  friction is deliberate, and PENDING was the first time it was worth
  paying. Real usage (a second round of field feedback, reviewed against
  the run logs and cross-checked with a persona-based design review) found
  the four-token vocabulary had no way to say "no verdict exists yet"
  without reusing RETRY — and RETRY meaning both "no verdict" and "verdict:
  fail" was close to a lie. An async review phase's `next`, called early,
  would burn a counted attempt for work nobody had judged, and a `clear:`
  on the phase's own re-entry could then discard a verdict that arrived a
  moment later. That is a real, distinct failure mode from a rejected
  gate, and conflating the two under one token was the bug — not a
  simplification worth keeping. Paying this ADR's friction once, on
  purpose, was cheaper than leaving that lie in the contract.
- This ADR's own rule was tested again, and paid again, by `status`
  (2026-07-25, ADR-0008): a fifth command needed exactly this kind of
  revisit. It bought a real distinction the four-command surface had no
  way to express — asking a question versus only observing — without
  adding a sixth token, because `status` never touches the token contract
  above at all; it just isn't `next`'s kind of command.
- The rule was tested a third time, and paid a third time, by `claim`
  (2026-07-25, ADR-0009): a sixth command was needed for a reason that
  overlaps neither revisit before it — not "no verdict exists yet"
  (PENDING) and not "observe without asking" (status), but "a session
  cannot discover its own identity from inside itself; only a
  stop-boundary hook, at the moment it fires, can answer that." `claim`
  buys that distinction without touching the token contract above at
  all, the same way `status` didn't: it is one more command that isn't
  `next`'s kind of command, arming a signal for the hook to consume
  rather than asking a question itself.
