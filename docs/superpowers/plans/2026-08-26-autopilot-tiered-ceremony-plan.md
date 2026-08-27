# Tiered Ceremony For Autopilot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a `/autopilot` run scale its decomposition ceremony to the size of the work — a brainstorm-declared tier caps the plan's task count, and a 1-task plan gets one review instead of two — without ever skipping `spec` or `plan`.

**Architecture:** Three tiers (`small`/`standard`/`large`) with ceilings in config. The brainstorm classifies, the orchestrator ledgers the tier and passes `--tier` to the `plan` dispatch, and `autopilot-dispatch.mjs` swaps the task-count budget fragment for a tier-specific one with the configured ceiling rendered in. Separately, the orchestrator passes `--tasks=<n>` to the `sdd` dispatch, and at exactly 1 task the composed definition carries a fragment collapsing per-task `task_review` into the single whole-branch `final_review`. Absence of either flag composes exactly today's prompt.

**Tech Stack:** Node ESM (no build step), vitest, markdown prompt fragments under `plugins/autopilot/skills/autopilot/references/dispatch/`.

**Spec:** `docs/superpowers/specs/2026-08-26-autopilot-tiered-ceremony-design.md`

## Global Constraints

- **A tier binds decomposition, never which documents exist.** `spec` and `plan` run on every tier without exception. No task may add a path that skips either.
- **Absence resolves toward more ceremony, never less.** No `--tier` composes today's `plan-budget.md` byte for byte; no `--tasks` composes today's `sdd` prompt with two-stage review.
- **Defaulting is never the fallback.** An unrecognised `--tier` value throws at compose time naming the flag and the three accepted values. It does not silently fall back.
- **`plan-budget.md` is retained untouched.** It is what a ledger predating this change composes, and AC5's byte-identity pin depends on it being unchanged. No task edits or deletes it.
- **Tier names, everywhere, are exactly `small`, `standard`, `large`.** Default ceilings are `1`, `3`, `5`.
- **Escalation is one-way, one step, unattended.** `small` → `standard`, `standard` → `large`, `large` never. A tier is never lowered mid-run. Escalation costs a ledger line, never a park.
- **The plugin lives at `plugins/autopilot/`.** All paths below are relative to the repository root.
- **Test command:** `npm test` (vitest). Run a single file with `npx vitest run <path>`.
- **The Write tool is blocked in this worktree.** Create files with Bash heredocs (`cat > path <<'EOF'`).
- **PR #33 is open and touches `autopilot.default.json`, `autopilot-config.mjs`, `autopilot-config.test.mjs`, `autopilot-ledger.mjs` and `skills/autopilot/SKILL.md`.** Expect textual conflict at rebase; neither change depends on the other. If PR #33 has already landed and `nextStage` already filters trailing informational entries out of its park check, extend that filter rather than adding a second one.

---

## File Structure

| File | Change |
|---|---|
| `plugins/autopilot/autopilot.default.json` | new `tiers` block |
| `plugins/autopilot/scripts/autopilot-config.mjs` | `TIERS` export, `tiers` merge, `tiers` validation |
| `plugins/autopilot/scripts/autopilot-config.test.mjs` | AC1–AC3 |
| `plugins/autopilot/scripts/autopilot-dispatch.mjs` | `tierBudget()`, tier-selected plan fragment, task-count-selected sdd fragment, `tier`/`tasks` in `RESERVED`, `values` + `fragmentReader` passed to `fragments()` |
| `plugins/autopilot/scripts/autopilot-dispatch.test.mjs` | AC4–AC8 |
| `plugins/autopilot/scripts/dispatch-fixture.mjs` | `extraValues` and `tiers` knobs |
| `.../references/dispatch/plan-budget-small.md` | **new** |
| `.../references/dispatch/plan-budget-standard.md` | **new** |
| `.../references/dispatch/plan-budget-large.md` | **new** |
| `.../references/dispatch/sdd-review-single.md` | **new** |
| `plugins/autopilot/scripts/autopilot-tier-contract.test.mjs` | **new** — AC9–AC13, AC16 |
| `plugins/autopilot/skills/autopilot-brainstorm/SKILL.md` | classification step; handoff carries the tier |
| `plugins/autopilot/skills/autopilot/SKILL.md` | `tier:` / `tier escalated:` ledger entries; `--tier`; `--tasks` |
| `plugins/autopilot/scripts/autopilot-ledger.mjs` | trailing informational entries must not unpark a run |
| `plugins/autopilot/scripts/autopilot-ledger.test.mjs` | AC14, AC15 |
| `README.md` | the ladder and the `tiers` block |

`plugins/autopilot/skills/autopilot/references/dispatch/plan-budget.md` appears in no row. That is deliberate.

---

## Task 1: The `tiers` config block

**Files:**
- Modify: `plugins/autopilot/autopilot.default.json`
- Modify: `plugins/autopilot/scripts/autopilot-config.mjs`
- Test: `plugins/autopilot/scripts/autopilot-config.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `export const TIERS = ["small", "standard", "large"];` from `autopilot-config.mjs` — **ordered**, lowest ceiling first. Task 2 imports it and derives the escalation target by index, so the order is load-bearing, not cosmetic.
  - A merged config always carrying `config.tiers` as `{ small: number, standard: number, large: number }` with every value a positive integer.

**Acceptance criteria covered:** AC1, AC2, AC3.

- [ ] **Step 1: Write the failing tests**

Append to `plugins/autopilot/scripts/autopilot-config.test.mjs`. Match the file's existing import list — it already imports from `./autopilot-config.mjs`; add `TIERS` to that import if the file's style is a named-import list, otherwise import it alongside.

```javascript
describe("the tiers block", () => {
  it("names the three tiers in ceiling order", () => {
    expect(TIERS).toEqual(["small", "standard", "large"]);
  });

  it("defaults to 1, 3 and 5 when the project supplies no tiers key", () => {
    // AC1
    const merged = mergeConfig(defaults(), {});
    expect(merged.tiers).toEqual({ small: 1, standard: 3, large: 5 });
  });

  it("inherits the default ceiling for every key a partial block omits", () => {
    // AC2 — the shallow top-level merge would otherwise drop small and large.
    const merged = mergeConfig(defaults(), { tiers: { standard: 4 } });
    expect(merged.tiers).toEqual({ small: 1, standard: 4, large: 5 });
  });

  it("rejects a ceiling that is not a positive integer, naming the key", () => {
    // AC3
    for (const bad of [0, -1, 2.5, "3", null]) {
      const { ok, errors } = validateConfig(
        mergeConfig(defaults(), { tiers: { standard: bad } }),
        {},
      );
      expect(ok).toBe(false);
      expect(errors.join("\n")).toMatch(/tiers\.standard/);
    }
  });

  it("rejects a flattened tiers value rather than silently keeping the defaults", () => {
    // "tiers": 3 is the flattening a numeric block invites. Spreading a
    // non-object into the merge would produce an object that validates,
    // losing the developer's intent without a word.
    const { ok, errors } = validateConfig(mergeConfig(defaults(), { tiers: 3 }), {});
    expect(ok).toBe(false);
    expect(errors.join("\n")).toMatch(/^tiers:/m);
  });

  it("rejects an unknown tier name, naming it", () => {
    // A typo'd tier key leaves that tier at its default ceiling, which is
    // indistinguishable from never having configured the feature — the same
    // reasoning the file already applies to minimalism.mode.
    const { ok, errors } = validateConfig(
      mergeConfig(defaults(), { tiers: { medium: 4 } }),
      {},
    );
    expect(ok).toBe(false);
    expect(errors.join("\n")).toMatch(/tiers\.medium/);
  });

  it("keeps loading a config that predates the key entirely", () => {
    const config = defaults();
    delete config.tiers;
    expect(validateConfig(config, {}).ok).toBe(true);
  });
});
```

`defaults()` above is **not** this file's existing `validConfig()` helper. `validConfig()` builds a synthetic config with no `tiers` key at all, so it cannot answer AC1 — "the shipped defaults are 1, 3 and 5" is a claim about `autopilot.default.json` itself, and only reading that file proves it. Add the helper beside `validConfig()` (the file already imports `readFileSync`, `fileURLToPath`, `dirname` and `join`; reuse its existing `HERE` constant if it has one, otherwise define it as shown):

```javascript
const HERE = dirname(fileURLToPath(import.meta.url));

