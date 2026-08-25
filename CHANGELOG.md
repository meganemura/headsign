# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).
During 0.x, a minor bump means feature additions (which may include breaking
changes), and a patch bump means fixes only.

## [Unreleased]

### Added

- **`next` now writes progress to stderr while a gate runs, and names a slow
  check's limit.** A gate printed nothing until its last check finished, so a
  caller with a time limit on one command that got cut off mid-gate learned
  nothing from it: not how many checks the gate held, which one was slow, or
  whether the interrupted lap had spent an attempt. `next` now writes one
  line before the first check starts, naming the gate's size, then one more
  line per check that finishes, each with its name, how long it took, and
  which of three ways it went — a timeout gets its own word rather than
  reading as an ordinary failure that happened to take two minutes. Once the
  elapsed time it shows has reached half the check's own limit — the
  `timeout:` its author wrote, or the 120-second default when they wrote
  none — the line names that limit too, so a duration mid-gate reads against
  something; a `timed out` line always carries it, decided by the fact of being
  killed at the limit rather than by the rounded elapsed time beside it. A check
  that never produced an exit code gets no line — headsign refuses the lap on it
  and names the check in that refusal already. Unconditional — no flag turns it
  on — and the token on stdout is unchanged
  ([ADR-0032](docs/adr/0032-the-gate-says-how-far-it-got.md)).

### Changed

- **The `design-workflow` skill now says what to do when an ordinary outcome
  fails a gate.** Its list of mistakes `validate` cannot catch already said that
  a list-form `on_pass` is never read on the failure path, and stopped there —
  leaving the author who needs to branch out of an expected-but-failing lap with
  the half of the answer that says where routes are not read. The failure edge
  does carry a run onward, but it cannot tell two expected outcomes apart: one
  destination serves every way the gate can fail, each exit through it is
  recorded as a gate failure and spends an attempt, and `on_fail: $end` answers
  `COMPLETE` for a lap whose gate had just failed — unless that lap spent the
  phase's last `max_attempts`, which escalates before `on_fail` is read. The
  entry says to restate the gate so the expected outcome passes it and to branch
  on `on_pass` instead, gives the test for spotting it — is every way this gate
  can fail one you want handled on the failure edge? — and names this
  repository's own triage workflow, which was written the other way once.

- **CI runs the coverage thresholds.** `npm run coverage` has enforced 100% of
  lines and functions in `src/` for as long as it has existed, and nothing ran
  it: it went red and stayed red for a release cycle with one `catch` block
  uncovered, and only a hand-run found it. It now stands where `npm test` stood
  in the workflow — the same files and the same runner, two thresholds added —
  rather than joining it, because a suite that races real processes against a
  lock is a flake surface, and running it twice for one set of assertions
  doubles that for nothing. The gap it was hiding is closed in the same change,
  with a test for a `clear:` entry whose parent directory does not exist.

## [0.9.0] - 2026-08-23

Everything here came from one place: a viewer being built against headsign,
asking what it may depend on and finding the answers only in internals.

`headsign status` now says when the run entered the phase it is on, so
time-in-phase can be shown without reading `.headsign/log`. And what is a
contract is written down rather than left to subtraction: `next`'s token, its
exit code, and `status`'s first line — nothing else.

The authoring skill and this repository's own workflows also stopped telling
the agent how to arrange its labour, finishing what v0.8.0 started with
`fan-out.yaml`.


### Changed

- **`headsign status` says when the run entered the phase it is on.** A viewer
  drawing a run had no way to show how long a phase has been going: the
  transitions are in `.headsign/log`, which is gitignored internal state, and
  neither timestamp `status` already printed answers it — `last moved:` is
  stamped by every `start` and `next`, so a retry moves it while the run stands
  where it stood. `state.json` gains `phase_entered_at`, written in one place,
  beside the call that runs the phase's `clear:` — so `on_fail: retry` leaves it
  alone and `on_fail: <this same phase>` moves it, which is the boundary the
  schema already draws. headsign still computes no duration and still limits no
  run by time; the timestamp is printed as recorded and the subtraction is the
  reader's
  ([ADR-0031](docs/adr/0031-when-the-run-entered-the-phase.md)).
- **What is a contract and what is not is now written down.** `next`'s
  first-line token with its exit code, and `status`'s first line with the
  exit-code rule beside it, are guaranteed. Everything else any command prints
  — every other `status` line, the failure and phase blocks, the wording, the
  order, and whether a conditional line appears at all — may change in any
  release, patch releases included. ADR-0002 already said the token line was
  the contract; what it left to inference was that the rest is not, and a
  silence reads as a guarantee to anything parsing the output. A tool that
  reads this output should pin the version it tested against, match strings
  exactly, and fail loudly rather than guess
  ([ADR-0030](docs/adr/0030-the-token-line-is-the-contract-and-nothing-else-is.md)).
- **The `design-workflow` skill now says to describe a phase by what must be
  true, not by who does the work.** A description that reads "spawn a subagent
  to clean this up" lands as a constraint rather than an instruction: it fixes
  one worker per phase, in the order the file happens to list them, decided by
  an author who cannot see the change. The skill's list of mistakes `validate`
  cannot catch gains that one, along with the exception that is authority
  rather than arrangement — who may author a verdict, and what that author may
  see, stays fixed (ADR-0007). Its worked example drops the word `subagent`
  from its review phase for the same reason.

## [0.8.1] - 2026-08-23

A release-procedure fix, and the release it repairs.

### Fixed

- **The Codex plugin manifest now carries the release version.** v0.8.0 bumped
  `package.json` and `plugin/.claude-plugin/plugin.json` and left
  `plugin/.codex-plugin/plugin.json` at `0.7.0`, so Codex plugin users could not
  receive that release at all: a plugin update is decided by comparing that
  string, and `codex plugin add` found nothing new, reported success, and moved
  no version. Claude Code plugin users and npm consumers were unaffected — both
  of their version strings were correct — and v0.8.0's CLI is the same code this
  release ships.

  The cause was the release procedure rather than the check that caught it.
  `docs/maintenance.md` step 1 said to bump "**both** `package.json` and
  `plugin/.claude-plugin/plugin.json`", which stopped being the whole list in
  v0.7.0 when the second host arrived with a manifest of its own. That step now
  takes its list from the tree.

## [0.8.0] - 2026-08-23

Two changes, and one sentence under both of them: **the graph sequences checks,
and the agent sequences work.**

