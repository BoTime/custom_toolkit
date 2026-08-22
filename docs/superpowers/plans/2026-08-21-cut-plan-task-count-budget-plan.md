# Cut Autopilot Plan Task-Count Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lower the autopilot `plan` stage's default task-count target from 5–8 to 3–5, and bump the plugin's minor version 1.6.0 → 1.7.0.

**Architecture:** Two surgical, prose-and-metadata-only changes. (1) Rewrite two lines in `plugins/autopilot/skills/autopilot/SKILL.md`'s "Task-count budget for this plan" block: the target band and the escape-valve ceiling. (2) A coordinated minor version bump across the two JSON manifests and the three contract-test assertions that pin the version. No script, no config key, no new logic.

**Tech Stack:** Markdown prose, JSON manifests, Vitest (`npm test`).

**Spec:** `docs/superpowers/specs/2026-08-21-cut-plan-task-count-budget-design.md`

## Global Constraints

- Version bumps touch both `plugins/autopilot/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` (entry + metadata block), and the contract test that pins the version.
- Test command: `npm test` (runs `vitest run`).
- The SKILL.md intro evidence paragraph (line ~258, "5 tasks landed in 17–23m …") and Rule 3 (lines ~271–273, "Do not merge steps that touch unrelated subsystems … Correctness outranks the budget.") stay exactly as written — Rule 3 is load-bearing and must not be touched.

---

## Task decomposition note

This plan has 2 tasks, below the 3–5 target. The spec's scope has exactly two independently-reviewable deliverables — the prose budget change and the version bump — and the spec is explicit that the version bump's JSON files and test assertions "must move together in one commit," so the bump cannot be split further. Padding to three tasks by splitting the version bump would leave the contract test red between tasks, which is exactly the drift the test exists to catch. Correctness outranks the budget.

---

### Task 1: Change the task-count budget band in SKILL.md

**Files:**
- Modify: `plugins/autopilot/skills/autopilot/SKILL.md:265` (item 1) and `:274` (item 4)

**Interfaces:**
- Consumes: none.
- Produces: the new "Target 3–5 tasks" band and "more than 5 tasks" ceiling, which the plan-dispatch prompt copies verbatim. No code interface.

- [ ] **Step 1: Edit item 1 — the target band**

In `plugins/autopilot/skills/autopilot/SKILL.md`, change line 265 from:

```markdown
> 1. **Target 5–8 tasks.** Every task costs a serial implementer dispatch plus
```

to:

```markdown
> 1. **Target 3–5 tasks.** Every task costs a serial implementer dispatch plus
```

The dash is an en dash (U+2013), not a hyphen. Only `5–8` → `3–5` changes; the rest of the sentence is untouched.

- [ ] **Step 2: Edit item 4 — the escape-valve ceiling**

In the same block, change line 274 from:

```markdown
> 4. **If the work genuinely needs more than 8 tasks, write them** and say why
```

to:

```markdown
> 4. **If the work genuinely needs more than 5 tasks, write them** and say why
```

Only `more than 8 tasks` → `more than 5 tasks` changes. The trailing "… in the plan. This is a budget, not a cap." is untouched.

- [ ] **Step 3: Confirm no other line moved**

Run `git diff` and confirm the diff shows exactly two changed lines, both inside the "Task-count budget for this plan" block, and that the intro evidence paragraph and Rule 3 are byte-for-byte unchanged:

```bash
git diff plugins/autopilot/skills/autopilot/SKILL.md
```

- [ ] **Step 4: Run the test suite to confirm nothing pins the old band**

No test asserts the plan-section budget prose, so this edit must leave the suite green:

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/autopilot/skills/autopilot/SKILL.md
git commit -m "perf(autopilot): cut plan task-count budget from 5–8 to 3–5"
```

---

### Task 2: Bump plugin version 1.6.0 → 1.7.0

**Files:**
- Modify: `plugins/autopilot/.claude-plugin/plugin.json:5`
- Modify: `.claude-plugin/marketplace.json:8` (metadata block) and `:15` (plugin entry block)
- Modify: `plugins/autopilot/scripts/autopilot-findings-contract.test.mjs:156-168` (three version assertions + the test-name string)

**Interfaces:**
- Consumes: none.
- Produces: consistent `1.7.0` across both manifests and the pinning assertions. No code interface.

The contract test pins the version at `1.6.0`, so the two JSON files and the three assertions move in one commit — a partial bump is a red suite.

- [ ] **Step 1: Bump `plugin.json`**

In `plugins/autopilot/.claude-plugin/plugin.json`, change line 5 from:

```json
  "version": "1.6.0",
```

to:

```json
  "version": "1.7.0",
```

- [ ] **Step 2: Bump both `marketplace.json` occurrences**

In `.claude-plugin/marketplace.json`, change BOTH occurrences from `1.6.0` to `1.7.0`:

Line 8 (metadata block):

```json
    "version": "1.7.0"
```

Line 15 (the `autopilot` plugin entry under `plugins`):

```json
      "version": "1.7.0",
```

Two places in one file — bumping only the plugin entry is the drift the contract test pins.

- [ ] **Step 3: Run the contract test to see it fail (red)**

With the JSON bumped but the assertions still expecting `1.6.0`, the pin fires:

```bash
npx vitest run plugins/autopilot/scripts/autopilot-findings-contract.test.mjs
```

Expected: FAIL — three `plugin packaging` assertions (`is at version 1.6.0`, `bumps the marketplace plugin entry…`, `bumps the marketplace metadata block too`) report expected `"1.6.0"` but received `"1.7.0"`.

- [ ] **Step 4: Update the three assertions (and the test-name string) to 1.7.0**

In `plugins/autopilot/scripts/autopilot-findings-contract.test.mjs`, change every remaining `1.6.0` to `1.7.0`:

Line 156 — the test-name string:

```js
  it("is at version 1.7.0", () => {
```

Line 157:

```js
    expect(pluginJson.version).toBe("1.7.0");
```

Line 162:

```js
    expect(entry.version).toBe("1.7.0");
```

Line 168:

```js
    expect(marketplace.metadata.version).toBe("1.7.0");
```

The test-name string on line 156 is a label, not an assertion, but it must move too so the test's own description matches what it asserts.

- [ ] **Step 5: Run the full suite to confirm green**

```bash
npm test
```

Expected: all tests PASS, including all three `plugin packaging` assertions now expecting `"1.7.0"`.

- [ ] **Step 6: Commit**

```bash
git add plugins/autopilot/.claude-plugin/plugin.json \
        .claude-plugin/marketplace.json \
        plugins/autopilot/scripts/autopilot-findings-contract.test.mjs
git commit -m "chore(autopilot): bump version to 1.7.0"
```

---

## Self-review

- **Spec coverage:** Task 1 covers the SKILL.md item 1 (5–8 → 3–5) and item 4 (8 → 5) edits; the unchanged evidence paragraph and Rule 3 are pinned as constraints. Task 2 covers the 1.6.0 → 1.7.0 bump across `plugin.json`, both `marketplace.json` occurrences, and the three contract-test assertions. Verification (`npm test`) is a step in both tasks.
- **Placeholder scan:** No TBD/TODO; every step carries exact old/new strings and the exact run command with expected result.
- **Type consistency:** No cross-task code symbols — the only shared contract is the literal string `1.7.0` and the `3–5` band, which are consistent across both tasks.
