# Releasing

`headsign` is already on npm. A later version does not need a token
bootstrap, and this repository does not store `NPM_TOKEN`.

Pushing a `v*` tag runs
[`.github/workflows/publish.yml`](../.github/workflows/publish.yml). The
job enters the GitHub Environment `publish` and waits until a required
reviewer approves it. That approval is what lets the job request an OIDC
token and run `npm publish`. Provenance is attached automatically because
the repository and the package are public.

The checklist that prepares the commit — versions, the committed bundle,
the changelog, the GitHub Release, the installed hosts — stays in
[Maintenance](maintenance.md#releasing-vxyz). This page is the registry
half: the trusted publisher and the Environment, and what has to be true
each time the workflow publishes.

## Trusted publisher and the Environment

Both are already configured, as of 2026-09-23. Recreate one only when it
is missing. Nothing in this repository creates the Environment or
registers the trusted publisher.

On `meganemura/headsign`, the GitHub Environment is named `publish` and
requires reviewers. The workflow job sets `environment: publish`, so a
run waits until a reviewer approves it. A missing Environment is not a
gate: GitHub creates `publish` on first use with no required reviewers,
and the job then publishes without a person.

On the `headsign` package at npmjs.com, one GitHub Actions trusted
publisher is registered. The fields are case-sensitive. Use these same
values if the registration has to be created again:

- Organization or user: `meganemura`
- Repository: `headsign`
- Workflow filename: `publish.yml` (the filename, including `.yml`)
- Environment name: `publish`
- Allowed action: `npm publish`

A trusted publisher created after 3 September 2026 starts with
`npm stage publish` allowed. A replacement has to allow `npm publish` as
well. The workflow runs `npm publish`. It does not stop at `npm stage
publish`.

`package.json` `repository.url` is already
`git+https://github.com/meganemura/headsign.git`. npm checks that URL
against the workflow repository.

Registering the trusted publisher does not open a pending approval. The
approval appears only when a `v*` tag run enters the Environment
`publish`.

After a publish from Actions has succeeded, two package settings are
optional hardening: require two-factor authentication, and disallow
token publishing. The trusted publisher keeps working. Until that first
OIDC publish has succeeded, leave token publishing allowed. The option
retires the old path once the new one has worked.

## Actions pinned by commit

Every `uses:` line names a forty-character commit, with the release in a
trailing comment:

```yaml
uses: action@<40-hex> # vX.Y.Z
```

A tag is a pointer. The repository setting `sha_pinning_required` is
enabled, so a workflow that names an action by tag is rejected.
`publish.yml` uses the same form as `ci.yml`. How to raise a pin is
[Maintenance](maintenance.md#how-the-workflow-is-written-and-why).

## Each version

1. Prepare the release commit as
   [Maintenance](maintenance.md#releasing-vxyz) describes. Bump `version`
   in `package.json` and in every `plugin.json` the tree lists, write the
   changelog section, and commit the rebuilt `plugin/dist/headsign.mjs`
   with that bump. The bundle is committed. The workflow will not publish
   a rebuild that differs from the tag.
2. `npm run typecheck && npm run coverage`, then `npm pack --dry-run` and
   the clean-install check from that page. Coverage is the suite CI runs
   in place of `npm test`.
3. Commit. Tag `vX.Y.Z`. The tag without the leading `v` is the
   `package.json` version; the workflow stops when they differ.
4. `git push && git push --tags`. The tag push starts the workflow. Do not
   `npm publish` from the checkout. A second publish of the same version
   fails, and a token publish skips the Environment.
5. Approve the `publish` environment on that Actions run. The pending
   approval is this run entering the environment. The workflow uses Node
   24 on `ubuntu-latest` with the npm registry URL set and the
   package-manager cache off. It requires npm 11.5.1 or newer (Trusted
   Publisher). It runs `npm ci --ignore-scripts`, `npm run typecheck`,
   `npm run coverage`, and `npm run build`, then refuses the run if the
   build changed the tagged tree, then `npm publish`. `ignore-scripts`
   skips `prepublishOnly`, which is why those commands are steps. The
   package `engines` field stays `>=20`; Node 24 is the publish job, not
   a new requirement for people running the bin.
6. Create the GitHub Release, then install the release on each host, as
   the rest of the maintenance checklist describes.