`headsign status` now answers for the workflow file in front of you, not only
for what the record was last told about it. That closes the one question a
read-only reader of a run could not ask, and the reader that asked for it is a
viewer that draws runs.

`example.headsign/fan-out.yaml` stops requiring a worktree and a child run per
piece of work. Deciding how to divide work, and by what machinery, belongs to
the agent that can see it.

### Added

- **`headsign status` says whether the file on disk is the graph the run
  pinned.** A difference reached `state.json` only when a lap reported it, so
  between an edit and the next `headsign next` the record held nothing about it
  and `status` printed the same output either way. It now compares the rules on
  disk with the pin as it reads them, and prints one `graph:` line for a file
  edited with no lap yet run, and one for a file put back while a report still
  stands — the one place the free, silent restore shows before you run anything.
  Both lines are conditional, so a run whose file agrees with its record prints
  what it always printed. The comparison runs no gate, writes nothing and takes
  no lock ([ADR-0029](docs/adr/0029-status-answers-for-the-file.md)).

### Changed

- **`example.headsign/fan-out.yaml` stops prescribing how the agent fans out.**
  The README says headsign has no opinion about how the agent gets a phase
  done — "if it wants to hand a step to three subagents, or run two things at
  once, that is its call to make, not this tool's to grant" — and this example
  granted it anyway: its `split` gate required a git worktree and a child
  `headsign start` for every item, so an agent that judged three subagents in
  one tree to be the better division failed a gate for being right.

  The division and the machinery are now the agent's, per piece. It records
  what it chose in `.headsign/tmp/plan.md`, and lists in `.headsign/tmp/items`
  only the pieces it gave runs of their own — possibly none. The gate verifies
  that recorded choice instead of requiring one, and a route out of `split`
  skips the join when nothing was given its own run. The line the file now
  draws: the graph sequences checks, and the agent sequences work.

### Fixed

- **Updating on Codex is two commands, and the docs said one.** They carried
  the Claude Code form and stopped there. Under Codex, `codex plugin add`
  installs from a marketplace snapshot Codex keeps on disk, so running it alone
  re-installs whatever that snapshot already held — the command reports success
  and the version does not move. `codex plugin marketplace upgrade` refreshes
  the snapshot first. Running only the second half is the failure to expect,
  because it looks exactly like success.
- **"until Claude Code restarts" now says "until the host restarts."** Written
  when there was one host, in a sentence that already began "either way".
  `headsign version` answers per host, so two hosts on one machine disagree
  until both have restarted.

## [0.7.0] - 2026-08-22

headsign has run on one host since it existed, and the decision that said so was
written down. It now runs on two. Nothing in the CLI changed to make that true —
gate judgment, state, locking and logging never read a host — so what moved was
the packaging and the prose, plus one honest account of what does not port.

The release is a minor rather than a patch for a second reason: `clear:` used to
remove a file outside the run's directory, and stopping it changes what a
workflow does.

### Added

- **Codex is a second host.** headsign installs as a Codex plugin, ships the
  same two skills, and registers the same stop-boundary backstop through Codex's
  hook engine — the same `hooks.json`, executed by both. Install with
  `codex plugin marketplace add meganemura/headsign` and
  `codex plugin add headsign@headsign`; Codex asks you to review and trust the
  hook commands separately, under `/hooks`.

  **One thing in those commands looks wrong and is not:** the plugin's directory
  arrives in `CLAUDE_PLUGIN_ROOT`. Codex defines that name and its own
  first-party plugin uses it, so the registration is unchanged from the version
  that ran on Claude Code alone.

  What does not port: Codex's ordinary commands expose no session variable this
  research could confirm, so a Codex run records no `last_drive.session`. The
  consequence is narrow and named in
  [ADR-0028](docs/adr/0028-codex-as-a-second-principal.md) — on an unclaimed
  Codex run with no stamp, more than one session can receive the backstop.

- **Every plugin manifest's version is checked, not the first one written.** A
  manifest left behind does not break an install; it makes the update a silent
  no-op, because a plugin update is decided by comparing that string. The check
  discovers the manifests rather than naming them, and refuses when it finds
  none.

### Fixed (security)

- **`clear:` no longer removes a file outside the run's directory.** The
  schema rejects `..` and a leading `/`, which reads as a promise that the field
  cannot reach out of the tree — but that check examines the string, and a
  symbolic link is a fact about the disk. An entry like `output/leftover.txt`,
  where `output` is a link pointing elsewhere, deleted the file at the far end
  and announced `--- cleared: output/leftover.txt ---` about it. Reproduced
  against 0.6.1. Such an entry is now refused and reported as
  `--- not cleared: <path> (resolves outside this run's directory) ---`.

  **This is as easy to trigger by accident as on purpose:** a repository that
  links its build directory, or links a package across a monorepo, reaches it
  with no ill intent at all.

  A link named *directly* in `clear:` is unchanged, and deliberately so — it is
  removed as a link, and what it points at is left alone. Only the path leading
  to an entry is resolved, never the entry itself.

### Fixed

- **Installing headsign no longer installs a package it never uses.** `yaml`
  was declared as a runtime dependency while the build inlines it into
  `plugin/dist/headsign.mjs`, whose only remaining imports are Node built-ins.
  Every consumer downloaded a copy that nothing loaded. It moves to
  `devDependencies`, where it is still what parses your workflow file — from
  inside the bundle. A clean install of the tarball now adds one package.

- **A rejected `on_pass` now names `$end`.** `on_pass: complete` — the word a
  writer reaches for when they mean "this is the last phase" — answered `does
  not name a defined phase` and left the reader to find the sentinel somewhere
  else. It now says `does not name a defined phase or '$end'`. The same
  correction applies to a route's `to:`, and deliberately not to `entry:`,
  which cannot be `$end` at all.

- **The README said the plugin ships three things and shipped four.** The
  `design-workflow` skill — the one that writes the YAML with you, which is
  exactly the friction the sentence above is about — went unmentioned.

- **`docs/architecture.md`'s list of design records was missing five of them**
  (0019, 0020, 0025, 0026, 0027), while the prose above it already cited 0027.

- **An optional field that has no value is now absent from the record, not
  present holding nothing.** `state.json` never carried the difference —
  `JSON.stringify` drops an `undefined` value — so nothing a run writes to disk
  changes. What changes is the shape in memory, which `status` reads back and
  which tests compare against: a `last_failure` for a check that did not time
  out no longer carries a `timeout_seconds` key at all. Three tests were
  asserting the old shape, and so were asserting a record that has never
  existed on disk.

