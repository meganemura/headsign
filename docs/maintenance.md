# Maintenance

One page for everything a maintainer does besides writing code: what each
change must keep true, how a release works, and the repository settings
that exist outside the tree. Design rationale lives in
[the ADRs](adr/README.md); this is the operations side.

## The distribution map — what ships, when

| Channel | Ships when | Consumers get updates when |
|---|---|---|
| Claude Code plugin (marketplace) | a commit lands on `main` | **only if `plugin.json`'s `version` changed** — plugin updates are compared by that string, so an unbumped version makes `marketplace update` a silent no-op. Third-party marketplaces also have auto-update off by default; users run the update themselves |
| `gh skill` | a GitHub Release tag exists (plus the `agent-skills` topic) | `gh skill update` follows release tags |
| npm | `npm publish` | normal npm semantics |
| git directly (`npm i -D github:…`, clone) | always | whatever ref they point at |

The consequence to internalize: **merging to `main` is the distribution
moment for plugin users.** Don't merge red, and don't merge a src change
without its rebuilt bundle.

## Every change (day-to-day hygiene)

- `npm run typecheck && npm test && npm run build` — and commit
  `plugin/dist/headsign.mjs` together with the src change. CI fails
  otherwise (`dist matches src`).
- READMEs stay in parity: `README.md` and `README.ja.md` say the same
  things; the Japanese one is one-sentence-per-line, polite form
  (です・ます) for body prose, no interpuncts for enumerations.
- If a behavioral guarantee changed, amend the ADR that owns it (index:
  [docs/adr/README.md](adr/README.md)) in the same change. Docs that state
  numbers (the dated line count in `architecture.md`) get refreshed when they
  drift.

## The fitness check

The 500-code-line guideline is retired
([ADR-0016](adr/0016-explainability-as-the-fitness-function.md)); what stands
in its place is a sweep that asks whether each function in `src/*.ts` can be
explained to a middle-school reader:

```
headsign start fitness
```

One lap per function: explain it, hand the explanation to a judge that reads
nothing else, record the result, move on. Functions nobody could explain do
not stop the run — they are collected and reported at the end, so what
reaches you is "these three could not be explained", named. That report is
the fitness verdict, and it escalates when the list isn't empty. The answer
to a failure is to simplify the function it names, not to write a better
explanation of it. Run it after a stretch of feature work, or whenever a
review keeps needing long paragraphs to say what a change does.

`headsign start grilling` is the other one this repository runs on itself:
it takes a list of open design questions and forces each through a plain
explanation and a round of naive "why?"s before anyone gets asked. Most
questions close there.

## Feedback triage loop

Field feedback on headsign accumulates, pull-style, as tickets in a private
aggregation repository. Where that repository lives is a per-machine
setting, never a relative or sibling path — a relative one breaks the moment
you work from a git worktree:

```
git config --global headsign.feedbackDir <path>
```

Everything downstream — the triage workflow's gate check, and the phase
instructions that say where to read and move tickets — resolves the
directory through that config value, so a machine that hasn't set it
simply has no tickets to triage.

**Running the loop.** `headsign start triage` (that's
`.headsign/triage.yaml`, one of this repository's own workflows — it reads a
per-machine git config value, so it is not shipped as an example). One run
judges **one** ticket: read it, fill its
`Judgment` section with a decision and a reason, move it on, then either
implement it or end the run. Three is the upper bound once the loop is
second nature, and that is a cap, not a target — past it you are batching,
which is the one thing this structure exists to prevent. Triage is where
the thinking happens, and a queue swept in a single pass is a queue nobody
judged. A run whose ticket was rejected or deferred — or whose inbox
turned out empty — has no implementation to do and ends `COMPLETE`: that
clean exit is the design, not a failure.

**The public-repository rule.** This repository is public; the feedback
sources are not. Nothing that lands here — code, tests, docs, YAML,
CHANGELOG entries, commit messages — may carry anything that identifies a
feedback source: no private project or repository names, no ticket ids, no
quoted logs, paths, or workflow excerpts, no reproduction detail that only
one reporter's setup could produce. Restate the underlying problem in
general terms and fix *that*. A problem that cannot survive being
generalized isn't ready to be worked on here.

