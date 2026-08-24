# Automatic version bump on every landing

**Date:** 2026-08-24
**Status:** Approved design, ready for planning

## Problem

This repo is a Claude Code plugin marketplace. Its version number is carried in
several JSON files and has been bumped by hand on every landing, which has let
the values drift apart. On `origin/main` today:

| Field | Value |
| --- | --- |
| `package.json` → `version` | `1.0.1` |
| `.claude-plugin/marketplace.json` → `metadata.version` | `1.7.0` |
| `.claude-plugin/marketplace.json` → `plugins[0].version` | `1.7.0` |
| `plugins/autopilot/.claude-plugin/plugin.json` → `version` | `1.7.0` |
| `package-lock.json` → `version` | `1.0.0` |
| `package-lock.json` → `packages[""].version` | `1.0.0` |

Three different numbers for one repo. The cause is mechanical: the bump is a
manual step in a checklist, the checklist named two files (see the "Version"
section of every prior spec in this directory, which says "both `plugin.json`
and `marketplace.json`"), and the files it did not name were never touched.

**Goal:** every commit that lands on `main` automatically updates the version,
with no manual step.

## Scope

One repo-wide version, kept in lockstep across all fields. There is no
per-plugin version and no independent `package.json` version; the repo ships as
one unit.

Four primary targets:

- `package.json` → `version`
- `.claude-plugin/marketplace.json` → `metadata.version`
- `.claude-plugin/marketplace.json` → `plugins[0].version`
- `plugins/autopilot/.claude-plugin/plugin.json` → `version`

Plus two that follow mechanically as a consequence of `package.json` being in
scope: `package-lock.json`'s top-level `version` and its `packages[""].version`.

Note as evidence: the existing 1.0.1-vs-1.0.0 drift between `package.json` and
`package-lock.json` has **not** broken `npm ci` in CI — `test.yml` has been
running `npm ci` against that mismatch throughout. Updating the lock is for
tidiness and future clarity, not a CI requirement. An implementer who finds the
lock's two fields awkward to target should still do it, but should not treat
them as load-bearing.

## Decisions

### Bump rule: conventional commits

Parse the head commit's subject line, and scan its body:

- A `!` after the type or scope (`feat(x)!:`, `fix!:`) **or** a
  `BREAKING CHANGE:` line in the body → **major**.
- Type `feat` → **minor**.
- Everything else — `fix`, `perf`, `chore`, `docs`, `refactor`, `test`,
  `style`, `build`, `ci` — → **patch**.

Rationale: the repo's landings already use these prefixes (`perf(autopilot):`,
`feat(autopilot):`, `chore:`), so the rule requires no new discipline from
anyone. Nothing has to change about how commits are written for this to start
working.

### Fallback: a non-conventional message still bumps

A commit message that is not a conventional commit — `Merge pull request #3
from BoTime/sdd-visibility`, or a bare `update docs`, or an empty message —
produces a **patch** bump. It never skips and it never fails.

Rationale: "every landing updates the version" must hold with no silent
no-ops. The two failure modes available are an inflated patch digit and a
version that silently stops tracking reality; the first is the cheapest
possible failure, and the second is exactly the problem this design exists to
fix. Merge commits are not hypothetical here — the repo's history contains
them.

### Mechanism: CI commits back to `main`

A GitHub Actions job triggered on `push` to `main` computes the next version,
rewrites the files, and pushes a commit back to `main`.

`main` has no branch protection and no rulesets, so the push works with the
default `GITHUB_TOKEN`. No PAT, no deploy key, no app installation.

### No tags, no GitHub Releases

The JSON files are the version record. Claude Code reads plugin versions from
`plugin.json` / `marketplace.json` and never looks at git tags, so tags would be
decoration on top of the real record rather than part of it. The repo has zero
tags and zero releases today; this design does not introduce the first one.

### Implementation shape: in-repo Node script plus vitest