- **The reference now says how to actually perform an update.** It spent a
  paragraph on updating being a separate event from declaring a version, and
  stopped short of the command — leaving the reader who followed the reasoning
  with no way to act on it. Worse, the obvious guess fails: `claude plugin
  update headsign` answers `Plugin "headsign" not found`, because `update`
  resolves the `plugin@marketplace` pair that `claude plugin list` prints, so
  the working form is `claude plugin update headsign@headsign`. The section also
  now says that the fetched copy does nothing until Claude Code restarts, and
  that `headsign version` keeps reporting the old copy until it does.

## [0.6.1] - 2026-08-17

One cause, in both of the two places headsign asks to be registered as a hook,
and it is one the previous six releases could not have reported: the symptom
only appears on a machine this project has never run on. A plugin brings its
own hooks, and headsign's two ran the bundle through `node` without checking
that a `node` was there to run. Where there was not, the only thing the plugin
did was print an error — at every turn end, in every repository, including the
ones with no workflow at all. The registration this project documents for
people who use the CLI without the plugin had the same hole, plus one of its
own.

### Fixed

- **Installing the plugin on a machine with no reachable `node` no longer
  prints a hook error at every turn end.** The plugin registers its two
  stop-boundary hooks in every session, including sessions in repositories that
  never heard of headsign, and `node` is the one thing the bundle needs and
  cannot bring. When Claude Code is installed natively, or when node comes from
  a version manager whose shim only an interactive shell sets up, the hook
  process failed to spawn and Claude Code showed a `Stop hook error` notice —
  in a repository with no `.headsign/` at all, that notice was the only thing
  headsign ever did. Both registrations now check for the interpreter first and
  exit 0 in silence when there is none. Nothing changes on a machine that has
  node: stdin still reaches the CLI, and the nudge's exit 2 and stderr still
  reach Claude Code. The trade is that a missing interpreter takes the backstop
  out without saying so, which is the direction the hook already fails in —
  [ADR-0005](docs/adr/0005-distribution-and-toolchain.md) records it, and
  `tests/acceptance.test.ts` runs the registration strings themselves.
- **The by-hand backstop recipe in the reference no longer reaches for the
  network.** It passed `npx headsign stop-hook`, which tries to fetch the
  package when it is absent — the same "not installed" case, at every stop. It
  now resolves the project-local install, then one on `PATH`, then `node`, and
  exits 0 in silence the moment one of those is missing. It checks the
  interpreter separately because finding the CLI does not establish that it can
  run: `node_modules/.bin/headsign` is a symlink to a `#!/usr/bin/env node`
  script, so on the machine this change is about it is present, executable, and
  exits 127 anyway.

## [0.6.0] - 2026-08-15

Field reports drove almost all of this one, and they cluster: most of what
changed is headsign saying something it already knew and had been keeping to
itself. A gate that failed named the check that failed and nothing else. A run
that could not be resumed looked exactly like one nobody had touched. A driver
deciding whether to spend an attempt had no way to learn what spending the last
one would do.

### Changed

- **Accepting a mid-run change to the workflow's rules is now its own command.**
  It used to be "run `headsign next` again" — the same input as an ordinary
  retry. That made acceptance something a caller could perform without meaning
  to: anything issuing `next` more than once without reading the output in
  between (a batch, a loop, a wrapper that retries on non-zero) accepted a rules
  change with nobody having seen the report. Acceptance is now
  `headsign next --accept-graph-change`; a bare `next` re-reports the change for
  as many laps as you ask, counting nothing and spending neither an attempt nor
  an iteration. The flag refuses with exit 3 when no reported change is
  outstanding, so it cannot be carried habitually. **If you have a script that
  relied on the second `next` accepting, it now needs the flag.** The reasoning
  this replaces — that a separate command would claim what it cannot prove — is
  retracted in
  [ADR-0023](docs/adr/0023-pinning-the-graph-a-run-is-walking-under.md), with the
  half of it that still stands: the flag proves nothing about who ran it, and
  never claimed to. What it buys is that repeating one command can no longer
  perform the other by accident.

### Added

- **`headsign status` now prints the current phase's instructions**, in the same
  `--- phase: <name> ---` block `start` and `next` print. Those instructions used
  to exist only in the output of a judgment, so re-reading them cost either an
  attempt or nothing at all. This matters most where the work is delegated: an
  agent that never runs headsign cannot see the gate's requirements at all, and
  this block is what gets handed over — verbatim rather than from memory.

- **A run paused with a note now says so on `status`.** The note is still
  consumed at the stop it was written for, but its first line stays on the
  record, under `last stop:`. A run parked deliberately on a gate that needs a
  person used to be indistinguishable, to anyone else reading the directory,
  from a run somebody walked away from.

- **A failing gate names the checks it never reached.** Checks run in order and
  the gate stops at the first failure, so a lap that fails is the lap where the
  gate examined the least — and a loop that ends on a failing lap can leave a
  check that never ran once in the whole walk. `--- 2 of 3 checks ran; 1 not run:
  <name> ---` appears on a `RETRY` and on a fail-routed `ADVANCE`, with `ran=2/3`
  in `.headsign/log` so it can still be answered after the run has ended. Not
  shown when the failing check was the last one, and an exhausting failure
  reports only its reason.

- **A repeated failure says it is one.** From the second identical failure
  onward — same check, same command, same exit code, same output — the block
  names how many in a row, and the closing advice changes: "fix the failure
  above" assumes a fixable failure, and the second identical one is where that
  assumption is worth questioning. Where the phase declares `max_attempts`, it
  also says what running out costs. None of it claims a gate cannot pass; that
  would take running arbitrary shell to know.

- **`clear:` reports an entry it could not clear.** It removes files and has
  never removed a directory, but the attempt failed silently, so a phase could
  name one on every entry and have nothing happen. Now the entry is named on
  entry, and `headsign validate` warns about a trailing-slash entry — the one
  form of the mistake visible without reading a filesystem. The field's reach is
  unchanged: deleting a tree is destructive with no undo, and this field runs
  every time a phase is entered.

- **`headsign help` says what each command touches** — read-only, or which of
  `state.json`, `log`, `lock`, `tmp/` it writes, plus the two writes that leave
  `.headsign/`: `start` amends a tracked `.gitignore`, and both `start` and
  `next` delete whatever the phase they enter lists under `clear:`. Deciding
  whether a command can disturb a repository used to mean running one somewhere
  else to find out.

### Documentation

