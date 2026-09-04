# Lightweight Documents for `small`-Tier Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On tier `small`, the `spec` and `plan` stages still run but write short documents into the run's gitignored scratch directory instead of committing full-length ones, and the `pr` stage carries the scratch spec's content into the pull request description.

**Architecture:** Three changes, no new modules. (1) `autopilot-dispatch.mjs` gains a third fragment form — `{ file }`, read *and* rendered by `compose`, with its placeholders folded into the required/consumed sets — plus a shared `assertTier` extracted from `tierBudget`; the `spec`, `plan` and `pr` recipes then branch on `values.tier`. (2) Five new verbatim fragments under `references/dispatch/` carry the two `small` document shapes and the commit/writing-plans text moved out of the two bodies. (3) `autopilot-ledger.mjs` accepts `spec written` alongside `spec committed`, and the orchestrator SKILL.md plus README document the routing.

**Tech Stack:** Node ESM (`.mjs`), `node:fs`, vitest (`npm test` runs `vitest run` from the repository root). No dependencies are added — the plugin's scripts use only the Node standard library.

**Spec:** `docs/superpowers/specs/2026-09-04-small-tier-scratch-docs-design.md`

## Global Constraints

- Never hand-edit a version field, and never assert a version literal in any test (`CLAUDE.md`).
- `standard` and `large` are untouched in substance: no ceiling changes, no review-count changes, no document-location changes (spec, "The rule" and Non-goals).
- Neither the `spec` stage nor the `plan` stage is ever skipped, on any tier (spec, Non-goals).
- Defaulting is never the fallback: an unknown `--tier` on `spec`, `plan` or `pr` throws at compose time naming `--tier` and all three of `small`, `standard`, `large` (spec, Error handling; the message `tierBudget` already emits).
- A missing document path is the module's existing unfilled-placeholder error, not a new bespoke error (spec, Error handling).
- Fragments are verbatim prose, but `compose` must never ship a literal `{{placeholder}}` to an agent. `autopilot-dispatch-contract.test.mjs`'s "renders every placeholder — none survives into the prompt" enforces this for every stage.
- Prose assertions match the way the prose is laid out. Fragment text wraps at ~78 columns; assert against `readFragment(...)` / `render(...)` output, or use a whitespace-tolerant regex — never a hand-typed sentence that the file happens to wrap (`docs/autopilot/learnings.md`).
- `npm test` passes at the end of every task (AC14).

## Ruling: what "byte-identical" can mean here (spec AC1, AC4)

The spec asks for two things that append-only composition cannot both give:

- AC1 wants the default `spec` output byte-identical to today's, *and* the design says `spec-body.md` "loses its inline `commit it` / `this is the run's first commit` / `do not open a pull request` sentences" into `spec-commit.md`.
- Those sentences are **not** a trailing block of `spec-body.md`. They sit on lines 1-2 and lines 11-12 of a 21-line file. `compose` only ever appends a fragment *after* the rendered body, so `body-minus-sentences + spec-commit.md` cannot reproduce today's paragraph order. The identical problem applies to `plan-body.md` lines 1 and 10-11 moving into `plan-writing-plans.md` (AC4).

**Ruling.** Sentence preservation wins over paragraph position. On the default, `standard` and `large` paths the composed prompt carries **every sentence today's prompt carries, verbatim and unreworded**; the sole difference is that the moved passages now appear as a trailing fragment rather than inline. This is the same kind of deliberate, enumerated difference the spec already grants `plan` for the `{{plan_path}}` line. It is recorded here so review sees a decision and not an accident.

Two tests pin it in place of a bytes-equal assertion, one per stage:

1. A rebuild-from-primitives assertion — the shape `autopilot-dispatch.test.mjs`'s existing "is byte-identical to the pre-tier assembly" already uses — pinning the exact fragment selection, order and joining on the default path.
2. A preservation assertion: the default output `toContain` the *rendered* text of the moved fragment, and the `small` output not contain it. Asserting both directions is what keeps the negative half from passing trivially.

Nothing else about the default path may move, reword or reflow.

## File Structure

**Modify: `plugins/autopilot/scripts/autopilot-dispatch.mjs`**
- Export `assertTier(tier)`, extracted from `tierBudget`'s existing guard; `tierBudget` calls it.
- `composeInstructions` resolves `entry.fragments(...)` *before* the missing/unconsumed checks, and treats a `{ file }` fragment as read-and-render: its placeholders join the body's for both checks. This is what lets `--spec-path` be required-and-consumed on `pr` exactly when `--tier=small`, without adding `spec_path` to `RESERVED` — which would turn the existing test "rejects a flag no placeholder consumes" red, since its fixture is `--spec-path` on stage `pr`.
- `STAGES.spec`, `STAGES.plan` and `STAGES.pr` gain the tier branch.
- `RESERVED` is **unchanged**. `tier` is already in it, which is the whole of AC9's first half; nothing else is added, which is the whole of its second half.

**Create, under `plugins/autopilot/skills/autopilot/references/dispatch/`:**
- `spec-commit.md` — the commit sentences moved out of `spec-body.md`. Default / `standard` / `large` only.
- `spec-small.md` — the short scratch-spec shape. `small` only.
- `plan-writing-plans.md` — the `superpowers:writing-plans` invocation and the execution-choice answer, moved out of `plan-body.md`. Every tier except `small`.
- `plan-inline-small.md` — the inline single-task plan shape plus its escalation rule. `small` only.
- `pr-small.md` — paste the scratch spec's design paragraph and acceptance criteria into the PR description. `small` only.

**Modify: `.../references/dispatch/spec-body.md`** — remove the commit language from lines 1-2 and delete lines 11-12. Placeholders unchanged.

**Modify: `.../references/dispatch/plan-body.md`** — remove the `writing-plans` clause from line 1 and delete lines 10-11; add a `Plan path: {{plan_path}}` line. This is the one placeholder change in the whole plan.

**Modify: `plugins/autopilot/scripts/autopilot-ledger.mjs`** — `nextStage` transitions to `plan` on `spec written` as well as `spec committed`, and the park-check exclusion regex gains `spec written`.

**Modify: `plugins/autopilot/skills/autopilot/SKILL.md`** — the `spec`, `plan` and `pr` dispatch blocks; the `spec written` ledger entry; the Phase 1 tier sentence; the escalation paragraph. Plus a rationale extraction, because of the size budget below.

**Modify: `plugins/autopilot/skills/autopilot/references/rationale.md`** — receives the extracted rationale.

**Modify: `README.md:97-118`** — the ceremony-tiers section documents the `small` document locations.

**Tests modified.** Each is a file that reads one of the above *as a document*, and would otherwise go red:

- `plugins/autopilot/scripts/autopilot-dispatch.test.mjs` — new tier-gate blocks for `spec`, `pr` and `plan`; the existing untiered-plan byte pin gains `plan-writing-plans.md`.
- `plugins/autopilot/scripts/autopilot-dispatch-contract.test.mjs` — `EXPECTED.plan` gains `plan_path` (line 62); the fragment-order block learns the `{ file }` form (around line 78); the `nextStage` prefix count goes 9 to 10 (line 212) and the verbatim-prefix list gains `spec written` (around line 223).
- `plugins/autopilot/scripts/skill-sections.test.mjs` — the orphan-fragment scan (around lines 232-261) must see the five new files: pass `fragmentReader: readFragment` into `entry.fragments(...)`, iterate `values` over each tier, and collect `f.file` as well as string fragments. Its SKILL.md size ceiling (line 289, `< 42_000`) is the budget named below.
- `plugins/autopilot/scripts/autopilot-ledger.test.mjs` — AC10 and AC11.
- `plugins/autopilot/scripts/autopilot-tier-contract.test.mjs` — the orchestrator assertions (AC12) and the README assertions (AC13).

**Sweep list — prose elsewhere that the `spec written` entry falsifies** (Task 3):

- `plugins/autopilot/scripts/autopilot-github-issue.mjs:12-14` — the doc comment enumerating "nine resume prefixes".
- `plugins/autopilot/scripts/autopilot-github-ledger-coupling.test.mjs:26-30` — `// The nine prefixes nextStage resumes on` and `RESUME_PREFIXES`.
- `plugins/autopilot/skills/autopilot-github/SKILL.md:42` — the resume-prefix list.
- `plugins/autopilot/scripts/autopilot-ledger.mjs` — the `INFORMATIONAL` doc comment, whose "without advancing it" is false for `spec written`.