**The link runs one way, private → public.** What a ticket turned into is
recorded in that ticket's `Response` section on the private side, with the
public commit hash. Never add the reverse link: nothing in this repository
points back at a ticket, a private repository, or a reporter.

**Turning a ticket into a public issue** is for the generalizable ones
only, and it is a rewrite, not a copy. Open a blank editor and state the
problem from scratch in your own words; pasting ticket text — even "lightly
edited" — is how source-identifying detail leaks.

## Live-patching an installed plugin (local testing)

For most changes, `npm test` plus running the CLI directly
(`node plugin/dist/headsign.mjs …`) is enough. Occasionally you need to
check a hook or skill change against a *real*, already-installed plugin
copy — e.g. confirming a stop-boundary hook edit actually fires the way you
expect inside a live Claude Code session — without cutting a release and running
`/plugin marketplace update` for every iteration. Claude Code caches an
installed plugin under a version-scoped path:

```
~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/
```

For headsign installed from its own marketplace, that's typically
`~/.claude/plugins/cache/headsign/headsign/<version>/`, mirroring this
repository's `plugin/` layout (`dist/`, `hooks/`, `skills/`). Build and
copy your local changes straight over the cached copy:

```
npm run build   # regenerate plugin/dist/headsign.mjs from src/
cp plugin/dist/headsign.mjs ~/.claude/plugins/cache/headsign/headsign/<version>/dist/headsign.mjs
rsync -a plugin/skills/      ~/.claude/plugins/cache/headsign/headsign/<version>/skills/
```

(Or `rsync -a plugin/ ~/.claude/plugins/cache/headsign/headsign/<version>/`
for everything at once — `hooks.json` rarely changes, but syncing it too
is harmless.)

This is a **local testing shortcut, not a distribution channel**: it
patches one machine's cache, gets silently overwritten the next time the
marketplace updates, and must never substitute for actually committing and
releasing the change (see the distribution map above).

**The two halves patch asymmetrically — know which before you go looking
for a change that "isn't taking".**

- **`dist/headsign.mjs` (the hook and CLI) takes effect immediately, even
  in a session that's already running.** The stop-boundary hooks are invoked
  fresh on every single firing and re-read the bundle off disk each time, so
  a patched `dist/headsign.mjs` changes the very next `Stop` or
  `SubagentStop` firing in any open session — no restart needed.
- **`skills/workflow/SKILL.md` only takes effect in new sessions.** Skill
  text is loaded once, at session start, and stays fixed in that session's
  context for its whole lifetime; a session already running keeps whatever
  SKILL.md text it started with. A skill-text patch only shows up in a
  session started after the patch was applied.

## What CI enforces (.github/workflows/ci.yml)

On every PR and push to `main`, ubuntu + Node 24:

1. `npm ci --ignore-scripts` — lockfile-pinned toolchain; byte-reproducible
   bundles depend on it
2. `npm run typecheck`
3. `npm test`
4. `npm run build` then `git diff --exit-code plugin/dist` — the committed
   bundle everyone's hook executes must be exactly what src builds to
5. `package.json` version == `plugin/.claude-plugin/plugin.json` version —
   guards the silent-no-op update trap above

### How the workflow is written, and why

Five things in that file are deliberate. Each is cheap to keep and expensive to
notice the absence of.

- **Actions are pinned by commit, with the version in a trailing comment.** A
  tag is a pointer; the same line resolves to different code once an account is
  taken. Raising one means resolving the new tag with
  `gh api repos/<owner>/<repo>/git/ref/tags/<tag> --jq .object.sha` and checking
  the written line against it afterwards — a forty-character value is wrong in a
  way that reads as right. The cost this accepts is that nothing raises them for
  you, and a pinned action also stops announcing that it went stale: this
  repository sat on `@v5` while the published tags reached v7.
- **`permissions: contents: read`, declared in the file** even though the
  repository default is already `read`. What an injected workflow can do is
  decided by the token, and whoever copies a step out of this file takes the
  line without the repository setting behind it.
- **`--ignore-scripts` written on the `npm ci` line**, for the same reason: the
  line travels, `.npmrc` does not.
