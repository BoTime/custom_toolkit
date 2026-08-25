# custom_toolkit

A personal Claude Code plugin marketplace. One plugin today: `autopilot`.

## Versioning is automated — do not do it by hand

This repo carries a single version number, mirrored across six fields in four
files: `package.json`, `package-lock.json` (twice), `.claude-plugin/marketplace.json`
(twice), and `plugins/autopilot/.claude-plugin/plugin.json`. A CI job rewrites
all six on every push to `main` and commits `chore(release): vX.Y.Z [skip ci]`.

Three rules follow from that.

**1. Never hand-edit a version field.** CI owns all six. A hand-edit downward is
silently ignored, because `scripts/bump-version.mjs` reads the highest value
across every target rather than trusting one source of truth. A hand-edit upward
just becomes the next base. Neither accomplishes anything, and both make the
release commit that follows look unexplained.

**2. Never assert a version literal in a test.** A line like
`expect(pluginJson.version).toBe("1.7.1")` turns `main` red on the next bump.
The version job is gated on tests passing, so a red `main` stops the automation
from running — and it cannot recover on its own. It disables itself one commit
later. Three such assertions were removed from
`plugins/autopilot/scripts/autopilot-findings-contract.test.mjs` for precisely
this reason; do not reintroduce them there or anywhere else. The invariant they
were reaching for — every target holding the same version after a write — is
tested properly in `scripts/bump-version.test.mjs` ("brings all six fields to
the same version"). Assert the invariant, never a specific number.

**3. The squash-merge title decides the bump.** `feat:` gives a minor, a `!`
after the type or a `BREAKING CHANGE:` line in the body gives a major, and
everything else gives a patch — including titles that are not conventional
commits at all. GitHub seeds the squash title from the pull request title, so a
PR titled without a prefix lands as a patch bump with no warning. This has
already happened once: PR #16 shipped a feature as `v1.7.1`. Rename the pull
request before merging when the change deserves a minor.

Full rationale, including why the version is read as a maximum instead of from
one designated file, is in
`docs/superpowers/specs/2026-08-24-auto-version-bump-design.md`.