## Size budget — SKILL.md (`skill-sections.test.mjs:289`)

`plugins/autopilot/skills/autopilot/SKILL.md` is **41,949 bytes** today against a **42,000** ceiling: **51 bytes of headroom**. Task 3 adds roughly 900 bytes of routing prose, so it must extract rationale into `references/rationale.md` first. The named blocks, with measured sizes:

| SKILL.md lines | Block | Bytes |
|---|---|---|
| 241-248 | the two numbered reasons `findings.jsonl` lives in the run directory | 493 |
| 427-435 | "Task count is the single largest driver..." through "nothing to gate by hand." | ~640 |
| 436-439 | "The plan ladder governs task decomposition only..." | ~200 |
| 304-307 | the consequence clause in "`cat`/heredoc or the Write tool produce untimestamped lines..." | ~250 |
| 757-760 | the semantic-conflict example after "The test run after the rebase is not optional." | ~250 |

Extracting all five leaves SKILL.md near **40,100** before additions and **41,000** after. **The task's gate is `wc -c` reporting under 41,300** — at least 700 bytes of headroom — and the step must print and report the number. If it is not under 41,300, keep extracting rationale paragraphs (ones whose deletion changes no agent's behaviour) until it is.

## Seams no single task's diff exposes

Per-task review sees one diff at a time; these three values cross task boundaries, so they are pinned here.

1. **The `{ file }` fragment form** is introduced in Task 1 and consumed by Task 2. Exact contract: `compose` reads `f.file` through `fragmentReader`, renders it with the same `values` as the body, and counts `placeholdersIn` of the *unrendered* source toward both the missing-value check and the consumed-flag set. A `{ text }` fragment (the role table, the tier budget) is unchanged — inserted verbatim, contributing no placeholders. A plain string fragment is also unchanged — read verbatim, never rendered.
2. **`assertTier`** is introduced in Task 1 and called by Task 2's `plan` recipe and by `tierBudget`. Signature: `assertTier(tier) -> tier`, throwing the existing message `--tier=<v> is not one of small, standard, large — a silent fallback would produce a run whose ceremony nobody chose`.
3. **The ledger text `spec written -> <path>`** is written with a real U+2192 arrow, exactly as `spec committed → <path>` is: lowercase, one space either side of the arrow. Task 3 writes it into both `autopilot-ledger.mjs` (as a `has(...)` prefix) and SKILL.md; `autopilot-dispatch-contract.test.mjs`'s "asserts every prefix nextStage reads, not a stale hand-copied list" fails unless SKILL.md contains the prefix verbatim.

---

### Task 1: the `{ file }` fragment form, `assertTier`, and the `spec` and `pr` tier gates

Satisfies AC1, AC2, AC3, AC8, AC9.

**Files:**
- Modify: `plugins/autopilot/scripts/autopilot-dispatch.mjs` — `assertTier`, `tierBudget`, `composeInstructions`, `STAGES.spec`, `STAGES.pr`
- Modify: `plugins/autopilot/skills/autopilot/references/dispatch/spec-body.md`
- Create: `plugins/autopilot/skills/autopilot/references/dispatch/spec-commit.md`
- Create: `plugins/autopilot/skills/autopilot/references/dispatch/spec-small.md`
- Create: `plugins/autopilot/skills/autopilot/references/dispatch/pr-small.md`
- Modify: `plugins/autopilot/scripts/autopilot-dispatch.test.mjs`
- Modify: `plugins/autopilot/scripts/autopilot-dispatch-contract.test.mjs` (around line 78)
- Modify: `plugins/autopilot/scripts/skill-sections.test.mjs` (around lines 232-261)

**Interfaces:**
- Produces: `export function assertTier(tier)` — returns `tier`, or throws naming `--tier` and all three values.
- Produces: the `{ file: "<name>.md" }` fragment form described in Seams #1.
- Consumes: `TIERS` from `./autopilot-config.mjs` (already imported by the module), plus the module's own `render`, `placeholdersIn` and `readFragment`.

- [ ] **Step 1: Write the failing tests for the `spec` and `pr` gates**

Append to `plugins/autopilot/scripts/autopilot-dispatch.test.mjs`. `fakeFragments` and `makeConfig` already exist in that file, and `compose`, `render`, `readFragment`, `composeStage`, `defaultConfig` and `dummyValues` are already imported at its top.

