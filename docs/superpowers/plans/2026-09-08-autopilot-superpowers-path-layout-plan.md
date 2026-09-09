# Relocate autopilot's project files under `.superpowers/autopilot/` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give autopilot one project root — the config at `.superpowers/autopilot/configs/`, per-run state at `.superpowers/autopilot/runs/` — resolved through a single module, with a read-only fallback to the old locations.

**Architecture:** A new `autopilot-paths.mjs` is the only place the `.superpowers/autopilot` literal is spelled; `autopilot-host.mjs` builds the host-keyed config paths on it. Both expose a `resolve*` helper with new-then-legacy-then-new precedence, so a project or an in-flight run that has not moved keeps working while `loadConfig` warns. Every script defaults its config path and constructs its run paths through those two modules; the documentation and this repository's own config follow.

**Tech Stack:** Node ESM (`.mjs`), vitest, git (`gitignore` negation rules).

**Spec:** `docs/superpowers/specs/2026-09-08-autopilot-superpowers-path-layout-design.md`

## Global Constraints

- The `.superpowers/autopilot` literal is spelled **exactly once**, in `plugins/autopilot/scripts/autopilot-paths.mjs`. Every other module imports the constants. (The legacy harness literals `.claude/autopilot.json` / `.codex/autopilot.json` live once each, in `autopilot-host.mjs`.)
- New config paths, verbatim: `.superpowers/autopilot/configs/autopilot.json` (Claude), `.superpowers/autopilot/configs/autopilot.codex.json` (Codex). New run root, verbatim: `.superpowers/autopilot/runs`.
- Everything **inside** a run directory keeps its current shape (`run.md`, `questions.jsonl`, `findings.jsonl`, `design.md`, `spec.md`, `criteria-source.md`, `land.txt`, `pr-body.md`, `agents/`, `verify/…`). Only the prefix changes.
- `.superpowers/autopilot/rules.md` **stays exactly where it is.** Never rewrite it to `runs/`. A blind `sed 's|.superpowers/autopilot/|.superpowers/autopilot/runs/|g'` would corrupt it — it appears twice in `plugins/autopilot/commands/autopilot-findings.md` (lines 47 and 84) and once in `plugins/autopilot/scripts/autopilot-questions-contract.test.mjs:104`. Leave all three.
- The legacy path is a **read fallback and a deprecation**, never a write target and never a migration prompt. An explicit `--config` still overrides both.
- Files under `docs/superpowers/specs/` and `docs/superpowers/plans/` are historical records. Do not edit any of them except this plan file (AC12).
- Version fields are never hand-edited and no test asserts a version literal (AC12).
- `plugins/autopilot/skills/autopilot/SKILL.md` has a hard size ceiling: `skill-sections.test.mjs:297` asserts `readFileSync(SKILL_PATH,"utf8").length` is `< 42_000`. It is **41,918 chars today — 82 chars of headroom.** Task 4 owns this budget and must land it at ~41,800.
- Gate: `npm test` from the worktree root. Baseline is green at 910 tests across 30 files (AC13).

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `plugins/autopilot/scripts/autopilot-paths.mjs` | The one spelling of `.superpowers/autopilot`; roots plus `runDir` / `legacyRunDir` / `resolveRunDir` |
| `plugins/autopilot/scripts/autopilot-paths.test.mjs` | Unit tests for the above |

**Modified**

| File | Change | Task |
|---|---|---|
| `plugins/autopilot/scripts/autopilot-host.mjs` | `hostConfigPath` → `configs/`; adds `legacyHostConfigPath`, `resolveConfigPath` | 1 |
| `plugins/autopilot/scripts/autopilot-host.test.mjs` | New expectations for the three | 1 |
| `plugins/autopilot/scripts/autopilot-config.mjs` | `loadConfig` legacy warning (task 1); `scaffoldConfig` mkdir + `ensureIgnoreRules` (task 3) | 1, 3 |
| `plugins/autopilot/scripts/autopilot-config.test.mjs` | Tests for both | 1, 3 |
| `plugins/autopilot/scripts/autopilot-session.mjs` | Config default via `resolveConfigPath` | 2 |
| `plugins/autopilot/scripts/autopilot-session.test.mjs` | Default-path test | 2 |
| `plugins/autopilot/scripts/autopilot-verify.mjs` | Config default via `resolveConfigPath` | 2 |
| `plugins/autopilot/scripts/autopilot-verify.test.mjs` | Default-path test | 2 |
| `plugins/autopilot/scripts/autopilot-github-issue.mjs` | Config default + two error-message literals | 2 |
| `plugins/autopilot/scripts/autopilot-github-issue.test.mjs` | Ledger-root fixtures + error-message literal | 2 |
| `plugins/autopilot/scripts/autopilot-dispatch.mjs` | Config default; `outputPath`/`codexOutputPath` via `runDir` | 2 |
| `plugins/autopilot/scripts/autopilot-dispatch.test.mjs` | Stage-artifact path expectations | 2 |
| `plugins/autopilot/scripts/autopilot-findings.mjs` | Default report root → `RUNS_ROOT`; header comment | 2 |
| `plugins/autopilot/scripts/autopilot-findings.test.mjs` | Default-root test | 2 |
| `plugins/autopilot/scripts/autopilot-questions.mjs` | Default report root → `RUNS_ROOT`; header comment | 2 |
| `plugins/autopilot/scripts/autopilot-questions.test.mjs` | Default-root test | 2 |
| `plugins/autopilot/scripts/autopilot-artifacts.mjs` | Two config-path literals in prose | 2 |
| `plugins/autopilot/scripts/autopilot-codex-contract.test.mjs` | `codexOutputPath` expectation (task 2); three doc-literal expectations (task 4) | 2, 4 |
| `.gitignore` | Drop `!.claude/autopilot.json`, append the five-rule block | 3 |
| `.claude/autopilot.json` → `.superpowers/autopilot/configs/autopilot.json` | `git mv` | 3 |
| `README.md` | 8 config-path mentions + the sentences they carry | 4 |
| `plugins/autopilot/skills/autopilot/SKILL.md` | 23 run paths, 5 config mentions, preflight step 4, size budget | 4 |
| `plugins/autopilot/skills/autopilot-github/SKILL.md` | 12 mentions incl. `--write-ledger` root | 4 |
| `plugins/autopilot/skills/autopilot-brainstorm/SKILL.md` | 1 config mention | 4 |
| `plugins/autopilot/commands/autopilot-findings.md` | 4 mentions (the 2 `rules.md` lines stay) | 4 |
| `plugins/autopilot/skills/autopilot/references/stages/claude-dispatch.md` | 1 | 4 |
| `plugins/autopilot/skills/autopilot/references/stages/codex-dispatch.md` | 2 | 4 |
| `plugins/autopilot/skills/autopilot/references/stages/verify-run.md` | 3 | 4 |
| `plugins/autopilot/skills/autopilot/references/dispatch/learnings.md` | 2, incl. the corpus glob | 4 |
| `plugins/autopilot/skills/autopilot/references/dispatch/sdd-findings.md` | 1 | 4 |
| `plugins/autopilot/skills/autopilot/references/dispatch/sdd-model-map.md` | 1 | 4 |
| `plugins/autopilot/skills/autopilot/references/dispatch/sdd-verification.md` | 1 | 4 |
| `plugins/autopilot/scripts/autopilot-verify-contract.test.mjs` | 3 doc-literal expectations | 4 |
| `plugins/autopilot/scripts/autopilot-config-scaffold-contract.test.mjs` | "left uncommitted" → commit instruction | 4 |

**Deliberately not modified** (state this in the PR if asked):