/** The real shipped defaults — the only thing that can answer AC1. */
const defaults = () =>
  JSON.parse(readFileSync(join(HERE, "..", "autopilot.default.json"), "utf8"));
```

Add `TIERS` to the existing named-import list from `./autopilot-config.mjs`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-config.test.mjs`
Expected: FAIL — `TIERS` is not exported, and `merged.tiers` is `undefined`.

- [ ] **Step 3: Add the defaults**

In `plugins/autopilot/autopilot.default.json`, add a `tiers` block after `"minimalism"` and before `"github"`, matching the file's existing two-space indentation:

```json
  "tiers": {
    "small": 1,
    "standard": 3,
    "large": 5
  },
```

- [ ] **Step 4: Export the tier names**

In `plugins/autopilot/scripts/autopilot-config.mjs`, after the `MINIMALISM_MODES` export:

```javascript
/**
 * The ceremony ladder, ordered by ceiling. A tier caps how far `plan` may
 * decompose the work; it never selects which documents get written — `spec`
 * and `plan` run on every tier.
 *
 * The order is load-bearing: escalation is one step up this list, derived by
 * index rather than by a second hand-maintained map.
 */
export const TIERS = ["small", "standard", "large"];
```

- [ ] **Step 5: Merge the block per key**

In `mergeConfig`, after the `minimalism` block:

```javascript
  // Likewise for `tiers`, with one addition: a non-object project value is
  // carried through unmerged so validateConfig can reject it. Spreading a
  // string or a number here would produce an object that validates while the
  // developer's intent is gone.
  if (defaults.tiers || project.tiers) {
    const supplied = project.tiers;
    const isBlock =
      typeof supplied === "object" && supplied !== null && !Array.isArray(supplied);
    merged.tiers = isBlock
      ? { ...defaults.tiers, ...supplied }
      : supplied ?? defaults.tiers;
  }
```

- [ ] **Step 6: Validate the block**

In `validateConfig`, after the `minimalism.mode` check and before the `CLAUDE_CODE_EFFORT_LEVEL` warning:

```javascript
  // Absent is not an error — every config that predates this key must keep
  // loading, and an absent block means an untiered run, which composes the
  // pre-tier budget. A present but malformed one is: a ceiling of 0 would
  // instruct the plan agent to write no tasks at all.
  const tiers = obj.tiers;
  const tiersIsBlock =
    typeof tiers === "object" && tiers !== null && !Array.isArray(tiers);
  if (tiers !== undefined && !tiersIsBlock) {
    errors.push(
      `tiers: must be an object mapping ${TIERS.join(", ")} to positive integers`,
    );
  }
  if (tiersIsBlock) {
    for (const tier of TIERS) {
      const ceiling = tiers[tier];
      if (ceiling !== undefined && (!Number.isInteger(ceiling) || ceiling < 1)) {
        errors.push(`tiers.${tier}: must be a positive integer`);
      }
    }
    for (const key of Object.keys(tiers)) {
      if (!TIERS.includes(key)) {
        errors.push(`tiers.${key}: not one of ${TIERS.join(", ")}`);
      }
    }
  }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-config.test.mjs`
Expected: PASS.

- [ ] **Step 8: Mutation-check the two guards**

Temporarily change `ceiling < 1` to `ceiling < 0` and re-run: the `0` case in "rejects a ceiling that is not a positive integer" must fail. Restore it. Then temporarily delete the unknown-key loop and re-run: "rejects an unknown tier name" must fail. Restore it. Both assertions must have been observed failing before you proceed.

- [ ] **Step 9: Run the whole suite**

Run: `npm test`
Expected: PASS — no other test reads `tiers`, and the new key must not disturb any existing config assertion. If a test asserts the exact shape of the default config, update it to include `tiers`.

- [ ] **Step 10: Commit**

```bash
git add plugins/autopilot/autopilot.default.json \
        plugins/autopilot/scripts/autopilot-config.mjs \
        plugins/autopilot/scripts/autopilot-config.test.mjs
git commit -m "feat(autopilot): add the tiers config block with 1/3/5 ceilings"
```

---

## Task 2: Tier-selected plan budget and single-review sdd fragment

**Files:**
- Modify: `plugins/autopilot/scripts/autopilot-dispatch.mjs`
- Modify: `plugins/autopilot/scripts/dispatch-fixture.mjs`
- Create: `plugins/autopilot/skills/autopilot/references/dispatch/plan-budget-small.md`
- Create: `plugins/autopilot/skills/autopilot/references/dispatch/plan-budget-standard.md`
- Create: `plugins/autopilot/skills/autopilot/references/dispatch/plan-budget-large.md`
- Create: `plugins/autopilot/skills/autopilot/references/dispatch/sdd-review-single.md`
- Test: `plugins/autopilot/scripts/autopilot-dispatch.test.mjs`
- Test (create): `plugins/autopilot/scripts/autopilot-tier-contract.test.mjs`

**Interfaces:**
- Consumes: `TIERS` and `config.tiers` from Task 1.
- Produces:
  - `export function tierBudget({ config, tier, fragmentReader })` from `autopilot-dispatch.mjs` — returns the tier's budget text with its ceiling rendered in; throws on an unknown tier or a missing ceiling.
  - `STAGES.<stage>.fragments` is now called as `fragments({ config, worktreeHas, values, fragmentReader })`. Every stage's `fragments` keeps its current signature by destructuring only what it needs; only `plan` and `sdd` read the new keys.
  - `composeStage(stage, { minimalism, tiers, hasLearnings, extraValues })` from `dispatch-fixture.mjs` — Task 3 uses `extraValues` to compose a tiered plan definition.
  - `plugins/autopilot/scripts/autopilot-tier-contract.test.mjs` exists — Task 3 appends its prose assertions to this file rather than creating a second one.

**Acceptance criteria covered:** AC4, AC5, AC6, AC7, AC8, AC9, AC10, AC11.

**Why `fragmentReader` is passed to `fragments()` as well as `values`:** the spec's §3 names `values` as the addition, and specifies `tierBudget({ config, tier, fragmentReader })` as the helper's signature. The helper reads a fragment file, so the reader has to reach it, and the injected reader is what keeps the unit tests off the filesystem. Passing both is what makes the spec's own helper signature callable from where the spec puts the call.

- [ ] **Step 1: Write the failing unit tests**

In `plugins/autopilot/scripts/autopilot-dispatch.test.mjs`:

First, add `tiers` to the `makeConfig` helper's base object so every existing composition still has ceilings available (find the `return { roles, worktree_dir: ...` line and add the key):

```javascript
  return { roles, worktree_dir: ".claude/worktrees", base_ref: "origin/main",
    reaper: true, findings_threshold: 2,
    tiers: { small: 1, standard: 3, large: 5 }, ...overrides };
```

Add `tierBudget` and `readFragment` to the import list from `./autopilot-dispatch.mjs`, and `render` if it is not already imported (it is). Then append:

