# Autopilot: cut the plan task-count budget to 3–5

**Date:** 2026-08-21
**Status:** Approved design, ready for planning

## Problem

The autopilot `plan` dispatch tells the planner to target 5–8 tasks. Task count
is the largest driver of a run's wall-clock time — `sdd` is ~66% of every run
measured, and `subagent-driven-development` forbids parallel implementer
dispatch, so tasks run strictly serially at a near-constant 3–12 minutes each.
The SKILL.md block already cites the evidence: 5 tasks land in 17–23m, 10 in
80m, 16 in 191m. The current 5–8 band tilts the default toward the slow end of
that curve.

This is issue #11 lever 1, tracked as issue #12: lower the *default* target band.
It is a behavioral default change, not a mechanism change — the "budget, not a
cap" escape valve stays.

## Scope

One prose edit in the plan stage's SKILL.md block, plus a minor version bump.
No script, no config key, no new logic. This is a small, surgical change.

## Changes

### `plugins/autopilot/skills/autopilot/SKILL.md`

The "Task-count budget for this plan" block (lines ~263–275):

- **Item 1** (line ~265): `**Target 5–8 tasks.**` → `**Target 3–5 tasks.**`
- **Item 4** (line ~274): `If the work genuinely needs more than 8 tasks, write
  them and say why` → `more than 5 tasks`, so the "budget, not a cap" valve
  tracks the new band rather than the old one.

Left unchanged:

- The intro evidence paragraph (line ~258: "5 tasks landed in 17–23m, 10 tasks
  in 80m, and 16 tasks in 191m") — it is the justification for the band and
  stays.
- Rule 3 (lines ~271–273): "Do not merge steps that touch unrelated
  subsystems … Correctness outranks the budget." Rule 3 is load-bearing (a bare
  instruction to emit fewer tasks produces oversized, unreviewable diffs); it
  stays exactly as written.

### Version bump `1.6.0 → 1.7.0`

Minor bump — a default-behavior change, per repo convention. Three files:

- `plugins/autopilot/.claude-plugin/plugin.json` (`"version": "1.7.0"`)
- `.claude-plugin/marketplace.json` — the plugin entry block AND the metadata
  block, both currently `"1.6.0"`
- `plugins/autopilot/scripts/autopilot-findings-contract.test.mjs` — the three
  version assertions (plugin JSON, marketplace entry, marketplace metadata)

The contract test pins the version, so the three version assertions and the two
JSON files must move together in one commit.

## Verification

- `npm test` passes. The `autopilot-findings-contract.test.mjs` test pins the
  version at `1.6.0`, so bumping the JSON files without updating the three
  assertions fails the test — update them together.

## Repo conventions

- Version bumps touch both `plugins/autopilot/.claude-plugin/plugin.json` and
  `.claude-plugin/marketplace.json` (entry + metadata block), and the contract
  test that pins the version.
- Test command: `npm test`.

## Deferred

None. The remaining levers of issue #11 (e.g. changing how `sdd` dispatches or
reviews, not just the plan target band) are out of scope for this run.
