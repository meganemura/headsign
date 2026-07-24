# Releasing

1. Bump `version` in **both** `package.json` and
   `plugin/.claude-plugin/plugin.json` at the same time — the plugin is
   distributed only via that version string, so the two must never diverge.
2. Add a `CHANGELOG.md` entry for the new version.
3. Commit (e.g. `Release vX.Y.Z`) and land it on `main`. The marketplace
   follows `main`, so the moment the commit lands it is distributed to
   plugin users.
4. `git tag vX.Y.Z` and `git push --tags`.
5. Create a GitHub Release; its body is the transcription of the relevant
   `CHANGELOG.md` section.

## Not yet enabled

`npm publish` will have `prepublishOnly` force build+test, and the `files`
whitelist restricts what ships.