```javascript
describe("the plan tier gate", () => {
  const composePlan = (values) =>
    compose({
      stage: "plan",
      config: makeConfig(),
      values: { run: "r", worktree: "/w", spec_path: "s", ...values },
      fragmentReader: fakeFragments({ "plan-body.md": "{{run}}{{worktree}}{{spec_path}}" }),
      worktreeHas: () => false,
    });

  it("selects exactly one tier budget, and only the named one", () => {
    // AC4
    for (const tier of ["small", "standard", "large"]) {
      const out = composePlan({ tier });
      expect(out).toContain(`FRAGMENT(plan-budget-${tier}.md)`);
      for (const other of ["small", "standard", "large"].filter((t) => t !== tier)) {
        expect(out).not.toContain(`FRAGMENT(plan-budget-${other}.md)`);
      }
      expect(out).not.toContain("FRAGMENT(plan-budget.md)");
    }
  });

  it("composes the untiered budget when --tier is absent", () => {
    const out = composePlan({});
    expect(out).toContain("FRAGMENT(plan-budget.md)");
    expect(out).not.toMatch(/plan-budget-(small|standard|large)\.md/);
  });

  it("rejects an unrecognised tier, naming the flag and all three values", () => {
    // AC6 — a silent fallback would let a typo produce a run whose ceremony
    // nobody chose.
    expect(() => composePlan({ tier: "medium" })).toThrow(/--tier/);
    expect(() => composePlan({ tier: "medium" })).toThrow(/small/);
    expect(() => composePlan({ tier: "medium" })).toThrow(/standard/);
    expect(() => composePlan({ tier: "medium" })).toThrow(/large/);
  });

  it("refuses to default a ceiling the merged config does not carry", () => {
    const config = makeConfig();
    delete config.tiers;
    expect(() =>
      compose({
        stage: "plan",
        config,
        values: { run: "r", worktree: "/w", spec_path: "s", tier: "small" },
        fragmentReader: fakeFragments({ "plan-body.md": "{{run}}{{worktree}}{{spec_path}}" }),
        worktreeHas: () => false,
      }),
    ).toThrow(/tiers\.small/);
  });
});

describe("the sdd review-depth gate", () => {
  const composeSdd = (values) =>
    compose({
      stage: "sdd",
      config: makeConfig(),
      values: { run: "r", worktree: "/w", plan_path: "p", ...values },
      fragmentReader: fakeFragments({ "sdd-body.md": "{{run}}{{worktree}}{{plan_path}}" }),
      worktreeHas: () => false,
    });

  it("collapses the two reviews into one at exactly 1 task", () => {
    // AC8
    expect(composeSdd({ tasks: "1" })).toContain("FRAGMENT(sdd-review-single.md)");
  });

  it("keeps two-stage review at 2 tasks and when --tasks is absent", () => {
    // AC8 — absence resolves toward more ceremony, never less.
    expect(composeSdd({ tasks: "2" })).not.toContain("FRAGMENT(sdd-review-single.md)");
    expect(composeSdd({})).not.toContain("FRAGMENT(sdd-review-single.md)");
  });

  it("rejects a --tasks value that is not a positive integer", () => {
    // Not absence: a malformed value is a typo, and the module's rule is that
    // defaulting is never the fallback.
    expect(() => composeSdd({ tasks: "one" })).toThrow(/--tasks/);
    expect(() => composeSdd({ tasks: "0" })).toThrow(/--tasks/);
  });

  it("orders the single-review fragment before the minimalism ladder", () => {
    const out = compose({
      stage: "sdd",
      config: makeConfig({ minimalism: { mode: "lite" } }),
      values: { run: "r", worktree: "/w", plan_path: "p", tasks: "1" },
      fragmentReader: fakeFragments({ "sdd-body.md": "{{run}}{{worktree}}{{plan_path}}" }),
      worktreeHas: () => false,
    });
    expect(out.indexOf("FRAGMENT(sdd-review-single.md)"))
      .toBeLessThan(out.indexOf("FRAGMENT(sdd-minimalism-lite.md)"));
  });
});
```

Then extend the existing reserved-flag test. Find `it("does not treat the reserved --run and --config as unconsumed", ...)` and add a sibling immediately after it:

```javascript
  it("does not treat --tier and --tasks as unconsumed, but still rejects others", () => {
    // AC7 — they select fragments rather than filling placeholders.
    const fragmentReader = fakeFragments({ "pr-body.md": "no placeholders here" });
    const values = { run: "r1", tier: "small", tasks: "1" };
    expect(() => compose({ ...base, stage: "pr", values, fragmentReader })).not.toThrow();
    expect(() =>
      compose({ ...base, stage: "pr", values: { run: "r1", nonsense: "x" }, fragmentReader }),
    ).toThrow(/--nonsense/);
  });
```

- [ ] **Step 2: Write the failing byte-identity test**

Also in `plugins/autopilot/scripts/autopilot-dispatch.test.mjs`, append. This one runs against the real files, so it needs the fixture:

```javascript
import { composeStage, defaultConfig, dummyValues } from "./dispatch-fixture.mjs";

describe("the untiered plan dispatch", () => {
  it("is byte-identical to the pre-tier assembly", () => {
    // AC5. Rebuilds what the pre-tier compose() produced, from the same
    // primitives, rather than restating the new selection logic — so this
    // pins bytes and not the implementation that emits them.
    const config = defaultConfig();
    const values = dummyValues("plan");
    const role = config.roles.plan;
    const expected =
      [
        [
          "---",
          "name: autopilot-plan",
          "description: plan stage of an autopilot run",
          `model: ${role.model}`,
          `effort: ${role.effort}`,
          "---",
        ].join("\n"),
        render(readFragment("plan-body.md"), values),
        readFragment("plan-budget.md"),
        readFragment("plan-learnings.md"),
      ]
        .map((p) => p.replace(/\s+$/, ""))
        .join("\n\n") + "\n";
    expect(composeStage("plan")).toBe(expected);
  });
});
```

If `render` and `readFragment` are not yet in this file's import list from `./autopilot-dispatch.mjs`, add them.

- [ ] **Step 3: Extend the fixture**

In `plugins/autopilot/scripts/dispatch-fixture.mjs`, replace `defaultConfig` and `composeStage`:

```javascript
/**
 * The plugin's shipped defaults, optionally with the `minimalism` or `tiers`
 * block replaced or removed. Passing `null` deletes the key entirely — which
 * is how the byte-identity pin builds a config that predates a key.
 */
export function defaultConfig({ minimalism, tiers } = {}) {
  const config = JSON.parse(readFileSync(DEFAULTS_PATH, "utf8"));
  if (minimalism === null) delete config.minimalism;
  else if (minimalism !== undefined) config.minimalism = minimalism;
  if (tiers === null) delete config.tiers;
  else if (tiers !== undefined) config.tiers = tiers;
  return config;
}

/**
 * The stage's composed definition, exactly as a dispatch would carry it.
 *
 * `hasLearnings` answers the `plan` stage's worktree check; it defaults to
 * true so assertions about the learnings instruction see it. `extraValues`
 * carries the reserved flags that select a fragment rather than filling a
 * placeholder — `tier` and `tasks` — which `dummyValues` cannot derive
 * because they appear in no body template.
 */
export function composeStage(
  stage,
  { minimalism, tiers, hasLearnings = true, extraValues = {} } = {},
) {
  return compose({
    stage,
    config: defaultConfig({ minimalism, tiers }),
    values: { ...dummyValues(stage), ...extraValues },
    worktreeHas: () => hasLearnings,
  });
}
```

- [ ] **Step 4: Write the failing contract tests for the fragments' prose**

