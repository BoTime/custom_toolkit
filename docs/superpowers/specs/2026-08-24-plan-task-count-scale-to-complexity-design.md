# Scale the plan task-count budget to complexity (1–5)

**Date:** 2026-08-24
**Status:** Approved design, ready for planning

## Problem

The `plan` stage's dispatch prompt in `plugins/autopilot/skills/autopilot/SKILL.md`
currently opens its task-count budget with **"Target 3–5 tasks."**

Evidence from 38 autopilot runs in the samba project (`/Users/bo/workspace/samba/samba`):

- Task-count distribution across all runs: 1×3, 2×5, 3×4, 4×4, 5×5, 6×6, 7×5, 8×1, 10×2.
- The "3–5" wording only went live 2026-08-21 21:21 (plugin v1.7.0). Nine samba runs
  have happened since; their task counts were 1, 2, 3, 3, 4, 4, 5, 5, 6.
- So **3 is not acting as a hard floor** — `issue-171-disable-buttons-during-edit`
  planned 1 task (22 min) and `worktree-up-default-force-tunnel` planned 2 (24 min),
  both under the current wording.
- But padding-to-target is real: `issue-193` ("theme text should be fully displayed",
  a label-display fix) came out as 3 tasks and ran **108 minutes**, and its Task 2 was
  *"jsdom component-test harness + pie-mode regression guard"* — test infrastructure
  invented to fill out the plan. A comparable truncation fix, `issue-192`, ran the same
  3 tasks in 40 minutes.

The defect is therefore NOT a binding floor. It is that **"Target N" states a number to
aim at, with a center of gravity near 4**, where the instruction should state **a rule to
derive the count from**. The fix replaces a target with a derivation.

## The change

One file: `plugins/autopilot/skills/autopilot/SKILL.md`, the `### plan` stage's
blockquoted "Task-count budget for this plan:" block. Three of its four rules move.

**Rule 1** becomes a derivation anchored at both endpoints, replacing the target:

> 1. **Scale task count to complexity — 1 to 5 tasks.** A change confined to one
>    module, satisfying one acceptance criterion, is ONE task — not three. Five is
>    for work that genuinely spans separate subsystems. Every task costs a serial
>    implementer dispatch plus a review round, so task count multiplies the run's
>    wall clock directly.

Keep the existing cost sentence — it is the *why* that makes the rule stick. Anchor
ONLY the endpoints; do NOT write a 1 / 2–3 / 4–5 sizing ladder, because a ladder
invites the plan agent to shop for a matching band rather than judge the work.

**Rule 2** (merge trivially-coupled steps into one task) is UNCHANGED.

**Rule 3** gains a symmetric clause. Today it guards only against over-merging; with
the floor gone it must bite both ways:

> 3. **Do not merge steps that touch unrelated subsystems, and do not pad or compress
>    to hit a number.** A task that cannot be reviewed as one diff is two tasks; a task
>    invented only to fill the range is not a task. Correctness outranks the budget in
>    both directions.

The phrase "invented only to fill the range" deliberately names the observed shape
(`issue-193`'s harness task), consistent with the skill's own stated principle that
naming patterns from real runs is load-bearing where a general instruction is not.

**Rule 4**'s escape hatch is unchanged in substance — it already reads "more than 5
tasks", which stays correct under the new range.

The prose immediately after the block ("Rule 3 is load-bearing: a bare instruction to
emit fewer tasks produces oversized tasks whose diffs defeat task review...") must
remain coherent with the rewritten rule 3.

## Explicitly out of scope

- **No version bump.** CI owns versioning: `.github/workflows/test.yml` runs
  `scripts/bump-version.mjs` on merge to main, keeping `package.json`, both
  `.claude-plugin/marketplace.json` fields, `plugins/autopilot/.claude-plugin/plugin.json`,
  and the lockfile in lockstep. Commit `320953b` (the previous budget change) bumped
  versions by hand only because it predated that automation. Do NOT edit any version field.
- **No new test.** The developer explicitly chose prose-only. No
  `autopilot-plan-contract.test.mjs` is to be created. The existing
  `autopilot-learnings-contract.test.mjs` asserts the literal string `task-count budget`
  survives — this change preserves that string, so it stays green.
- No other file changes.

## Acceptance criteria

- AC1 (non-ui) — the plan stage's task-count budget in
  `plugins/autopilot/skills/autopilot/SKILL.md` states a 1-to-5 range scaled to
  complexity, and no longer instructs the planner to target a floor of 3
- AC2 (non-ui) — rule 1 anchors work confined to one module satisfying one acceptance
  criterion at ONE task, and reserves the top of the range for work spanning separate
  subsystems, without enumerating a per-band sizing ladder
- AC3 (non-ui) — rule 3 forbids both padding to a number and compressing to a number,
  and states that correctness outranks the budget in both directions
- AC4 (non-ui) — rule 4 still permits exceeding the budget when the work genuinely
  needs it, provided the plan says why
- AC5 (non-ui) — no version field is modified in any file, and no new test file is added
- AC6 (non-ui) — `npm test` is green (466 tests baseline)