- **`concurrency` with `cancel-in-progress`**, because an overtaken run has
  nothing left to report, and **`timeout-minutes`**, because the default is six
  hours and this suite races real processes against a lock.
- **Node 24 is chosen by the lockfile, not by "current LTS".**
  `package-lock.json` is lockfileVersion 3, which npm 11 writes and npm 10
  refuses to read. Node 22 ships npm 10. Picking the LTS by habit fails at
  `npm ci` with an error naming some unrelated package.

The repository-level settings this leans on — Actions restricted to trusted
publishers, SHA pinning required, default workflow token `read`, and no secrets
at all — are recorded under Repository settings below. **The order matters: no
secrets and a read-only token are what make an injected workflow come up empty.
Pinning and an allowlist narrow which actions can run; neither stops a `run:`
line.**

### `.npmrc`, and the hole it opens

The repository carries an `.npmrc` so that a clone and CI both get it rather
than only whoever set up their home directory:

- `ignore-scripts=true` — a dependency's install hook is where a compromised
  package does its work.
- `min-release-age=7` — install nothing published in the last week. A
  compromised release is usually found and pulled within days.

**`ignore-scripts` also stops npm's own lifecycle hooks, `prepublishOnly`
included.** Nothing announces that it was skipped, so a step that lives only in
a lifecycle hook silently stops running. `prepublishOnly` is the one hook that
cannot move into a script body — `npm publish` is its only caller — so the
release procedure below carries it instead: step 5 runs typecheck and the tests,
and step 2 runs the build. Those are not a convenience. They are the whole of
what `prepublishOnly` used to guarantee.

Measured on 2026-08-22: `ignore-scripts=true` does not break this toolchain.
`npm ci --ignore-scripts` from this lockfile leaves esbuild and tsc both
runnable, because esbuild ships its platform binary as an optional package
rather than through an install hook.

## Releasing vX.Y.Z

Semver, currently 0.x: minor = features (breaking changes possible),
patch = fixes only.

Every step is marked **[agent]** or **[you]**. The line between them is not
trust, it is reversibility: an agent may do anything that changes only this
machine and can be undone here, and everything reserved either leaves the
machine or is protected against being undone once it has.

1. **[agent]** Bump `version` in **both** `package.json` and
   `plugin/.claude-plugin/plugin.json` (CI enforces equality; without the
   plugin bump, marketplace users never receive the release).
2. **[agent]** `npm run build`, and commit the rebuilt
   `plugin/dist/headsign.mjs` with the bump. **This step is not optional and
   the release commit is where it belongs**: the build substitutes the version
   into the bundle, so a bump without a rebuild leaves `headsign version`
   reporting the previous release from a package claiming the new one.

   **Do not rely on CI to catch it.** CI runs on push, and pushing to `main` is
   itself the distribution moment for plugin users (see the map at the top of
   this page); there are no branch protections, so a red run afterwards retracts
   nothing. `npm test` catches it before anything leaves the machine — an acceptance test drives
   the bundle on disk and compares its baked version against `package.json` — which is
   why the pre-flight below runs the tests and not only the two dry-runs. Why
   that is the check that binds the reported number, and what CI's own check
   adds after the fact, is
   [ADR-0002](adr/0002-single-question-and-output-contract.md) — this page states
   the consequence and leaves the reasoning there.

   Note the consequence for review: a release commit now touches the bundle,
   where it used to be three text files.
3. **[agent]** Add the `CHANGELOG.md` entry — curated and user-facing, not a
   commit-log replay (Keep a Changelog format).
4. **[agent]** Commit (`Release vX.Y.Z`) — the two version files, the bundle,
   and the changelog. Landing it is a separate step on purpose, and not the
   next one: the commit is local and amendable, and everything between here
   and the push — the pre-flight, the tag — is still undoable on this machine.