- **The reference manual gained a section on what a run keeps and what outlives
  it** (both languages): what `start` folds away, what `clear:` folds away on
  each entry, that everything outside `.headsign/tmp/` outlives the run, that
  budgets are per run rather than per tree, and what `abort` actually costs. It
  also states where the graph pin stops — a check's `run:` string is pinned, and
  whatever that string executes is not.

- **The workflow-authoring skill gained a good deal**, most of it from questions
  people answered by guessing: how long an anchor lasts and how to place a guard
  without depending on the order of lines; that a loop needs a measure *and* a
  separate stopping condition, with the standard form it comes from; what makes
  another check worth adding, when a phase count is too high, and whether an
  always-green check is worth keeping; that a check which writes costs the driver
  the ability to rehearse the gate by hand; that a check and the instruction
  satisfying it have to move together; and where to put a value one round needs
  to hand to the next.

### Fixed

- **The reference manual said neither stop-boundary hook compares session
  identifiers.** It has compared one since 0.5.0's `last_drive` work: a stop
  whose session does not match the one on record passes silently. The section
  describing the hooks now agrees with the section describing the behaviour in
  full, six hundred lines away.

## [0.5.0] - 2026-08-01

### Added

- **You can now ask which copy of headsign is running.** An installed plugin copy
  is version-scoped, so a released fix does not reach a machine until that copy
  updates — and when a report came in that a fix was missing, or that a gate
  behaved differently for one person, there was no way to establish the version
  in play. The reference told you to start by doing exactly that and then had to
  admit the tool could not answer. `headsign version` (or `headsign --version`)
  now prints the bare version and nothing else, so it reads and composes equally
  well: `v=$(headsign version)`. It is baked in when the bundle is built rather
  than read from `package.json` at runtime, which a copy cached from the plugin
  marketplace does not have above it — so the number cannot come from some other
  package. See
  [ADR-0002](docs/adr/0002-single-question-and-output-contract.md) for what keeps
  it in step with the packaged version.
  `headsign help` is added alongside it: `help` was the one word you could not
  type without dashes, and it prints exactly what `-h`, `--help` and a bare
  `headsign` print.
  Both always exit 0 and neither is a verdict. There is deliberately no `-v`: it
  reads as *verbose* in enough tools to be worth leaving free.


- **A turn that ends outside the run's directory now leaves a line instead of
  nothing.** The stop-boundary hooks find the run by walking up from where the
  turn ended, stopping at the first enclosing `.git`. A session standing outside
  that tree found nothing and wrote nothing at all — and from the outside, a hook
  that ran and found nothing looked exactly like a hook that never ran, a plugin
  that failed to install, or a `node` that could not start. When that first walk
  comes up empty, headsign now tries once more, the same bounded way, from
  Claude Code's `CLAUDE_PROJECT_DIR`. Find a run there and it writes one
  `unheld` line with the detail `by=CLAUDE_PROJECT_DIR`, and `headsign status`'s
  `last stop:` line says the session was not standing in the run's tree. **The
  turn is never held on this path** — it records, it does not stop you — and it
  is reached only from the branch that used to write nothing, so every case that
  produced a nudge produces the same nudge and every case that wrote a line
  writes the same line. It narrows the silent branch rather than closing it: that
  second walk also only goes up, so a run below the project root or beside it (a
  package in a monorepo, a linked worktree added outside the checkout) is still
  unreached, and writes nothing as before. See
  [ADR-0026](docs/adr/0026-a-second-place-to-look.md), which also records the one
  rule anything built on this must obey: never let a value the harness supplies
  decide whether headsign's records are right while headsign still appears to be
  working.

- **Documented: a shell variable touching non-ASCII text can lose both.** Gate
  checks run through `/bin/sh -c`, and on macOS that is bash 3.2, where a `run:`
  string like `"count: $n→"` does not merely expand the variable to nothing — it
  also swallows the leading byte of the character that follows, so a broken
  multi-byte sequence reaches the rest of the command. A check written that way
  does not fail loudly; it compares against text nobody wrote. Brace the
  variable (`${n}`) whenever non-ASCII text follows it. It is not a full-width
  punctuation or Japanese-text problem — accented letters, arrows and emoji all
  do it — and it is specific to that shell and locale: `zsh` and `dash` expand
  the same string correctly, and `LC_ALL=C` sidesteps it. headsign does not
  force a locale on the gate's shell, because that would change how every
  check's commands handle multi-byte output to cover a trap most runs never
  meet.

- **Documented: a subprocess your program starts is a session too, and gets
  nudged like any other.** The hooks nudge whoever ends a turn in an unclaimed
  run's directory. A program that starts Claude Code as a subprocess gets a
  session standing wherever the caller was — the run's directory, unless it was
  given another — and that session has no way to know the nudge is not meant for
  it. It tries to answer, and what comes back to whatever called it is prose
  about headsign instead of the output it was started to produce. Someone
  debugging that is looking at their own parser, not at a workflow tool.
  `HEADSIGN_OBSERVER` already answers this exactly — it is the first branch of
  both hooks, checked before the payload is parsed, so a turn end from that
  environment is not nudged and writes nothing at all — and the reference now
  says to pass it in the subprocess's environment rather than moving that
  subprocess's working directory out of the run, which can cost it access to
  files it still needs there. One consequence is recorded and not yet solved: a
  nudged subprocess spends one from the run's nudge cap like any other, so a
  subprocess that was never driving anything can exhaust the backstop budget of
  a run that was.

### Fixed

- **`.headsign/log` now records the turn ends headsign held, which is what makes
  the other stop-boundary lines readable.** The log recorded three of the four
  things that can happen to a turn end — a deliberate pause, a spent nudge cap,
  a turn Claude Code had already resumed — and not the one that happens most,
  the ordinary nudge. Two lines were unreadable because of it. An `unheld` line
  is read by what comes before it, and the hold that preceded it left nothing
  behind, so a harmless pass could not be told from a turn that ended with no
  `headsign next` at all. And `stalled`, which records the cap being exhausted,
  had no denominator: a run could show the cap tripping with no countable nudge
  anywhere, which tells a later reader nothing. Every nudge now writes a line of
  its own — `held <phase> a=… i=… nudges=N` — carrying the count under the same
  key `stalled` already uses for the same quantity, so counting the holds a run
  spent between two transitions is one grep. The nudge that trips the cap still
  writes `stalled` and not `held`, one line per turn end either way, and its
  `nudges=5` is that fifth hold as well as the moment the cap tripped; stops
  after a spent cap still write nothing. Unlike `unheld`, a hold cannot go
  missing from the log: the counter and the line are one write, and a nudge
  headsign cannot record is one it does not make. See
  [ADR-0025](docs/adr/0025-a-stop-that-passed-and-a-stop-that-never-ran.md),
  which weighed this cost, accepted it, and has been amended.

