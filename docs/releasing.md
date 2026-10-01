# Distributing skills

headsign ends CLI and npm distribution with the skills-only revision.
Git tags and CHANGELOG identify releases. Do not publish headsign to npm.

Skill consumers can use a reviewed checkout or copy complete directories from
`skills/` into their host's configured skill directory.
The README also documents `gh skill` and `npx skills` installation.

## Prepare a revision

1. Update the skills, their references, current guides, and the Unreleased changelog.
2. Run `node scripts/check.ts`, the same check CI runs.
   Run `gh skill publish ./skills --dry-run` to validate the skill files.
3. Exercise changed behavior and report the observations and limits.
4. Inspect the distribution contents: two skills and their references.
5. Give the changelog entry the release tag's version and date.
   Update pinned installation examples in both READMEs for the new version.
6. Review the exact diff and release description before external publication.

A version change belongs to an authorized release task. Preparing this
transition does not itself bump versions, create a release, or update a
registry.

## Publish with explicit authority

Obtain explicit approval immediately before publication or pushing a release
tag. Preserve published tags; do not move them to this revision.
Treat a change to npm deprecation status as a separate external action.
Ending distribution in the repository does not deprecate or delete an existing
npm package.

Check the destination and revision before publication.
Release-based installers may still resolve an earlier tag.
`gh skill` prefers the latest GitHub Release when the user omits a version.
Publish a release for the reviewed tag so ordinary installs select it.
`npx skills` accepts the repository or a GitHub tree URL for a particular tag.
Inspect the selected revision and its contents before recommending it.

After a release, verify the delivered skill files with both installers.
Tell existing users to uninstall the old plugin and remove its manual hooks.
Record the observed revision; a successful install message alone does
not identify the instructions loaded by an active session.

## Historical operations

The [v0.15.4 maintenance guide](https://github.com/meganemura/headsign/blob/v0.15.4/docs/maintenance.md)
and [release guide](https://github.com/meganemura/headsign/blob/v0.15.4/docs/releasing.md)
record the retired npm, bundle, and hook release process.
They can help identify existing external configuration.
Removing that configuration requires its own authorized action; this checkout
does not change registry or hosting settings.