5. **[agent]** Pre-flight. First `npm run typecheck && npm test`, because this is
   the last point before anything leaves the machine and the tests are what tie
   the reported version to the packaged one (step 2). Then two dry-runs, both
   free and both read-only:
   `npm pack --dry-run` — read the *list* rather than the count, and check it
   against the `files` whitelist (`plugin/`, the READMEs, the CHANGELOG); the
   number changes whenever `plugin/` gains a file, and a count written down
   here goes stale silently while a wrong list does not. And
   `gh skill publish --dry-run`, which validates the skill layout and nothing
   else.

   Then the one check that cannot be done from inside this repository: pack the
   tarball, install it into an empty project, and run it.

   ```sh
   npm pack --pack-destination /tmp/packtest
   mkdir -p /tmp/packtest/p && cd /tmp/packtest/p && npm init -y
   npm install /tmp/packtest/headsign-<version>.tgz
   ls node_modules                          # `headsign`, and nothing else
   ./node_modules/.bin/headsign --version   # the version just packed
   ```

   The repository always has the toolchain that built the bundle, so nothing run
   here can tell you whether the published artifact stands on its own. Two
   answers only come from the clean install: whether the bundle resolves without
   the build tools, and whether `node_modules` holds exactly one package. The
   second is what keeps a runtime dependency from reappearing — every dependency
   is inlined at build time, so anything listed under `dependencies` would be
   downloaded by every consumer and used by none.
6. **[agent]** `git tag vX.Y.Z` — creating the tag locally, which is
   reversible here. It happens *before* the handover, not after, so that the
   one command you run pushes the commit and the tag together.
7. **[you]** `git push && git push --tags` — one command, deliberately.
   Landing on `main` is the moment plugin users can receive it (the
   distribution map above is what makes a merge a publication), and tags
   matching `v*` are protected: no deletion, no re-pointing. Both halves are
   irreversible, and separating them only creates a window where `main` has
   shipped and the shared reference point for every other channel does not yet
   exist. `&&` and not `;` — a rejected push must not be followed by a tag
   push that succeeds.
8. **[agent]** Create the GitHub Release for the tag; its body is the
   transcription of the `CHANGELOG.md` section. Reversible — a release can be
   deleted, and the protected thing it hangs on is the tag, which already
   exists by now.

   **Backfilling an older version needs `--latest=false`.** GitHub picks the
   "Latest" release by publication *time*, not by version, so creating a page
   for an older tag today silently moves the Latest marker backwards — and
   `gh skill update` follows it, so skill users would be walked back a version
   by a bookkeeping fix. Check with
   `gh api repos/<owner>/<repo>/releases/latest -q .tag_name` after any release
   made out of order. A backfilled page also carries today's date with no way
   to set the real one, so say the real date in its first line rather than
   leaving the two records disagreeing.
9. **[you]** `npm login && npm publish` from the tagged, CI-green checkout.
   Both halves prompt — for credentials and a 2FA OTP — which is the mechanical
   reason this one cannot be delegated.

   **`prepublishOnly` does not run.** The repository's `.npmrc` sets
   `ignore-scripts=true`, which stops npm's own lifecycle hooks along with every
   dependency's. `package.json` still declares one, and it is still correct
   about what a release needs; it simply is not what runs it. Steps 2 and 5
   above are. Do not treat publish as a second chance to catch a bad build.

   **`npm login` first, and not only when you know you are logged out.** npm
   sessions expire, and the registry check happens late. Logging in first turns
   a late failure into an immediate one, and costs nothing when the session was
   live.

   Consider `--provenance` once publishing moves into CI instead of a laptop.
10. **[agent]** Receive the release on this machine:
    `claude plugin update headsign@headsign`. The bare name answers `Plugin
    "headsign" not found` — `update` resolves the `plugin@marketplace` pair
    that `claude plugin list` prints. Changes only this machine and is undone
    by installing the previous version, which is why it sits on the agent's
    side of the line.

    **This step exists because the map above applies to the maintainer too.**
    "Users run the update themselves" does not exempt the person who cut the
    release, and the plugin cache is version-scoped, so nothing about
    publishing moves it. Skipping it has a specific cost, and it is not
    cosmetic: every later change gets tested against the previous version, and
    every field report gets read through a copy that does not have the fix
    being discussed. Measured on 2026-08-20, this machine was running 0.5.0
    while 0.6.0 and 0.6.1 were written, released, and reasoned about — the
    v0.6.1 hook fix included, whose whole subject is what the stop hook does on
    a machine that does not have it.

    `claude plugin list` confirms the fetched version; `headsign version`
    confirms the running one, and the two disagree until Claude Code restarts.

