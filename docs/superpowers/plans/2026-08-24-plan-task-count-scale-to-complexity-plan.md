# Scale the plan task-count budget to complexity (1–5) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the `plan` stage's task-count budget in `plugins/autopilot/skills/autopilot/SKILL.md` so it derives task count from complexity across a 1–5 range instead of instructing the planner to target 3–5.

**Architecture:** This is a prose-only edit to a single blockquoted block inside one markdown file, plus the one paragraph immediately after it that explains why rule 3 is load-bearing. Rule 1 is replaced with a derivation anchored at both endpoints; rule 3 gains a symmetric anti-padding clause; rules 2 and 4 are untouched. No code, no schema, no version field, no new test.

**Tech Stack:** Markdown (`plugins/autopilot/skills/autopilot/SKILL.md`), Node + vitest (`npm test`) for regression only.

**Spec:** `docs/superpowers/specs/2026-08-24-plan-task-count-scale-to-complexity-design.md`

## Global Constraints

- **Exactly one file may change:** `plugins/autopilot/skills/autopilot/SKILL.md`. The spec's "Explicitly out of scope" says "No other file changes."
- **No version bump.** Do not edit `package.json`, `.claude-plugin/marketplace.json`, `plugins/autopilot/.claude-plugin/plugin.json`, or `package-lock.json`. CI's `scripts/bump-version.mjs` owns versioning on merge to main.
- **No new test file.** In particular, do NOT create `plugins/autopilot/scripts/autopilot-plan-contract.test.mjs` or any other new test. See the "Learnings override" note below.
- **Preserve the literal string `task-count budget`** in the `### \`plan\`` section. `plugins/autopilot/scripts/autopilot-learnings-contract.test.mjs:91-93` asserts `/task-count budget/i` against that section. It occurs in the sentence "The dispatch prompt also carries a task-count budget." at SKILL.md:285, which this change does not touch — keep it that way.
- **Character encoding is load-bearing.** The block uses EN DASH `–` (U+2013) in "3–5", EM DASH `—` (U+2014) in rule 2, and a plain ASCII apostrophe `'` (U+0027) in "run's". New text below follows the same convention: em dash in rule 1's "complexity — 1 to 5 tasks", ASCII apostrophe throughout.
- **Do not enumerate a sizing ladder.** The spec is explicit: anchor only the endpoints (1 and 5). No "1 task / 2–3 tasks / 4–5 tasks" band table — a ladder invites the plan agent to shop for a matching band rather than judge the work.
- **`npm test` must stay green at 466 passing tests across 18 files** (verified as the baseline in this worktree before planning).

## Learnings override — read before starting

`docs/autopilot/learnings.md` carries the planning rule: *"Guard load-bearing prose and error-handling instructions. When a plan adds SKILL.md prose a dispatched agent must follow ... add a contract test."*

**That rule is overridden for this plan by an explicit developer decision.** The developer was asked directly whether to add an `autopilot-plan-contract.test.mjs` guarding the budget wording, and answered "No test, prose only." The spec records this under "Explicitly out of scope." Developer instructions outrank learnings rules, so this plan adds no test file. The guard is replaced by the grep-based verification steps in Task 1, which run in the shell and create nothing.

The other learnings rules do apply and are honored here: every quoted substring below was verified byte-for-byte against SKILL.md as written (not as intended); no user- or issue-supplied text is interpolated into any shell command; there are no cross-task seams to surface because there is one task.

## Task count

**This plan has ONE task, below the budget's 1–5 range midpoint and below the old 3–5 target.** That is deliberate, and it is the plan applying the spec's own argument to itself. The change is confined to one module (`SKILL.md`), it is one diff a reviewer reads in a sitting, and its acceptance criteria (AC1–AC4) all describe different sentences of the same blockquote — none of them can be reviewed or tested without the others. Splitting them would leave the block internally inconsistent between tasks (e.g. a rule 1 that says "1 to 5" sitting next to a rule 3 that still says "do not merge to hit the number") and would buy no reviewability while costing a full dispatch cycle. A second task invented here would be exactly the defect the spec exists to remove.

---

### Task 1: Replace the target with a complexity-scaled derivation