```js
describe("the spec tier gate", () => {
  const composeSpec = (values) =>
    compose({
      stage: "spec",
      config: makeConfig(),
      values: {
        run: "r", worktree: "/w", branch: "b", spec_path: "s",
        design: "d", criteria_source: "c", ...values,
      },
      fragmentReader: fakeFragments({
        "spec-body.md": "{{run}}{{worktree}}{{branch}}{{spec_path}}{{design}}{{criteria_source}}",
      }),
      worktreeHas: () => false,
    });

  it("emits the commit fragment on the default, standard and large paths", () => {
    // AC1 — the untiered path and the two untouched tiers select one shape.
    for (const values of [{}, { tier: "standard" }, { tier: "large" }]) {
      const out = composeSpec(values);
      expect(out).toContain("FRAGMENT(spec-commit.md)");
      expect(out).not.toContain("FRAGMENT(spec-small.md)");
      expect(out).toContain("FRAGMENT(spec-criteria.md)");
    }
  });

  it("swaps in the small fragment on small, keeping the criteria contract", () => {
    // AC2
    const out = composeSpec({ tier: "small" });
    expect(out).toContain("FRAGMENT(spec-small.md)");
    expect(out).not.toContain("FRAGMENT(spec-commit.md)");
    expect(out).toContain("FRAGMENT(spec-criteria.md)");
  });

  it("rejects an unrecognised tier, naming the flag and all three values", () => {
    // AC3
    expect(() => composeSpec({ tier: "medium" })).toThrow(/--tier/);
    expect(() => composeSpec({ tier: "medium" })).toThrow(/small/);
    expect(() => composeSpec({ tier: "medium" })).toThrow(/standard/);
    expect(() => composeSpec({ tier: "medium" })).toThrow(/large/);
  });
});

describe("the pr tier gate", () => {
  const composePr = (values, bodies = { "pr-body.md": "{{run}}{{worktree}}" }) =>
    compose({
      stage: "pr",
      config: makeConfig(),
      values: { run: "r", worktree: "/w", ...values },
      fragmentReader: fakeFragments(bodies),
      worktreeHas: () => false,
    });

  it("adds nothing on the default, standard and large paths", () => {
    // AC8
    for (const values of [{}, { tier: "standard" }, { tier: "large" }]) {
      expect(composePr(values)).not.toContain("FRAGMENT(pr-small.md)");
    }
  });

  it("emits pr-small.md on small", () => {
    // AC8
    expect(composePr({ tier: "small", spec_path: "/run/spec.md" }))
      .toContain("FRAGMENT(pr-small.md)");
  });

  it("requires --spec-path on small, through the ordinary placeholder error", () => {
    // The fragment is what consumes it, so the fragment is what makes it
    // required. No bespoke error, and no literal {{spec_path}} shipped.
    const bodies = {
      "pr-body.md": "{{run}}{{worktree}}",
      "pr-small.md": "read {{spec_path}}",
    };
    expect(() => composePr({ tier: "small" }, bodies)).toThrow(/spec_path/);
    expect(() => composePr({ tier: "small" }, bodies)).toThrow(/--spec-path/);
    expect(composePr({ tier: "small", spec_path: "/run/spec.md" }, bodies))
      .toContain("read /run/spec.md");
  });

  it("still rejects --spec-path when the tier is absent or not small", () => {
    // AC9 — a fragment consumes it only on small; everywhere else it is a
    // typo whose value would never reach the agent.
    expect(() => composePr({ spec_path: "/run/spec.md" })).toThrow(/--spec-path/);
    expect(() => composePr({ tier: "large", spec_path: "/run/spec.md" }))
      .toThrow(/--spec-path/);
  });

  it("rejects an unrecognised tier on pr too", () => {
    // AC3's sibling: the same message, from the same helper.
    expect(() => composePr({ tier: "medium" })).toThrow(/--tier/);
    expect(() => composePr({ tier: "medium" })).toThrow(/standard/);
  });
});

// Touches the real files: the sentence-preservation half of the plan's
// byte-identity ruling, which only the real fragments can carry.
describe("the default spec dispatch", () => {
  const values = dummyValues("spec");

  it("selects, orders and joins exactly body + spec-commit + spec-criteria", () => {
    const config = defaultConfig();
    const role = config.roles.spec;
    const expected =
      [
        [
          "---",
          "name: autopilot-spec",
          "description: spec stage of an autopilot run",
          `model: ${role.model}`,
          `effort: ${role.effort}`,
          "---",
        ].join("\n"),
        render(readFragment("spec-body.md"), values),
        render(readFragment("spec-commit.md"), values),
        readFragment("spec-criteria.md"),
      ]
        .map((p) => p.replace(/\s+$/, ""))
        .join("\n\n") + "\n";
    expect(composeStage("spec")).toBe(expected);
  });

  it("keeps every commit sentence on the default path and drops all of them on small", () => {
    // AC2. The negative half would pass trivially on its own, so the same
    // literals are asserted present on the default path first.
    const dflt = composeStage("spec");
    const small = composeStage("spec", { extraValues: { tier: "small" } });
    const moved = render(readFragment("spec-commit.md"), values).replace(/\s+$/, "");

    expect(dflt).toContain(moved);
    expect(dflt).toContain("commit it");
    expect(dflt).toContain("first commit");

    expect(small).not.toContain(moved);
    expect(small).not.toContain("commit it");
    expect(small).not.toContain("first commit");
    expect(small).toContain(readFragment("spec-criteria.md").replace(/\s+$/, ""));
  });
});
```

- [ ] **Step 2: Run the new tests and verify they fail**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-dispatch.test.mjs -t "tier gate"`

Expected: FAIL — `references/dispatch/spec-commit.md cannot be read`, and the `pr` gate emitting nothing.

- [ ] **Step 3: Split `spec-body.md` and write the three new fragments**

Rewrite `spec-body.md` so it carries no commit language. Only lines 1-2 and lines 11-12 change; every other line stays byte-for-byte what is there today. The file's harness note contains the literal token `EOF`, so use a distinct outer heredoc delimiter and `cat` the file back afterwards to confirm all 17 lines landed.

Write `plugins/autopilot/skills/autopilot/references/dispatch/spec-body.md` as:

```
SPEC STAGE — write the approved design into a spec file.

Run: {{run}}
Worktree (work only here): {{worktree}}
Branch: {{branch}}
Spec path: {{spec_path}}

{{criteria_source}}