- `plugins/autopilot/scripts/autopilot-ledger.test.mjs` and the artifacts-dir fixtures in `autopilot-verify.test.mjs` — arbitrary path strings passed *into* the code under test, not paths it constructs. No acceptance criterion covers them; changing them is churn.
- `.superpowers/autopilot/rules.md` and every reference to it.
- `docs/autopilot/learnings.md` — states no path literal.

---

## Task 1: The path module, host config resolution, and the legacy-config warning

Satisfies AC1, AC3, AC5, and the module half of AC2 and AC4.

**Files:**
- Create: `plugins/autopilot/scripts/autopilot-paths.mjs`
- Create: `plugins/autopilot/scripts/autopilot-paths.test.mjs`
- Modify: `plugins/autopilot/scripts/autopilot-host.mjs`
- Modify: `plugins/autopilot/scripts/autopilot-host.test.mjs:14-21`
- Modify: `plugins/autopilot/scripts/autopilot-config.mjs` (`loadConfig` only)
- Modify: `plugins/autopilot/scripts/autopilot-config.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, from `autopilot-paths.mjs`:
  - `AUTOPILOT_ROOT: string` — `".superpowers/autopilot"`
  - `CONFIGS_DIR: string` — `".superpowers/autopilot/configs"`
  - `RUNS_ROOT: string` — `".superpowers/autopilot/runs"`
  - `runDir(run: string): string`
  - `legacyRunDir(run: string): string`
  - `resolveRunDir(run: string, opts?: { exists?: (p: string) => boolean }): { dir: string, legacy: boolean }`
- Produces, from `autopilot-host.mjs` (in addition to the existing `HOSTS`, `assertHost`, `hostDefaultsPath`, `hostEffortOverride`):
  - `hostConfigPath(host: "claude" | "codex"): string` — now the `configs/` path
  - `legacyHostConfigPath(host): string`
  - `resolveConfigPath(host, opts?: { exists?: (p: string) => boolean }): { path: string, legacy: boolean }`
- Produces, from `autopilot-config.mjs`: `loadConfig` unchanged in signature and return shape; its `warnings` array may now carry one extra legacy-location line.

**Design note — why `resolve*` takes an injected `exists`.** Both helpers hit the filesystem, and every existing test in this suite mocks I/O rather than touching disk. Injecting `exists` (defaulting to `existsSync`) is how `scaffoldConfig` already does it in this module family; follow that, do not add a new mocking layer.

**Design note — the warning matches the legacy path exactly.** Scripts resolve config from the repository root, so the string `loadConfig` sees for a legacy config is always the bare relative literal `resolveConfigPath` handed back. Match it with `===`, not a suffix test: a suffix test would start warning on the many `/proj/.claude/autopilot.json` fixtures already in `autopilot-config.test.mjs`, whose warning arrays are asserted exactly. The warning is a deprecation nudge, not a guard; a hand-typed `--config=./.claude/autopilot.json` going unwarned is acceptable and is why this is a `===`.

- [ ] **Step 1: Write the failing tests for the path module**

Create `plugins/autopilot/scripts/autopilot-paths.test.mjs`:

```js
import { describe, expect, it } from "vitest";
import {
  AUTOPILOT_ROOT,
  CONFIGS_DIR,
  RUNS_ROOT,
  legacyRunDir,
  resolveRunDir,
  runDir,
} from "./autopilot-paths.mjs";

describe("autopilot path layout", () => {
  it("spells the three roots", () => {
    expect(AUTOPILOT_ROOT).toBe(".superpowers/autopilot");
    expect(CONFIGS_DIR).toBe(".superpowers/autopilot/configs");
    expect(RUNS_ROOT).toBe(".superpowers/autopilot/runs");
  });

  it("puts a run under runs/", () => {
    expect(runDir("r1")).toBe(".superpowers/autopilot/runs/r1");
  });

  it("keeps the legacy run directory addressable", () => {
    expect(legacyRunDir("r1")).toBe(".superpowers/autopilot/r1");
  });
});