**Files:**
- Modify: `plugins/autopilot/skills/autopilot/SKILL.md:296-297` (rule 1), `:302-304` (rule 3), `:308-310` (the "Rule 3 is load-bearing" paragraph)
- Test: none created. Regression only via the existing suite: `plugins/autopilot/scripts/autopilot-learnings-contract.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks — this is the only task.
- Produces: the rewritten budget block that the `plan` stage's dispatch prompt copies verbatim into every future plan agent's prompt. No code interface, no exported symbol. The only downstream contract is the literal string `task-count budget` at SKILL.md:285, which stays untouched.

---

- [ ] **Step 1: Establish the baseline — confirm the suite is green and the exact text is where the plan says it is**

Run:

```bash
npm test 2>&1 | tail -5
```

Expected: `Test Files  18 passed (18)` and `Tests  466 passed (466)`.

Then confirm the block you are about to edit is byte-identical to what this plan quotes:

```bash
sed -n '294,310p' plugins/autopilot/skills/autopilot/SKILL.md
```

Expected output, exactly:

```
> Task-count budget for this plan:
>
> 1. **Target 3–5 tasks.** Every task costs a serial implementer dispatch plus
>    a review round, so task count multiplies the run's wall clock directly.
> 2. **Merge trivially-coupled steps into one task.** Two steps belong together
>    when one cannot be reviewed or tested without the other — a function and
>    its only caller, a field and the migration that adds it. Splitting those
>    buys no reviewability and costs a full dispatch cycle.
> 3. **Do not merge steps that touch unrelated subsystems**, and do not merge
>    to hit the number. A task that cannot be reviewed as one diff is two
>    tasks. Correctness outranks the budget.
> 4. **If the work genuinely needs more than 5 tasks, write them** and say why
>    in the plan. This is a budget, not a cap.