Pure exported functions plus a thin CLI entry point, with a sibling
`*.test.mjs`, matching how every other script in this repo is written (see
`plugins/autopilot/scripts/*.mjs` and their colocated tests; the tail of
`autopilot-sync-base.mjs` is the canonical shape for the `main()` /
`import.meta.url` entry guard).

Rejected alternatives:

- **Inline `jq`/bash in the workflow YAML.** Untestable. The parse table in the
  bump rule has roughly a dozen cases and the file rewriting has a
  no-regression property to prove; neither can be covered from YAML.
- **A third-party bump action.** Only understands `package.json`, which is one
  of six fields, and adds a supply-chain dependency to a repo that currently
  has none beyond `vitest`.

## Component A — `scripts/bump-version.mjs`

A **new root-level `scripts/` directory**, not `plugins/autopilot/scripts/`,
because this versions the whole repo rather than the autopilot plugin.

Vitest has no config file in this repo, so its default discovery
(`**/*.{test,spec}.?(c|m)[jt]s?(x)`, excluding `node_modules`) already picks up
a test file at `scripts/bump-version.test.mjs`. No config change is needed.

### Exported functions

**`bumpKind(message)` → `'major' | 'minor' | 'patch'`**

Implements the bump rule and the fallback above. Total function: every string,
including `""`, returns one of the three kinds. It never throws and never
returns null.

**A target table** describing each file and the path to its version field,
covering all six fields in Scope. Each entry must carry enough information to
locate its field unambiguously — file path plus a way to disambiguate that field
from the other `"version"` keys in the same file. The two files that need
disambiguation:

- `package-lock.json` has one `"version"` key per dependency (hundreds of them,
  in a ~1600-line file). Only two must ever change: the top-level `version`,
  and the `version` inside the root package entry `packages[""]`. A rewrite that
  touches any dependency's version is a corruption bug, not a cosmetic one — it
  would change what `npm ci` installs.
- `.claude-plugin/marketplace.json` has two: `metadata.version` and the plugin
  entry's `version`.

Implementation note: locate the marketplace plugin entry by its
`"name": "autopilot"` rather than by array index, so that adding a second plugin
later cannot silently retarget the rewrite at the wrong entry. The existing
contract test already reaches for that entry the same way
(`marketplace.plugins.find((p) => p.name === "autopilot")`).

**`currentVersion(targets)` → the HIGHEST semver across all targets**

Deliberately **not** one designated source-of-truth file. This is load-bearing:

- Reading the max makes the first run self-healing. It reads `1.7.0`, not
  `1.0.1`, so the first automated landing pulls `package.json` and
  `package-lock.json` up to join the other four instead of dragging the other
  four down to `1.0.1`.
- It makes "no field is ever moved backwards" a structural property of the
  design rather than a rule someone has to remember. There is no choice of
  source file that could regress a field, because the source is by construction
  the largest.
- It repairs today's drift on the first landing, instead of requiring a manual
  seed commit — which would be one more hand-bump, of exactly the kind this
  design exists to eliminate.

Comparison must be numeric and field-wise, not lexicographic: `1.10.0` is
greater than `1.9.0`.

**`nextVersion(current, kind)` → the incremented semver**

Standard semver increment: minor resets patch; major resets minor and patch.

**`writeVersion(targets, version)` → rewrites each version field in place**

Edits the version **line**, rather than doing a `JSON.parse` / `JSON.stringify`
round-trip, so surrounding formatting stays byte-stable. This matters most for
`package-lock.json`: a round-trip there would produce a diff of the entire file
on every landing, burying the two-line real change and making every future
`git log -p` and every future merge conflict worse.

### Version format

The repo uses plain `X.Y.Z` throughout. A target whose version is not plain
`X.Y.Z` (a prerelease or build-metadata suffix) is an error, not something to be
parsed leniently — see error handling.

### Error handling