11. **[you]** Restart Claude Code. Not a command to paste, which is why the
    list below still has two: it is the only part of step 10 an agent cannot
    perform, and until it happens the copy fetched above sits unused.

`gh skill` needs no per-release step of its own. It cannot attach to an
existing tag (`gh skill publish` insists on creating the tag itself), and what
discovery actually keys on — the `agent-skills` topic — is a one-time
repository setting, already in place (publish added it on 2026-07-25). The
`--dry-run` in step 5 is the whole of its involvement.

### Yours, and only yours

Everything above that leaves this machine, in order, ready to paste:

```sh
git push && git push --tags  # lands on main; v* is protected once pushed
npm login && npm publish     # both prompt; login first so auth fails fast
```

That is the whole list — two commands, plus one thing that is not a command:
restarting Claude Code, so the release you just cut is the one this machine
runs (step 11). The GitHub Release is *not* yours: it can be deleted, which by
this page's own rule puts it on the agent's side. It was listed here once, and
the release it was listed for is the one that never got a page — a step an
agent could do but a person is marked for is a step with nobody actually
holding it.

If an agent hands you a longer list than this, it either has not done its half
or is asking permission for something reversible — check which before running
it.

## Repository settings (live outside the tree; recorded here to be reproducible)

- **Visibility**: private until first release; public from v0.1.0.
- **Description / topics**: set via `gh repo edit`. The description carries the
  README's one-liner and names the hosts, because it is the line a search result
  shows and "which agents does this work with" is the first question it has to
  answer. Read the live values with
  `gh repo view --json description,repositoryTopics` rather than trusting this
  page — the list below is what was set on 2026-08-22, not a promise about now.

  Topics, 17 of a possible 20: `claude-code`, `claude-code-plugin`, `codex`,
  `codex-cli`, `codex-plugin`, `coding-agent`, `ai-agents`, `agentic-coding`,
  `agent-skills`, `phase-gate`, `workflow`, `state-machine`, `graph-engineering`,
  `loop-engineering`, `cli`, `developer-tools`, `typescript`.

  The per-host pairs are deliberate: a bare host name reaches people browsing
  the ecosystem, and the `-plugin` form reaches the ones looking for something
  to install. `agent-skills` is what `gh skill` discovery keys on, so it earns
  its slot for a reason the others do not.

  **A release that adds a host is not finished until this line moves.** v0.7.0
  shipped Codex support with the description still reading "Claude Code
  drives" — the manifests had been corrected and the one public sentence about
  the project had not.
- **Tag protection ruleset**: targets `v*`; denies deletion and updates
  (re-pointing). Create under Settings > Rules > Rulesets, or via `gh api`.
- **Actions hardening.** What the workflow file can safely assume is decided
  here, so this is the half to set first. Measured 2026-08-22 with
  `gh api repos/<owner>/<repo>/actions/permissions`,
  `.../actions/permissions/workflow`, and `.../actions/secrets`:

  | Setting | Wanted | State on 2026-08-22 |
  |---|---|---|
  | Default workflow permissions | `read` | `read` |
  | Actions secrets, Dependabot secrets, environment secrets | none | none |
  | `sha_pinning_required` | on — the workflow's pins become enforced rather than merely intended | off |
  | Actions enabled | on, restricted to this owner plus actions created by GitHub | **off — no workflow has run since 2026-08-01** |

  The first two rows carry the weight. With no secrets and a read-only token,
  a workflow injected into `.github/` finds nothing to steal and cannot push.
  Required SHA pinning and an allowlist narrow which actions may run; neither
  constrains a `run:` line, which is where an attacker writes shell anyway.

  Verified releases and the Marketplace "verified creator" badge are not the
  same thing, and the badge is not a trust decision — leave it out of the
  allowlist.

  On a public repository, `pull_request` runs from forks get no secrets by
  default. `pull_request_target` removes that protection; this repository does
  not use it, and a workflow that starts to should say in a comment that it is
  doing so.
- No branch protections beyond CI at the moment (single-maintainer); add a
  required-check rule on `main` when a second maintainer joins.