Rule 3 is load-bearing: a bare instruction to emit fewer tasks produces
oversized tasks whose diffs defeat task review, which converts a wall-clock
saving into fix rounds that cost more than the tasks saved.
```

If the line numbers have drifted, locate the block with `grep -n 'Task-count budget for this plan' plugins/autopilot/skills/autopilot/SKILL.md` and edit by content, not by line number. The `old_string` values below are unique in the file, so a content-based edit is safe.

---

- [ ] **Step 2: Rewrite rule 1 — replace the target with a derivation (AC1, AC2)**

Edit `plugins/autopilot/skills/autopilot/SKILL.md`.

Find exactly (2 lines):

```
> 1. **Target 3–5 tasks.** Every task costs a serial implementer dispatch plus
>    a review round, so task count multiplies the run's wall clock directly.
```

Replace with exactly (5 lines):

```
> 1. **Scale task count to complexity — 1 to 5 tasks.** A change confined to
>    one module, satisfying one acceptance criterion, is ONE task — not three.
>    Five is for work that genuinely spans separate subsystems. Every task
>    costs a serial implementer dispatch plus a review round, so task count
>    multiplies the run's wall clock directly.
```

Notes for the implementer:
- The two `—` characters in the new text are EM DASH (U+2014), matching rule 2's existing em dash. The old EN DASH (U+2013) in "3–5" disappears with the old text.
- `ONE` is capitalized deliberately. It is the emphasis that makes the floor removal land; do not lowercase it or convert it to bold.
- The final sentence ("Every task costs a serial implementer dispatch plus a review round, so task count multiplies the run's wall clock directly.") is carried over verbatim from the old rule 1 — it is the *why* that makes the rule stick. Only its line wrapping changes.
- Do **not** add a per-band sizing ladder. Anchoring the two endpoints (one module / one AC → 1; separate subsystems → 5) is the whole instruction.
- Every line stays inside the `> ` blockquote, wrapped near the file's existing ~76-column hard wrap, with continuation lines indented `>    ` (blockquote marker, then three spaces) to match rules 2–4.

---

- [ ] **Step 3: Rewrite rule 3 — make it bite in both directions (AC3)**

Find exactly (3 lines):

```
> 3. **Do not merge steps that touch unrelated subsystems**, and do not merge
>    to hit the number. A task that cannot be reviewed as one diff is two
>    tasks. Correctness outranks the budget.
```

Replace with exactly (4 lines):

```
> 3. **Do not merge steps that touch unrelated subsystems, and do not pad or
>    compress to hit a number.** A task that cannot be reviewed as one diff is
>    two tasks; a task invented only to fill the range is not a task.
>    Correctness outranks the budget in both directions.
```

Notes for the implementer:
- The bold now wraps the **whole** first sentence, including the "do not pad or compress" clause — in the old text the bold closed after "subsystems". The `**` opens on the first line and closes after "number." on the second; that is intentional and renders correctly in markdown.
- "the number" becomes "a number" — there is no single number to hit any more.
- The phrase "invented only to fill the range" is load-bearing and must appear verbatim. It names an observed failure shape from a real run (a plan that grew a jsdom test-harness task purely to reach three), which the skill's own stated principle says sticks where a general instruction does not.
- "in both directions" is likewise required by AC3.

---

- [ ] **Step 4: Keep the follow-on paragraph coherent with the rewritten rule 3**

The spec requires that the prose immediately after the blockquote "remain coherent with the rewritten rule 3." Today that paragraph explains only the over-merging direction, which is now half of what rule 3 says.

Find exactly (3 lines, not inside the blockquote):

```
Rule 3 is load-bearing: a bare instruction to emit fewer tasks produces
oversized tasks whose diffs defeat task review, which converts a wall-clock
saving into fix rounds that cost more than the tasks saved.
```

Replace with exactly (6 lines):

```
Rule 3 is load-bearing in both directions. A bare instruction to emit fewer
tasks produces oversized tasks whose diffs defeat task review, which converts
a wall-clock saving into fix rounds that cost more than the tasks saved. And a
range with a low end still reads as a number to reach, which produces tasks
invented to fill it — a full dispatch cycle plus a review round spent on work
no acceptance criterion asked for.
```

Notes for the implementer:
- The `—` is an EM DASH (U+2014). Everything else in this paragraph is ASCII, matching the surrounding prose.
- This paragraph is plain prose, **not** blockquoted — do not add `> ` markers.
- Do not touch the paragraph *before* the blockquote (the one starting "The dispatch prompt also carries a task-count budget."). It contains the string the contract test pins, and its wall-clock evidence ("5 tasks landed in 17–23m, 10 tasks in 80m, and 16 tasks in 191m") is still accurate.

---

- [ ] **Step 5: Confirm rules 2 and 4, and everything out of scope, are untouched (AC4, AC5)**

Run:

```bash
git -C . diff --stat
```

Expected: exactly one file listed, `plugins/autopilot/skills/autopilot/SKILL.md`. If any other file appears — especially `package.json`, `package-lock.json`, any `marketplace.json`, or any `plugin.json` — revert it before continuing.

Run:

```bash
git diff -- plugins/autopilot/skills/autopilot/SKILL.md
```

Expected: the diff touches only rule 1, rule 3, and the "Rule 3 is load-bearing" paragraph. Rule 2 and rule 4 must not appear as changed lines. Rule 4 must still read:

```
> 4. **If the work genuinely needs more than 5 tasks, write them** and say why
>    in the plan. This is a budget, not a cap.
```

Confirm no new file was created:

```bash
git status --porcelain
```

Expected: a single ` M plugins/autopilot/skills/autopilot/SKILL.md` line. No `??` untracked entries — in particular no new `*.test.mjs`.

---

- [ ] **Step 6: Verify the rewritten block against each acceptance criterion**

These greps stand in for the contract test the developer declined. They create nothing and are run from the repo root.

AC1 — the old target is gone and the new range is stated:

```bash
grep -c 'Target 3–5 tasks' plugins/autopilot/skills/autopilot/SKILL.md
```

Expected: `0` (grep exits 1; that is the pass).

```bash
grep -n 'Scale task count to complexity — 1 to 5 tasks' plugins/autopilot/skills/autopilot/SKILL.md
```

Expected: exactly one match.

AC2 — both endpoints anchored, no ladder:

```bash
grep -n 'satisfying one acceptance criterion, is ONE task' plugins/autopilot/skills/autopilot/SKILL.md
grep -n 'Five is for work that genuinely spans separate subsystems' plugins/autopilot/skills/autopilot/SKILL.md
```

Expected: one match each. Then read the block by eye and confirm no per-band table or "2–3 tasks" style enumeration was introduced.

AC3 — rule 3 forbids both directions:

```bash
grep -n 'do not pad or' plugins/autopilot/skills/autopilot/SKILL.md
grep -n 'invented only to fill the range is not a task' plugins/autopilot/skills/autopilot/SKILL.md
grep -n 'Correctness outranks the budget in both directions' plugins/autopilot/skills/autopilot/SKILL.md
```

Expected: one match each.

AC4 — rule 4's escape hatch survives verbatim:

```bash
grep -n 'If the work genuinely needs more than 5 tasks, write them' plugins/autopilot/skills/autopilot/SKILL.md
```

Expected: one match.

Contract-test string preserved:

```bash
grep -n 'The dispatch prompt also carries a task-count budget' plugins/autopilot/skills/autopilot/SKILL.md
```

Expected: one match.

AC5 — no version field moved:

```bash
git diff --name-only | grep -E 'package(-lock)?\.json|marketplace\.json|plugin\.json'
```

Expected: no output (grep exits 1; that is the pass).

Finally, read the whole block once as a human would:

```bash
sed -n '294,315p' plugins/autopilot/skills/autopilot/SKILL.md
```

Confirm the blockquote markers are intact on every rule line, the numbering still runs 1–4, and the paragraph after the block is not blockquoted.

---

- [ ] **Step 7: Run the full suite (AC6)**

Run:

```bash
npm test 2>&1 | tail -5
```

Expected: `Test Files  18 passed (18)` and `Tests  466 passed (466)` — the same baseline as Step 1. The count must not change: this plan adds no test and removes none. `autopilot-learnings-contract.test.mjs` in particular must stay green, which it will because the string it pins (`task-count budget`, at SKILL.md:285) is outside the edited region.

If the learnings contract test fails, the edit strayed out of the blockquote — re-read Step 4's warning about the preceding paragraph.

---

- [ ] **Step 8: Commit**

```bash
git add plugins/autopilot/skills/autopilot/SKILL.md
git commit -m "$(cat <<'EOF'
feat(autopilot): scale plan task-count budget to complexity (1-5)