```bash
cat > plugins/autopilot/scripts/autopilot-tier-contract.test.mjs <<'EOF'
// The tier ladder reaches its agents entirely as prose: a task-count ceiling
// the `plan` dispatch carries, and a review-depth instruction the `sdd`
// dispatch carries at exactly one task. Nothing else fails if that prose is
// deleted, reworded past recognition, or gated onto the wrong stage — the run
// simply decomposes as it always did, and nobody finds out.
//
// These assertions compose the real definition from the real files, the way
// autopilot-dispatch.mjs does, and read the result.

import { describe, it, expect } from "vitest";
import { compose } from "./autopilot-dispatch.mjs";
import { composeStage, defaultConfig, dummyValues } from "./dispatch-fixture.mjs";

const plan = (tier, opts) => composeStage("plan", { extraValues: { tier }, ...opts });

describe("the plan tier budgets", () => {
  it("states each tier's configured ceiling as a number", () => {
    // AC9
    for (const [tier, ceiling] of Object.entries({ small: 1, standard: 3, large: 5 })) {
      expect(plan(tier)).toContain(`The ceiling for this plan is **${ceiling}**.`);
    }
  });

  it("renders a tuned ceiling rather than a number baked into the text", () => {
    // AC9 — the config knob has to actually reach the prompt.
    const out = compose({
      stage: "plan",
      config: defaultConfig({ tiers: { small: 1, standard: 4, large: 5 } }),
      values: { ...dummyValues("plan"), tier: "standard" },
      worktreeHas: () => true,
    });
    expect(out).toContain("The ceiling for this plan is **4**.");
    expect(out).not.toContain("The ceiling for this plan is **3**.");
    // The escalation target's ceiling is rendered from config too.
    expect(out).toContain("more than 5 tasks");
  });

  it("leaves no placeholder unrendered in any tier's budget", () => {
    // render() leaves an unfilled placeholder in place, so a stray marker
    // would ship to the agent literally.
    for (const tier of ["small", "standard", "large"]) {
      expect(plan(tier)).not.toContain("{{");
    }
  });

  it("gives small and standard the one-step escalation rule, naming the target tier", () => {
    // AC10
    expect(plan("small")).toMatch(/escalat/i);
    expect(plan("small")).toContain("tier `standard`");
    expect(plan("small")).toContain("escalated to standard: <reason>");
    expect(plan("small")).toContain("## Escalation");
    expect(plan("small")).toMatch(/at most once|never moves more than one step/i);

    expect(plan("standard")).toMatch(/escalat/i);
    expect(plan("standard")).toContain("tier `large`");
    expect(plan("standard")).toContain("escalated to large: <reason>");
    expect(plan("standard")).toContain("## Escalation");
    expect(plan("standard")).toMatch(/at most once|never moves more than one step/i);
  });

  it("gives large no escalation rule at all", () => {
    // AC10 — large has nowhere to escalate to, and a rule naming a tier that
    // does not exist is worse than no rule.
    const large = plan("large");
    expect(large).not.toMatch(/escalat/i);
    expect(large).toContain("This is a budget, not a cap.");
  });

  it("keeps correctness above the ceiling in every tier", () => {
    for (const tier of ["small", "standard", "large"]) {
      expect(plan(tier)).toMatch(/cannot be reviewed as one diff is two tasks/);
    }
  });
});

describe("the sdd single-review contract", () => {
  const single = composeStage("sdd", { extraValues: { tasks: "1" } });

  it("names final_review as the review that runs", () => {
    // AC11
    expect(single).toContain("`final_review`");
    expect(single).toMatch(/one review, not two/i);
  });

  it("names task_review as the dispatch that is skipped", () => {
    // AC11
    expect(single).toMatch(/[Ss]kip the per-task `task_review` dispatch/);
  });

  it("keeps the fix-round machinery explicitly unchanged", () => {
    // The saving is one review dispatch, not the loop that acts on findings.
    expect(single).toContain("`re_review`");
    expect(single).toContain("`fix_escalation`");
    // sdd-body.md also says "round-5 breaker", so match the phrasing that is
    // unique to this fragment — otherwise deleting the fragment leaves this
    // assertion green.
    expect(single).toContain("the round-5 breaker still applies");
  });

  it("is absent from a two-task dispatch", () => {
    expect(composeStage("sdd", { extraValues: { tasks: "2" } }))
      .not.toMatch(/one review, not two/i);
  });
});
EOF
```

- [ ] **Step 5: Run the tests to verify they fail**
Run: `npx vitest run plugins/autopilot/scripts/autopilot-dispatch.test.mjs plugins/autopilot/scripts/autopilot-tier-contract.test.mjs`
Expected: FAIL — `tierBudget` is not exported, the tier and tasks gates do not exist, `--tier` trips the unconsumed-flag error, and none of the four new fragment files exist yet.

Read the failure output. Every new test must be failing, and each for the reason above rather than an import error or a typo. A test that passes here is pinning nothing.

- [ ] **Step 6: Write the three plan budget fragments**

`plan-budget-small.md`, `plan-budget-standard.md` and `plan-budget-large.md` carry `{{ceiling}}` and (for the two that escalate) `{{next_tier}}` and `{{next_ceiling}}`. These are rendered by `tierBudget`, not by `compose` — a string fragment is read verbatim and never rendered, which is why the budget travels as inline text.

```bash
# run from the repository root
cat > plugins/autopilot/skills/autopilot/references/dispatch/plan-budget-small.md <<'EOF'
Task-count budget for this plan — tier `small`.

The ceiling for this plan is **{{ceiling}}**. Write no more tasks than that.

1. **Prefer one reviewable diff.** The brainstorm classified this work as
   `small`: confined to one module, satisfying one acceptance criterion.
   Every task costs a serial implementer dispatch plus a review round, so
   task count multiplies the run's wall clock directly.
2. **Merge trivially-coupled steps into one task.** Two steps belong together
   when one cannot be reviewed or tested without the other — a function and
   its only caller, a field and the migration that adds it. Splitting those
   buys no reviewability and costs a full dispatch cycle.
3. **Escalate once, and only if the work genuinely cannot be one reviewable
   diff.** Escalation moves this plan to tier `{{next_tier}}`, whose ceiling
   is **{{next_ceiling}}**. Write the tasks the work needs up to that number
   and no further. Escalation happens at most once in a run and never moves
   more than one step: a plan that believes this work needs more than
   {{next_ceiling}} tasks writes {{next_ceiling}} and says so.
4. **Report an escalation in two places.** Open the plan with an
   `## Escalation` heading naming the reason, and say
   `escalated to {{next_tier}}: <reason>` in your return line. The
   orchestrator records it in the ledger. A misclassification is a
   measurement, not a failure — it costs a ledger line and nothing else.
5. **Correctness outranks the budget in both directions.** A task that cannot
   be reviewed as one diff is two tasks; a task invented only to fill the
   ceiling is not a task.
EOF

cat > plugins/autopilot/skills/autopilot/references/dispatch/plan-budget-standard.md <<'EOF'
Task-count budget for this plan — tier `standard`.

The ceiling for this plan is **{{ceiling}}**. Write no more tasks than that.

1. **Scale task count to complexity.** The brainstorm classified this work as
   `standard`: more than one reviewable diff, but not work that spans separate
   subsystems. Every task costs a serial implementer dispatch plus a review
   round, so task count multiplies the run's wall clock directly.
2. **Merge trivially-coupled steps into one task.** Two steps belong together
   when one cannot be reviewed or tested without the other — a function and
   its only caller, a field and the migration that adds it. Splitting those
   buys no reviewability and costs a full dispatch cycle.
3. **Escalate once, and only if the work genuinely spans separate
   subsystems.** Escalation moves this plan to tier `{{next_tier}}`, whose
   ceiling is **{{next_ceiling}}**. Write the tasks the work needs up to that
   number and no further. Escalation happens at most once in a run and never
   moves more than one step: a plan that believes this work needs more than
   {{next_ceiling}} tasks writes {{next_ceiling}} and says so.