Two failure classes, deliberately kept distinct:

- **Repo-structure bugs fail loudly.** A missing target file, a target file with
  no version field where one is expected, or a version field that does not parse
  as `X.Y.Z` → exit non-zero with a message naming the file and field. These
  mean the target table and the repo have gone out of sync, and a silent skip
  would let a field quietly stop being versioned — reintroducing drift through a
  different door.
- **An unparseable commit message never fails.** It is the ordinary case covered
  by the fallback decision, not an error.

### CLI

The head commit message is the input. The CLI reads it from git by default and
accepts an override for testing. It prints the resulting version to stdout — the
workflow reads that to build its commit message.

It exits 0 without writing when every target is already at the computed target
version. Running it twice in a row is a no-op the second time.

## Component B — the version workflow

A job triggered on `push` to branch `main`, with:

- **`needs: test`**, so a red `main` is never versioned. The existing
  `.github/workflows/test.yml` already runs `npm ci && npm test` on push to
  `main`. The implementer may either add the version job to `test.yml` (where
  `needs: test` is a direct job dependency) or create a separate
  `.github/workflows/version.yml` — whichever is cleaner — as long as the
  "tests must pass first" property holds and is expressed in a way the contract
  test below can assert.
- **`permissions: contents: write`.**
- **Checkout that persists credentials**, so the push works.

It runs the script against the head commit message and, when files changed,
commits as `github-actions[bot]` with the message
`chore(release): vX.Y.Z [skip ci]` and pushes to `main`.

### Loop prevention is layered, on purpose

Three layers, all of them required in the implementation:

1. **A push made with the default `GITHUB_TOKEN` does not trigger new workflow
   runs.** This is the primary guard and the one the design relies on.
2. **`[skip ci]` in the commit message** backs it up, and covers the case where
   someone later swaps the token for a PAT without thinking about loops.
3. **The job skips outright when the head commit message already starts with
   `chore(release):`.** The last-resort guard, and the only one that still works
   if both of the above are bypassed.

The layering is deliberate because the failure mode is not a failed run — it is
an infinite series of successful ones, each pushing a commit that triggers the
next.

### Consequence to accept

Because the bot's push does not trigger workflows, the release commit itself is
never tested by CI. That is acceptable precisely because of the discovered
constraint below: once no test pins a version literal, the release commit's
entire content is version digits in JSON files, and nothing in the test suite
can be affected by it.

## Discovered constraint: a test currently pins the version

`plugins/autopilot/scripts/autopilot-findings-contract.test.mjs` hard-pins the
version at `1.7.0` in three assertions (roughly lines 156–168):

```js
it("is at version 1.7.0", () => {
  expect(pluginJson.version).toBe("1.7.0");
});
```

plus the same literal for the marketplace plugin entry and the marketplace
metadata block.

**This blocks the design as written, and the failure is not obvious.** The
sequence:

1. A commit lands on `main`. `test` passes — the tree is still at `1.7.0`.
2. The version job bumps to `1.7.1` and pushes. No workflow runs (layer 1).
3. Every subsequent run of the suite — every pull request, every push — fails,
   because the tree says `1.7.1` and the test demands `1.7.0`.
4. `main` is now permanently red, and `needs: test` means the version job never
   runs again either. The automation disables itself one commit after it ships.

**Resolution, in scope for this run: delete the three version assertions.**

Do not replace them with an assertion that the live tree's version fields agree
with each other, tempting as that is. Two reasons:

- The current tree does not satisfy it (`package.json` is `1.0.1`,
  `marketplace.json` is `1.7.0`), so such a test would fail this run's own PR CI
  and force exactly the manual seed commit the max-reading design was chosen to
  avoid.
- It would re-pin the automation's output to a test that runs on an untested
  commit (see "Consequence to accept" above).