## [0.4.0] - 2026-07-30

### Added

- **You can now tell a stop that passed from a hook that never ran.** When Claude
  Code has already resumed a turn — it sets a flag on the hook's input once a
  stop hook has held one — headsign lets that turn end pass, and used to record
  nothing at all: no log line, no state, nothing in `headsign status`. So a
  driver who noticed the nudge arriving only on alternate turn endings could not
  tell whether the backstop had run and stood down or was not installed, and had
  no way to find out except reading the source. The pass now leaves a line,
  `unheld <phase> a=… i=… by=stop_hook_active`, and `headsign status` grows a
  `last stop:` line reading how the previous turn end was handled — held and
  pointed back to `next`, not held because Claude Code had already resumed the
  turn, paused by a note, or not held because the nudge cap is spent. Both are
  written in one locked operation, so they cannot disagree, and the field behind
  the status line is stamped at *every* stop headsign can attribute rather than
  only at passes — a value written only on passes would still read "not held"
  long after a later nudge, which is the misreading that produced this report in
  the first place. `status` also reports `HEADSIGN_OBSERVER` when it is set in the
  calling environment: of the reasons a turn can end quietly, that is the only
  one a caller can answer about *itself*. Both lines are conditional, so a run on
  which no stop has been processed prints exactly what it printed before.
  Two limits worth knowing: a **missing** `unheld` line does not prove the hook
  did not run, because the hook's writes are skipped while the run's lock is
  held; and the line says *some* stop hook held the turn and headsign stood down,
  not that headsign was the hook that held it. A nudge therefore arrives roughly
  once per exchange rather than once per turn end, which the skill and the
  reference now say out loud, along with where to look for each way a turn can
  end quietly. See [ADR-0025](docs/adr/0025-a-stop-that-passed-and-a-stop-that-never-ran.md).

### Fixed

- **A restart no longer erases the run before it.** `headsign start` truncated
  `.headsign/log`, and that file is gitignored — so it was the only copy of what
  happened, and the next `start` wiped it. `headsign abort <reason>` records the
  one thing nothing else does, a person's stated reason for stopping, and that
  line did not survive the next run. It mattered most beside the graph pin: a
  gate loosened mid-run is reported and counted, while `abort` → edit → `start`
  reset the pin, reset the count and emptied the log, so the detour left less
  trace than the sanctioned path. Every write to the log is now an append. The
  line format is unchanged, and nothing is inserted between runs — each run
  already opens with its own `start` line, which is a marker a script can trust
  because the event word is always the second field. To read just the current
  run, and follow it:
  `N=$(grep -n '^[^ ]* start ' .headsign/log | tail -1 | cut -d: -f1); tail -n +"$N" -f .headsign/log`.
  See [ADR-0024](docs/adr/0024-the-log-survives-a-restart.md).

### Added

- **A run now notices when its own workflow changes underneath it.** `next`
  re-reads the file every lap on purpose — that is how you raise a ceiling and
  carry on, and how a run improves the phases it has walked past — but until now
  nothing recorded that it had happened, so a gate could be loosened between two
  laps with the earlier attempts still counted against the stricter version. A
  run now pins a fingerprint of the *rules* it is walking under (every phase it
  can still reach, plus `limits`; `description` deliberately excluded, so
  rewriting instructions stays invisible). A change is reported once as an
  `ESCALATE` that ends nothing and spends nothing: put the file back and the
  next lap is silent and free, or run `headsign next` again to accept it, which
  is counted. `COMPLETE` says how many changes a run accepted, and `status`
  shows the same plus any change still awaiting an answer. A change to `limits`
  alone is accepted without a report, so raising the ceiling stays one stop. It
  is a guardrail, not a lock — anything that can edit the workflow can edit
  `state.json` — but loosening a gate is no longer indistinguishable from the
  edits the documentation recommends. See
  [ADR-0023](docs/adr/0023-pinning-the-graph-a-run-is-walking-under.md).

- **`headsign validate` says when a workflow has no way to stop.** It checked
  that every phase could be *reached* and never that the run could *end*. If a
  set of phases can cycle on pass edges alone — a sweep turning back through its
  queue, say — and no `limits.max_total_iterations` is declared, nothing bounds
  the run: `max_attempts` counts a phase's failures since it last passed, so a
  loop that turns on passes clears it every lap. That is now a warning (still
  exit 0, like the unreachable-phase one), and it carries its reason, because an
  author told only that the graph loops reaches for `max_attempts` — the one
  thing that cannot help. Cycles that close through a *failure* edge are not
  warned about; the failing phase's `max_attempts` really does bound those. See
  [ADR-0022](docs/adr/0022-validate-checks-that-a-run-can-end.md).

### Fixed

- **A gate check that could not be run at all was counted as a check that
  failed.** If the command never started — a working directory that had gone
  away, output past the runner's buffer — headsign had no exit code to read,
  and reported it as an ordinary gate failure anyway: the lap spent an attempt,
  `max_attempts` of them ended the run in `ESCALATE`, and a phase with
  `on_fail: <phase>` moved the run somewhere on the strength of it. The rule
  was already written one function away, where a route's `when:` that cannot be
  run stops the run rather than falling through to the default. Now a check or
  a `ready:` probe that could not be run refuses the lap the same way (exit 3)
  and moves nothing: no attempt, no iteration, no state written, and a message
  naming the command, the errno, and the file to fix it in. A check that runs
  and *times out* is unchanged and still an ordinary failure — it ran, and the
  limit it ran past is one you wrote. See
  [ADR-0021](docs/adr/0021-a-command-that-never-ran-is-not-an-answer.md).

### Upgrading

- Nothing to do before taking this release: a run already in progress keeps
  working, and every field added to `.headsign/state.json` reads as absent when
  it isn't there.
- One thing to check if you script around headsign: **`headsign status` can now
  print more lines than it used to.** A `last stop:` line appears once a stop has
  been processed, and an `observer:` line when `HEADSIGN_OBSERVER` is set in the
  calling environment. Both are additions in documented positions and the run's
  own state is still on line 1, so read `status` by its first line or by matching
  a label — never by line number.