4. **Report an escalation in two places.** Open the plan with an
   `## Escalation` heading naming the reason, and say
   `escalated to {{next_tier}}: <reason>` in your return line. The
   orchestrator records it in the ledger. A misclassification is a
   measurement, not a failure — it costs a ledger line and nothing else.
5. **Correctness outranks the budget in both directions.** A task that cannot
   be reviewed as one diff is two tasks; a task invented only to fill the
   ceiling is not a task.
EOF

cat > plugins/autopilot/skills/autopilot/references/dispatch/plan-budget-large.md <<'EOF'
Task-count budget for this plan — tier `large`.

The ceiling for this plan is **{{ceiling}}**.

1. **Scale task count to complexity — 1 to {{ceiling}} tasks.** A change
   confined to one module, satisfying one acceptance criterion, is ONE task —
   not three. {{ceiling}} is for work that genuinely spans separate
   subsystems. Every task costs a serial implementer dispatch plus a review
   round, so task count multiplies the run's wall clock directly.
2. **Merge trivially-coupled steps into one task.** Two steps belong together
   when one cannot be reviewed or tested without the other — a function and
   its only caller, a field and the migration that adds it. Splitting those
   buys no reviewability and costs a full dispatch cycle.
3. **Do not merge steps that touch unrelated subsystems, and do not pad or
   compress to hit a number.** A task that cannot be reviewed as one diff is
   two tasks; a task invented only to fill the range is not a task.
   Correctness outranks the budget in both directions.
4. **If the work genuinely needs more than {{ceiling}} tasks, write them** and
   say why in the plan. This is a budget, not a cap.
EOF
```

Two constraints on this text, both asserted by the contract tests you wrote in Step 4:

- `plan-budget-large.md` must contain no form of the word "escalate" or "escalation". `large` has nowhere to escalate to, and a rule naming a tier that does not exist is worse than no rule.
- All three open with the identical line `The ceiling for this plan is **{{ceiling}}**.` — that line is what AC9 reads.

- [ ] **Step 7: Write the single-review sdd fragment**

```bash
# run from the repository root
cat > plugins/autopilot/skills/autopilot/references/dispatch/sdd-review-single.md <<'EOF'
Review depth for this run: **one review, not two.**

This plan has exactly one task, so the per-task reviewer and the whole-branch
reviewer would read the same diff. Running both spends a second full review
dispatch re-reading content that was already reviewed, and finds nothing the
first one could not.

1. **Run one review for the run, in the `final_review` role.** It runs once,
   after the single task's implementer reports done, over the whole branch.
2. **Skip the per-task `task_review` dispatch entirely.** Do not substitute a
   cheaper reviewer for it, and do not run it "quickly" first — the whole
   point is that the two reviews would read the same diff.
3. **Everything downstream of the review is unchanged.** A finding returns the
   task to its implementer exactly as a `task_review` finding would, the
   `re_review` and `fix_escalation` roles apply as normal, and the round-5
   breaker still applies. A load-bearing finding that survives it is still
   BLOCKED.
4. **Capture findings exactly as the findings contract above states.** The
   single review produces the same one-line-per-finding record, and a task
   that passes it still writes its explicit `{"task": 1, "clean": true}` line.
EOF
```

- [ ] **Step 8: Wire the fragments into `autopilot-dispatch.mjs`**

Five edits.

(a) Import `TIERS` — extend the existing import:

```javascript
import { TIERS, loadConfig } from "./autopilot-config.mjs";
```

(b) Add the helper, immediately after `roleTable` (it uses `render`, which is defined below it — that is fine, function declarations hoist, and `roleTable` sits beside it for the same reason: both are inline-text builders):

```javascript
/** The tier one step up the ladder, or undefined for the top tier. */
const nextTier = (tier) => TIERS[TIERS.indexOf(tier) + 1];

/**
 * The tier's task-count budget, with the configured ceiling rendered in.
 *
 * This is inline text rather than a plain fragment name because `compose`
 * reads a string fragment verbatim and never renders it — a `{{ceiling}}`
 * written into a file selected by name would ship to the agent literally.
 */
export function tierBudget({ config, tier, fragmentReader }) {
  if (!TIERS.includes(tier)) {
    throw new Error(
      `--tier=${tier} is not one of ${TIERS.join(", ")} — ` +
        `a silent fallback would produce a run whose ceremony nobody chose`,
    );
  }
  const ceilingFor = (name) => {
    const ceiling = config?.tiers?.[name];
    if (!Number.isInteger(ceiling) || ceiling < 1) {
      throw new Error(
        `tiers.${name}: missing from the merged config — a tier budget cannot default its ceiling`,
      );
    }
    return String(ceiling);
  };

  const values = { ceiling: ceilingFor(tier) };
  const next = nextTier(tier);
  if (next) {
    values.next_tier = next;
    values.next_ceiling = ceilingFor(next);
  }
  return render(fragmentReader(`plan-budget-${tier}.md`), values);
}

/**
 * True when the plan wrote exactly one task. A malformed count throws rather
 * than resolving to "not one": absence is the documented untiered path, but a
 * typo is not absence.
 */
function isSingleTask(tasks) {
  if (tasks === undefined) return false;
  if (!/^\d+$/.test(tasks) || Number(tasks) < 1) {
    throw new Error(`--tasks=${tasks} is not a positive integer`);
  }
  return Number(tasks) === 1;
}
```

(c) `STAGES.plan.fragments` and `STAGES.sdd.fragments`:

```javascript
  plan: {
    role: "plan",
    body: "plan-body.md",
    fragments: ({ config, worktreeHas, values, fragmentReader }) => [
      values?.tier === undefined
        ? "plan-budget.md"
        : { text: tierBudget({ config, tier: values.tier, fragmentReader }) },
      ...(laddered(config) ? ["plan-minimalism-lite.md"] : []),
      ...(fullLadder(config) ? ["plan-minimalism-full.md"] : []),
      ...(worktreeHas("docs/autopilot/learnings.md") ? ["plan-learnings.md"] : []),
    ],
  },
  sdd: {
    role: "implement",
    body: "sdd-body.md",
    fragments: ({ config, values }) => [
      "sdd-model-map.md",
      { text: roleTable(config) },
      "sdd-verification.md",
      "sdd-findings.md",
      ...(isSingleTask(values?.tasks) ? ["sdd-review-single.md"] : []),
      ...(laddered(config) ? ["sdd-minimalism-lite.md"] : []),
      ...(fullLadder(config) ? ["sdd-minimalism-full.md"] : []),
    ],
  },
