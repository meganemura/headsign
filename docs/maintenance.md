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
| npm (**not yet enabled**) | `npm publish` | normal npm semantics |
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
  numbers (line counts in `architecture.md`) get refreshed when they drift.
- The ~500-code-line guideline (comments and blanks excluded) is a smell
  detector, not a cap. Recount occasionally:

  ```
  for f in src/*.ts; do grep -vE '^\s*//' "$f" | grep -vE '^\s*$'; done | wc -l
  ```

## What CI enforces (.github/workflows/ci.yml)

On every PR and push to `main`, ubuntu + Node 24:

1. `npm ci` — lockfile-pinned toolchain; byte-reproducible bundles depend on it
2. `npm run typecheck`
3. `npm test`
4. `npm run build` then `git diff --exit-code plugin/dist` — the committed
   bundle everyone's hook executes must be exactly what src builds to
5. `package.json` version == `plugin/.claude-plugin/plugin.json` version —
   guards the silent-no-op update trap above

## Releasing vX.Y.Z

Semver, currently 0.x: minor = features (breaking changes possible),
patch = fixes only.

1. Bump `version` in **both** `package.json` and
   `plugin/.claude-plugin/plugin.json` (CI enforces equality; without the
   plugin bump, marketplace users never receive the release).
2. Add the `CHANGELOG.md` entry — curated and user-facing, not a commit-log
   replay (Keep a Changelog format).
3. Commit (`Release vX.Y.Z`) and land it on `main`. This is the moment
   plugin users can receive it.
4. `git tag vX.Y.Z && git push --tags`. Tags matching `v*` are protected
   (no deletion, no re-pointing) — one tag is the shared reference point
   for every channel, which is only trustworthy if it cannot move.
5. Create the GitHub Release for the tag; its body is the transcription of
   the `CHANGELOG.md` section.
6. `gh skill publish --tag vX.Y.Z` — validates the skill against the Agent
   Skills spec and keeps the `agent-skills` topic in place. It reuses the
   same tag; if it balks at the existing release, ensuring the topic is
   present is the part that matters for `gh skill search`.
7. (once npm is enabled) `npm publish` — `prepublishOnly` forces
   typecheck+test+build; the `files` whitelist ships only `plugin/`, the
   READMEs, and the CHANGELOG. Verify with `npm pack --dry-run` (9 files).

## Repository settings (live outside the tree; recorded here to be reproducible)

- **Visibility**: private until first release; public from v0.1.0.
- **Description / topics**: set via `gh repo edit` — description is the
  one-liner from the README; topics include `claude-code`,
  `claude-code-plugin`, `coding-agent`, `ai-agents`, `agentic-coding`,
  `phase-gate`, `workflow`, `state-machine`, `cli`, `developer-tools`,
  `typescript`, plus `agent-skills` once `gh skill publish` has run.
- **Tag protection ruleset**: targets `v*`; denies deletion and updates
  (re-pointing). Create under Settings > Rules > Rulesets, or via `gh api`.
- No branch protections beyond CI at the moment (single-maintainer); add a
  required-check rule on `main` when a second maintainer joins.

## npm publish enablement (future)

When turning npm on: publish from a tagged, CI-green `main` checkout;
`npm pack --dry-run` must list exactly the whitelisted files; the README's
install lines switch from `github:meganemura/headsign` to the package name.
Consider `--provenance` once publishing runs in CI instead of a laptop.