## [0.3.0] - 2026-07-29

### Fixed

- **A stop-boundary hook could erase a running lap's progress.** The hooks
  write the run's record — consuming a pause note, counting a nudge, sealing a
  claim — and a write replaces rather than merges. They took no lock, so a
  hook firing while `next` was mid-lap read the record from before that lap,
  changed one field, and wrote the whole thing back: the lap's phase
  transition and its attempt increment were gone. The lock protected `next`
  from `next` and from nothing else, in a tool built for several agents
  working in one directory — so meeting this needed nothing unusual, just a
  turn ending somewhere while a gate was running. Each hook write now takes
  the lock and re-reads under it; if the lock is held it changes nothing and
  lets the turn end, and an unconsumed pause note or claim marker waits for
  the next one. See [ADR-0004](docs/adr/0004-state-attempts-and-cache.md).

- **Two concurrent `headsign next` calls could both evaluate, and one's
  attempt count could be lost.** The lock was created empty and its pid
  written a moment later, and a second process arriving in that moment found
  an unparseable pid, concluded the holder had crashed, and stole a lock the
  first was still taking. Both then ran the gate and both wrote state, so one
  increment vanished — the exact corruption the lock exists to prevent. It
  needed real contention to hit: delegating a run to several subagents at once
  is the way to meet it, and it failed this repository's own concurrency
  regression test about one run in three under load. The lock is now created
  with its pid already inside it, atomically, so no reader can ever see it
  empty. Stealing a genuinely stale lock is unchanged. See
  [ADR-0004](docs/adr/0004-state-attempts-and-cache.md).

### Changed

- **Reaching `limits.max_total_iterations` no longer ends the run.** It still
  answers `ESCALATE` (exit 2), but writes nothing: the run stays `running`
  (`headsign status` says so), and raising the limit in the workflow file and
  running `headsign next` continues from the same phase, with the same
  attempts and the same `.headsign/tmp/`. The message now says how:

  ```
  ESCALATE build: max_total_iterations (15) reached — the run is still open: raise limits.max_total_iterations in .headsign/workflow.yaml and run `headsign next` to continue from this phase, or run `headsign abort <reason>` to end it
  ```

  The reason it is the only escalation that can be answered this
  way: `max_attempts` exhausted and `on_fail: escalate` mean an agent cannot
  satisfy a gate, while the global ceiling counts every lap and can fire on a
  run doing nothing wrong — it says the run was bigger than the number
  someone typed, which is a thing a person can answer. Those two escalations
  are unchanged and still end the run for good, as does `headsign abort`. The
  runaway protection is unchanged too: the ceiling is still checked before the
  gate, so a run standing at it spends no iteration and no attempt however
  many times it is asked. In `.headsign/log` the event is now written as
  `ceiling` rather than `escalate`, so a log that stops there can't be read as
  a run that ended. See
  [ADR-0017](docs/adr/0017-three-budgets-and-the-recoverable-ceiling.md).
- **`example.headsign/workflow.yaml` is now a generic minimal sample**
  (`name: minimal`) rather than headsign's own development loop. It is still
  the file `headsign start` picks when given no name, and still the smallest
  useful shape — implement behind gates, then a review phase — but its checks
  are placeholders marked swap-me instead of this repository's build and
  version-lockstep commands. `example.headsign/triage.yaml` has left the
  examples entirely: it resolves a private feedback repository through
  `git config --global headsign.feedbackDir`, which made it a workflow only
  this project could run. Both moves come from separating the two
  directories — `example.headsign/` is what ships to be copied, and this
  repository's own workflows now live in a real `.headsign/` directory
  instead of a symlink to the examples. See
  [ADR-0016](docs/adr/0016-explainability-as-the-fitness-function.md).
- **ADR-0007's gate-hardness scale is restated around authorship.** A gate is
  measured (nothing is authored) or judged, and a judged gate sits on one of
  three tiers according to *who writes the verdict file*: the check starts
  the judge and no file survives; the judge writes the file itself; or the
  judge reports and the working agent transcribes. The old wording
  introduced the top tier through its `claude -p` example and was read as a
  recommendation to run that command — the tiers are now stated by
  authorship, with `claude -p` demoted to one way of reaching the top one.
  The middle tier's limit is written down rather than implied: a working
  agent can still overwrite a verdict file it did not write.
- **The ~500-code-line guideline for `src/` is retired.** It never fired:
  `src/` passed twice the number without stopping a feature proposal, while
  the design problems actually found in this project's last eight ADRs all
  announced themselves as an explanation that would not come out straight.
  What replaces it is a workflow, not a number — `.headsign/fitness.yaml`
  asks whether each function in `src/*.ts` can be explained to a
  middle-school reader, and reports the ones that could not by name.
  `docs/architecture.md` now carries the measured size as a dated
  observation rather than a target.
- **Breaking: `version:` must now be `0.1`, not `1`.** Every workflow file
  needs that line changed, and `headsign validate` says so with `version
  must be 0.1 (the schema is pre-1.0 and still changing; a file written for
  the old 'version: 1' needs its fields checked against the current schema,
  not just the number changed)`. The number is the point of the change: `1`
  read as a promise of compatibility, and this schema has taken breaking
  changes on consecutive days — including the three fields removed below.
  While headsign is pre-1.0 the value is matched exactly, `0.2` will be
  matched exactly too, and no compatibility shim accepts an older one: a
  file whose version is out of date is stopped so someone reads it against
  the current schema. See
  [ADR-0015](docs/adr/0015-strict-schema-and-version-0-1.md).
- **Breaking: a key the schema doesn't define is now an error.** `validate`
  used to check the fields it knew and walk past the rest, so `max_atempts:
  3` loaded, validated, and ran a phase with no attempt budget at all. Every
  level of the file is now closed — top level, phase, `gate`, a check, an
  `on_pass` route, `limits` — and an unknown key stops the workflow (exit 3)
  with the keys that level accepts: `phase 'implement': unknown key
  'max_atempts' (allowed: description, clear, ready, gate, on_pass, on_fail,
  max_attempts)`. It is an error rather than a warning because the author's
  intent silently doesn't happen; an unreachable phase stays a warning,
  because a run can proceed with one. No did-you-mean guess is offered — the
  allowed list is printed instead. One consequence lands on the removals
  below: a phase still carrying `env:` or `on_exhausted:` is now rejected
  rather than ignored.