Rule 1 stated a target near 4 rather than a rule to derive the count
from, which padded small work: a single-label display fix planned three
tasks and ran 108 minutes, its second task an invented test harness.
Replace the target with a derivation anchored at both endpoints, and
make rule 3 forbid padding as well as over-merging.

Prose only, by explicit developer decision: no contract test, no
version bump (CI owns versioning).
EOF
)"
```

Note: the commit subject uses an ASCII hyphen in "1-5" to keep the git log ASCII-clean; the SKILL.md prose itself uses the em dash as specified.

---

## Self-Review

**1. Spec coverage.**

| Spec requirement | Where it lands |
|---|---|
| Rule 1 → derivation, 1–5, one module/one AC → 1, five for separate subsystems, cost sentence kept | Step 2 (AC1, AC2) |
| No sizing ladder | Step 2 note + Step 6 AC2 eyeball check |
| Rule 2 unchanged | Step 5 (diff must not touch it) |
| Rule 3 → symmetric, "invented only to fill the range", "in both directions" | Step 3 (AC3) |
| Rule 4 unchanged in substance | Step 5 + Step 6 AC4 |
| Follow-on prose stays coherent | Step 4 |
| No version bump | Global Constraints + Step 5 + Step 6 AC5 |
| No new test | Global Constraints + Learnings override + Step 5 `git status` check |
| No other file changes | Step 5 `git diff --stat` |
| `npm test` green at 466 | Steps 1 and 7 (AC6) |

No gaps.

**2. Placeholder scan.** No TBD/TODO, no "add appropriate error handling", no "similar to Task N" (there is only one task), no step that describes without showing. Every edit is given as an exact find/replace pair with the surrounding characters spelled out, including which dash is which.

**3. Type consistency.** No code symbols cross any boundary. The only shared literals are the SKILL.md phrases quoted in Steps 2–4 and re-grepped in Step 6; they were cross-checked character-for-character between those steps, and each was verified against the file as it currently stands (en dash confirmed at U+2013 in "3–5", em dash at U+2014 in rule 2, ASCII apostrophe in "run's").