Harness note: the Write tool is blocked in this worktree. Use Bash heredocs
(`cat > path <<'EOF'`) to create files.

The approved design this spec must carry:

{{design}}

Return one line: the spec path. Do not paste the spec back.
```

Write `plugins/autopilot/skills/autopilot/references/dispatch/spec-commit.md` as:

```
Write the spec to `{{spec_path}}` **inside the worktree** and commit it there.
Do not write it into the main checkout, and do not open a pull request. This is
the run's first commit.
```

Write `plugins/autopilot/skills/autopilot/references/dispatch/spec-small.md` as:

```
This run is tier `small`. Its spec is a scratch document, not a repository
artifact.

Write to `{{spec_path}}` — an absolute path in the main checkout's run
directory, outside the worktree — exactly two things:

1. A design paragraph of a few sentences: what to build, and how.
2. The `## Acceptance criteria` section described below.

Write no other sections. No Problem, no Non-goals, no Measurement, no per-file
sections, no testing section.

Do not commit anything. Do not stage anything. Do not modify any tracked file
in the worktree, and do not open a pull request. The pull request description
is where this document's content ends up; the `pr` stage reads it back from
the path above.
```

Write `plugins/autopilot/skills/autopilot/references/dispatch/pr-small.md` as:

```
This run is tier `small`. Its spec is a scratch document at `{{spec_path}}`
that was never committed, so the pull request description is the only place
the design and the acceptance criteria survive.

Read `{{spec_path}}` and carry two things into the pull request description,
verbatim: the design paragraph, then the whole `## Acceptance criteria`
section, AC ids and `(ui)`/`(non-ui)` tags included. Do not summarise them, do
not renumber them, and do not drop the criteria you judge uninteresting.
```

Then check the two new `small` fragments against AC2 — neither may contain the substring `commit it` or `first commit`:

```bash
grep -n 'commit it\|first commit' plugins/autopilot/skills/autopilot/references/dispatch/spec-small.md plugins/autopilot/skills/autopilot/references/dispatch/pr-small.md
```

Expected: no output.

- [ ] **Step 4: Add `assertTier` and the `{ file }` fragment form to `autopilot-dispatch.mjs`**

Extract the tier guard so three stages share one message. Replace the opening of `tierBudget` with:

```js
/** The tier a `--tier` flag names, or an error naming all three accepted values. */
export function assertTier(tier) {
  if (!TIERS.includes(tier)) {
    throw new Error(
      `--tier=${tier} is not one of ${TIERS.join(", ")} — ` +
        `a silent fallback would produce a run whose ceremony nobody chose`,
    );
  }
  return tier;
}