- A run that reads `ABORTED` was ended by a person. With the two `abort`
  routes removed below, nothing headsign judges can produce that status, so
  `status`'s terminal line and the log's `abort` event now say
  unambiguously who ended the run.
- **Breaking: `next` no longer reprints a cached verdict, and
  `max_attempts` now counts judgments.** Until now, a `next` on a working
  tree unchanged since that phase's last failure reprinted the old verdict
  for free — no gate run, no attempt counted. That free probe existed
  because `next` was once the only way to see where a run stood;
  `headsign status` (0.2.0) does that job now, read-only and as often as
  you like. So every `next` on a running phase runs that phase's gate, and
  every failure it reports spends one attempt: ask twice and your test
  suite runs twice. The rule that replaces "probing is free" is **did work
  → `next`; want to look → `status`**. One effect is deliberate: an agent
  that keeps calling `next` without doing any work now spends the phase's
  attempts, and once `max_attempts` runs out the run ends in `ESCALATE`,
  where before it consumed nothing and could be abandoned quietly. A
  `RETRY` line no longer carries the
  `(unchanged)` marker or its `[cached — …]` note, since neither can happen
  any more. See
  [ADR-0012](docs/adr/0012-removing-the-tree-hash-cache.md).
- **Breaking: `state.json`'s `last_eval` is now `last_failure`**, and has
  lost `tree_hash` (the cache's field) and `result` (always `"fail"`).
  What `status` prints as `--- last failure: … ---` is unchanged; that
  display is the field's only reader and the reason it still exists. A
  `state.json` written by 0.2.0 is not migrated — see Upgrading.
- **Breaking: `headsign claim` is now the only way a run learns who drives
  it.** `start` and `next` no longer record a driver, and the `Stop` hook
  no longer compares identifiers: while nobody has claimed a run it nudges
  whichever session stops in the run's directory, and once a delegated
  agent has claimed it, that agent's own turn ends are the only ones held.
  A session driving its own run needs no claim and keeps its backstop.
  What this gives up is telling two *sessions* apart in one directory: a
  second session watching a run it isn't driving is now nudged like any
  other, and should set `HEADSIGN_OBSERVER` to opt out. `status`'s
  `driver:` line has two readings to match — `a delegated agent`, or `not
  delegated yet — no agent has claimed this run`. See
  [ADR-0013](docs/adr/0013-claim-only-driver-identity.md).
- **Breaking: `HEADSIGN_SESSION_ID` is gone**, and headsign no longer reads
  a session identifier from the environment at all (`CLAUDE_CODE_SESSION_ID`
  included). `HEADSIGN_OBSERVER` is the only environment variable it now
  consults. Setting `HEADSIGN_SESSION_ID` was worse than useless under
  Claude Code: the CLI recorded the value you exported while the hook
  compared against the identifier Claude Code handed it on stdin, so the
  two disagreed permanently and the session that set it stopped being
  nudged at all.
- **Breaking: `state.json`'s `driver_session` and `driver_source` are
  replaced by a single `driver_agent`.** Only one thing can be recorded
  there now — the id of the delegated agent that claimed the run — so the
  field is named for it, and the companion field that used to say which
  mechanism had written it is gone. A `state.json` written by 0.2.0 is not
  migrated; an unfinished run reads as unclaimed. See Upgrading.
- headsign no longer runs `git`. The working-tree fingerprint was its only
  use of it, so the tool now behaves identically inside a repository,
  outside one, and in a linked worktree, and `/bin/sh -c` — running the
  check commands you wrote — is the only kind of process it spawns.

### Removed

- **Breaking: a phase's `env:` is gone.** Write the variables a check needs
  into the check's own command — `run: "FOO=bar npm test"` — the same way
  you would at a prompt. Every command headsign runs (checks, `ready:`
  probes, and routes' `when:` predicates) now inherits headsign's own
  environment and nothing else. None of the shipped example workflows ever
  used the field. A phase still declaring `env:` now fails `validate` as an
  unknown key, so the field has to come out rather than be left in place —
  see Upgrading. See
  [ADR-0014](docs/adr/0014-removing-three-unused-knobs.md).
- **Breaking: `on_exhausted:` is gone; exhausting `max_attempts` always
  answers `ESCALATE`.** The field chose between `escalate` (the default)
  and `abort`, and every one of its eleven uses across the shipped example
  workflows spelled out the default. A spent budget is the moment to ask a
  person, which is what `escalate` does and what `abort` — noticing the run
  is stuck and then ending it without telling anyone — did not. Like `env:`,
  a leftover `on_exhausted:` is rejected as an unknown key, so a file
  carrying one is stopped rather than escalating on a field nothing reads.
- **Breaking: `on_fail: abort` is gone.** `on_fail` now takes `retry` (the
  default), a phase name, `$end`, or `escalate`. Ending a run for good stays
  a person's decision, made with `headsign abort <reason>` — the command is
  unchanged, and so is the `ABORT` answer token. A workflow declaring it
  fails `validate` with exit 3, as an invalid route rather than an unknown
  key: `on_fail` is still a field, it is `abort` that is no longer one of
  its values. One consequence of `abort` leaving the token set: a phase
  actually named `abort` is now a legal `on_fail` target.

### Upgrading

Finish or abort a run before upgrading, or start it again afterwards: a
`state.json` from 0.2.0 carries `last_eval` and the two ownership fields
this version replaced, so an upgraded-into run loses its recorded driver
(it reads as unclaimed) as well as its last-failure block. If such a run
was being driven by a delegated agent, have that agent run `headsign
claim` again. Drop `HEADSIGN_SESSION_ID` from any shell profile or hook
config that exports it — nothing reads it any more.

Then edit your workflow files, starting with the top line: `version: 1`
becomes `version: 0.1`. That line is not the only thing that moved, though,
which is why the error asks you to check the fields too — three of them left
the schema in this same version. Delete every `on_exhausted:` line:
`escalate` is now what exhaustion always does, so a line that said
`escalate` was already redundant, and one that said `abort` no longer has
anywhere to say it. Delete every `env:` mapping and move its variables into
the commands that need them (`run: "FOO=bar npm test"`). Replace `on_fail:
abort` with `on_fail: escalate` (or a phase name).

All three are caught for you now, along with anything else the schema does
not define: run `headsign validate` on each of your workflow files and fix
what it names, one `unknown key` line at a time. That is also the check to
run on a file you thought was fine — a `max_atempts:` that has been quietly
doing nothing surfaces here rather than in a run. The six answer tokens are
the same six. Do re-read your slowest gate, too — its cost is now paid on
every `next` rather than once per change to the working tree.

## [0.2.0] - 2026-07-27

Two themes: a workflow can now branch more than two ways, and a run can be
driven by a delegated agent rather than only by the session that started it.

### Added

- k-way routing on `on_pass`: a phase can branch to one of several phases
  instead of exactly one. Write `on_pass` as a list of `when:`/`to:` routes
  — the `when:` commands run in order once the gate has passed, the first to
  exit 0 decides the destination, and the last entry (which has no `when:`)
  is the default. `ADVANCE` gains a `--- routed: … ---` line naming the
  route taken, and `.headsign/log` records the same. A `when:` that cannot
  be run at all (spawn error, timeout) stops the run with exit 3 instead of
  falling through to the default: the thing being decided is the
  destination. A plain string `on_pass` behaves exactly as before, down to
  its output and log lines. See
  [ADR-0011](docs/adr/0011-k-way-routing-on-pass.md).
- `headsign status`: a strictly read-only command for a session that isn't
  driving a run — reports the current phase (or terminal outcome) without
  running any gate, writing state, or taking the lock. Its exit code never
  overlaps `next`'s: 0 whenever state is readable (including
  `ESCALATED`/`ABORTED`), 3 only when there's no run to read. Its `driver:`
  line reports only what it can establish: an environment-based match proves
  the caller is `this session, or an agent it delegated to` and cannot
  separate the two, and a run whose driver was seated by `headsign claim`
  reads `a delegated agent`.
- Driver ownership for repositories with more than one session open on
  them. `start`/`next` stamp who is driving (`driver_session`, resolved from
  `HEADSIGN_SESSION_ID`, or automatically from Claude Code's own session
  identifier), and a stop by a confirmed non-driver passes through instead
  of being nudged toward a run it isn't running. See
  [ADR-0008](docs/adr/0008-multi-session-ownership.md).
- `headsign claim`, for handing a run to a delegated agent — a teammate
  under Claude Code's agent-teams feature, or a subagent — whose own
  environment cannot tell it apart from the session that spawned it. It arms
  a one-shot marker that the claiming agent's own turn end seals, and the
  hook confirms the seal in its message. See
  [ADR-0009](docs/adr/0009-claim-handshake.md) and
  [ADR-0010](docs/adr/0010-subagent-stop-identity.md).
- A `SubagentStop` hook, giving a delegated agent the same backstop a
  session has always had: while a run is `running`, the agent recorded as
  its driver is pushed back to `headsign next` at the end of its own turn
  instead of stopping silently. Agents that aren't the driver pass through
  untouched, unless they are the first to name themselves under an armed
  `claim` marker — that is how a claim gets sealed. The plugin registers it
  automatically; the plugin-free `settings.json` snippet in the README now
  shows both hooks.
- `HEADSIGN_OBSERVER`: set on a session that should never be nudged by the
  stop-boundary hooks, regardless of driver ownership — the manual opt-out
  for environments where no session identifier resolves.
- Pause notes: writing one line to `.headsign/tmp/stop-note` lets a session
  stop immediately and quietly — the stop-boundary hook consumes the note,
  records a `paused` line in `.headsign/log`, and leaves the run resumable
  with `headsign next`. Silent exits now always leave a trace. A `stalled`
  line is recorded when the nudge cap is reached instead, so an unattended
  supervisor can tell an abandoned run (`status == "running"` plus `stalled`
  in the log) from a deliberate pause.
- Example workflows in `example.headsign/`, one per shape worth copying:
  role-based ones (TDD feature, bugfix, docs, release, and headsign's own
  development workflow), `triage.yaml` for a queue judged one item per run,
  `router.yaml` for a three-way branch, and `sweep.yaml` for a cycle that
  ends because the data ran out rather than because a counter tripped. Each
  is drawn as a flowchart in `example.headsign/README.md`. This repository
  dogfoods them through a `.headsign` symlink.

### Changed

- A phase unreachable from `entry` is now a **warning** rather than a
  validation error. `headsign validate` prints it to stderr and still exits
  0, `start` prints it once per run, and `next` stays silent so the
  every-turn path isn't noisy. Workflows that headsign previously refused to
  load for this reason now load and run — including a run wedged mid-flight
  by a half-written phase or a commented-out edge.
- The stop-boundary nudge cap was raised from 3 to 5 and is now purely an
  abnormal-case backstop; the pause note is the intended exit for deliberate
  stops.
- No-argument `headsign validate` now defaults to the current run's own
  `workflow_path` (from `.headsign/state.json`, whatever its status)
  whenever a run exists, falling back to the plain `.headsign/workflow.yaml`
  default only when there is no run; an explicit name or `--workflow` still
  always wins.
- Git worktrees are documented as supported within one clear boundary —
  **one worktree, one independent run**: a worktree's `state.json`, lock,
  and log live in that worktree's own `.headsign/`, headsign writes nothing
  under the shared `.git`, and sharing or coordinating state between
  worktrees remains out of scope.

### Upgrading

Nothing to do coming from 0.1.0: every 0.1.0 workflow file, and every
`state.json` a 0.1.0 run left behind, is read unchanged. If instead you have
been tracking `main` and live-patching an installed plugin, a run claimed
before the `SubagentStop` change carries a driver stamp neither hook now
matches — nothing misfires, but that run's stop backstop is off. Run
`headsign claim` again from the agent that should be driving, or start a
fresh run.

## [0.1.0] - 2026-07-25

### Added

- Deterministic phase gates: `workflow.yaml` choreographs phases whose gates
  are ordinary shell checks with `on_pass`/`on_fail` routing — the LLM never
  judges, only reads the verdict.
- A single question, `headsign next`, and its six answer tokens: `ADVANCE`,
  `RETRY`, `PENDING`, `COMPLETE`, `ESCALATE`, `ABORT`.
- Per-phase attempt counting with a tree-hash cache, so probing `next` on an
  unchanged working tree costs no attempt.
- `ready:` async gates: an unready gate answers `PENDING` with zero
  mutation — no attempt spent, no `clear:` run.
- `clear:` with a deletion announcement, and a `.headsign/tmp/` scratch area
  for phase-local files.
- A self-healing lock so concurrent `next` invocations don't corrupt state.
- A run transition log at `.headsign/log`.
- The Claude Code plugin: the `workflow` skill plus a walk-up Stop hook
  backstop that fails open after three nudges.
- `headsign start <name>` for selecting among multiple workflow files.
- `-h` / `--help` on the CLI.