```

(d) `RESERVED`:

```javascript
/** Flags that never fill a placeholder. */
const RESERVED = new Set(["run", "config", "worktree", "tier", "tasks"]);
```

The optional chaining is not decoration. `autopilot-dispatch-contract.test.mjs:78` and `skill-sections.test.mjs:242` both call `STAGES[stage].fragments({ config, worktreeHas })` directly, with no `values` at all. Without `?.` those two callers throw a TypeError; with it they get the untiered fragment list, which is the correct answer for a caller that passed no tier.

(e) The call site in `compose` — the one line that passes the new keys through:

```javascript
  for (const fragment of entry.fragments({ config, worktreeHas, values, fragmentReader })) {
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-dispatch.test.mjs plugins/autopilot/scripts/autopilot-tier-contract.test.mjs`
Expected: PASS.

- [ ] **Step 10: Mutation-check the byte-identity pin and the review gate**

Temporarily change `values.tier === undefined ? "plan-budget.md" : ...` to always return `{ text: tierBudget({ config, tier: values.tier ?? "large", fragmentReader }) }` and re-run: "is byte-identical to the pre-tier assembly" must fail. Restore it.

Then temporarily change `isSingleTask(values.tasks)` to `true` and re-run: "is absent from a two-task dispatch" and "keeps two-stage review at 2 tasks and when --tasks is absent" must fail. Restore it.

Both must have been observed failing before you proceed.

- [ ] **Step 11: Confirm `plan-budget.md` is untouched**

Run: `git status --porcelain plugins/autopilot/skills/autopilot/references/dispatch/plan-budget.md`
Expected: empty output. It is the no-tier fallback and AC5's pin depends on it being unchanged. Quote the command's actual output in your report.

- [ ] **Step 12: Run the whole suite**

Run: `npm test`
Expected: PASS. `autopilot-dispatch-contract.test.mjs` composes every stage through the fixture; if it asserts on the exact fragment list for `plan` or `sdd`, reconcile it with the new conditional entries rather than weakening it.

- [ ] **Step 13: Commit**

```bash
git add plugins/autopilot/scripts/autopilot-dispatch.mjs \
        plugins/autopilot/scripts/dispatch-fixture.mjs \
        plugins/autopilot/scripts/autopilot-dispatch.test.mjs \
        plugins/autopilot/scripts/autopilot-tier-contract.test.mjs \
        plugins/autopilot/skills/autopilot/references/dispatch/plan-budget-small.md \
        plugins/autopilot/skills/autopilot/references/dispatch/plan-budget-standard.md \
        plugins/autopilot/skills/autopilot/references/dispatch/plan-budget-large.md \
        plugins/autopilot/skills/autopilot/references/dispatch/sdd-review-single.md
git commit -m "feat(autopilot): select the plan budget by tier and collapse review at one task"
```

---

## Task 3: Classification, ledger entries, dispatch flags and docs

**Files:**
- Modify: `plugins/autopilot/skills/autopilot-brainstorm/SKILL.md`
- Modify: `plugins/autopilot/skills/autopilot/SKILL.md`
- Modify: `plugins/autopilot/scripts/autopilot-ledger.mjs`
- Modify: `README.md`
- Test: `plugins/autopilot/scripts/autopilot-ledger.test.mjs`
- Test: `plugins/autopilot/scripts/autopilot-tier-contract.test.mjs` (created in Task 2 — append, do not recreate)

**Interfaces:**
- Consumes: the `--tier` and `--tasks` flags from Task 2, and the tier names and ceilings from Task 1. The exact flag spellings SKILL.md must write are `--tier=<small|standard|large>` and `--tasks=<n>`; the exact tier names the brainstorm must state are `small`, `standard`, `large`.
- Produces: nothing later tasks consume. This task is what makes Tasks 1 and 2 reachable from a real run — without it, `--tier` and `--tasks` are dead flags nobody passes.

**Acceptance criteria covered:** AC12, AC13, AC14, AC15, AC16.

**The seam this task closes:** Tasks 1 and 2 add machinery with no caller. Every value that crosses into it comes from prose here — the brainstorm's `tier: <name>` handoff line, the ledger entry the orchestrator writes, the flag it passes. Prose drift on any of them silently returns the run to untiered behaviour, which is why AC12, AC13 and AC16 are pinned by tests rather than left to review.

- [ ] **Step 1: Write the failing ledger tests**

Append to `plugins/autopilot/scripts/autopilot-ledger.test.mjs`, reusing whatever ledger-building helper the file already has; if it has none, build strings inline as shown:

```javascript
describe("tier entries in the ledger", () => {
  const HEADER = "# autopilot run — task: add a CSV export button";
  const build = (...texts) =>
    [HEADER, ...texts.map((t, i) => `2026-08-26T14:${String(i).padStart(2, "0")}:00Z  ${t}`)]
      .join("\n");

  it("parses tier entries like any other entry", () => {
    // AC14
    const ledger = parseLedger(
      build("started (phase 1)", "design approved", "tier: small"),
    );
    expect(ledger.entries.map((e) => e.text)).toContain("tier: small");
  });

  it("resolves the same stage with and without the tier entries", () => {
    // AC14 — a tier entry records what happened; it must not move the run.
    const withTier = build(
      "started (phase 1)",
      "design approved",
      "tier: small",
      "worktree: .claude/worktrees/x (branch x)",
      "spec committed → docs/superpowers/specs/x-design.md",
      "tier escalated: small → standard — the config block and the dispatch wiring cannot be reviewed as one diff",
      "plan complete → docs/superpowers/plans/x.md (2 tasks)",
    );
    const without = build(
      "started (phase 1)",
      "design approved",
      "worktree: .claude/worktrees/x (branch x)",
      "spec committed → docs/superpowers/specs/x-design.md",
      "plan complete → docs/superpowers/plans/x.md (2 tasks)",
    );
    expect(nextStage(parseLedger(withTier))).toBe(nextStage(parseLedger(without)));
    expect(nextStage(parseLedger(withTier))).toBe("sdd");
  });

  it("leaves a parked run parked when a tier entry lands after the PARKED line", () => {
    // AC15. nextStage detects a park by reading the LAST entry, so any entry
    // appended after a park would unpark the run. PR #33 hit exactly this
    // with its `session:` entries.
    for (const trailing of ["tier: small", "tier escalated: small → standard — reason"]) {
      const ledger = build(
        "started (phase 1)",
        "design approved",
        "PARKED (spec): the acceptance criteria contradict the design",
        trailing,
      );
      expect(nextStage(parseLedger(ledger))).toBe("parked");
    }
  });

  it("still parks on a bare PARKED line with nothing after it", () => {
    const ledger = build("started (phase 1)", "PARKED (setup): no origin remote");
    expect(nextStage(parseLedger(ledger))).toBe("parked");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-ledger.test.mjs`
Expected: FAIL on "leaves a parked run parked when a tier entry lands after the PARKED line" — it returns `"setup"` instead of `"parked"`, because the last entry is the tier line. The other three should already pass; that is expected, and Step 4 mutation-checks the one that matters.

- [ ] **Step 3: Make a trailing tier entry non-load-bearing**

In `plugins/autopilot/scripts/autopilot-ledger.mjs`, above `nextStage`:

```javascript
/**
 * Entries that record something about the run without advancing it.
 *
 * `nextStage` detects a park by reading the LAST entry, so an informational
 * line appended after a `PARKED` line would unpark the run — a parked branch
 * would silently resume into the stage that parked it. Anything appended
 * purely for the record belongs here.
 */
const INFORMATIONAL = /^tier(:| escalated:)/;
```

and replace the park check inside `nextStage`:

```javascript
  // Check if the last stage-advancing entry is a PARKED line (currently
  // parked, not historical). Informational entries are skipped: they may
  // legitimately land after a park.
  const advancing = ledger.entries.filter((e) => !INFORMATIONAL.test(e.text));
  if (advancing.length > 0) {
    const lastEntry = advancing[advancing.length - 1];
    if (lastEntry.text.startsWith("PARKED")) return "parked";
  }
```

If PR #33 has already landed and this filter exists for `session:` entries, add the `tier` alternation to its pattern instead of introducing a second filter.

- [ ] **Step 4: Run the tests to verify they pass, then mutation-check**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-ledger.test.mjs`
Expected: PASS.

Then temporarily delete the `.filter(...)` line (reverting to `ledger.entries`) and re-run: the AC15 test must fail. Restore it. Then temporarily change `INFORMATIONAL` to match everything (`/^/`) and re-run: "still parks on a bare PARKED line" must fail. Restore it.

- [ ] **Step 5: Add the classification step to the brainstorm skill**

In `plugins/autopilot/skills/autopilot-brainstorm/SKILL.md`:

(a) In the `## Checklist`, insert a new item 5 and renumber the current item 5 to 6:

```markdown
5. **Classify the ceremony tier** — state it out loud in the same message as the approaches, so the developer's pick and any override arrive together. See the Ceremony Tier section below.
6. **State the design and hand back** — in one message: the design as settled by their answers, then `tier: <name>`, then control returned to the autopilot orchestrator. No approval gate. Nothing is written to disk and nothing is committed; the design lives in conversation only.
```

(b) In the `## Process Flow` dot graph, add the node and rewire the two edges that currently connect "Propose 2-3 approaches" to the terminal state:

```dot
    "Classify the ceremony tier" [shape=box];

    "Propose 2-3 approaches" -> "Classify the ceremony tier" [label="developer picks"];
    "Classify the ceremony tier" -> "State design + hand back to autopilot";
```

Delete the old `"Propose 2-3 approaches" -> "State design + hand back to autopilot" [label="developer picks"];` edge so the graph has one path.

(c) Add a new section immediately before `## After the Design`:

```markdown
## Ceremony Tier

Autopilot scales one thing to the size of the work: how far the `plan` stage
may decompose it, and — at a single task — whether the run needs two reviews or
one. It does not scale which documents get written. `spec` and `plan` run on
every tier without exception, because the measured defects in this repository
are overwhelmingly in exactly those documents.

Classify the settled design into one of three tiers:

| Tier | The work is | Plan ceiling |
|---|---|---|
| `small` | confined to one module, satisfying one acceptance criterion | 1 task |
| `standard` | more than one reviewable diff, but not spanning separate subsystems | 3 tasks |
| `large` | genuinely spanning separate subsystems | 5 tasks |

Ceilings are the shipped defaults; a project may tune them in
`.claude/autopilot.json`. Classify by the shape of the work, not by the number.

**State the tier in the same message as the approaches**, in one line — for
example, "I'd classify this `small`: it's one function and its caller."
Stating it there is what gives the developer a place to override it, since they
are replying to that message anyway.

**This is not a gate.** Do not ask whether the tier is right, do not wait for
confirmation, and do not re-state it as a question later. If they say nothing
about it, the tier stands.

**Classify once.** If a later answer genuinely changes the shape of the work,
restate the tier in the design statement — but never as a second question.

A misclassification is cheap and recoverable: the `plan` stage may escalate one
step on its own (`small` → `standard`, `standard` → `large`) and says so in the
ledger. Prefer the smaller tier when the two are close.
```

(d) In `## After the Design`, extend the first bullet so the handoff carries the tier:

```markdown
- The developer's answers to the clarifying questions are the last decisions.
  Hand back in the same message that states the design — do NOT ask for
  approval, do NOT summarize it back for confirmation, and do NOT ask "shall I
  start?" or any other proceed-check. Phase 2 begins the instant the brainstorm
  returns, and running `/autopilot` was the developer's authorization for that.
- **End the handoff with the tier on its own line: `tier: small`, `tier:
  standard`, or `tier: large`.** The orchestrator reads that line, records it
  in the ledger, and passes it to the `plan` stage. Omitting it is not an
  error — the run falls back to the untiered budget — but it discards the
  classification you just made.
```

- [ ] **Step 6: Add the ledger entries and dispatch flags to the orchestrator skill**

In `plugins/autopilot/skills/autopilot/SKILL.md`:

(a) In `## Phase 1 — brainstorm`, after the paragraph beginning "Append `started (phase 1)` at invocation and `design approved` when the brainstorm hands the design back.", insert:

```markdown
The brainstorm's handoff ends with `tier: <small|standard|large>`. Append that
line to the ledger verbatim, immediately after `design approved`:

```
2026-08-26T14:03:00Z  design approved
2026-08-26T14:03:01Z  tier: small
```

The tier caps how far `plan` may decompose the work. It never decides which
documents get written — `spec` and `plan` run on every tier. If the handoff
carries no tier, append nothing and omit `--tier` at the `plan` dispatch: the
run gets the untiered budget, which is more ceremony rather than less.
```

(b) In `### plan`, add the flag to the dispatch block:

```bash
node "$AP/scripts/autopilot-dispatch.mjs" plan \
  --run=<run> \
  --config=.claude/autopilot.json \
  --worktree=<worktree path> \
  --spec-path=<path-to-spec> \
  --tier=<tier>
```

and, immediately after "Dispatch by the printed path.", insert:

```markdown
`--tier` is the `tier:` entry's value, read from the ledger you re-read before
dispatching. **Omit the flag entirely when the ledger has no `tier:` entry** —
a resumed run whose ledger predates tiering, or a brainstorm that returned no
tier. Do not guess one. An unrecognised value is a compose-time error naming
the three accepted values, because a typo would otherwise produce a run whose
ceremony nobody chose.
```

(c) In `### plan`, replace the "Append: `plan complete → <path> (<n> tasks)`." line with:

```markdown
If the plan agent's return line reports an escalation, append the escalation
first, then the completion — so `plan complete` stays the last entry and the
resume path is unambiguous:

```
tier escalated: small → standard — the config block and the dispatch wiring cannot be reviewed as one diff
plan complete → docs/superpowers/plans/2026-08-26-x-plan.md (2 tasks)
```

Escalation is the plan stage's own one-step move and needs no answer from you:
it is never a park and never a question. A tier is never lowered, and never
escalates twice in a run.

Append: `plan complete → <path> (<n> tasks)`.
```

(d) In `### sdd`, add the flag to the dispatch block:

```bash
node "$AP/scripts/autopilot-dispatch.mjs" sdd \
  --run=<run> \
  --config=.claude/autopilot.json \
  --worktree=<worktree path> \
  --plan-path=<path-to-plan> \
  --tasks=<n>
```

and add this paragraph after the existing "SDD reporting BLOCKED is not answered from config. It parks." line:

```markdown
`--tasks` is `<n>` from the `plan complete → <path> (<n> tasks)` ledger entry —
the count the plan actually wrote, not the tier the brainstorm declared. At
exactly 1 the composed definition instructs SDD to run one whole-branch
`final_review` and skip the per-task `task_review` dispatch, because at one
task the two reviewers read the same diff. At 2 or more, and when the flag is
omitted, the dispatch is today's two-stage review. An escalated run therefore
needs no extra plumbing: it has 2 or more tasks and gets both reviews.
```

- [ ] **Step 7: Document the ladder in the README**

In `README.md`, insert a new `#### Ceremony tiers` subsection inside `## Plugins` → `### autopilot`, immediately after the `#### Configuration` subsection and before `#### Turning browser verification on`:

```markdown
#### Ceremony tiers

Phase 1 classifies the work into one of three tiers, and states it in the same
message as the approaches so you can override it there. A tier binds one
thing: **how far the `plan` stage may decompose the work**, and — at a single
task — whether the run needs two reviews or one.

| Tier | The work is | Plan ceiling | Escalates to |
|---|---|---|---|
| `small` | confined to one module, satisfying one acceptance criterion | 1 task | `standard`, once |
| `standard` | more than one reviewable diff, not spanning separate subsystems | 3 tasks | `large`, once |
| `large` | genuinely spanning separate subsystems | 5 tasks | — |

**A tier never decides which documents get written.** `spec` and `plan` run on
every tier without exception. Across this repository's findings corpus, 36 of
39 review findings — and every major one — were defects in the spec or the
plan, caught in prose before they became code. The document that catches them
is not the ceremony worth cutting; decomposition is.

A plan that finds its tier too tight escalates one step on its own, opens with
an `## Escalation` heading naming the reason, and the run records
`tier escalated: small → standard — <reason>` in its ledger. It never parks and
never asks. Each escalation entry is a labelled classifier miss, so the ledgers
say over time whether Phase 1 is judging complexity well.

Ceilings are tunable, merged per key like `roles`:

```json
{
  "tiers": {
    "small": 1,
    "standard": 3,
    "large": 5
  }
}
```

A project that widens `standard` to 4 gets a plan prompt that says 4. Omitting
the block entirely, or resuming a run whose ledger predates tiering, composes
the untiered budget of 1–5 tasks with two-stage review — absence resolves
toward more ceremony, never less.
```

- [ ] **Step 8: Write the failing prose contract tests**

Append to `plugins/autopilot/scripts/autopilot-tier-contract.test.mjs` (created in Task 2). Add the imports it now needs at the top of that file:

```javascript
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BRAINSTORM_PATH = join(HERE, "..", "skills", "autopilot-brainstorm", "SKILL.md");
const ORCHESTRATOR_PATH = join(HERE, "..", "skills", "autopilot", "SKILL.md");
const README_PATH = join(HERE, "..", "..", "..", "README.md");
```

and append:

```javascript
describe("the brainstorm's classification step", () => {
  const brainstorm = readFileSync(BRAINSTORM_PATH, "utf8");

  it("names all three tiers", () => {
    // AC12
    for (const tier of ["small", "standard", "large"]) {
      expect(brainstorm).toContain(`\`${tier}\``);
    }
  });

  it("makes classification a checklist step, not an aside", () => {
    // AC12 — the checklist is what the skill says MUST be done in order.
    expect(brainstorm).toMatch(/\*\*Classify the ceremony tier\*\*/);
  });

  it("carries the tier in the handoff, in the form the orchestrator reads", () => {
    expect(brainstorm).toContain("tier: small");
  });

  it("keeps the classification from becoming an approval gate", () => {
    // The whole fork exists to have no gate after the questions.
    expect(brainstorm).toMatch(/This is not a gate/);
  });

  it("still forbids writing a spec file", () => {
    // Guards against the classification section being read as a licence to
    // start producing artifacts during Phase 1.
    expect(brainstorm).toMatch(/Do NOT write it to a file/);
  });
});

describe("the orchestrator's tier handling", () => {
  const skill = readFileSync(ORCHESTRATOR_PATH, "utf8");

  it("appends the tier entry immediately after design approved", () => {
    // AC13
    expect(skill).toMatch(/immediately after `design approved`/);
    expect(skill).toContain("tier: <small|standard|large>");
  });

  it("appends a tier escalated entry when the plan reports one", () => {
    // AC13
    expect(skill).toContain("tier escalated: small → standard");
  });

  it("passes the tier to the plan dispatch and the task count to sdd", () => {
    expect(skill).toContain("--tier=<tier>");
    expect(skill).toContain("--tasks=<n>");
  });

  it("omits --tier rather than guessing when the ledger carries no tier", () => {
    // Absence resolves toward more ceremony, never less.
    expect(skill).toMatch(/Omit the flag entirely when the ledger has no `tier:` entry/);
  });

  it("keys review depth to the count the plan wrote, not the declared tier", () => {
    expect(skill).toMatch(/not the tier the brainstorm declared/);
  });
});

describe("the README's tier documentation", () => {
  const readme = readFileSync(README_PATH, "utf8");

  it("documents the three tiers and their ceilings", () => {
    // AC16
    for (const [tier, ceiling] of Object.entries({ small: 1, standard: 3, large: 5 })) {
      expect(readme).toMatch(new RegExp(`\`${tier}\`.*\\| ${ceiling} tasks? \\|`));
    }
  });

  it("states that spec and plan run on every tier", () => {
    // AC16 — the one thing a reader must not conclude is that a small tier
    // skips documents.
    expect(readme).toMatch(/`spec` and `plan` run on\nevery tier/);
  });

  it("documents the tiers config block", () => {
    expect(readme).toContain('"tiers": {');
    expect(readme).toContain('"standard": 3');
  });
});
```

The `spec` and `plan` assertion matches across the line break exactly as written in Step 7. If you rewrap that sentence, update the regex to match your wrapping — do not weaken it to a substring that would pass on prose saying the opposite.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-tier-contract.test.mjs plugins/autopilot/scripts/autopilot-ledger.test.mjs`
Expected: PASS.

- [ ] **Step 10: Sweep for prose that still describes the untiered world**

Run:

```bash
grep -rn "1 to 5 tasks\|1–5\|task-count budget\|plan-budget" \
  README.md plugins/autopilot/skills plugins/autopilot/scripts --include=*.md --include=*.mjs
```

Every hit must be either (a) inside `plan-budget.md` or `plan-budget-large.md`, where it is correct, (b) the README's sentence about the untiered fallback, or (c) reconciled with the tier ladder. The `### plan` section of the orchestrator SKILL.md currently says "the composed definition carries a task-count budget" — extend that sentence to say the budget is the tier's when a tier is present. Report each hit and its disposition.

- [ ] **Step 11: Run the whole suite**

Run: `npm test`
Expected: PASS. `autopilot-ledger-coupling.test.mjs` and `autopilot-no-design-gate.test.mjs` both read these two SKILL.md files; if either fails, the prose above collided with an existing pin — reconcile rather than loosen.

- [ ] **Step 12: Commit**

```bash
git add plugins/autopilot/skills/autopilot-brainstorm/SKILL.md \
        plugins/autopilot/skills/autopilot/SKILL.md \
        plugins/autopilot/scripts/autopilot-ledger.mjs \
        plugins/autopilot/scripts/autopilot-ledger.test.mjs \
        plugins/autopilot/scripts/autopilot-tier-contract.test.mjs \
        README.md
git commit -m "feat(autopilot): classify a run's tier in Phase 1 and carry it to plan and sdd"
```

---

## Acceptance criteria coverage

| AC | Task | Where |
|---|---|---|
| AC1 defaults 1/3/5 | 1 | `autopilot-config.test.mjs` — "defaults to 1, 3 and 5" |
| AC2 partial block inherits | 1 | `autopilot-config.test.mjs` — "inherits the default ceiling" |
| AC3 non-positive-integer ceiling errors, naming the key | 1 | `autopilot-config.test.mjs` — "rejects a ceiling that is not a positive integer" |
| AC4 `--tier` selects exactly one budget | 2 | `autopilot-dispatch.test.mjs` — "selects exactly one tier budget" |
| AC5 no `--tier` is byte-identical | 2 | `autopilot-dispatch.test.mjs` — "is byte-identical to the pre-tier assembly" |
| AC6 `--tier=medium` throws, naming the three | 2 | `autopilot-dispatch.test.mjs` — "rejects an unrecognised tier" |
| AC7 `--tier`/`--tasks` reserved, others still rejected | 2 | `autopilot-dispatch.test.mjs` — "does not treat --tier and --tasks as unconsumed" |
| AC8 `--tasks=1` gates the single-review fragment | 2 | `autopilot-dispatch.test.mjs` — the sdd review-depth gate |
| AC9 each budget states its configured ceiling | 2 | `autopilot-tier-contract.test.mjs` — "states each tier's configured ceiling", "renders a tuned ceiling" |
| AC10 escalation rule in small/standard, absent in large | 2 | `autopilot-tier-contract.test.mjs` — "gives small and standard the one-step escalation rule", "gives large no escalation rule at all" |
| AC11 names `final_review` and skipped `task_review` | 2 | `autopilot-tier-contract.test.mjs` — the sdd single-review contract |
| AC12 brainstorm states the step and the three names | 3 | `autopilot-tier-contract.test.mjs` — the brainstorm's classification step |
| AC13 orchestrator ledgers `tier:` and `tier escalated:` | 3 | `autopilot-tier-contract.test.mjs` — the orchestrator's tier handling |
| AC14 `parseLedger`/`nextStage` unaffected by tier entries | 3 | `autopilot-ledger.test.mjs` — "resolves the same stage with and without" |
| AC15 a trailing tier entry does not unpark | 3 | `autopilot-ledger.test.mjs` — "leaves a parked run parked" |
| AC16 README documents the ladder | 3 | `autopilot-tier-contract.test.mjs` — the README's tier documentation |
| AC17 `npm test` passes | 1, 2, 3 | every task's final step |