The lockstep invariant those assertions protected is preserved, but moved to
where it now belongs — a property of `writeVersion` in
`scripts/bump-version.test.mjs`: after a write, every target reads the same
version. That is a stronger guarantee than the deleted assertions gave (they
covered three of six fields and had to be hand-edited on every bump), and it
lives with the tool that now owns the digits.

The rest of `autopilot-findings-contract.test.mjs` — the SKILL.md prose
assertions and the `plugin packaging` checks that are not about the version
literal — stays untouched.

## Component C — Tests

### `scripts/bump-version.test.mjs`

- **The conventional-commit parse table**: plain (`feat: x`), scoped
  (`feat(autopilot): x`), `!` breaking (`feat(x)!:`), `BREAKING CHANGE:` in the
  body, each non-`feat` type (`fix`, `perf`, `chore`, `docs`, `refactor`,
  `test`, `style`, `build`, `ci`), merge-commit fallback (`Merge pull request #3
  from BoTime/sdd-visibility`), and the empty message.
- **`currentVersion` picks the max under the real current drift** — given the
  six values in the Problem table, it returns `1.7.0`. Include a
  numeric-versus-lexicographic case (`1.9.0` vs `1.10.0`).
- **The no-regression property**: no target is ever written a version lower than
  the one it had. Assert it over the drifted fixture, where four of six fields
  would regress under a naive `package.json`-as-source implementation.
- **Formatting preservation**: after a write, the only changed lines are the
  targeted version lines. For `package-lock.json` specifically, assert that no
  dependency's `"version"` changed — the corruption case named in Component A.
- **Lockstep**: after a write, all six fields read the same version.
- **Idempotence**: running twice against the same target version changes nothing
  and exits 0.
- **Error handling**: a missing target file and a target file with no version
  field each exit non-zero.

### `scripts/version-workflow-contract.test.mjs`

A workflow contract test in the style of the repo's existing
`*-contract.test.mjs` files — read
`plugins/autopilot/scripts/autopilot-sdd-contract.test.mjs` for the pattern: it
reads the file, matches on load-bearing phrases rather than whole lines, and
each `it()` explains what breaks if the thing goes missing.

It reads the workflow YAML and asserts it retains:

- the tests-must-pass dependency,
- `contents: write`,
- the `chore(release):` skip guard,
- its invocation of `scripts/bump-version.mjs`.

These are the four properties that fail silently rather than loudly. A workflow
that loses `contents: write` fails visibly on the push; a workflow that loses
its skip guard or its `needs: test` keeps succeeding while doing the wrong
thing.

## Version

This run does **not** hand-bump anything, and the spec's usual "bump to X in
both files" instruction is deliberately absent — shipping this design is the
point at which that instruction stops applying to this repo.

The first automated run happens when this work lands on `main`: the script reads
`1.7.0` as the max, applies the kind derived from the landing commit's message,
and pulls all six fields to the result — repairing the drift in the Problem
table as its first act.

## Repo conventions

- Node helpers are pure exported functions plus a thin `main()` CLI, with
  colocated `.test.mjs` files (vitest). Repo-wide tooling goes in a root
  `scripts/`; autopilot-plugin tooling stays in `plugins/autopilot/scripts/`.
- Test command: `npm test`.
- Contracts that live in prose or in YAML are pinned by `*-contract.test.mjs`
  guard tests, because nothing else fails when they are edited away.

## Deferred

- **Per-plugin versioning.** The repo ships one plugin, so one repo-wide version
  is correct today. If a second plugin is added, the target table is where that
  decision gets revisited, and the `"name": "autopilot"` lookup means the second
  plugin's version is simply not managed rather than wrongly managed.
- **Tags and GitHub Releases.** Rejected above, not merely postponed. If a
  consumer ever needs them, they can be derived from the JSON record after the
  fact.
- **Changelog generation.** The commit messages already carry the
  conventional-commit structure a changelog would need, but nothing consumes it
  today and guessing at a format would be speculative.