describe("resolveRunDir", () => {
  const only = (...paths) => (p) => paths.includes(p);

  it("prefers the new directory when its ledger exists", () => {
    expect(
      resolveRunDir("r1", { exists: only(".superpowers/autopilot/runs/r1/run.md") }),
    ).toEqual({ dir: ".superpowers/autopilot/runs/r1", legacy: false });
  });

  it("falls back to the legacy directory when only its ledger exists", () => {
    expect(
      resolveRunDir("r1", { exists: only(".superpowers/autopilot/r1/run.md") }),
    ).toEqual({ dir: ".superpowers/autopilot/r1", legacy: true });
  });

  it("prefers the new directory when both ledgers exist", () => {
    expect(resolveRunDir("r1", { exists: () => true }))
      .toEqual({ dir: ".superpowers/autopilot/runs/r1", legacy: false });
  });

  it("names the new directory when neither exists — a run about to start", () => {
    expect(resolveRunDir("r1", { exists: () => false }))
      .toEqual({ dir: ".superpowers/autopilot/runs/r1", legacy: false });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-paths.test.mjs`
Expected: FAIL — `Failed to resolve import "./autopilot-paths.mjs"`.

- [ ] **Step 3: Write the path module**

Create `plugins/autopilot/scripts/autopilot-paths.mjs`:

```js
// The one place `.superpowers/autopilot` is spelled.
//
// Autopilot keeps two kinds of project file under this root, and the split is
// what makes the layout extensible: `configs/` is durable and tracked (a git
// worktree contains only committed files, and the stage agents run inside one,
// so an untracked config is invisible exactly where it is read), while `runs/`
// is rederived every run, per-machine, and stays ignored. Anything else added
// here later gets its own sibling directory instead of colliding with a run
// name.

import { existsSync } from "node:fs";

export const AUTOPILOT_ROOT = ".superpowers/autopilot";
export const CONFIGS_DIR = `${AUTOPILOT_ROOT}/configs`;
export const RUNS_ROOT = `${AUTOPILOT_ROOT}/runs`;

/** `.superpowers/autopilot/runs/<run>` — the canonical home for a run. */
export const runDir = (run) => `${RUNS_ROOT}/${run}`;

/** `.superpowers/autopilot/<run>` — where runs lived before the move. */
export const legacyRunDir = (run) => `${AUTOPILOT_ROOT}/${run}`;

/**
 * New, then legacy, then new. The last clause is the important one: a run
 * about to start has no ledger anywhere, and it must be created in the new
 * home rather than inheriting the deprecated one. `run.md` is the marker
 * because it is the first file any run writes.
 */
export function resolveRunDir(run, { exists = existsSync } = {}) {
  const dir = runDir(run);
  if (exists(`${dir}/run.md`)) return { dir, legacy: false };
  const legacy = legacyRunDir(run);
  if (exists(`${legacy}/run.md`)) return { dir: legacy, legacy: true };
  return { dir, legacy: false };
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-paths.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Update the host tests to the new config locations**

In `plugins/autopilot/scripts/autopilot-host.test.mjs`, replace the two existing config-path tests (lines 14-21) with:

```js
  it("maps claude to the configs/ config path", () => {
    expect(hostConfigPath("claude"))
      .toBe(".superpowers/autopilot/configs/autopilot.json");
  });

  it("maps codex to the configs/ config path", () => {
    expect(hostConfigPath("codex"))
      .toBe(".superpowers/autopilot/configs/autopilot.codex.json");
  });

  it("rejects an unknown host from the config path", () => {
    expect(() => hostConfigPath("cursor")).toThrow(/unknown host/i);
  });

  it("keeps the old harness paths addressable as the legacy fallback", () => {
    expect(legacyHostConfigPath("claude")).toBe(".claude/autopilot.json");
    expect(legacyHostConfigPath("codex")).toBe(".codex/autopilot.json");
    expect(() => legacyHostConfigPath("cursor")).toThrow(/unknown host/i);
  });
```

and append a new describe block at the end of the file:

```js
describe("resolveConfigPath", () => {
  const only = (...paths) => (p) => paths.includes(p);
  const NEW = ".superpowers/autopilot/configs/autopilot.json";

  it("prefers the configs/ path when it exists", () => {
    expect(resolveConfigPath("claude", { exists: only(NEW) }))
      .toEqual({ path: NEW, legacy: false });
  });

  it("falls back to the harness path when only that exists", () => {
    expect(resolveConfigPath("claude", { exists: only(".claude/autopilot.json") }))
      .toEqual({ path: ".claude/autopilot.json", legacy: true });
  });

  it("prefers the configs/ path when both exist", () => {
    expect(resolveConfigPath("claude", { exists: () => true }))
      .toEqual({ path: NEW, legacy: false });
  });

  it("names the configs/ path when neither exists", () => {
    expect(resolveConfigPath("claude", { exists: () => false }))
      .toEqual({ path: NEW, legacy: false });
  });

  it("resolves codex against its own pair", () => {
    expect(resolveConfigPath("codex", { exists: only(".codex/autopilot.json") }))
      .toEqual({ path: ".codex/autopilot.json", legacy: true });
  });
});
```

Extend the import at the top of the file to `legacyHostConfigPath` and `resolveConfigPath`.

- [ ] **Step 6: Run the host tests and confirm they fail**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-host.test.mjs`
Expected: FAIL — `hostConfigPath("claude")` still returns `.claude/autopilot.json`, and `legacyHostConfigPath` / `resolveConfigPath` are not exported.

- [ ] **Step 7: Implement the host changes**

In `plugins/autopilot/scripts/autopilot-host.mjs`, add the imports and replace `hostConfigPath`:

```js
import { existsSync } from "node:fs";
import { CONFIGS_DIR } from "./autopilot-paths.mjs";
```

```js
/** The project config for `host`, under the tracked `configs/` directory. */
export function hostConfigPath(host) {
  assertHost(host);
  return host === "codex"
    ? `${CONFIGS_DIR}/autopilot.codex.json`
    : `${CONFIGS_DIR}/autopilot.json`;
}

/**
 * Where `host` kept its project config before the move. Read-only: nothing
 * writes here any more, and `loadConfig` warns when it reads from here.
 */
export function legacyHostConfigPath(host) {
  assertHost(host);
  return host === "codex" ? ".codex/autopilot.json" : ".claude/autopilot.json";
}

/**
 * New, then legacy, then new — the same precedence as `resolveRunDir`, so a
 * project that has not moved keeps working across the release and one that
 * has never had a config gets told about the new home.
 */
export function resolveConfigPath(host, { exists = existsSync } = {}) {
  const path = hostConfigPath(host);
  if (exists(path)) return { path, legacy: false };
  const legacy = legacyHostConfigPath(host);
  if (exists(legacy)) return { path: legacy, legacy: true };
  return { path, legacy: false };
}
```

- [ ] **Step 8: Run the host tests and confirm they pass**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-host.test.mjs`
Expected: PASS.

- [ ] **Step 9: Write the failing test for the legacy-config warning**

Add to `plugins/autopilot/scripts/autopilot-config.test.mjs`, **inside the existing `loadConfig` describe block**. That block already defines the `reader({path: contents})` stub, the `DEFAULTS` and `CODEX_DEFAULTS` constants and the `validConfig()` fixture these use — reuse them, do not redefine them:

```js
  it("warns when the project config is still at the legacy Claude path", () => {
    const LEGACY = ".claude/autopilot.json";
    const readFile = reader({
      [DEFAULTS]: JSON.stringify(validConfig()),
      [LEGACY]: JSON.stringify({ test_command: "npm test" }),
    });
    const { warnings } = loadConfig(LEGACY, {}, readFile, DEFAULTS);
    expect(warnings).toContain(
      ".claude/autopilot.json is the old project config location — move it to " +
        ".superpowers/autopilot/configs/autopilot.json and commit it",
    );
  });

  it("warns when the project config is still at the legacy Codex path", () => {
    const LEGACY = ".codex/autopilot.json";
    const readFile = reader({
      [CODEX_DEFAULTS]: JSON.stringify(validConfig()),
      [LEGACY]: JSON.stringify({ test_command: "npm test" }),
    });
    const { warnings } = loadConfig(LEGACY, {}, readFile, undefined, { host: "codex" });
    expect(warnings).toContain(
      ".codex/autopilot.json is the old project config location — move it to " +
        ".superpowers/autopilot/configs/autopilot.codex.json and commit it",
    );
  });

  it("does not warn about the location when the config is at the new path", () => {
    const NEW = ".superpowers/autopilot/configs/autopilot.json";
    const readFile = reader({
      [DEFAULTS]: JSON.stringify(validConfig()),
      [NEW]: JSON.stringify({ test_command: "npm test" }),
    });
    const { warnings } = loadConfig(NEW, {}, readFile, DEFAULTS);
    expect(warnings.join("\n")).not.toMatch(/old project config location/);
  });

  it("does not warn about the location when no project config was loaded", () => {
    const readFile = reader({ [DEFAULTS]: JSON.stringify(validConfig()) });
    const { warnings, usedProjectConfig } = loadConfig(
      ".claude/autopilot.json", {}, readFile, DEFAULTS,
    );
    expect(usedProjectConfig).toBe(false);
    expect(warnings.join("\n")).not.toMatch(/old project config location/);
  });
```

The legacy-Codex case is deliberate: the warning is keyed on the file `loadConfig` actually read and checked against **both** hosts' legacy paths, so a Codex project still hears about it under a Claude-hosted run.

Every existing fixture in this block uses an absolute `/proj/.claude/autopilot.json` path, which does **not** equal the bare legacy literal, so none of them starts warning and none of their exact-array warning assertions moves. That is the `===` design note above, made visible.

- [ ] **Step 10: Run it and confirm it fails**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-config.test.mjs -t "legacy"`
Expected: FAIL — no such warning is produced.

- [ ] **Step 11: Implement the warning in `loadConfig`**

In `plugins/autopilot/scripts/autopilot-config.mjs`, extend the import from `./autopilot-host.mjs` with `HOSTS` and `legacyHostConfigPath`, then insert immediately after the `if (!ok) { … }` block and before `return { config: merged, … }`:

```js
  // A deprecation, not a permanent second path: the fallback exists so a
  // project that has not moved keeps working across one release. Matched with
  // `===` against the bare relative literal, which is the only string
  // `resolveConfigPath` ever hands back for a legacy config.
  if (project !== undefined) {
    const staleHost = HOSTS.find((h) => legacyHostConfigPath(h) === path);
    if (staleHost) {
      warnings.push(
        `${path} is the old project config location — move it to ` +
          `${hostConfigPath(staleHost)} and commit it`,
      );
    }
  }
```

- [ ] **Step 12: Run the full suite**

Run: `npm test`
Expected: PASS. `autopilot-host.test.mjs` and `autopilot-config.test.mjs` carry the new cases; nothing else moves yet, because every other script still passes its own hardcoded literal.

- [ ] **Step 13: Commit**

```bash
git add plugins/autopilot/scripts/autopilot-paths.mjs plugins/autopilot/scripts/autopilot-paths.test.mjs plugins/autopilot/scripts/autopilot-host.mjs plugins/autopilot/scripts/autopilot-host.test.mjs plugins/autopilot/scripts/autopilot-config.mjs plugins/autopilot/scripts/autopilot-config.test.mjs
git commit -m "feat(autopilot): resolve config and run paths through one module

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Every script defaults and constructs through the modules

Satisfies AC2 (script half) and AC4.

**Files:**
- Modify: `plugins/autopilot/scripts/autopilot-session.mjs:209`
- Modify: `plugins/autopilot/scripts/autopilot-session.test.mjs`
- Modify: `plugins/autopilot/scripts/autopilot-verify.mjs:644`
- Modify: `plugins/autopilot/scripts/autopilot-verify.test.mjs`
- Modify: `plugins/autopilot/scripts/autopilot-github-issue.mjs:137,219,394`
- Modify: `plugins/autopilot/scripts/autopilot-github-issue.test.mjs:179-183,251,290-299`
- Modify: `plugins/autopilot/scripts/autopilot-dispatch.mjs:269-275,451`
- Modify: `plugins/autopilot/scripts/autopilot-dispatch.test.mjs:228,263,265,277,300,302`
- Modify: `plugins/autopilot/scripts/autopilot-findings.mjs:3,232`
- Modify: `plugins/autopilot/scripts/autopilot-findings.test.mjs`
- Modify: `plugins/autopilot/scripts/autopilot-questions.mjs:3,367`
- Modify: `plugins/autopilot/scripts/autopilot-questions.test.mjs`
- Modify: `plugins/autopilot/scripts/autopilot-artifacts.mjs:54,90`
- Modify: `plugins/autopilot/scripts/autopilot-codex-contract.test.mjs:63-64`

**Interfaces:**
- Consumes: `RUNS_ROOT`, `runDir` from `autopilot-paths.mjs`; `resolveConfigPath` from `autopilot-host.mjs` (Task 1).
- Produces: `outputPath(run, stage)` → `.superpowers/autopilot/runs/<run>/agents/<stage>.md`; `codexOutputPath(run, stage)` → the `.json` sibling. Task 4's documentation quotes both verbatim.

**Design note — no new `--host` flag.** `autopilot-session.mjs`, `autopilot-verify.mjs` and `autopilot-github-issue.mjs` take no host today; they hardcode the Claude literal, and Codex reaches them by passing `--config=` explicitly from `references/stages/codex-dispatch.md`. Preserve that exactly: default through `resolveConfigPath("claude").path`. Adding a host flag nothing passes is the parameterisation the minimalism ladder forbids.

**Design note — resolve lazily.** Write `flag(…) ?? resolveConfigPath("claude").path`, not `flag(…, resolveConfigPath("claude").path)`. The eager form stats the filesystem on every invocation, including the ones that supply `--config`.

- [ ] **Step 1: Write the failing tests for the run-path constructors**

In `plugins/autopilot/scripts/autopilot-dispatch.test.mjs`, change every stage-artifact path expectation to the `runs/` form. The six sites and their new values:

```js
    expect(paths[0]).toBe(".superpowers/autopilot/runs/r1/agents/sdd.md");        // line 228
    expect(t.out).toEqual([".superpowers/autopilot/runs/r1/agents/pr.md"]);       // line 263
    expect(t.written[0].path).toBe(".superpowers/autopilot/runs/r1/agents/pr.md"); // line 265
    expect(explicit.written[0].path).toBe(".superpowers/autopilot/runs/r1/agents/pr.md"); // line 277
    expect(t.out).toEqual([".superpowers/autopilot/runs/r1/agents/pr.json"]);     // line 300
    expect(t.written[0].path).toBe(".superpowers/autopilot/runs/r1/agents/pr.json"); // line 302
```

In `plugins/autopilot/scripts/autopilot-codex-contract.test.mjs`, line 63-64:

```js
    expect(codexOutputPath("run-7", "pr"))
      .toBe(".superpowers/autopilot/runs/run-7/agents/pr.json");
```

Leave the three doc-literal assertions in that file (lines 73, 90-92, 111) alone — Task 4 owns them together with the documents they read.

- [ ] **Step 2: Write the failing tests for the report roots and the config defaults**

Append to `plugins/autopilot/scripts/autopilot-findings.test.mjs`:

```js
  it("defaults the report root to the runs directory", () => {
    // The default is the only path a bare `report` reads; pointed at the old
    // root it would find the `runs` directory itself and no findings at all.
    const { positional } = splitThresholdFlag(["report"]);
    const [, root = RUNS_ROOT] = positional;
    expect(root).toBe(".superpowers/autopilot/runs");
  });
```

If `splitThresholdFlag` is not exported, assert the default through `main` instead, by stubbing the corpus reader the file already stubs elsewhere and checking the root it was handed. Whichever route: the assertion must fail if the `RUNS_ROOT` default in `main` is reverted to `".superpowers/autopilot"`. Import `RUNS_ROOT` from `./autopilot-paths.mjs`.

Add the mirror test to `plugins/autopilot/scripts/autopilot-questions.test.mjs` for its own `report` default.

Append to `plugins/autopilot/scripts/autopilot-session.test.mjs`, using the existing `deps.load` stub that block already uses:

```js
  it("defaults the config path to the resolved project config", () => {
    const seen = [];
    main(["measure"], {}, {
      load: (p) => { seen.push(p); return { config: {} }; },
      log: () => {}, logError: () => {}, find: () => undefined,
    });
    expect(seen[0]).toBe(".superpowers/autopilot/configs/autopilot.json");
  });
```

(The worktree has no `.claude/autopilot.json` and no `configs/autopilot.json` while Task 2 runs, so `resolveConfigPath` returns the new path. Task 3 creates the file; this assertion holds either way, because the new path wins whenever it exists.)

Append to `plugins/autopilot/scripts/autopilot-verify.test.mjs`, beside the existing "passes the paths through as the flags name them" test:

```js
  it("defaults the config path when no --config is given", async () => {
    const { calls, fn } = spy();
    await silently(() => main(["run", "--run-dir=x", "--spec=s.md"], fn));
    expect(calls[0].configPath).toBe(".superpowers/autopilot/configs/autopilot.json");
  });
```

- [ ] **Step 3: Run them and confirm they fail**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-dispatch.test.mjs plugins/autopilot/scripts/autopilot-codex-contract.test.mjs plugins/autopilot/scripts/autopilot-findings.test.mjs plugins/autopilot/scripts/autopilot-questions.test.mjs plugins/autopilot/scripts/autopilot-session.test.mjs plugins/autopilot/scripts/autopilot-verify.test.mjs`
Expected: FAIL — the old `.superpowers/autopilot/r1/...` and `.claude/autopilot.json` values are still produced.

- [ ] **Step 4: Rewire `autopilot-dispatch.mjs`**

Extend the imports:

```js
import { assertHost, resolveConfigPath } from "./autopilot-host.mjs";
import { runDir } from "./autopilot-paths.mjs";
```

Replace lines 269-275:

```js
/** `.superpowers/autopilot/runs/<run>/agents/<stage>.md` — keyed by stage. */
export const outputPath = (run, stage) => `${runDir(run)}/agents/${stage}.md`;

/** `.superpowers/autopilot/runs/<run>/agents/<stage>.json` — keyed by stage. */
export const codexOutputPath = (run, stage) => `${runDir(run)}/agents/${stage}.json`;
```

Replace line 451:

```js
    const configPath = values.config ?? resolveConfigPath(host).path;
```

`hostConfigPath` is no longer referenced here — drop it from the import list.

- [ ] **Step 5: Rewire the remaining scripts**

`autopilot-session.mjs` — add `import { resolveConfigPath } from "./autopilot-host.mjs";` and replace line 209:

```js
  const configPath = flag(argv, "config") ?? resolveConfigPath("claude").path;
```

`autopilot-verify.mjs` — add the same import and replace line 644:

```js
      configPath: flag("config") ?? resolveConfigPath("claude").path,
```

`autopilot-github-issue.mjs` — add the same import and replace line 394:

```js
  const configPath = args.config ?? resolveConfigPath("claude").path;
```

and the two prose literals:

```js
          `Add them under "github" in .superpowers/autopilot/configs/autopilot.json.`,   // line 137
```
```js
        `add the issue to that board, or fix project_owner/project_number in ` +
          `.superpowers/autopilot/configs/autopilot.json`,                                // line 219
```

`autopilot-findings.mjs` — add `import { RUNS_ROOT } from "./autopilot-paths.mjs";`, replace line 232's default `root = ".superpowers/autopilot"` with `root = RUNS_ROOT`, and update the header comment on line 3 to `.superpowers/autopilot/runs/<run>/findings.jsonl`.

`autopilot-questions.mjs` — the same three edits against line 367 and the header comment on line 3 (`.superpowers/autopilot/runs/<run>/questions.jsonl`).

`autopilot-artifacts.mjs` — the two prose literals:

```js
        "no `artifacts` block in .superpowers/autopilot/configs/autopilot.json — " +
        "add env_file, bucket and public_base_url to publish screenshots",   // line 54
```
```js
 * enters `.superpowers/autopilot/configs/autopilot.json`. `R2_BUCKET` in that   // line 90
```

- [ ] **Step 6: Move the GitHub ledger-root fixtures**

`autopilot-github-issue.mjs` takes its ledger root from `--write-ledger` and appends `/<run>`, so the root the caller passes is what decides where a run's ledger lands. Task 4 changes `skills/autopilot-github/SKILL.md` to pass `.superpowers/autopilot/runs`; move the test fixtures with it now so the two halves agree. In `plugins/autopilot/scripts/autopilot-github-issue.test.mjs`:

- lines 179-183: `writeLedgerHeader(".superpowers/autopilot/runs/issue-42-csv-export-drops-unicode", …)`, with the `mkdirs` and written-path expectations updated to match.
- line 251: `expect(result.message).toContain(".superpowers/autopilot/configs/autopilot.json");`
- lines 290-299: the argv `["resolve", "--issue", "42", "--write-ledger", ".superpowers/autopilot/runs"]` and both derived path expectations.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Sweep the files you edited for prose the change falsified**

For each of the eight `.mjs` files touched above, re-read the module header comment and every JSDoc block for a path, a directory name, or a claim about where something lives. Fix anything now wrong. The known sites are already listed in Step 5; this step exists to catch the ones that are not.

- [ ] **Step 9: Commit**

```bash
git add plugins/autopilot/scripts
git commit -m "feat(autopilot): default every script's config and run paths to the new layout

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: The scaffolder creates its directory and seeds the ignore rules; this repository adopts them

Satisfies AC6, AC7, AC8, AC11.

**Files:**
- Modify: `plugins/autopilot/scripts/autopilot-config.mjs` (`scaffoldConfig`, plus a new `ensureIgnoreRules` and `IGNORE_RULES`)
- Modify: `plugins/autopilot/scripts/autopilot-config.test.mjs` (the `scaffoldConfig` describe block)
- Modify: `.gitignore`
- Move: `.claude/autopilot.json` → `.superpowers/autopilot/configs/autopilot.json`

**Interfaces:**
- Consumes: `hostConfigPath` from Task 1 (only indirectly — `scaffoldConfig` is still handed its path by the caller).
- Produces:
  - `IGNORE_RULES: string` — the five rules plus their four-line comment, newline-joined, no trailing newline.
  - `ensureIgnoreRules(gitignorePath?: string, deps?: { readFile, writeFile, exists }): { path: string, changed: boolean }`
  - `scaffoldConfig(path, opts)` now returns `{ path: string, gitignore: { path: string, changed: boolean } }` instead of a bare string. Task 4's SKILL.md prose reports both halves.

**Design note — the return shape does not change the preflight command.** SKILL.md invokes `console.log('created', m.scaffoldConfig(...))`. `console.log` formats the object, so the command string is untouched and the `SCAFFOLD_CALL` assertions in `autopilot-config-scaffold-contract.test.mjs` keep matching. Only the surrounding prose changes, in Task 4.

**Design note — append at the end of `.gitignore`, never before the existing `.superpowers/` line.** git resolves a path against the *last* matching pattern, so `!.superpowers/` only wins if it comes after the plain `.superpowers/` exclusion. Appending is what makes the block work; inserting it earlier would silently do nothing.

- [ ] **Step 1: Write the failing tests**

Add a new describe block to `plugins/autopilot/scripts/autopilot-config.test.mjs`:

```js
describe("ensureIgnoreRules", () => {
  const deps = (files) => {
    const written = [];
    return {
      written,
      exists: (p) => p in files,
      readFile: (p) => files[p],
      writeFile: (p, text) => { written.push({ path: p, text }); files[p] = text; },
      files,
    };
  };

  it("appends the block to a .gitignore that lacks it", () => {
    const d = deps({ ".gitignore": "node_modules/\n.superpowers/\n" });
    expect(ensureIgnoreRules(".gitignore", d)).toEqual({ path: ".gitignore", changed: true });
    expect(d.written).toHaveLength(1);
    const text = d.files[".gitignore"];
    expect(text.startsWith("node_modules/\n.superpowers/\n")).toBe(true);
    for (const rule of [
      "!.superpowers/",
      ".superpowers/*",
      "!.superpowers/autopilot/",
      ".superpowers/autopilot/*",
      "!.superpowers/autopilot/configs/",
    ]) {
      expect(text.split("\n")).toContain(rule);
    }
    // Order is the whole mechanism: the negation must land after the
    // pre-existing exclusion or git never re-includes the directory.
    expect(text.indexOf("\n!.superpowers/\n"))
      .toBeGreaterThan(text.indexOf("\n.superpowers/\n"));
  });

  it("writes nothing on a second run", () => {
    const d = deps({ ".gitignore": "node_modules/\n.superpowers/\n" });
    ensureIgnoreRules(".gitignore", d);
    const after = d.files[".gitignore"];
    d.written.length = 0;
    expect(ensureIgnoreRules(".gitignore", d)).toEqual({ path: ".gitignore", changed: false });
    expect(d.written).toEqual([]);
    expect(d.files[".gitignore"]).toBe(after);
  });

  it("creates the rules when there is no .gitignore at all", () => {
    const d = deps({});
    expect(ensureIgnoreRules(".gitignore", d).changed).toBe(true);
    expect(d.files[".gitignore"]).toBe(`${IGNORE_RULES}\n`);
    expect(d.files[".gitignore"].startsWith("#")).toBe(true);
  });

  it("does not glue the block onto an unterminated last line", () => {
    const d = deps({ ".gitignore": "node_modules/" });
    ensureIgnoreRules(".gitignore", d);
    expect(d.files[".gitignore"].split("\n")[0]).toBe("node_modules/");
  });
});
```

**First, repair the existing `scaffoldConfig` harness — it is about to write to the real filesystem.** That describe block's `harness()` helper supplies only `readFile`, `writeFile` and `exists`. Once `scaffoldConfig` gains a `mkdir`, the default `mkdirSync(dirname(path), {recursive:true})` would run for real against `CLAUDE_PROJECT = "/proj/.claude/autopilot.json"` and create `/proj/.claude` at the filesystem root. Add both new dependencies to the harness and record them:

```js
  const harness = ({ present = false } = {}) => {
    const writes = [];
    const reads = [];
    const mkdirs = [];
    return {
      writes,
      reads,
      mkdirs,
      deps: {
        readFile: (p) => {
          reads.push(p);
          return readFileSync(p, "utf8");
        },
        writeFile: (p, text) => {
          writes.push({ path: p, text });
        },
        exists: () => present,
        mkdir: (d) => mkdirs.push(d),
        gitignorePath: "/proj/.gitignore",
      },
    };
  };
```

**Then re-scope the four existing tests in that block**, which the new behaviour moves:

- `expect(returned).toBe(CLAUDE_PROJECT)` becomes `expect(returned.path).toBe(CLAUDE_PROJECT)` — the return is now an object.
- `expect(writes).toHaveLength(1)` becomes `toHaveLength(2)`, because `ensureIgnoreRules` sees `exists: () => false` and appends the block. Assert the second write explicitly rather than loosening the count:

  ```js
    expect(writes[1].path).toBe("/proj/.gitignore");
    expect(writes[1].text).toBe(`${IGNORE_RULES}\n`);
  ```
- `expect(reads).toEqual([CODEX_DEFAULTS])` is unaffected: with `exists` false, `ensureIgnoreRules` never reads.
- The `present: true` overwrite-refusal and the unknown-host and non-object-defaults guards are unaffected: all three throw before any write, and `expect(writes).toEqual([])` still holds.

Then add the two new cases:

```js
  it("creates the config's parent directory before writing", () => {
    // AC6 — .claude/ and .codex/ always existed; configs/ does not.
    const { writes, mkdirs, deps } = harness();
    const result = scaffoldConfig(".superpowers/autopilot/configs/autopilot.json", {
      host: "claude",
      ...deps,
    });
    expect(mkdirs).toEqual([".superpowers/autopilot/configs"]);
    expect(writes[0].path).toBe(".superpowers/autopilot/configs/autopilot.json");
    expect(Object.keys(JSON.parse(writes[0].text))[0]).toBe("test_command");
    expect(JSON.parse(writes[0].text).test_command).toBe("");
    expect(result.path).toBe(".superpowers/autopilot/configs/autopilot.json");
    expect(result.gitignore).toEqual({ path: "/proj/.gitignore", changed: true });
  });

  it("makes no directory and writes nothing when the config already exists", () => {
    // AC6 — the check-then-write gap behind the "never overwrites" claim.
    const { writes, mkdirs, deps } = harness({ present: true });
    expect(() => scaffoldConfig(CLAUDE_PROJECT, { host: "claude", ...deps }))
      .toThrow(/already exists/);
    expect(writes).toEqual([]);
    expect(mkdirs).toEqual([]);
  });
```

Import `ensureIgnoreRules` and `IGNORE_RULES` at the top of the file.

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-config.test.mjs`
Expected: FAIL — `ensureIgnoreRules` is not exported and `scaffoldConfig` neither mkdirs nor returns an object.

- [ ] **Step 3: Implement `IGNORE_RULES` and `ensureIgnoreRules`**

In `plugins/autopilot/scripts/autopilot-config.mjs`, add `import { dirname } from "node:path";` and `mkdirSync` to the `node:fs` import, then add above `scaffoldConfig`:

```js
/**
 * The gitignore rules that make `.superpowers/autopilot/configs/` tracked
 * while everything else under `.superpowers/` stays ignored.
 *
 * git cannot re-include a file whose parent directory is excluded, so each
 * parent is un-ignored before its contents are re-ignored. Appended — never
 * inserted — because the last matching pattern wins, and these have to beat a
 * pre-existing `.superpowers/` line.
 */
export const IGNORE_RULES = [
  "# autopilot keeps its project config under .superpowers/, which is otherwise",
  "# ignored. git cannot un-ignore a file inside an excluded directory, so each",
  "# parent is un-ignored before its contents are re-ignored. Runs stay ignored:",
  "# they are rederived every run and are per-machine.",
  "!.superpowers/",
  ".superpowers/*",
  "!.superpowers/autopilot/",
  ".superpowers/autopilot/*",
  "!.superpowers/autopilot/configs/",
].join("\n");

/** The most specific rule; its presence is what "already done" means. */
const IGNORE_SENTINEL = "!.superpowers/autopilot/configs/";

/**
 * Append `IGNORE_RULES` to `gitignorePath` unless they are already there.
 * Idempotent: rerunning the scaffolder on a project that has the rules
 * changes nothing and reports `changed: false`.
 */
export function ensureIgnoreRules(
  gitignorePath = ".gitignore",
  {
    readFile = (p) => readFileSync(p, "utf8"),
    writeFile = (p, text) => writeFileSync(p, text),
    exists = existsSync,
  } = {},
) {
  const text = exists(gitignorePath) ? readFile(gitignorePath) : "";
  if (text.split("\n").includes(IGNORE_SENTINEL)) {
    return { path: gitignorePath, changed: false };
  }
  const lead = text === "" ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  writeFile(gitignorePath, `${text}${lead}${IGNORE_RULES}\n`);
  return { path: gitignorePath, changed: true };
}
```

- [ ] **Step 4: Extend `scaffoldConfig`**

Replace the options destructure and the write in `scaffoldConfig` so it reads:

```js
export function scaffoldConfig(
  path,
  {
    host = "claude",
    readFile = (p) => readFileSync(p, "utf8"),
    writeFile = (p, text) => writeFileSync(p, text),
    exists = existsSync,
    mkdir = (d) => mkdirSync(d, { recursive: true }),
    gitignorePath = ".gitignore",
  } = {},
) {
  const defaultsPath = hostDefaultsPath(host); // throws on an unknown host
  if (exists(path)) {
    throw new Error(`${path} already exists — refusing to overwrite it`);
  }
  const defaults = readJson(defaultsPath, readFile);
  if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) {
    throw new Error(
      `${defaultsPath} is not a JSON object — the plugin install is incomplete`,
    );
  }
  // `.claude/` and `.codex/` already existed whenever the plugin ran;
  // `.superpowers/autopilot/configs/` does not.
  mkdir(dirname(path));
  writeFile(path, `${JSON.stringify({ test_command: "", ...defaults }, null, 2)}\n`);
  return { path, gitignore: ensureIgnoreRules(gitignorePath, { readFile, writeFile, exists }) };
}
```

Update the JSDoc above it: it currently ends "Returns the written path" — it now returns the written path and the gitignore outcome, and it creates the parent directory and seeds the ignore rules.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-config.test.mjs`
Expected: PASS.

- [ ] **Step 6: Move this repository's own config**

```bash
mkdir -p .superpowers/autopilot/configs
git mv .claude/autopilot.json .superpowers/autopilot/configs/autopilot.json
```

- [ ] **Step 7: Rewrite `.gitignore`**

The file currently ends:

```
.superpowers/

# Ignore .claude/ contents, but not the directory itself — git cannot unignore
# a file inside an excluded directory, and autopilot.json must stay tracked.
.claude/*
# Project config, not personal settings — autopilot's land stage needs it to
# verify a branch, so it has to survive a fresh clone.
!.claude/autopilot.json
```

Replace everything from the `# Ignore .claude/` comment to the end with:

```
# Personal harness settings, not project files.
.claude/*

# autopilot keeps its project config under .superpowers/, which is otherwise
# ignored. git cannot un-ignore a file inside an excluded directory, so each
# parent is un-ignored before its contents are re-ignored. Runs stay ignored:
# they are rederived every run and are per-machine.
!.superpowers/
.superpowers/*
!.superpowers/autopilot/
.superpowers/autopilot/*
!.superpowers/autopilot/configs/
```

Both old comments are falsified by the move — the first names `autopilot.json` as the reason `.claude/` is handled specially, the second explains an un-ignore that no longer exists. `.superpowers/` and the three lines above it stay exactly as they are.

- [ ] **Step 8: Verify the tracking outcome (AC8, AC11)**

```bash
git ls-files --error-unmatch .superpowers/autopilot/configs/autopilot.json
git check-ignore -v .superpowers/autopilot/runs/demo/run.md .superpowers/autopilot/rules.md .superpowers/brainstorm/x .superpowers/sdd/y
test ! -e .claude/autopilot.json && echo "legacy config gone"
git status --porcelain
```

Expected: the first command prints the config path (it is tracked). `git check-ignore -v` prints a matching `.gitignore` line for **all four** paths (they stay ignored). The third prints `legacy config gone`. `git status --porcelain` shows only the renamed config, `.gitignore`, and the source files you edited — no stray `.superpowers/` entries.

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: PASS. No test reads this repository's own `.claude/autopilot.json`, so the move is inert to the suite.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(autopilot): scaffold the config under .superpowers/ and track it

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: The documentation states the new layout, and SKILL.md stays under its ceiling

Satisfies AC9, AC10.

**Files:**
- Modify: `README.md` (8 sites)
- Modify: `plugins/autopilot/skills/autopilot/SKILL.md` (23 run paths, 5 config mentions, preflight step 4, the session-cap extraction)
- Modify: `plugins/autopilot/skills/autopilot-github/SKILL.md` (12 sites)
- Modify: `plugins/autopilot/skills/autopilot-brainstorm/SKILL.md:136`
- Modify: `plugins/autopilot/commands/autopilot-findings.md` (lines 18, 19, 20, 28 — **not** 47 or 84)
- Modify: `plugins/autopilot/skills/autopilot/references/stages/claude-dispatch.md:6`
- Modify: `plugins/autopilot/skills/autopilot/references/stages/codex-dispatch.md:10,13`
- Modify: `plugins/autopilot/skills/autopilot/references/stages/verify-run.md:12,62,72`
- Modify: `plugins/autopilot/skills/autopilot/references/dispatch/learnings.md:3,8`
- Modify: `plugins/autopilot/skills/autopilot/references/dispatch/sdd-findings.md:4`
- Modify: `plugins/autopilot/skills/autopilot/references/dispatch/sdd-model-map.md:3`
- Modify: `plugins/autopilot/skills/autopilot/references/dispatch/sdd-verification.md:4`
- Modify: `plugins/autopilot/scripts/autopilot-verify-contract.test.mjs:117,203,331`
- Modify: `plugins/autopilot/scripts/autopilot-codex-contract.test.mjs:73,90-92,111`
- Modify: `plugins/autopilot/scripts/autopilot-config-scaffold-contract.test.mjs`

**Interfaces:**
- Consumes: `outputPath` / `codexOutputPath` (Task 2) — `claude-dispatch.md` and `codex-dispatch.md` quote what those now print; `scaffoldConfig`'s `{ path, gitignore }` return (Task 3) — preflight step 4 reports both halves.
- Produces: nothing later tasks consume.

**The size budget.** `SKILL.md` is 41,918 chars against a `< 42_000` ceiling in `skill-sections.test.mjs:297` — **82 chars of headroom**, and the path substitutions alone add 237. The budget is closed three ways, all specified below; the measured result is **~41,800 chars, ~200 chars of headroom**. Run the measurement in Step 7 and do not commit a larger file.

- [ ] **Step 1: Rewrite the run paths across every document**

In each of the twelve markdown files, replace `.superpowers/autopilot/<X>` with `.superpowers/autopilot/runs/<X>` for every run-scoped path — `<run>`, `<branch>`, and the `*` glob alike. Exactly two strings under this root are **not** run paths and must not be touched:

- `.superpowers/autopilot/rules.md` — `commands/autopilot-findings.md` lines 47 and 84.
- `.superpowers/autopilot/configs/...` — anything you write in Step 2.

Named sites that carry a behavioural consequence:

- `references/dispatch/learnings.md:8` — the corpus glob becomes `.superpowers/autopilot/runs/*/findings.jsonl`. Left as `.superpowers/autopilot/*/findings.jsonl` it would match the `runs` directory itself and read no findings at all.
- `skills/autopilot-github/SKILL.md:122` — `--write-ledger .superpowers/autopilot` becomes `--write-ledger .superpowers/autopilot/runs`. This flag is a **root**, not a run directory; the script appends `/<run>` itself. Task 2 already moved the matching fixtures in `autopilot-github-issue.test.mjs`.
- `commands/autopilot-findings.md:19-20` — the two report roots become `.superpowers/autopilot/runs`.

- [ ] **Step 2: Rewrite the config paths**

New literals: `.superpowers/autopilot/configs/autopilot.json` (Claude), `.superpowers/autopilot/configs/autopilot.codex.json` (Codex).

In `skills/autopilot/SKILL.md`, only the preflight host table (lines 72-73) spells a literal:

```
   | Claude Code | `claude` | `.superpowers/autopilot/configs/autopilot.json` |
   | Codex | `codex` | `.superpowers/autopilot/configs/autopilot.codex.json` |
```

The other three mentions in that file (line 185's `config` source-of-truth table row, line 329's session-caps sentence, line 670's artifacts sentence) become the existing `` `<config>` `` placeholder. That is both correct — the file is host-neutral everywhere below preflight, and naming the Claude file there was already a latent Codex bug — and 42 chars cheaper.

Everywhere else, substitute the literal for the host that document already names: `.claude/autopilot.json` → the Claude path, `.codex/autopilot.json` → the Codex path. That covers `README.md` (8), `skills/autopilot-github/SKILL.md`, `skills/autopilot-brainstorm/SKILL.md:136`, `commands/autopilot-findings.md:18,28`, `references/stages/codex-dispatch.md:10`, `references/dispatch/sdd-model-map.md:3`, `references/dispatch/sdd-verification.md:4`.

- [ ] **Step 3: Sweep the prose each edit falsifies**

Path substitution is not the whole change. In every file you touched, re-read the sentences around each edit for a claim the move makes false. Known sites:

- `README.md:31-33` — "Codex reads project overrides from `.codex/autopilot.json` … Claude **keeps using** `.claude/autopilot.json`; the files do not replace each other." The contrast is now between two filenames in one directory, not two harness directories. Rewrite it to say so.
- `README.md:183-184` — "the selected host config file (`…` on Claude, `…` on Codex)" — the parenthetical still works with the new literals; check the surrounding sentence still reads correctly.
- `README.md:229` — "No credential goes in `.claude/autopilot.json`" → the new Claude path.
- `commands/autopilot-findings.md:28` — "`findings_threshold` comes from `.claude/autopilot.json`" → new path.
- `skills/autopilot-github/SKILL.md:64-66` — the paragraph explaining how `<config>` is selected names both harness directories; both become the `configs/` filenames.

Add nothing about migration prompts: the fallback is a read path, and no document instructs anyone to move anything except preflight step 4.

- [ ] **Step 4: Rewrite preflight step 4 (AC10)**

In `skills/autopilot/SKILL.md`, the scaffold-branch paragraph currently reads:

```
   Then report the created path, say that `test_command` must be filled in
   before rerunning `/autopilot`, and stop the run — do not start the
   brainstorm. The file is left uncommitted on the current branch; committing
   it is the developer's decision. A non-zero exit here (the directory is
```

Replace it with:

```
   Then report the created path and whether `.gitignore` changed, say that
   `test_command` must be filled in before rerunning `/autopilot`, and stop the
   run — do not start the brainstorm. Commit the config: a worktree contains
   only committed files, and the stage agents run inside one. A non-zero exit
   here (the directory is
```

Keep `report the created path`, `` `test_command` must be filled in before rerunning `/autopilot` `` and `stop the run — do not start the brainstorm` as contiguous substrings: `autopilot-config-scaffold-contract.test.mjs` matches all three against whitespace-normalised text, and they must survive whatever line wrapping you choose.

Then, in `autopilot-config-scaffold-contract.test.mjs`, replace

```js
    expect(skill).toContain("The file is left uncommitted on the current branch");
```

with

```js
    // AC10 — a config the worktree cannot see is a config the stage agents
    // cannot read, so the scaffold branch now ends in a commit instruction.
    expect(skill).toContain("Commit the config");
    expect(skill).not.toContain("left uncommitted");
```

and rename that `it` to `"reports the created path and the commit instruction, then stops"`. Match the assertion string against the file exactly as you wrapped it — whitespace is normalised, so `Commit the config` is safe across a wrap, but re-run the test rather than assuming.

- [ ] **Step 5: Free the size budget**

Three sentences in `SKILL.md`'s `### The session cap` section are pure rationale and are **already stated in full** in `references/rationale.md` under `## The session cap` (lines 313-315, 346-349, 358-378). Delete them from `SKILL.md`; add nothing to `rationale.md` — nothing is lost.

1. Drop the opening clause, so the section starts at the instruction:

   before: `A session's cost grows with the square of its own length, so no one session`<br>`carries a whole run. **After appending a stage's completion line, …**`<br>
   after: `**After appending a stage's completion line, record your size and hand off if you are over cap:**`

2. Truncate the boundary rule to the rule:

   before: ``Check at a stage boundary only, never mid-stage: a session that stops halfway``<br>``through `sdd` hands its successor no way to pick up, and the stage is redone.``<br>
   after: `Check at a stage boundary only, never mid-stage.`

3. Truncate the `on_cap` sentence to its behaviour:

   before: ``` `on_cap: continue` makes `record` never ask for a handoff — for unattended runs, where a stop is a stall until someone types `resume`. ```<br>
   after: ``` `on_cap: continue` makes `record` never ask for a handoff. ```

No test asserts any of these three — verified against every `*.test.mjs` in `plugins/autopilot/scripts/`. Do not touch the `**After appending…**`, `handoff: false` / `handoff: true` bullets, or `Obey the `handoff` field; never read the policy yourself.` — those are instructions, not rationale.

- [ ] **Step 6: Update the doc-literal contract tests**

`plugins/autopilot/scripts/autopilot-verify-contract.test.mjs`:

```js
    expect(verify).toContain(".superpowers/autopilot/runs/<run>/verify/");            // line 117
    expect(verify).toContain(".superpowers/autopilot/runs/<run>/verify/recipe.json"); // line 203
    expect(plan).toContain(".superpowers/autopilot/runs/<run>/verify/recipe.json");   // line 331
```

`plugins/autopilot/scripts/autopilot-codex-contract.test.mjs` — all three of these break silently otherwise, because `autopilot.codex.json` does not contain the substring `.codex/autopilot.json`:

```js
    expect(flat).toContain(
      "--config=.superpowers/autopilot/configs/autopilot.codex.json",           // line 73
    );
```
```js
      expect(command).toMatch(                                                   // lines 90-92
        /--config=(?:<config>|\.superpowers\/autopilot\/configs\/autopilot\.codex\.json)/,
      );
```
```js
    expect(flat).toContain(".superpowers/autopilot/configs/autopilot.codex.json"); // line 111
```

- [ ] **Step 7: Measure SKILL.md against its ceiling**

```bash
node -e "console.log(require('fs').readFileSync('plugins/autopilot/skills/autopilot/SKILL.md','utf8').length)"
```

Expected: a number under 42,000 — around 41,800. If it is over, take the next cut from `references/rationale.md`-duplicated prose in `SKILL.md`; do not raise the ceiling in `skill-sections.test.mjs`.

- [ ] **Step 8: Confirm no legacy path survives in documentation (AC9)**

```bash
grep -rn "\.claude/autopilot\.json\|\.codex/autopilot\.json" README.md plugins/autopilot/skills plugins/autopilot/commands
grep -rn "\.superpowers/autopilot/" README.md plugins/autopilot/skills plugins/autopilot/commands | grep -v "/runs\|/configs\|/rules\.md"
```

Expected: the first prints nothing. The second prints nothing — every remaining mention is a `runs` path (with or without a trailing segment, since two sites pass the bare root), a `configs/` path, or `rules.md`. Any other hit is an unconverted site; fix it and rerun.

- [ ] **Step 9: Run the full suite**

Run: `npm test`
Expected: PASS, at or above the 910-test baseline.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "docs(autopilot): state the new config and run paths everywhere

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Cross-task seams

Per-task review sees one diff. These are the couplings no single diff exposes — check them at whole-branch review:

1. **`autopilot-codex-contract.test.mjs` is edited by two tasks.** Task 2 owns the `codexOutputPath` expectation (line 63-64, script behaviour); Task 4 owns the three assertions that read `codex-dispatch.md` and `autopilot-github/SKILL.md` (lines 73, 90-92, 111). Both must be present at the end; neither task may touch the other's.
2. **The `--write-ledger` root crosses Tasks 2 and 4.** The value is `.superpowers/autopilot/runs`, written in `skills/autopilot-github/SKILL.md:122` (Task 4) and asserted in `autopilot-github-issue.test.mjs` (Task 2). If they disagree, GitHub-driven runs write their ledger to the deprecated directory and every later stage's `resolveRunDir` quietly reports `legacy: true`.
3. **`scaffoldConfig`'s return type crosses Tasks 3 and 4.** Task 3 changes it to `{ path, gitignore }`; Task 4's preflight prose says to report both. The invocation string in SKILL.md does not change, so nothing fails loudly if Task 4 forgets — read the paragraph.
4. **`outputPath` / `codexOutputPath` cross Tasks 2 and 4.** `references/stages/claude-dispatch.md:6` and `codex-dispatch.md:13` state what the script prints. If the script says `runs/` and the document says otherwise, an orchestrator looks for the artifact in the wrong place.
5. **The `configs/` literal is spelled in three independent places** — `autopilot-host.mjs` (Task 1), `IGNORE_RULES` (Task 3), and the documents (Task 4). A typo in any one of them is invisible to the others: `IGNORE_RULES` would track a directory nothing writes to, and `git status` would show the config as untracked. Step 8 of Task 3 is the check that catches it.

## Self-review

**Spec coverage.** AC1 → Task 1 Step 5/7. AC2 → Task 1 (module) + Task 2 Steps 4-5. AC3 → Task 1 Steps 9-11. AC4 → Task 2 Steps 1-2, 4-5. AC5 → Task 1 Steps 1-3. AC6 → Task 3 Steps 1, 4. AC7 → Task 3 Steps 1, 3. AC8 → Task 3 Steps 7-8. AC9 → Task 4 Steps 1-3, 8. AC10 → Task 4 Step 4. AC11 → Task 3 Steps 6-8. AC12 → Global Constraints, plus `git status --porcelain` in Task 3 Step 8. AC13 → the `npm test` step closing each task.

**Out of scope, confirmed absent from every task:** the `configs/test-data.md` convention. Nothing in this plan creates, reads, or documents it.