export function tierBudget({ config, tier, fragmentReader }) {
  assertTier(tier);
  const ceilingFor = (name) => {
```

The rest of `tierBudget` is unchanged.

Then teach `composeInstructions` the `{ file }` form. Replace everything from `const template = fragmentReader(entry.body);` down to and including the `for (const fragment of entry.fragments(...))` loop with:

```js
  const template = fragmentReader(entry.body);

  // Fragments are resolved before the checks below, because a `{file}`
  // fragment's placeholders are part of what this dispatch requires and
  // consumes. `pr-small.md` is the case that forces it: `--spec-path` reaches
  // the `pr` agent through a fragment and through nothing else, so the body
  // alone cannot say whether the flag is required or a typo.
  const fragments = entry.fragments({ config, worktreeHas, values, fragmentReader });
  const rendered = fragments.map((fragment) => {
    if (typeof fragment === "string") return { text: fragmentReader(fragment) };
    if (fragment.file) {
      const source = fragmentReader(fragment.file);
      return { text: render(source, values), placeholders: placeholdersIn(source) };
    }
    return { text: fragment.text };
  });

  const placeholders = [...placeholdersIn(template)];
  for (const part of rendered) {
    for (const p of part.placeholders ?? []) {
      if (!placeholders.includes(p)) placeholders.push(p);
    }
  }

  // An unfilled placeholder is an error, not an empty string: an empty
  // {{spec_path}} produces an agent told to write its spec to nowhere, which it
  // resolves by inventing a path — and the run continues, wrong, to completion.
  const missing = placeholders.filter(
    (p) => !Object.prototype.hasOwnProperty.call(values, p),
  );
  if (missing.length > 0) {
    throw new Error(
      `stage "${stage}": no value for ${missing.map((p) => `{{${p}}}`).join(", ")} — ` +
        `pass ${missing.map(flagFor).join(", ")}`,
    );
  }

  // And an unconsumed flag on the same grounds: a typo'd flag means the value
  // the orchestrator meant to pass never reached the agent.
  const unconsumed = Object.keys(values).filter(
    (k) => !placeholders.includes(k) && !RESERVED.has(k),
  );
  if (unconsumed.length > 0) {
    throw new Error(
      `stage "${stage}": ${unconsumed.map(flagFor).join(", ")} fills no placeholder in ` +
        `references/dispatch/${entry.body} — the value would never reach the agent`,
    );
  }

  const parts = [render(template, values), ...rendered.map((r) => r.text)];
```

The `const instructions = ...` and `return { entry, role, instructions };` lines that follow are unchanged. The old `const parts = [render(template, values)];` line and its fragment loop are gone.

The consequence to preserve: a `{ file }` fragment is rendered, so its `{{...}}` never ships literally; a plain string fragment is still inserted verbatim, which is what `plan-budget.md` and the `sdd-*` contracts rely on.

- [ ] **Step 5: Branch the `spec` and `pr` recipes on the tier**

In `STAGES`, replace the `spec` entry:

```js
  spec: {
    role: "spec",
    body: "spec-body.md",
    fragments: ({ values }) => {
      const tier = values?.tier === undefined ? undefined : assertTier(values.tier);
      return [
        { file: tier === "small" ? "spec-small.md" : "spec-commit.md" },
        "spec-criteria.md",
      ];
    },
  },
```

and the `pr` entry:

```js
  pr: {
    role: "implement",
    body: "pr-body.md",
    fragments: ({ values }) => {
      const tier = values?.tier === undefined ? undefined : assertTier(values.tier);
      return tier === "small" ? [{ file: "pr-small.md" }] : [];
    },
  },
```

- [ ] **Step 6: Update the two tests that enumerate fragments structurally**

`plugins/autopilot/scripts/autopilot-dispatch-contract.test.mjs`, in the "each stage carries its declared fragments, in order" block, resolves each declared fragment with `typeof fragment === "string" ? fragmentBody(fragment) : fragment.text`, which yields `undefined` for the `{ file }` form. Add a helper beside `fragmentBody` and use it at both call sites in that block:

```js
const resolveFragment = (fragment, stage) => {
  if (typeof fragment === "string") return fragmentBody(fragment);
  if (fragment.file) return render(readFragment(fragment.file), dummyValues(stage));
  return fragment.text;
};
```

Import `render` and `readFragment` from `./autopilot-dispatch.mjs` in that file if they are not already imported.

`plugins/autopilot/scripts/skill-sections.test.mjs`, in the orphan scan, must see the new files. Replace the loop that builds `declared` with:

```js
      for (const mode of ["off", "lite", "full"]) {
        for (const has of [true, false]) {
          for (const values of [
            undefined, { tasks: "1" },
            { tier: "small" }, { tier: "standard" }, { tier: "large" },
          ]) {
            const config = defaultConfig({ minimalism: { mode } });
            // fragmentReader is required now that a tiered `values` reaches
            // the plan recipe: it renders its tier budget through it.
            for (const f of entry.fragments({
              config, worktreeHas: () => has, values, fragmentReader: readFragment,
            })) {
              if (typeof f === "string") declared.add(f);
              else if (f.file) declared.add(f.file);
            }
          }
        }
      }
```

Import `readFragment` from `./autopilot-dispatch.mjs` in that file alongside `STAGES`.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`

Expected: PASS.

Then confirm the AC2 property against the real files, since the composed output is what the criterion is about:

```bash
node -e 'import("./plugins/autopilot/scripts/dispatch-fixture.mjs").then(({composeStage})=>{const s=composeStage("spec",{extraValues:{tier:"small"}});console.log("commit it:",s.includes("commit it"),"| first commit:",s.includes("first commit"),"| criteria:",s.includes("## Acceptance criteria"));})'
```

Expected: `commit it: false | first commit: false | criteria: true`.

- [ ] **Step 8: Commit**

```bash
git add plugins/autopilot/scripts/autopilot-dispatch.mjs plugins/autopilot/scripts/autopilot-dispatch.test.mjs plugins/autopilot/scripts/autopilot-dispatch-contract.test.mjs plugins/autopilot/scripts/skill-sections.test.mjs plugins/autopilot/skills/autopilot/references/dispatch/
git commit -m "feat(autopilot): give the spec and pr stages a small-tier document shape"
```

---

### Task 2: the `plan` stage's `{{plan_path}}` and its `small` inline shape

Satisfies AC4, AC5, AC6, AC7.

**Files:**
- Modify: `plugins/autopilot/skills/autopilot/references/dispatch/plan-body.md`
- Create: `plugins/autopilot/skills/autopilot/references/dispatch/plan-writing-plans.md`
- Create: `plugins/autopilot/skills/autopilot/references/dispatch/plan-inline-small.md`
- Modify: `plugins/autopilot/scripts/autopilot-dispatch.mjs` — `STAGES.plan`
- Modify: `plugins/autopilot/scripts/autopilot-dispatch.test.mjs` — a new gate block, and the existing `describe("the untiered plan dispatch")` byte pin
- Modify: `plugins/autopilot/scripts/autopilot-dispatch-contract.test.mjs:62` — `EXPECTED.plan`

**Interfaces:**
- Consumes: `assertTier(tier)` and the `{ file }` fragment form from Task 1 (Seams #1 and #2).
- Produces: `plan-body.md` declaring exactly `run`, `worktree`, `spec_path`, `plan_path` — so `--plan-path` is required on **every** tier.

- [ ] **Step 1: Write the failing tests**

Append to `plugins/autopilot/scripts/autopilot-dispatch.test.mjs`:

```js
describe("the plan document-shape gate", () => {
  const composePlan = (values) =>
    compose({
      stage: "plan",
      config: makeConfig(),
      values: { run: "r", worktree: "/w", spec_path: "s", plan_path: "p", ...values },
      fragmentReader: fakeFragments({
        "plan-body.md": "{{run}}{{worktree}}{{spec_path}}{{plan_path}}",
      }),
      worktreeHas: () => false,
    });

  it("carries the writing-plans fragment on default, standard and large", () => {
    // AC4
    for (const values of [{}, { tier: "standard" }, { tier: "large" }]) {
      const out = composePlan(values);
      expect(out).toContain("FRAGMENT(plan-writing-plans.md)");
      expect(out).not.toContain("FRAGMENT(plan-inline-small.md)");
    }
  });

  it("swaps in the inline shape on small", () => {
    // AC5
    const out = composePlan({ tier: "small" });
    expect(out).toContain("FRAGMENT(plan-inline-small.md)");
    expect(out).not.toContain("FRAGMENT(plan-writing-plans.md)");
  });

  it("puts the document shape ahead of the task-count budget", () => {
    const out = composePlan({ tier: "small" });
    expect(out.indexOf("FRAGMENT(plan-inline-small.md)"))
      .toBeLessThan(out.indexOf("plan-budget-small"));
  });

  it("requires --plan-path on every tier", () => {
    // AC7
    for (const tier of [undefined, "small", "standard", "large"]) {
      const values = { run: "r", worktree: "/w", spec_path: "s" };
      if (tier) values.tier = tier;
      const call = () =>
        compose({
          stage: "plan", config: makeConfig(), values,
          fragmentReader: fakeFragments({
            "plan-body.md": "{{run}}{{worktree}}{{spec_path}}{{plan_path}}",
          }),
          worktreeHas: () => false,
        });
      expect(call).toThrow(/\{\{plan_path\}\}/);
      expect(call).toThrow(/--plan-path/);
    }
  });
});

// Touches the real files.
describe("the small plan dispatch", () => {
  const small = () => composeStage("plan", { extraValues: { tier: "small" } });

  it("never names writing-plans", () => {
    // AC5 — the point of the inline shape is that no planning sub-skill runs.
    expect(small()).not.toContain("superpowers:writing-plans");
    expect(small()).not.toContain("writing-plans");
  });

  it("states the one-step escalation to standard and its return-line form", () => {
    // AC6. Whitespace-tolerant where the fragment may wrap: the assertion is
    // about the sentence reaching the agent, not about the column it breaks at.
    const out = small();
    expect(out).toMatch(/escalat/i);
    expect(out).toMatch(/tier\s+`standard`/);
    expect(out).toContain("escalated to standard: <reason>");
    expect(out).toContain("## Escalation");
    expect(out).toMatch(/at most once|never moves more than one step/i);
  });

  it("keeps the writing-plans text in the default dispatch and out of the small one", () => {
    // Both directions, so neither half passes trivially.
    const values = dummyValues("plan");
    const moved = render(readFragment("plan-writing-plans.md"), values).replace(/\s+$/, "");
    expect(composeStage("plan")).toContain(moved);
    expect(small()).not.toContain(moved);
    expect(small()).toContain(
      render(readFragment("plan-inline-small.md"), values).replace(/\s+$/, ""),
    );
  });
});
```

- [ ] **Step 2: Run the new tests and verify they fail**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-dispatch.test.mjs -t "plan document-shape"`

Expected: FAIL — `references/dispatch/plan-writing-plans.md cannot be read`, and `--plan-path` not yet required.

- [ ] **Step 3: Split `plan-body.md` and write the two new fragments**

`plan-body.md` also contains the literal token `EOF` in its harness note, so use a distinct outer heredoc delimiter and read the file back afterwards.

Write `plugins/autopilot/skills/autopilot/references/dispatch/plan-body.md` as:

```
PLAN STAGE — turn the approved spec into an implementation plan and return the
plan path plus the task count.

Run: {{run}}
Worktree (work only here): {{worktree}}
Approved spec: {{spec_path}}
Plan path: {{plan_path}}

Read the spec first. It is the authority on what to build; do not redesign it.

Harness note: the Write tool is blocked in this worktree. Use Bash heredocs
(`cat > path <<'EOF'`) to create files.

Return under 15 lines: the plan path and the number of tasks. Do not paste the
plan back.
```

Write `plugins/autopilot/skills/autopilot/references/dispatch/plan-writing-plans.md` as:

```
Invoke `superpowers:writing-plans` against the approved spec, and write the
plan it produces to `{{plan_path}}`.

Answer `writing-plans`' execution-choice question with `subagent-driven` — do
not ask.
```

Write `plugins/autopilot/skills/autopilot/references/dispatch/plan-inline-small.md` as:

```
Write the plan yourself, inline. This run is tier `small`: the plan is a
scratch document, not a repository artifact, and no planning sub-skill runs.

Write to `{{plan_path}}` — an absolute path in the main checkout's run
directory, outside the worktree — a single-task plan of roughly 20 to 40 lines
carrying exactly four things:

1. The files the task touches, each with what changes in it.
2. The change itself, in a few sentences.
3. The test to add, named by file and by what it asserts.
4. Which acceptance criteria the task satisfies, by AC id.

Do not commit it, and do not modify any tracked file in the worktree.

Escalate once, and only if the work genuinely cannot be one reviewable diff.
Escalation moves this plan to tier `standard`; write the tasks the work needs
up to that tier's ceiling and no further, in this same inline shape.
Escalation happens at most once in a run and never moves more than one step.
Report it in two places: open the plan with an `## Escalation` heading naming
the reason, and say `escalated to standard: <reason>` in your return line. The
orchestrator records it in the ledger, and the run continues with these same
scratch documents — nothing is promoted, rerun or committed.
```

`plan-inline-small.md` names the escalation target and the return-line form but no ceiling *number*: `plan-budget-small.md` is still emitted after it and renders the configured ceilings, and two literals for one number is how they drift apart.

- [ ] **Step 4: Branch the `plan` recipe**

Replace the `plan` entry in `STAGES`:

```js
  plan: {
    role: "plan",
    body: "plan-body.md",
    fragments: ({ config, worktreeHas, values, fragmentReader }) => {
      const tier = values?.tier === undefined ? undefined : assertTier(values.tier);
      return [
        // The document shape first, then how many tasks may go in it.
        tier === "small"
          ? { file: "plan-inline-small.md" }
          : { file: "plan-writing-plans.md" },
        tier === undefined
          ? "plan-budget.md"
          : { text: tierBudget({ config, tier, fragmentReader }) },
        ...(laddered(config) ? ["plan-minimalism-lite.md"] : []),
        ...(fullLadder(config) ? ["plan-minimalism-full.md"] : []),
        ...(worktreeHas("docs/autopilot/learnings.md") ? ["plan-learnings.md"] : []),
      ];
    },
  },
```

Both shapes are `{ file }`, not bare strings: `plan-writing-plans.md` carries `{{plan_path}}` too, and a plain string fragment is inserted verbatim, which would ship a literal `{{plan_path}}` to the agent — caught by `autopilot-dispatch-contract.test.mjs`'s "renders every placeholder" block. With `fakeFragments`, a `{ file }` fragment still resolves to `FRAGMENT(<name>)`, so Step 1's assertions hold unchanged.

- [ ] **Step 5: Update the two tests the new placeholder and fragment break**

In `plugins/autopilot/scripts/autopilot-dispatch-contract.test.mjs`, line 62:

```js
      plan: ["run", "worktree", "spec_path", "plan_path"],
```

In `plugins/autopilot/scripts/autopilot-dispatch.test.mjs`, replace the existing `describe("the untiered plan dispatch")` block with the same rebuild-from-primitives shape, now including the new fragment and saying what it pins:

```js
describe("the untiered plan dispatch", () => {
  it("selects, orders and joins exactly body + writing-plans + budget + learnings", () => {
    // AC4. Rebuilds what compose() must produce from the same primitives,
    // rather than restating the selection logic — so this pins the assembly
    // and not the implementation that emits it.
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
        render(readFragment("plan-writing-plans.md"), values),
        readFragment("plan-budget.md"),
        readFragment("plan-learnings.md"),
      ]
        .map((p) => p.replace(/\s+$/, ""))
        .join("\n\n") + "\n";
    expect(composeStage("plan")).toBe(expected);
  });
});
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`

Expected: PASS. If the orphan scan reports `plan-writing-plans.md` or `plan-inline-small.md`, Task 1 Step 6's `values` loop did not land — fix it there, rather than hardcoding names here.

- [ ] **Step 7: Commit**

```bash
git add plugins/autopilot/scripts/autopilot-dispatch.mjs plugins/autopilot/scripts/autopilot-dispatch.test.mjs plugins/autopilot/scripts/autopilot-dispatch-contract.test.mjs plugins/autopilot/skills/autopilot/references/dispatch/
git commit -m "feat(autopilot): give the plan stage a plan path and a small-tier inline shape"
```

---

### Task 3: the `spec written` ledger entry, the orchestrator's routing, and the README

Satisfies AC10, AC11, AC12, AC13, AC14.

**Files:**
- Modify: `plugins/autopilot/scripts/autopilot-ledger.mjs` — `nextStage` and the park-check regex
- Modify: `plugins/autopilot/scripts/autopilot-ledger.test.mjs`
- Modify: `plugins/autopilot/scripts/autopilot-dispatch-contract.test.mjs:212` and the verbatim-prefix list below it
- Modify: `plugins/autopilot/skills/autopilot/SKILL.md`
- Modify: `plugins/autopilot/skills/autopilot/references/rationale.md`
- Modify: `plugins/autopilot/scripts/autopilot-tier-contract.test.mjs`
- Modify: `README.md:97-118`
- Sweep: `plugins/autopilot/scripts/autopilot-github-issue.mjs`, `plugins/autopilot/scripts/autopilot-github-ledger-coupling.test.mjs`, `plugins/autopilot/skills/autopilot-github/SKILL.md`

**Interfaces:**
- Consumes: nothing from Tasks 1 and 2 at the code level. The strings this task writes into SKILL.md are the flags those tasks made real: `--tier=small`, `--spec-path`, `--plan-path`.
- Produces: the ledger entry text `spec written → <path>` (Seams #3), matched by prefix.

- [ ] **Step 1: Write the failing ledger tests**

Append to `plugins/autopilot/scripts/autopilot-ledger.test.mjs`; `parseLedger` and `nextStage` are already imported there.

```js
describe("the small tier's spec entry", () => {
  const build = (...texts) =>
    parseLedger(
      [
        "# autopilot run — task: x",
        ...texts.map((t, i) => `2026-09-04T10:0${i}:00Z  ${t}`),
      ].join("\n"),
    );

  it("transitions to plan on `spec written`, exactly as on `spec committed`", () => {
    // AC10
    const written = build(
      "started (phase 1)", "design approved",
      "worktree: .claude/worktrees/x (branch x)",
      "spec written → /repo/.superpowers/autopilot/x/spec.md",
    );
    const committed = build(
      "started (phase 1)", "design approved",
      "worktree: .claude/worktrees/x (branch x)",
      "spec committed → docs/superpowers/specs/2026-09-04-x-design.md",
    );
    expect(nextStage(written)).toBe("plan");
    expect(nextStage(written)).toBe(nextStage(committed));
  });

  it("leaves a parked run parked when appended after PARKED", () => {
    // AC11 — the same guarantee the `tier:` lines carry.
    const ledger = build(
      "started (phase 1)", "design approved",
      "worktree: .claude/worktrees/x (branch x)",
      "PARKED — spec agent could not resolve the design",
      "spec written → /repo/.superpowers/autopilot/x/spec.md",
    );
    expect(nextStage(ledger)).toBe("parked");
  });
});
```

- [ ] **Step 2: Run them and verify they fail**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-ledger.test.mjs -t "small tier"`

Expected: FAIL — the first returns `"spec"` (no transition), the second returns `"plan"` (the park silently lifted).

- [ ] **Step 3: Teach `nextStage` the entry**

First confirm the constant has no other reader:

```bash
grep -rn 'INFORMATIONAL' plugins/ scripts/ docs/
```

Expected: only `plugins/autopilot/scripts/autopilot-ledger.mjs`. If a test names it, keep the old name and add `spec written` to the existing regex instead of renaming.

In `plugins/autopilot/scripts/autopilot-ledger.mjs`, replace the `INFORMATIONAL` constant and its doc comment with:

```js
/**
 * Entries the park check must not read as the run's last word.
 *
 * `nextStage` detects a park by reading the LAST entry, so a line appended
 * after a `PARKED` line would unpark the run — a parked branch would silently
 * resume into the stage that parked it. Anything appended purely for the
 * record belongs here, `session:` measurements included.
 *
 * `spec written` is the exception that is not merely informational: it is a
 * pipeline entry, and `nextStage` transitions to `plan` on it exactly as it
 * does on `spec committed`. It is listed here only so that a `small` run's
 * spec entry arriving after a park cannot resume the run — the same guarantee
 * the `tier:` lines carry.
 */
const NOT_LAST_WORD = /^(tier(:| escalated:)|session:|spec written)/;
```

Rename the single use inside `nextStage` — `const advancing = ledger.entries.filter((e) => !INFORMATIONAL.test(e.text));` — to `NOT_LAST_WORD`, and update the comment above it ("Informational entries — `tier` lines and `session` measurements alike — are skipped") so it also names `spec written`.

Then add the transition beside the existing one:

```js
  // `spec written` is the `small` tier's entry: the spec is a scratch document
  // in the run directory and is never committed. Both mean the same thing to
  // the pipeline — the spec exists, plan next.
  if (has("spec committed") || has("spec written")) return "plan";
```

- [ ] **Step 4: Run the ledger tests, then the coupling test**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-ledger.test.mjs`

Expected: PASS.

Run: `npx vitest run plugins/autopilot/scripts/autopilot-dispatch-contract.test.mjs`

Expected: FAIL twice — "finds the ten prefixes in nextStage's source" asserts `toHaveLength(9)` and there are now ten, and "asserts every prefix nextStage reads" fails because `spec written` is not yet in SKILL.md. Fix the count now (Step 6 fixes the other):

```js
    expect(prefixes).toHaveLength(10); // `started (phase 1)` is the `return "phase1"` default
```

and add `"spec written"` to the `it.each([...])("%s appears verbatim")` prefix list, beside `"spec committed"`.

- [ ] **Step 5: Extract rationale from SKILL.md to make room**

Measure first:

```bash
wc -c plugins/autopilot/skills/autopilot/SKILL.md
```

Expected: 41949 — 51 bytes under the 42,000 ceiling `skill-sections.test.mjs:289` enforces.

Move each block in the plan's size-budget table out of `SKILL.md` and into `plugins/autopilot/skills/autopilot/references/rationale.md`, under a heading naming where it came from (follow the heading convention already in that file). Leave behind only the sentences whose removal would change an agent's behaviour:

- SKILL.md 241-248: keep "The run directory is `.superpowers/autopilot/<run>/` in the **main checkout** — never inside the worktree. `run.md`, `findings.jsonl` and `verify/` live there." Move the two numbered reasons.
- SKILL.md 427-435 and 436-439: keep "the composed definition carries a task-count budget"; move the remainder of the "Task count is the single largest driver..." paragraph and all of "The plan ladder governs task decomposition only...".
- SKILL.md 304-307: keep "`cat`/heredoc or the Write tool produce untimestamped lines." and "Run from the repository root so relative paths resolve."; move the consequence clause between them.
- SKILL.md 757-760: keep "The test run after the rebase is not optional."; move the semantic-conflict example after it.

`skill-sections.test.mjs` also asserts that no dispatch fragment's text is duplicated back into SKILL.md — extraction only removes text, so that stays green. `rationale.md` is not under `references/dispatch/`, so it is not part of the orphan scan.

- [ ] **Step 6: Write the `small` routing into SKILL.md**

Six edits. Keep each terse — this is the file with the size budget.

1. **Phase 1, the tier paragraph** (around line 218). Replace "The tier caps how far `plan` may decompose the work. It never decides which documents get written — `spec` and `plan` run on every tier." with:

```markdown
The tier caps how far `plan` may decompose the work, and on `small` it also
picks the document shape: `spec` and `plan` run on every tier without
exception, but on `small` they are short and live in the run directory,
uncommitted.
```

2. **`spec` stage intro** (around line 367). After the existing paragraph, add:

```markdown
On `small`, pass `--tier=small` and `--spec-path=<absolute run dir>/spec.md`
instead: the spec is a short scratch document in the run directory and is
never committed. On every other tier pass the committed
`docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` path as today, and
`--tier=<tier>` when the ledger carries one — omit the flag when it does not.
```

3. **`spec` ledger line** (around line 401). Replace ``Append: `spec committed → <path>`.`` with:

```markdown
Append: `spec committed → <path>` — or, on `small`, `spec written → <path>`.
```

4. **`plan` dispatch block** (around line 409). Add `  --plan-path=<path-to-plan> \` to the command, and after the block:

```markdown
`--plan-path` is required on every tier. On `small` it is
`<absolute run dir>/plan.md`; otherwise
`docs/superpowers/plans/YYYY-MM-DD-<topic>-plan.md` inside the worktree.
```

5. **`plan` escalation paragraph** (around line 490). Add one sentence:

```markdown
On `small`, an escalation keeps the scratch documents and the inline plan
shape — nothing is promoted, rerun or committed.
```

6. **`pr` dispatch block** (around line 765). After the command block, add:

```markdown
On `small`, add `--tier=small --spec-path=<absolute run dir>/spec.md`: the
spec was never committed, so the PR description is where its design paragraph
and acceptance criteria survive.
```

- [ ] **Step 7: Sweep the prose the change falsifies**

```bash
grep -n 'nine resume prefixes' plugins/autopilot/scripts/autopilot-github-issue.mjs
grep -n 'nine prefixes' plugins/autopilot/scripts/autopilot-github-ledger-coupling.test.mjs
grep -n 'spec committed' plugins/autopilot/skills/autopilot-github/SKILL.md
```

For each hit, add `spec written` to the enumeration and correct the count word (`nine` becomes `ten`). These lists exist so a `github: `-prefixed line can be checked for collisions with the prefixes `nextStage` resumes on; a list missing a prefix is a collision check that does not check.

- [ ] **Step 8: Update README's ceremony-tiers section**

In `README.md`, the sentence ``\`spec\` and \`plan\` run on`` / `every tier without exception.` is asserted verbatim **across that exact line break** by `autopilot-tier-contract.test.mjs` ("states that spec and plan run on every tier"). Keep that sentence and its wrapping untouched. Replace only the bolded lead-in before it, and append after "without exception.":

```markdown
**A tier never decides whether a document gets written.** `spec` and `plan` run on
every tier without exception. What `small` changes is where they land and how long
they are: a short spec and a short single-task plan in the
run directory, uncommitted and gitignored, while `standard` and `large` commit a
full spec to `docs/superpowers/specs/` and a full plan to
`docs/superpowers/plans/` exactly as before. The `pr` stage carries a `small`
run's design paragraph and acceptance criteria into the pull request
description, which is where they survive.
```

Also correct the section's opening claim three lines above the table — "A tier binds one thing: **how far the `plan` stage may decompose the work**, and — at a single task — whether the run needs two reviews or one." — to say it binds three things: the plan ceiling, the review count, and, on `small` only, the document shape and location.

- [ ] **Step 9: Add the contract assertions for the two documents**

Append to `plugins/autopilot/scripts/autopilot-tier-contract.test.mjs`, inside the existing `describe("the orchestrator's tier handling")` block:

```js
  it("routes the small tier's spec, plan and pr dispatches to the run directory", () => {
    // AC12
    expect(skill).toContain("--tier=small");
    expect(skill).toContain("--plan-path");
    expect(skill).toMatch(/--spec-path=<absolute run dir>\/spec\.md/);
    expect(skill).toMatch(/<absolute run dir>\/plan\.md/);
  });

  it("names the small tier's ledger entry", () => {
    // AC12
    expect(skill).toContain("spec written → <path>");
  });

  it("says an escalation on small keeps the scratch documents", () => {
    // AC12 — the one thing a resumed run must not do is promote or recommit.
    expect(skill).toMatch(/nothing is promoted,\s+rerun or committed/);
  });
```

and inside `describe("the README's tier documentation")`:

```js
  it("says small keeps its spec and plan in the run directory, uncommitted", () => {
    // AC13
    expect(readme).toMatch(/short spec and a short single-task plan in the\s+run directory/);
    expect(readme).toMatch(/uncommitted and gitignored/);
    expect(readme).toMatch(/`standard` and `large` commit a\s+full spec/);
  });
```

Every regex above is whitespace-tolerant across the one line break each phrase might take. After writing them, delete the SKILL.md or README line each one guards, confirm the test fails, and restore it — an assertion that cannot fail is not an assertion.

- [ ] **Step 10: Run the whole suite and report the size**

Run: `npm test`

Expected: PASS (AC14).

Run: `wc -c plugins/autopilot/skills/autopilot/SKILL.md`

Expected: a number under **41,300**. If it is not, extract further rationale paragraphs — ones whose deletion changes no agent's behaviour — into `references/rationale.md` until it is. Report the final number in the task's completion note.

- [ ] **Step 11: Commit**

```bash
git add plugins/autopilot/scripts/ plugins/autopilot/skills/ README.md
git commit -m "feat(autopilot): route small-tier runs to scratch spec and plan documents"
```
