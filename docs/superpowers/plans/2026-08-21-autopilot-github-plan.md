# autopilot-github: GitHub Issues + Projects v2 Wrapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `autopilot-github` skill that takes a GitHub issue number or URL, resolves it into autopilot's task description and run name, then drives `autopilot:autopilot` unchanged while moving the issue's Projects v2 card and commenting on the issue at each transition.

**Architecture:** One new Node helper, `plugins/autopilot/scripts/autopilot-github-issue.mjs`, in the same style as `autopilot-land.mjs` and `autopilot-sync-base.mjs`: pure, injectable functions plus a thin `main()` CLI, with every `gh` call reached through an injected runner returning `{ code, stdout, stderr }`. One new prose skill, `plugins/autopilot/skills/autopilot-github/SKILL.md`, that is a **thin wrapper** — it invokes `autopilot:autopilot` in the same session and layers four deltas at four anchors, restating none of the pipeline. `autopilot-config.mjs` gains a `github` per-key merge branch and a `validateGithubConfig` export; `autopilot.default.json` gains a `github` block carrying only the four non-project-specific keys. Both manifests bump to 1.6.0.

**Tech Stack:** Node ESM (`.mjs`, stdlib only), vitest 3.2, Claude Code plugin (skills), `gh` CLI via `spawnSync`.

**Spec:** `docs/superpowers/specs/2026-08-21-autopilot-github-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Test command:** `npm test` (vitest). Run from the repository root.
- **Baseline:** 175 tests passing across 10 files. Do not weaken, delete, or loosen any existing test. Every task must leave the full suite green.
- **Node helpers** live in `plugins/autopilot/scripts/` with colocated `.test.mjs` vitest files. ESM only (`"type": "module"` at the repo root). **Standard library only** — the plugin ships with zero runtime dependencies and vitest is the sole devDependency. Do not add a package.
- **Dependency injection, always.** Scripts are pure functions plus a thin `main()`, with `gh`/`git`/filesystem dependencies injected so tests need no live git repo, no network, and no `gh` session. Copy the shape `autopilot-land.mjs` uses: `run(args) -> { code, stdout, stderr }`.
- **The `main()` guard is `pathToFileURL(process.argv[1])`**, never a `file://` template — a space in the plugin's install path silently skips `main()`. Copy the existing comment.
- **No change to the `autopilot` skill's pipeline.** `plugins/autopilot/skills/autopilot/SKILL.md` is **not modified by this plan at all**. The wrapper uses it as-is.
- **Every wrapper ledger line starts with `github: `.** These are the exactly five strings, and they are exported from the script as `GITHUB_LEDGER_LINES` so the prose and the tests share one source of truth:
  - `github: moved to in-progress`
  - `github: start comment posted`
  - `github: moved to in-review`
  - `github: pr comment posted`
  - `github: parked comment posted`
- **The PARKED ordering constraint is load-bearing.** The park comment and its `github: parked comment posted` line are appended **before** the `PARKED — <reason>` line, never after. `nextStage` detects a park only when `PARKED` starts the ledger's **last** entry.
- **`github` must NOT join `TOP_LEVEL` in `validateConfig`.** That list is a hard error on absence; adding `github` there breaks every plain `/autopilot` run in a project with no board.
- **`project_owner` and `project_number` get no default**, for the same reason `test_command` has none: they are irreducibly project-specific and a guessed value fails confusingly.
- **Version bump to `1.6.0`** in BOTH `plugins/autopilot/.claude-plugin/plugin.json` AND `.claude-plugin/marketplace.json` — and in marketplace.json in BOTH places: `metadata.version` and the `plugins[0].version` entry. Three existing assertions in `autopilot-findings-contract.test.mjs` pin `1.5.0`; they must be updated in the same task, or the suite goes red.

---

## File Structure

**Created:**

- `plugins/autopilot/scripts/autopilot-github-issue.mjs` — the whole GitHub surface. Owns slug/run-name derivation, task-description assembly, `gh issue view` wrapping, Projects v2 item/field/option resolution, the item-edit move, the issue comment, config preflight, and the `GITHUB_LEDGER_LINES` constant. One file because these all share the injected `gh` runner and are all consumed by one caller.
- `plugins/autopilot/scripts/autopilot-github-issue.test.mjs` — colocated vitest coverage for the above.
- `plugins/autopilot/scripts/autopilot-github-ledger-coupling.test.mjs` — pins that `github: ` lines are inert to `nextStage`, and that the PARKED ordering is what makes a parked run detectable. A new file rather than an extension of `autopilot-ledger-coupling.test.mjs`, which stays focused on autopilot's own eight entries.
- `plugins/autopilot/scripts/autopilot-github-contract.test.mjs` — prose guard test over the new SKILL.md, in the style of `autopilot-sdd-contract.test.mjs`.
- `plugins/autopilot/skills/autopilot-github/SKILL.md` — the thin wrapper.

**Modified:**

- `plugins/autopilot/scripts/autopilot-config.mjs` — `GITHUB_KEYS`, `validateGithubConfig`, and a `github` branch in `mergeConfig`.
- `plugins/autopilot/scripts/autopilot-config.test.mjs` — coverage for the above.
- `plugins/autopilot/autopilot.default.json` — a `github` block with the four status keys.
- `plugins/autopilot/.claude-plugin/plugin.json` — version `1.6.0`.
- `.claude-plugin/marketplace.json` — version `1.6.0` in both places.
- `plugins/autopilot/scripts/autopilot-findings-contract.test.mjs` — the three `1.5.0` assertions become `1.6.0`.
- `README.md` — the `### autopilot` section.

**Not modified:** `plugins/autopilot/skills/autopilot/SKILL.md`, `autopilot-ledger.mjs`, `autopilot-land.mjs`, `autopilot-reaper.mjs`, `autopilot-sync-base.mjs`, `autopilot-findings.mjs`. `plugin.json` already declares `"skills": ["./skills/"]`, so the new skill directory is picked up with no manifest change beyond the version.

**Task order rationale.** Task 1 is the config foundation both the script and the wrapper's preflight depend on. Tasks 2 and 3 split the script where a reviewer can meaningfully reject one and approve the other: Task 2 is the issue-side half (pure derivation plus `gh issue view`), which needs no board at all and ends with a working `resolve`/`preflight` CLI; Task 3 is the board-side half (Projects v2 item, field, option, item-edit, comment), a different `gh` surface with its own failure taxonomy. Merged, they are a ~500-line diff whose size defeats task review — rule 3 of the budget. Task 4 pins the ledger-coupling claim the whole design rests on, against code that already exists, before any prose asserts it. Task 5 writes the wrapper and its prose guard together, because a prose contract and the test pinning it cannot be reviewed apart. Task 6 is release metadata plus docs — unrelated files (JSON manifests, README), and it must also fix an existing test that hardcodes the old version.

Six tasks, inside the 5–8 budget.

---

### Task 1: `github` config block — defaults, merge, and validation

Extend the config loader so a project can supply just `project_owner` and `project_number` and inherit the four status names, and so both the wrapper's preflight and the script's own subcommands fail on one shared check. Plain `/autopilot` in a project with no board must be completely unaffected.

**Files:**
- Modify: `plugins/autopilot/scripts/autopilot-config.mjs`
- Modify: `plugins/autopilot/scripts/autopilot-config.test.mjs`
- Modify: `plugins/autopilot/autopilot.default.json`

**Interfaces:**
- Consumes: `mergeConfig`, `validateConfig`, `loadConfig` as they exist today.
- Produces:
  - `GITHUB_KEYS: string[]` — the six keys the wrapper needs, in order: `project_owner`, `project_number`, `status_field`, `status_ready`, `status_in_progress`, `status_in_review`.
  - `validateGithubConfig(config: object): string[]` — the names of the missing keys, empty when complete. Never throws.
  - `mergeConfig(defaults, project)` additionally merges `github` per key.
  - The shipped `autopilot.default.json` carries `github.status_field`, `github.status_ready`, `github.status_in_progress`, `github.status_in_review` and **neither** project key.

- [ ] **Step 1: Write the failing tests**

Append to `plugins/autopilot/scripts/autopilot-config.test.mjs`. Also add `validateGithubConfig` and `GITHUB_KEYS` to the existing import at the top of the file, so line 2 becomes:

```js
import {
  ROLES, EFFORTS, GITHUB_KEYS,
  validateConfig, validateGithubConfig, mergeConfig, loadConfig,
} from "./autopilot-config.mjs";
```

And add these imports below it (the real-defaults assertion at the end needs them):

```js
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
```

Then append this block to the end of the file:

```js
// The `github` block powers the autopilot-github wrapper only. Two properties
// have to hold at once: a project that supplies just the two irreducibly
// project-specific keys must keep the four default status names (otherwise the
// shallow top-level merge silently drops them), and a project with no `github`
// block at all must keep loading exactly as before — plain /autopilot has no
// board and must not start erroring.

const validGithub = () => ({
  project_owner: "BoTime",
  project_number: 7,
  status_field: "Status",
  status_ready: "Ready",
  status_in_progress: "In Progress",
  status_in_review: "In Review",
});

describe("validateGithubConfig", () => {
  it("returns an empty list for a complete github block", () => {
    expect(validateGithubConfig({ github: validGithub() })).toEqual([]);
  });

  it("names every key when the block is absent entirely", () => {
    expect(validateGithubConfig({})).toEqual(GITHUB_KEYS);
  });

  it("names every key when the block is not an object", () => {
    expect(validateGithubConfig({ github: "yes" })).toEqual(GITHUB_KEYS);
  });

  it("names only the keys that are actually missing", () => {
    const github = validGithub();
    delete github.project_owner;
    delete github.status_in_review;
    expect(validateGithubConfig({ github })).toEqual([
      "project_owner",
      "status_in_review",
    ]);
  });

  it("treats an empty string as missing", () => {
    // A key present but blank fails at gh-call time with a confusing message.
    // Catching it in preflight is the whole point of the check.
    expect(validateGithubConfig({ github: { ...validGithub(), status_ready: "" } }))
      .toEqual(["status_ready"]);
  });

  it("does not throw on a null config", () => {
    expect(validateGithubConfig(null)).toEqual(GITHUB_KEYS);
  });
});

describe("mergeConfig with github", () => {
  it("merges github per key so a project supplying only the two project keys keeps the status names", () => {
    const defaults = {
      ...validConfig(),
      github: {
        status_field: "Status",
        status_ready: "Ready",
        status_in_progress: "In Progress",
        status_in_review: "In Review",
      },
    };
    const merged = mergeConfig(defaults, {
      github: { project_owner: "BoTime", project_number: 7 },
    });
    expect(merged.github).toEqual(validGithub());
  });

  it("lets a project override one status name and keep the rest", () => {
    const defaults = { ...validConfig(), github: validGithub() };
    const merged = mergeConfig(defaults, { github: { status_in_review: "Review" } });
    expect(merged.github.status_in_review).toBe("Review");
    expect(merged.github.status_ready).toBe("Ready");
    expect(merged.github.project_owner).toBe("BoTime");
  });

  it("leaves github absent when neither layer supplies one", () => {
    const merged = mergeConfig(validConfig(), { test_command: "npm test" });
    expect(merged.github).toBeUndefined();
  });

  it("does not mutate the defaults' github block", () => {
    const defaults = { ...validConfig(), github: validGithub() };
    mergeConfig(defaults, { github: { status_ready: "Backlog" } });
    expect(defaults.github.status_ready).toBe("Ready");
  });
});

describe("github is not a hard requirement", () => {
  it("validateConfig accepts a config with no github block", () => {
    // github in TOP_LEVEL would break every plain /autopilot run in a project
    // with no board. This is the test that stops someone adding it there.
    const result = validateConfig(validConfig(), {});
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("loadConfig warns about nothing new when the project has no github block", () => {
    const readFile = (p) => {
      if (p !== "/plugin/autopilot.default.json") throw new Error("ENOENT");
      return JSON.stringify({ ...validConfig(), github: { status_ready: "Ready" } });
    };
    const { config, warnings } = loadConfig(
      "/proj/.claude/autopilot.json", {}, readFile, "/plugin/autopilot.default.json",
    );
    expect(warnings).toEqual([]);
    expect(config.github).toEqual({ status_ready: "Ready" });
  });
});

describe("shipped autopilot.default.json", () => {
  const defaults = JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "autopilot.default.json"),
      "utf8",
    ),
  );

  it("ships the four non-project-specific github keys", () => {
    expect(defaults.github).toEqual({
      status_field: "Status",
      status_ready: "Ready",
      status_in_progress: "In Progress",
      status_in_review: "In Review",
    });
  });

  it("ships no default for the two project-specific keys", () => {
    // Same reason test_command has no default: a guessed owner or board number
    // fails confusingly instead of failing at preflight with the key's name.
    expect(defaults.github.project_owner).toBeUndefined();
    expect(defaults.github.project_number).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-config.test.mjs`
Expected: FAIL — `validateGithubConfig is not a function`, plus the two `shipped autopilot.default.json` assertions failing on `defaults.github` being `undefined`.

- [ ] **Step 3: Add the github keys and validator to the config loader**

In `plugins/autopilot/scripts/autopilot-config.mjs`, immediately after the `EFFORTS` export (line 8) and before the `TOP_LEVEL` constant, insert:

```js
/**
 * The `github` keys the autopilot-github wrapper needs, in report order.
 *
 * Deliberately NOT part of `TOP_LEVEL` below: that list is a hard error on
 * absence, so listing `github` there would break every plain `/autopilot` run
 * in a project that has no board. The wrapper's preflight and the board-
 * touching subcommands of autopilot-github-issue.mjs call the validator below
 * instead, so both fail on exactly the same check.
 */
export const GITHUB_KEYS = [
  "project_owner", "project_number", "status_field",
  "status_ready", "status_in_progress", "status_in_review",
];

/** Names the `github` keys no config layer supplied. Empty means complete. */
export function validateGithubConfig(config) {
  const github = config?.github;
  if (!github || typeof github !== "object") return [...GITHUB_KEYS];
  return GITHUB_KEYS.filter((key) => {
    const value = github[key];
    return value === undefined || value === null || value === "";
  });
}
```

- [ ] **Step 4: Add the `github` merge branch**

In the same file, inside `mergeConfig`, immediately after the existing `roles` block and before `return merged;`, insert:

```js
  // Same per-key treatment as `roles`, and for the same reason: the top-level
  // merge is shallow, so a project supplying only `project_owner` and
  // `project_number` would replace the block wholesale and lose all four
  // default status names.
  if (defaults.github || project.github) {
    merged.github = { ...defaults.github, ...(project.github ?? {}) };
  }
```

- [ ] **Step 5: Add the `github` block to the shipped defaults**

In `plugins/autopilot/autopilot.default.json`, change the trailing keys so the file reads:

```json
{
  "roles": {
    "brainstorm":        { "model": "opus",   "effort": "high" },
    "spec":              { "model": "opus",   "effort": "high" },
    "plan":              { "model": "opus",   "effort": "high" },
    "implement":         { "model": "sonnet", "effort": "medium" },
    "implement_complex": { "model": "opus",   "effort": "high" },
    "task_review":       { "model": "sonnet", "effort": "medium" },
    "re_review":         { "model": "sonnet", "effort": "medium" },
    "final_review":      { "model": "opus",   "effort": "high" },
    "fix_escalation":    { "model": "opus",   "effort": "high" }
  },
  "worktree_dir": ".claude/worktrees",
  "base_ref": "origin/main",
  "reaper": true,
  "findings_threshold": 2,
  "github": {
    "status_field": "Status",
    "status_ready": "Ready",
    "status_in_progress": "In Progress",
    "status_in_review": "In Review"
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-config.test.mjs`
Expected: PASS — 43 tests (29 existing + 14 new).

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS — 189 tests across 10 files (175 baseline + 14 new).

- [ ] **Step 8: Commit**

```bash
git add plugins/autopilot/scripts/autopilot-config.mjs plugins/autopilot/scripts/autopilot-config.test.mjs plugins/autopilot/autopilot.default.json
git commit -m "feat(autopilot): add a github config block with per-key merge and validation"
```

---

### Task 2: The issue side of the script — derivation, `resolve`, `preflight`

Build the half of `autopilot-github-issue.mjs` that needs no board: slug and run-name derivation, task-description and ledger-header assembly, the `gh issue view` wrapper, the config preflight, and the `GITHUB_LEDGER_LINES` constant — plus a `main()` CLI serving `resolve` and `preflight`.

The slug lives in code, not prose, because it is the ledger directory's key: prose rules re-applied by a different session on resume can produce a different string and orphan the run.

**Files:**
- Create: `plugins/autopilot/scripts/autopilot-github-issue.mjs`
- Create: `plugins/autopilot/scripts/autopilot-github-issue.test.mjs`

**Interfaces:**
- Consumes: `validateGithubConfig`, `loadConfig` from `./autopilot-config.mjs` (Task 1).
- Produces:
  - `GITHUB_LEDGER_LINES: string[]` — the five `github: ` ledger lines, in pipeline order.
  - `slugify(title: string): string`
  - `runName(number: number|string, title: string): string`
  - `ledgerTask(issue: {number, title}): string` — single-line by construction.
  - `taskDescription(issue: {number, title, body}): string`
  - `resolveIssue(issueArg: string, gh): {number, title, url, run, task}` — throws on a non-zero `gh` exit.
  - `preflightGithub(config): {ok: boolean, missing: string[], message: string}`
  - `main(argv, gh, load)` — Task 3 extends it with `move` and `comment`.
  - `gh` throughout is `(args: string[]) => {code: number, stdout: string, stderr: string}`.

- [ ] **Step 1: Write the failing test**

Create `plugins/autopilot/scripts/autopilot-github-issue.test.mjs`:

```js
// The issue side of autopilot-github-issue.mjs: everything derivable from
// `gh issue view`, with no Projects v2 board involved.
//
// The slug is the load-bearing piece. It is the ledger directory's key, so a
// resumed run that re-derives a different slug points at a different directory
// and loses the run. That is why it lives in code with a stability test, not in
// the wrapper's prose.
//
// Every gh call goes through an injected runner with the {code, stdout, stderr}
// shape autopilot-land.mjs's run() already uses — no network, no gh session.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  GITHUB_LEDGER_LINES,
  slugify,
  runName,
  ledgerTask,
  taskDescription,
  resolveIssue,
  preflightGithub,
  main,
} from "./autopilot-github-issue.mjs";

const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
const fail = (stderr = "") => ({ code: 1, stdout: "", stderr });

/** Records every gh invocation so a test can assert the exact argument list. */
function fakeGh(handler) {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    return handler(args);
  };
  gh.calls = calls;
  return gh;
}

const ISSUE = {
  number: 42,
  title: "CSV export drops unicode",
  body: "Steps:\n\n1. export\n2. open in Excel",
  url: "https://github.com/BoTime/custom_toolkit/issues/42",
};

const CONFIG = {
  github: {
    project_owner: "BoTime",
    project_number: 7,
    status_field: "Status",
    status_ready: "Ready",
    status_in_progress: "In Progress",
    status_in_review: "In Review",
  },
};

describe("GITHUB_LEDGER_LINES", () => {
  it("lists the five lines the wrapper's hooks append, all github:-prefixed", () => {
    expect(GITHUB_LEDGER_LINES).toEqual([
      "github: moved to in-progress",
      "github: start comment posted",
      "github: moved to in-review",
      "github: pr comment posted",
      "github: parked comment posted",
    ]);
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates an ordinary title", () => {
    expect(slugify("CSV export drops unicode")).toBe("csv-export-drops-unicode");
  });

  it("collapses runs of non-alphanumerics into one hyphen and strips the ends", () => {
    expect(slugify("  ***Fix: the (broken) thing!!  ")).toBe("fix-the-broken-thing");
  });

  it("truncates to 40 characters and strips the hyphen the cut leaves behind", () => {
    // The 41st character is a space, so a naive truncate would leave "...-".
    const slug = slugify("aaaaaaaaaa bbbbbbbbbb cccccccccc dddddddddd eeeeeeeeee");
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
    expect(slug).toBe("aaaaaaaaaa-bbbbbbbbbb-cccccccccc-ddddddd");
  });

  it("returns an empty string for a title that is entirely punctuation", () => {
    expect(slugify("!!! ??? ---")).toBe("");
  });

  it("is stable — the same title always yields the same slug", () => {
    // Resume depends on this: a second derivation that differs orphans the run.
    const title = "Fix: CSV export drops unicode (again)";
    expect(slugify(title)).toBe(slugify(title));
  });
});

describe("runName", () => {
  it("combines the issue number and the slug", () => {
    expect(runName(42, "CSV export drops unicode")).toBe(
      "issue-42-csv-export-drops-unicode",
    );
  });

  it("falls back to issue-<n> when the title is entirely punctuation", () => {
    expect(runName(42, "!!! ???")).toBe("issue-42");
  });

  it("falls back to issue-<n> for a title with no ASCII alphanumerics", () => {
    expect(runName(7, "日本語のタイトル")).toBe("issue-7");
  });
});

describe("ledgerTask and taskDescription", () => {
  it("builds the task description as header, blank line, body", () => {
    expect(taskDescription(ISSUE)).toBe(
      "GitHub issue #42: CSV export drops unicode\n\nSteps:\n\n1. export\n2. open in Excel",
    );
  });

  it("omits the blank line and body for an issue with an empty body", () => {
    expect(taskDescription({ ...ISSUE, body: "" })).toBe(
      "GitHub issue #42: CSV export drops unicode",
    );
    expect(taskDescription({ ...ISSUE, body: undefined })).toBe(
      "GitHub issue #42: CSV export drops unicode",
    );
  });

  it("keeps the ledger header single-line no matter how long the body is", () => {
    // autopilot-ledger.mjs's HEADER regex is single-line. A multi-line header
    // strands the body as untimestamped lines that parseLedger silently drops.
    const header = ledgerTask(ISSUE);
    expect(header).toBe("GitHub issue #42: CSV export drops unicode");
    expect(header).not.toContain("\n");
    expect(taskDescription(ISSUE).startsWith(header)).toBe(true);
  });

  it("collapses whitespace inside a title so the header cannot break the regex", () => {
    expect(ledgerTask({ number: 9, title: "one\ntwo   three" })).toBe(
      "GitHub issue #9: one two three",
    );
  });
});

describe("resolveIssue", () => {
  it("wraps gh issue view and returns number, title, url, run, and task", () => {
    const gh = fakeGh(() => ok(JSON.stringify(ISSUE)));
    const resolved = resolveIssue("42", gh);
    expect(gh.calls[0]).toEqual([
      "issue", "view", "42", "--json", "number,title,body,url",
    ]);
    expect(resolved).toEqual({
      number: 42,
      title: "CSV export drops unicode",
      url: "https://github.com/BoTime/custom_toolkit/issues/42",
      run: "issue-42-csv-export-drops-unicode",
      task: "GitHub issue #42: CSV export drops unicode\n\nSteps:\n\n1. export\n2. open in Excel",
    });
  });

  it("passes a full issue URL through to gh unchanged", () => {
    // gh accepts both forms, so the argument needs no parsing on our side.
    const gh = fakeGh(() => ok(JSON.stringify(ISSUE)));
    resolveIssue(ISSUE.url, gh);
    expect(gh.calls[0][2]).toBe(ISSUE.url);
  });

  it("throws with gh's message when gh exits non-zero — never a silent success", () => {
    const gh = fakeGh(() => fail("gh: issue not found"));
    expect(() => resolveIssue("999", gh)).toThrow(/issue not found/);
  });
});

describe("preflightGithub", () => {
  it("reports ok for a complete github block", () => {
    const result = preflightGithub(CONFIG);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.message).toBe("ok");
  });

  it("names exactly the missing keys", () => {
    const github = { ...CONFIG.github };
    delete github.project_number;
    const result = preflightGithub({ github });
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["project_number"]);
    expect(result.message).toContain("project_number");
    expect(result.message).toContain(".claude/autopilot.json");
  });
});

describe("main — resolve and preflight", () => {
  // main() sets process.exitCode only on failure, and Node leaves it undefined
  // until something sets it — so the success cases need it zeroed up front.
  beforeEach(() => {
    process.exitCode = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  const capture = () => {
    const out = [];
    vi.spyOn(console, "log").mockImplementation((m) => out.push(String(m)));
    vi.spyOn(console, "error").mockImplementation((m) => out.push(String(m)));
    return out;
  };

  it("resolve prints the JSON object", () => {
    const out = capture();
    const gh = fakeGh(() => ok(JSON.stringify(ISSUE)));
    main(["resolve", "--issue", "42"], gh, () => ({ config: CONFIG }));
    expect(process.exitCode).toBe(0);
    expect(JSON.parse(out.join("\n"))).toMatchObject({
      number: 42,
      run: "issue-42-csv-export-drops-unicode",
    });
  });

  it("preflight prints ok and exits 0 for a complete config", () => {
    const out = capture();
    main(["preflight"], fakeGh(() => ok()), () => ({ config: CONFIG }));
    expect(process.exitCode).toBe(0);
    expect(out.join("\n")).toContain("ok");
  });

  it("preflight exits non-zero naming the missing keys", () => {
    const out = capture();
    main(["preflight"], fakeGh(() => ok()), () => ({ config: { github: {} } }));
    expect(process.exitCode).toBe(1);
    expect(out.join("\n")).toContain("project_owner");
    expect(out.join("\n")).toContain("status_in_review");
  });

  it("prints usage and exits non-zero for an unknown command", () => {
    const out = capture();
    main(["frobnicate"], fakeGh(() => ok()), () => ({ config: CONFIG }));
    expect(process.exitCode).toBe(1);
    expect(out.join("\n")).toMatch(/usage:/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-github-issue.test.mjs`
Expected: FAIL — `Failed to resolve import "./autopilot-github-issue.mjs"`

- [ ] **Step 3: Write the implementation**

Create `plugins/autopilot/scripts/autopilot-github-issue.mjs`:

```js
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadConfig, validateGithubConfig } from "./autopilot-config.mjs";

/**
 * The five ledger lines the autopilot-github wrapper's hooks append, in
 * pipeline order.
 *
 * Exported so the wrapper's prose guard test and the ledger-coupling test share
 * one source of truth. Every line is `github: `-prefixed, which collides with
 * none of nextStage's seven resume prefixes (`pr:`, `rebase clean`,
 * `sdd complete`, `plan complete`, `spec committed`, `worktree:`,
 * `design approved`) nor with `PARKED`.
 *
 * Move and comment get separate lines rather than one per hook, so a hook that
 * moved the card but failed to comment resumes into the comment alone instead
 * of redoing the move or skipping the comment.
 */
export const GITHUB_LEDGER_LINES = [
  "github: moved to in-progress",
  "github: start comment posted",
  "github: moved to in-review",
  "github: pr comment posted",
  "github: parked comment posted",
];

/**
 * The run-name slug, derived in code rather than prose.
 *
 * The slug is the ledger directory's key: prose rules re-applied by a different
 * session on resume can produce a different string and orphan the run.
 *
 * Lowercase, every run of non-`[a-z0-9]` becomes a single `-`, ends stripped,
 * truncated to 40 characters, then a trailing `-` the cut left behind stripped
 * again. Empty is a legitimate result (a title that is entirely punctuation or
 * non-ASCII); runName below handles it.
 */
export function slugify(title) {
  return String(title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/** `issue-<n>-<slug>`, or just `issue-<n>` when the slug normalizes to empty. */
export function runName(number, title) {
  const slug = slugify(title);
  return slug === "" ? `issue-${number}` : `issue-${number}-${slug}`;
}

/**
 * The ledger header's task text: `GitHub issue #<n>: <title>`.
 *
 * autopilot-ledger.mjs's HEADER regex is single-line, so the title's whitespace
 * is collapsed here. Writing a multi-line header into run.md would strand the
 * remainder as untimestamped lines that parseLedger silently drops.
 */
export function ledgerTask({ number, title }) {
  return `GitHub issue #${number}: ${String(title ?? "").replace(/\s+/g, " ").trim()}`;
}

/**
 * The task description handed to autopilot:autopilot-brainstorm — the same
 * shape autopilot already expects, so Phase 1 itself needs no changes.
 */
export function taskDescription(issue) {
  const header = ledgerTask(issue);
  const body = String(issue.body ?? "").trim();
  return body === "" ? header : `${header}\n\n${body}`;
}

/** `gh issue view <n> --json number,title,body,url`, plus the derived fields. */
export function resolveIssue(issueArg, gh) {
  const result = gh(["issue", "view", String(issueArg), "--json", "number,title,body,url"]);
  if (result.code !== 0) {
    throw new Error(
      `gh issue view ${issueArg} failed: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  const issue = JSON.parse(result.stdout);
  return {
    number: issue.number,
    title: issue.title,
    url: issue.url,
    run: runName(issue.number, issue.title),
    task: taskDescription(issue),
  };
}

/** The hard preflight gate: every `github` key present, or exactly which are not. */
export function preflightGithub(config) {
  const missing = validateGithubConfig(config);
  return missing.length === 0
    ? { ok: true, missing, message: "ok" }
    : {
        ok: false,
        missing,
        message:
          `github config is incomplete — missing: ${missing.join(", ")}. ` +
          `Add them under "github" in .claude/autopilot.json.`,
      };
}

/** Minimal `--flag value` / `--flag=value` parsing; positionals land in `_`. */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq !== -1) out[arg.slice(2, eq)] = arg.slice(eq + 1);
    else out[arg.slice(2)] = argv[++i];
  }
  return out;
}

const USAGE =
  "usage: autopilot-github-issue.mjs <preflight|resolve|move|comment> " +
  '[--issue <n>] [--to "<status>"] [--body <text>|--body-file <path>]';

function ghRun(args) {
  const r = spawnSync("gh", args, { encoding: "utf8" });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function requireIssue(args) {
  if (!args.issue) throw new Error("--issue <number-or-url> is required");
  return args.issue;
}

export function main(argv = process.argv.slice(2), gh = ghRun, load = loadConfig) {
  const [command] = argv;
  const args = parseArgs(argv.slice(1));
  const configPath = args.config ?? ".claude/autopilot.json";

  try {
    if (command === "preflight") {
      const result = preflightGithub(load(configPath).config);
      console.log(result.message);
      process.exitCode = result.ok ? 0 : 1;
      return;
    }

    if (command === "resolve") {
      console.log(JSON.stringify(resolveIssue(requireIssue(args), gh), null, 2));
      return;
    }

    console.error(USAGE);
    process.exitCode = 1;
  } catch (err) {
    // A failure here is never a silent success: the message reaches stderr and
    // the exit code is non-zero, so the wrapper can record it and move on.
    console.error(err.message);
    process.exitCode = 1;
  }
}

// pathToFileURL rather than a `file://` template: the plugin's install path is
// user-controlled and a space in it would silently skip main().
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

`readFileSync` is imported here but first used by `comment` in Task 3. If your linter objects to the unused import in this task, move the import line into Task 3's step instead — nothing else depends on where it lands.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-github-issue.test.mjs`
Expected: PASS — 22 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — 211 tests across 11 files.

- [ ] **Step 6: Commit**

```bash
git add plugins/autopilot/scripts/autopilot-github-issue.mjs plugins/autopilot/scripts/autopilot-github-issue.test.mjs
git commit -m "feat(autopilot): resolve GitHub issues into autopilot run names and task descriptions"
```

---

### Task 3: The board side of the script — item resolution, `move`, `comment`

Add the Projects v2 half to the same script: resolve the issue's project item (issue-scoped call first, `item-list` as fallback), resolve the single-select field and the named option, perform the `item-edit`, post issue comments from `--body` or `--body-file`, and extend `main()` with the `move` and `comment` subcommands.

Failure modes are named, never silent: an issue on no matching board errors with the issue number and the configured owner/number; a status option that does not exist errors listing the option names the field actually has.

**Files:**
- Modify: `plugins/autopilot/scripts/autopilot-github-issue.mjs`
- Modify: `plugins/autopilot/scripts/autopilot-github-issue.test.mjs`

**Interfaces:**
- Consumes: `parseArgs`, `USAGE`, `requireIssue`, `ghRun`, `main` from Task 2; `validateGithubConfig` from Task 1.
- Produces:
  - `matchProjectItem(projectItems: object[]|undefined, github): string|null`
  - `matchItemList(itemListJson: object, issueNumber): string|null`
  - `resolveItemId(issueNumber, config, gh): string` — throws when the issue is on no matching board.
  - `resolveProjectId(config, gh): string`
  - `findStatusField(fieldListJson, fieldName): {id, name, options}` — throws listing the fields present.
  - `findStatusOption(field, optionName): {id, name}` — throws listing the options present.
  - `move(issueNumber, statusName, config, gh): {itemId, projectId, fieldId, optionId, status}`
  - `comment(issueNumber, {body, bodyFile}, gh, readFile?): string`
  - `main` additionally serves `move --issue <n> --to "<option>"` and `comment --issue <n> --body <text>|--body-file <path>`.

**Note on `--project-id`.** `gh project item-edit` requires the project's node id, which neither `field-list` nor `item-list` returns. `resolveProjectId` adds one `gh project view <number> --owner <owner> --format json` call to obtain it. This is implied by the spec's item-edit invocation rather than stated in its four-call list.

- [ ] **Step 1: Write the failing test**

Append to `plugins/autopilot/scripts/autopilot-github-issue.test.mjs`. First extend the import at the top of that file to add the new names:

```js
import {
  GITHUB_LEDGER_LINES,
  slugify,
  runName,
  ledgerTask,
  taskDescription,
  resolveIssue,
  preflightGithub,
  matchProjectItem,
  matchItemList,
  resolveItemId,
  resolveProjectId,
  findStatusField,
  findStatusOption,
  move,
  comment,
  main,
} from "./autopilot-github-issue.mjs";
```

Then append this block to the end of the file:

```js
// The Projects v2 side. Two resolution steps have to be right for a move to be
// possible at all — which board item corresponds to this issue, and which
// single-select option corresponds to this status name — and each has a named
// failure mode rather than a silent no-op.

const PROJECT_ITEMS_MATCH = {
  projectItems: [
    { id: "PVTI_other", project: { number: 3, owner: { login: "BoTime" } } },
    { id: "PVTI_right", project: { number: 7, owner: { login: "BoTime" } } },
  ],
};

const FIELD_LIST = {
  fields: [
    { id: "PVTF_title", name: "Title", type: "ProjectV2Field" },
    {
      id: "PVTSSF_status",
      name: "Status",
      type: "ProjectV2SingleSelectField",
      options: [
        { id: "opt_ready", name: "Ready" },
        { id: "opt_progress", name: "In Progress" },
        { id: "opt_review", name: "In Review" },
      ],
    },
  ],
};

/** Routes a fake gh by subcommand pair, so each test describes only what it needs. */
function ghRouter(routes) {
  return fakeGh((args) => {
    const key = args[0] === "project" ? `project ${args[1]}` : `${args[0]} ${args[1]}`;
    const handler = routes[key];
    if (!handler) throw new Error(`unexpected gh call: ${args.join(" ")}`);
    return typeof handler === "function" ? handler(args) : handler;
  });
}

describe("matchProjectItem", () => {
  it("returns the item id when the project number and owner both match", () => {
    expect(matchProjectItem(PROJECT_ITEMS_MATCH.projectItems, CONFIG.github))
      .toBe("PVTI_right");
  });

  it("skips an entry for a different project number", () => {
    const items = [{ id: "PVTI_x", project: { number: 3, owner: { login: "BoTime" } } }];
    expect(matchProjectItem(items, CONFIG.github)).toBeNull();
  });

  it("skips an entry whose owner differs", () => {
    const items = [{ id: "PVTI_x", project: { number: 7, owner: { login: "SomeoneElse" } } }];
    expect(matchProjectItem(items, CONFIG.github)).toBeNull();
  });

  it("accepts an entry that names no owner — a number match is enough", () => {
    // An item that carries no owner is not evidence of a DIFFERENT owner.
    const items = [{ id: "PVTI_x", projectV2: { number: 7 } }];
    expect(matchProjectItem(items, CONFIG.github)).toBe("PVTI_x");
  });

  it("returns null for a shape it does not recognize, so the fallback runs", () => {
    // gh's projectItems payload has varied across versions. An unrecognized
    // shape must fall through to item-list rather than guess.
    expect(matchProjectItem([{ id: "PVTI_x", title: "some board" }], CONFIG.github))
      .toBeNull();
  });

  it("returns null for a missing or empty list", () => {
    expect(matchProjectItem(undefined, CONFIG.github)).toBeNull();
    expect(matchProjectItem([], CONFIG.github)).toBeNull();
  });
});

describe("matchItemList", () => {
  it("returns the id of the item whose content number matches the issue", () => {
    const list = {
      items: [
        { id: "PVTI_a", content: { type: "Issue", number: 41 } },
        { id: "PVTI_b", content: { type: "Issue", number: 42 } },
      ],
    };
    expect(matchItemList(list, 42)).toBe("PVTI_b");
  });

  it("returns null when no item matches", () => {
    expect(matchItemList({ items: [] }, 42)).toBeNull();
  });
});

describe("resolveItemId", () => {
  it("uses the issue-scoped projectItems match and never calls item-list", () => {
    const gh = ghRouter({
      "issue view": ok(JSON.stringify(PROJECT_ITEMS_MATCH)),
    });
    expect(resolveItemId(42, CONFIG, gh)).toBe("PVTI_right");
    expect(gh.calls).toHaveLength(1);
    expect(gh.calls[0]).toEqual(["issue", "view", "42", "--json", "projectItems"]);
  });

  it("falls back to item-list when projectItems yields nothing usable", () => {
    const gh = ghRouter({
      "issue view": ok(JSON.stringify({ projectItems: [] })),
      "project item-list": ok(
        JSON.stringify({ items: [{ id: "PVTI_b", content: { number: 42 } }] }),
      ),
    });
    expect(resolveItemId(42, CONFIG, gh)).toBe("PVTI_b");
    expect(gh.calls[1]).toEqual([
      "project", "item-list", "7", "--owner", "BoTime", "--format", "json",
    ]);
  });

  it("errors naming the issue and the configured owner and number when neither path matches", () => {
    const gh = ghRouter({
      "issue view": ok(JSON.stringify({ projectItems: [] })),
      "project item-list": ok(JSON.stringify({ items: [] })),
    });
    expect(() => resolveItemId(42, CONFIG, gh)).toThrow(/#42/);
    expect(() => resolveItemId(42, CONFIG, gh)).toThrow(/BoTime\/7/);
  });
});

describe("resolveProjectId", () => {
  it("reads the project node id from gh project view", () => {
    const gh = ghRouter({ "project view": ok(JSON.stringify({ id: "PVT_kw", number: 7 })) });
    expect(resolveProjectId(CONFIG, gh)).toBe("PVT_kw");
    expect(gh.calls[0]).toEqual([
      "project", "view", "7", "--owner", "BoTime", "--format", "json",
    ]);
  });
});

describe("findStatusField and findStatusOption", () => {
  it("finds the configured single-select field by name", () => {
    expect(findStatusField(FIELD_LIST, "Status").id).toBe("PVTSSF_status");
  });

  it("errors listing the field names the project actually has", () => {
    expect(() => findStatusField(FIELD_LIST, "State")).toThrow(/Title, Status/);
  });

  it("finds the option named by the target status", () => {
    expect(findStatusOption(findStatusField(FIELD_LIST, "Status"), "In Review").id)
      .toBe("opt_review");
  });

  it("errors listing the options the field actually has", () => {
    const field = findStatusField(FIELD_LIST, "Status");
    expect(() => findStatusOption(field, "Done")).toThrow(
      /Ready, In Progress, In Review/,
    );
  });
});

describe("move", () => {
  const routes = {
    "issue view": ok(JSON.stringify(PROJECT_ITEMS_MATCH)),
    "project view": ok(JSON.stringify({ id: "PVT_kw" })),
    "project field-list": ok(JSON.stringify(FIELD_LIST)),
    "project item-edit": ok("edited"),
  };

  it("builds the expected gh project item-edit argument list", () => {
    const gh = ghRouter(routes);
    const result = move(42, "In Progress", CONFIG, gh);
    expect(gh.calls.at(-1)).toEqual([
      "project", "item-edit",
      "--id", "PVTI_right",
      "--project-id", "PVT_kw",
      "--field-id", "PVTSSF_status",
      "--single-select-option-id", "opt_progress",
    ]);
    expect(result.status).toBe("In Progress");
  });

  it("surfaces a non-zero item-edit exit as an error, never a silent success", () => {
    const gh = ghRouter({ ...routes, "project item-edit": fail("HTTP 403") });
    expect(() => move(42, "In Progress", CONFIG, gh)).toThrow(/403/);
  });
});

describe("comment", () => {
  it("posts the --body text", () => {
    const gh = ghRouter({ "issue comment": ok("https://example.com/issues/42#c1") });
    comment(42, { body: "run started" }, gh);
    expect(gh.calls[0]).toEqual(["issue", "comment", "42", "--body", "run started"]);
  });

  it("reads --body-file and posts its contents", () => {
    // Park reasons and PR announcements are multi-line; the pr stage already
    // establishes writing such a body to a file rather than shell-quoting it.
    const gh = ghRouter({ "issue comment": ok("") });
    comment(42, { bodyFile: "/run/comment.md" }, gh, () => "line one\nline two");
    expect(gh.calls[0][4]).toBe("line one\nline two");
  });

  it("errors when neither --body nor --body-file is supplied", () => {
    const gh = ghRouter({ "issue comment": ok("") });
    expect(() => comment(42, {}, gh)).toThrow(/--body/);
    expect(gh.calls).toHaveLength(0);
  });

  it("surfaces a non-zero gh exit", () => {
    const gh = ghRouter({ "issue comment": fail("HTTP 404") });
    expect(() => comment(42, { body: "x" }, gh)).toThrow(/404/);
  });
});

describe("main — move and comment", () => {
  beforeEach(() => {
    process.exitCode = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  const capture = () => {
    const out = [];
    vi.spyOn(console, "log").mockImplementation((m) => out.push(String(m)));
    vi.spyOn(console, "error").mockImplementation((m) => out.push(String(m)));
    return out;
  };

  it("move prints a confirmation and exits 0", () => {
    const out = capture();
    const gh = ghRouter({
      "issue view": ok(JSON.stringify(PROJECT_ITEMS_MATCH)),
      "project view": ok(JSON.stringify({ id: "PVT_kw" })),
      "project field-list": ok(JSON.stringify(FIELD_LIST)),
      "project item-edit": ok("edited"),
    });
    main(["move", "--issue", "42", "--to", "In Review"], gh, () => ({ config: CONFIG }));
    expect(process.exitCode).toBe(0);
    expect(out.join("\n")).toContain("In Review");
  });

  it("move exits non-zero naming the missing keys when the github block is incomplete", () => {
    // The wrapper's preflight and the script fail on the same check.
    const out = capture();
    main(
      ["move", "--issue", "42", "--to", "In Review"],
      ghRouter({}),
      () => ({ config: { github: { project_owner: "BoTime" } } }),
    );
    expect(process.exitCode).toBe(1);
    expect(out.join("\n")).toContain("project_number");
  });

  it("comment posts the body and exits 0", () => {
    const out = capture();
    const gh = ghRouter({ "issue comment": ok("posted") });
    main(
      ["comment", "--issue", "42", "--body", "run started"],
      gh,
      () => ({ config: CONFIG }),
    );
    expect(process.exitCode).toBe(0);
    expect(out.join("\n")).toContain("posted");
  });

  it("a failing gh call exits non-zero with the message", () => {
    const out = capture();
    const gh = ghRouter({ "issue comment": fail("HTTP 404") });
    main(["comment", "--issue", "42", "--body", "x"], gh, () => ({ config: CONFIG }));
    expect(process.exitCode).toBe(1);
    expect(out.join("\n")).toContain("404");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-github-issue.test.mjs`
Expected: FAIL — `matchProjectItem is not a function` and the other new exports undefined. The 22 tests from Task 2 still pass.

- [ ] **Step 3: Write the board-side implementation**

In `plugins/autopilot/scripts/autopilot-github-issue.mjs`, insert the following **after** `preflightGithub` and **before** `parseArgs`:

```js
function ghJson(result, what) {
  if (result.code !== 0) {
    throw new Error(`${what} failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${what} returned output that is not JSON: ${result.stdout.slice(0, 200)}`);
  }
}

/**
 * Match an entry from `gh issue view --json projectItems` to the configured
 * board, returning its item id.
 *
 * gh's projectItems payload has varied across versions, so this reads the
 * project under either `project` or `projectV2` and returns null for any shape
 * it does not recognize — resolveItemId then falls back to `item-list`, which
 * has a stable `content.number`. The owner is compared only when the payload
 * carries one: an item that names no owner is not evidence of a different one.
 */
export function matchProjectItem(projectItems, github) {
  for (const item of projectItems ?? []) {
    if (!item?.id) continue;
    const project = item.project ?? item.projectV2;
    if (!project) continue;
    if (Number(project.number) !== Number(github.project_number)) continue;
    const owner = project.owner?.login ?? project.owner;
    if (
      owner &&
      String(owner).toLowerCase() !== String(github.project_owner).toLowerCase()
    ) {
      continue;
    }
    return item.id;
  }
  return null;
}

/** Match an item from `gh project item-list --format json` by its issue number. */
export function matchItemList(itemListJson, issueNumber) {
  for (const item of itemListJson?.items ?? []) {
    if (Number(item?.content?.number) === Number(issueNumber)) return item.id;
  }
  return null;
}

/**
 * The issue's project item id. The issue-scoped call is one request, so it is
 * tried first; `item-list` is the fallback. An issue on no matching board is a
 * named error, never a silent no-op.
 */
export function resolveItemId(issueNumber, config, gh) {
  const github = config.github;

  const view = gh(["issue", "view", String(issueNumber), "--json", "projectItems"]);
  if (view.code === 0) {
    let parsed = null;
    try {
      parsed = JSON.parse(view.stdout);
    } catch {
      parsed = null;
    }
    const id = matchProjectItem(parsed?.projectItems, github);
    if (id) return id;
  }

  const list = ghJson(
    gh([
      "project", "item-list", String(github.project_number),
      "--owner", github.project_owner, "--format", "json",
    ]),
    `gh project item-list for ${github.project_owner}/${github.project_number}`,
  );
  const id = matchItemList(list, issueNumber);
  if (!id) {
    throw new Error(
      `issue #${issueNumber} is not an item on project ${github.project_owner}/${github.project_number} — ` +
        `add the issue to that board, or fix project_owner/project_number in .claude/autopilot.json`,
    );
  }
  return id;
}

/** `gh project item-edit` needs the project's node id, which item-list omits. */
export function resolveProjectId(config, gh) {
  const github = config.github;
  const project = ghJson(
    gh([
      "project", "view", String(github.project_number),
      "--owner", github.project_owner, "--format", "json",
    ]),
    `gh project view for ${github.project_owner}/${github.project_number}`,
  );
  if (!project.id) {
    throw new Error(
      `gh project view returned no project id for ${github.project_owner}/${github.project_number}`,
    );
  }
  return project.id;
}

/** The configured single-select field, or an error listing what the board has. */
export function findStatusField(fieldListJson, fieldName) {
  const fields = fieldListJson?.fields ?? [];
  const field = fields.find((f) => f?.name === fieldName);
  if (!field) {
    const names = fields.map((f) => f?.name).filter(Boolean).join(", ");
    throw new Error(
      `no field named "${fieldName}" on the project — fields present: ${names || "(none)"}`,
    );
  }
  if (!Array.isArray(field.options)) {
    throw new Error(`field "${fieldName}" is not a single-select field — it has no options`);
  }
  return field;
}

/** The named option, or an error listing the options the field actually has. */
export function findStatusOption(field, optionName) {
  const option = field.options.find((o) => o?.name === optionName);
  if (!option) {
    const names = field.options.map((o) => o?.name).filter(Boolean).join(", ");
    throw new Error(
      `no option named "${optionName}" on field "${field.name}" — options present: ${names || "(none)"}`,
    );
  }
  return option;
}

/** Set the issue's Projects v2 Status field to the named option. */
export function move(issueNumber, statusName, config, gh) {
  const github = config.github;
  const itemId = resolveItemId(issueNumber, config, gh);
  const projectId = resolveProjectId(config, gh);
  const fields = ghJson(
    gh([
      "project", "field-list", String(github.project_number),
      "--owner", github.project_owner, "--format", "json",
    ]),
    `gh project field-list for ${github.project_owner}/${github.project_number}`,
  );
  const field = findStatusField(fields, github.status_field);
  const option = findStatusOption(field, statusName);

  const edit = gh([
    "project", "item-edit",
    "--id", itemId,
    "--project-id", projectId,
    "--field-id", field.id,
    "--single-select-option-id", option.id,
  ]);
  if (edit.code !== 0) {
    throw new Error(
      `gh project item-edit failed for issue #${issueNumber} → "${statusName}": ` +
        `${edit.stderr.trim() || edit.stdout.trim()}`,
    );
  }
  return { itemId, projectId, fieldId: field.id, optionId: option.id, status: statusName };
}

/** Post an issue comment from inline text or a file. */
export function comment(
  issueNumber,
  { body, bodyFile },
  gh,
  readFile = (p) => readFileSync(p, "utf8"),
) {
  const text = bodyFile !== undefined ? readFile(bodyFile) : body;
  if (text === undefined || text === null || String(text).trim() === "") {
    throw new Error("comment needs a non-empty --body <text> or --body-file <path>");
  }
  const result = gh(["issue", "comment", String(issueNumber), "--body", String(text)]);
  if (result.code !== 0) {
    throw new Error(
      `gh issue comment failed for #${issueNumber}: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  return result.stdout.trim();
}
```

- [ ] **Step 4: Extend `main()` with the two new subcommands**

In the same file, inside `main()`, insert the following **between** the `resolve` block and the `console.error(USAGE)` fallthrough:

```js
    if (command === "move") {
      const issue = requireIssue(args);
      if (!args.to) throw new Error('move needs --to "<status option>"');
      const { config } = load(configPath);
      const check = preflightGithub(config);
      if (!check.ok) throw new Error(check.message);
      const result = move(issue, args.to, config, gh);
      console.log(`moved issue #${issue} to ${result.status}`);
      return;
    }

    if (command === "comment") {
      const issue = requireIssue(args);
      const posted = comment(
        issue,
        { body: args.body, bodyFile: args["body-file"] },
        gh,
      );
      console.log(posted || `commented on issue #${issue}`);
      return;
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-github-issue.test.mjs`
Expected: PASS — 48 tests (22 from Task 2 + 26 new).

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — 237 tests across 11 files.

- [ ] **Step 7: Commit**

```bash
git add plugins/autopilot/scripts/autopilot-github-issue.mjs plugins/autopilot/scripts/autopilot-github-issue.test.mjs
git commit -m "feat(autopilot): move Projects v2 cards and comment on issues from the CLI"
```

---

### Task 4: Pin the ledger coupling and the PARKED ordering

The whole design rests on one claim: lines the wrapper appends are invisible to `nextStage`, so a run with board hooks resumes exactly like a run without them — with one exception, the park comment, which must be appended **before** the `PARKED` entry or a parked run looks resumable and `/autopilot resume` drives it straight past the park.

Both are claims about code that already exists (`autopilot-ledger.mjs`), so they can be pinned now, before any prose asserts them. This is what makes the ordering constraint a test rather than a comment.

**Files:**
- Create: `plugins/autopilot/scripts/autopilot-github-ledger-coupling.test.mjs`

**Interfaces:**
- Consumes: `parseLedger`, `nextStage` from `./autopilot-ledger.mjs` (unchanged); `GITHUB_LEDGER_LINES` from `./autopilot-github-issue.mjs` (Task 2).
- Produces: no source changes — this task is a guard only.

- [ ] **Step 1: Write the failing test**

Create `plugins/autopilot/scripts/autopilot-github-ledger-coupling.test.mjs`:

```js
// autopilot-github appends its own lines to the same run.md that autopilot's
// nextStage reads to decide where /autopilot resume jumps back in. Nothing in
// the code links the two: if a wrapper line ever gained a prefix nextStage
// matches, a resumed run would jump to the wrong stage, and nothing else would
// fail.
//
// This file pins both halves of that contract:
//
//   1. Every `github: ` line is inert — a ledger with them interleaved at every
//      hook point resolves to the same stage as the same ledger without them.
//   2. The park hook's ordering. nextStage returns "parked" only when PARKED
//      starts the LAST entry, so `github: parked comment posted` must be
//      appended BEFORE `PARKED — <reason>`. Reversed, the run looks resumable
//      and /autopilot resume drives it past the park — the exact failure
//      autopilot's parking section warns about.
//
// Sibling of autopilot-ledger-coupling.test.mjs, which stays focused on
// autopilot's own eight entries.

import { describe, it, expect } from "vitest";
import { parseLedger, nextStage } from "./autopilot-ledger.mjs";
import { GITHUB_LEDGER_LINES } from "./autopilot-github-issue.mjs";

const HEADER = "# autopilot run — task: GitHub issue #42: CSV export drops unicode";

// The seven prefixes nextStage resumes on, plus the park marker.
const RESUME_PREFIXES = [
  "pr:", "rebase clean", "sdd complete", "plan complete",
  "spec committed", "worktree:", "design approved", "PARKED",
];

// autopilot's own eight entries, in pipeline order, with the stage nextStage
// must return once the ledger ends there.
const STAGE_ENTRIES = [
  ["started (phase 1)", "phase1"],
  ["design approved", "setup"],
  ["worktree: .claude/worktrees/issue-42 (branch worktree-issue-42)", "spec"],
  ["spec committed → docs/superpowers/specs/2026-08-21-x-design.md", "plan"],
  ["plan complete → docs/superpowers/plans/2026-08-21-x.md (6 tasks)", "sdd"],
  ["sdd complete (6 tasks, 0 parked, 0 fix rounds across 0 tasks)", "land"],
  ["rebase clean, tests green (42 passed)", "pr"],
  ["pr: https://example.com/pull/23", "done"],
];

// The wrapper's lines interleaved at their hook points: the two start lines
// straight after `started (phase 1)`, the two PR lines straight after `pr:`.
const GITHUB_AFTER = {
  "started (phase 1)": ["github: moved to in-progress", "github: start comment posted"],
  "pr: https://example.com/pull/23": ["github: moved to in-review", "github: pr comment posted"],
};

function buildLedger(entries) {
  const lines = [HEADER];
  entries.forEach((text, i) => {
    lines.push(`2026-08-21T14:${String(i).padStart(2, "0")}:00Z  ${text}`);
  });
  return lines.join("\n");
}

const stageOf = (entries) => nextStage(parseLedger(buildLedger(entries)));

/** The plain entry list through index `i`, with the github lines woven in. */
function withGithub(entries) {
  return entries.flatMap((text) => [text, ...(GITHUB_AFTER[text] ?? [])]);
}

describe("github: lines collide with none of nextStage's prefixes", () => {
  GITHUB_LEDGER_LINES.forEach((line) => {
    it(`"${line}" starts with none of them`, () => {
      for (const prefix of RESUME_PREFIXES) {
        expect(line.startsWith(prefix)).toBe(false);
      }
    });
  });
});

describe("a ledger with github: lines resolves like one without them", () => {
  STAGE_ENTRIES.forEach(([entryText, expectedStage], index) => {
    it(`through "${entryText}" resolves to "${expectedStage}" either way`, () => {
      const plain = STAGE_ENTRIES.slice(0, index + 1).map(([text]) => text);
      expect(stageOf(plain)).toBe(expectedStage);
      expect(stageOf(withGithub(plain))).toBe(expectedStage);
    });
  });

  it("still returns done when the pr hook's lines are the last two entries", () => {
    // nextStage matches `pr:` anywhere in the ledger, not only as the last
    // entry, so appending after it is safe — this is what makes the pr hook's
    // anchor (immediately after `pr:`) legal.
    const entries = withGithub(STAGE_ENTRIES.map(([text]) => text));
    expect(entries.at(-1)).toBe("github: pr comment posted");
    expect(stageOf(entries)).toBe("done");
  });
});

describe("the PARKED ordering constraint", () => {
  const throughSdd = STAGE_ENTRIES.slice(0, 6).map(([text]) => text);
  const REASON = "PARKED — tests red after rebase (3 failures)";

  it("returns parked when the github line is appended BEFORE the PARKED entry", () => {
    expect(stageOf([...throughSdd, "github: parked comment posted", REASON]))
      .toBe("parked");
  });

  it("does NOT return parked when the github line lands after it", () => {
    // This is the failure the ordering rule exists to prevent: the run reads as
    // resumable and /autopilot resume drives it into `land` on a red branch.
    const stage = stageOf([...throughSdd, REASON, "github: parked comment posted"]);
    expect(stage).not.toBe("parked");
    expect(stage).toBe("land");
  });
});
```

- [ ] **Step 2: Run test to verify it fails, then passes for the right reason**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-github-ledger-coupling.test.mjs`

This test guards existing behavior, so it should pass on the first run — the failure mode it protects against is a *future* edit. Confirm it is failing-capable rather than vacuous by temporarily changing `"github: parked comment posted"` in the second PARKED test to `"PARKED (comment posted)"` and re-running:

Expected with that temporary edit: FAIL — `expected "parked" not to be "parked"`, proving the assertion actually discriminates. **Revert the temporary edit** before continuing.

- [ ] **Step 3: Run the file for real**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-github-ledger-coupling.test.mjs`
Expected: PASS — 16 tests.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS — 253 tests across 12 files.

- [ ] **Step 5: Commit**

```bash
git add plugins/autopilot/scripts/autopilot-github-ledger-coupling.test.mjs
git commit -m "test(autopilot): pin github: ledger lines as inert and the PARKED ordering"
```

---

### Task 5: The wrapper skill and its prose guard

Write `plugins/autopilot/skills/autopilot-github/SKILL.md` — a thin wrapper that resolves the issue, invokes `autopilot:autopilot` in the same session, and layers four deltas — together with the guard test that pins its load-bearing phrases. The prose and its guard go in one task because a prose contract and the test pinning it cannot be reviewed apart.

**Files:**
- Create: `plugins/autopilot/skills/autopilot-github/SKILL.md`
- Create: `plugins/autopilot/scripts/autopilot-github-contract.test.mjs`

**Interfaces:**
- Consumes: `GITHUB_LEDGER_LINES` from `./autopilot-github-issue.mjs` (Task 2) — the guard test asserts every one of them appears in the prose; the four subcommand names from Tasks 2 and 3.
- Produces: prose only. No source changes, and **no change to `plugins/autopilot/skills/autopilot/SKILL.md`**.

- [ ] **Step 1: Write the failing guard test**

Create `plugins/autopilot/scripts/autopilot-github-contract.test.mjs`:

```js
// autopilot-github's SKILL.md is a wrapper made of prose. Nothing else in the
// repository fails when it drifts: it can lose the "do not dispatch autopilot
// into a subagent" rule, or the park hook's ordering, or one of the five ledger
// lines, and every test still passes while the wrapper quietly stops working —
// a card left in Ready, or worse, a parked run that /autopilot resume drives
// straight past.
//
// This test reads SKILL.md and asserts the load-bearing phrases are present. It
// matches on phrases and on the exact strings shared with code, not on full
// sentences, so ordinary editing does not break it but removal does.
//
// Style sibling of autopilot-sdd-contract.test.mjs.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { GITHUB_LEDGER_LINES } from "./autopilot-github-issue.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = join(HERE, "..", "skills", "autopilot-github", "SKILL.md");

const skill = readFileSync(SKILL_PATH, "utf8");

// SKILL.md is hard-wrapped prose, so a pinned phrase routinely straddles a
// newline. Collapse whitespace before matching; otherwise a reflow that changes
// no words at all would fail these tests.
const unwrap = (s) => s.replace(/\s+/g, " ");
const flat = unwrap(skill);

describe("autopilot-github frontmatter", () => {
  it("declares the skill name the plugin loads it under", () => {
    expect(skill).toMatch(/^---\nname: autopilot-github\n/);
  });

  it("triggers on /autopilot-github and on its resume form", () => {
    // There is no command file — the skill triggers purely off `description`
    // matching the developer's message, exactly as `autopilot` itself does.
    const description = /description:.*/.exec(skill)?.[0] ?? "";
    expect(description).toContain("/autopilot-github");
    expect(description).toMatch(/resume/i);
  });
});

describe("the wrapper stays a wrapper", () => {
  it("delegates the pipeline to autopilot:autopilot", () => {
    expect(skill).toContain("autopilot:autopilot");
  });

  it("forbids dispatching autopilot into a subagent", () => {
    // Behind a subagent boundary the hooks are unreachable and a park is
    // reported to the wrapper instead of to the human.
    expect(flat).toMatch(/do not dispatch autopilot into a subagent/i);
  });

  it("says the deltas must not touch autopilot's pattern-matched seams", () => {
    expect(flat).toMatch(/nextStage/);
    expect(flat).toMatch(/prefix/i);
  });
});

describe("the five github: ledger lines", () => {
  GITHUB_LEDGER_LINES.forEach((line) => {
    it(`documents "${line}"`, () => {
      expect(skill).toContain(line);
    });
  });
});

describe("the load-bearing rules", () => {
  it("puts the park comment BEFORE the PARKED append", () => {
    // Appended after, the PARKED entry is no longer last and nextStage stops
    // returning "parked" — /autopilot resume then drives the run past the park.
    expect(flat).toMatch(/before[^.]{0,80}PARKED/i);
  });

  it("pins the single-line ledger header", () => {
    expect(flat).toMatch(/single-line/i);
    expect(skill).toContain("# autopilot run — task: GitHub issue #");
  });

  it("says a failed move or comment does not park the run", () => {
    expect(flat).toMatch(/do not park|does not park/i);
    expect(skill).toContain("github: ");
  });

  it("requires each hook to re-read the ledger and skip its own line", () => {
    expect(flat).toMatch(/re-read the ledger/i);
    expect(flat).toMatch(/skip/i);
  });

  it("names all four subcommands of the script", () => {
    for (const subcommand of ["preflight", "resolve", "move", "comment"]) {
      expect(skill).toContain(`autopilot-github-issue.mjs ${subcommand}`);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-github-contract.test.mjs`
Expected: FAIL — `ENOENT: no such file or directory ... skills/autopilot-github/SKILL.md`

- [ ] **Step 3: Create the skill directory and write the wrapper**

```bash
mkdir -p plugins/autopilot/skills/autopilot-github
```

Create `plugins/autopilot/skills/autopilot-github/SKILL.md` with exactly this content:

````markdown
---
name: autopilot-github
description: Use when the developer runs /autopilot-github with a GitHub issue number or URL, or /autopilot-github resume with a run name - resolves the issue, then drives autopilot end to end while moving the issue's Projects v2 card and commenting on the issue at each transition
---

# Autopilot for GitHub issues

Take a GitHub issue from brainstorm to pull request, keeping its Projects v2
card and its comment thread in step with the run.

```
/autopilot-github <issue-number-or-URL>
/autopilot-github resume <run>
```

**Announce at start:** "I'm using the autopilot-github skill to take issue #\<n\>
from brainstorm to PR."

## This is a wrapper, not a copy

The run itself is `autopilot:autopilot`, unchanged. Brainstorm → setup → spec →
plan → sdd → land → pr, the ledger format, stage idempotency, the SDD dispatch
contracts, and all five parking conditions all come from that skill. Read it and
follow it. Everything in this file is a delta layered on top.

Two structural rules make that work.

1. **Invoke `autopilot:autopilot` in this session, with the Skill tool, and
   follow it directly. Do not dispatch autopilot into a subagent.** The deltas
   below interleave with autopilot's own stages and read and write the same
   ledger. Behind a subagent boundary the hooks would be unreachable, and a park
   would be reported to you instead of to your human partner.
2. **Never touch autopilot's pattern-matched seams.** `nextStage` resumes a run
   by prefix-matching ledger text — `pr:`, `rebase clean`, `sdd complete`,
   `plan complete`, `spec committed`, `worktree:`, `design approved` — and
   detects a park by `PARKED` at the start of the ledger's **last** entry. Every
   line this wrapper appends is prefixed `github: `, which collides with none of
   them, subject to the ordering rule in Delta 3c.

## Locating the plugin's scripts

Identical to autopilot's own "Locating the plugin's scripts" section, with one
difference: this skill's base directory is `<plugin root>/skills/autopilot-github`,
so the plugin root is that path with `/skills/autopilot-github` removed.

`$CLAUDE_PLUGIN_ROOT` is **not** set in Bash tool calls. Resolve the path once
and substitute the literal value into every `"$AP/..."` command below — you
write each command fresh, and shell variables do not persist between Bash calls.

```bash
AP="<the base directory, minus /skills/autopilot-github>"
ls "$AP/scripts/autopilot-github-issue.mjs"   # must exist; if not, stop
```

Run every command below from the **repository root**, so the relative
`.claude/autopilot.json` and `.superpowers/autopilot/...` paths resolve.

## Delta 0 — preflight

Run autopilot's own preflight first, exactly as it prescribes. Then, before
asking your human partner anything:

```bash
node "$AP/scripts/autopilot-github-issue.mjs" preflight
```

This is a **hard requirement**, at the same tier as autopilot's "skills resolve"
check. A non-zero exit prints exactly which `github` keys are missing. Report
those key names and **stop** — do not start the brainstorm. The fix is a
`github` block in the project's `.claude/autopilot.json`:

```json
"github": {
  "project_owner": "<org-or-user>",
  "project_number": 7,
  "status_field": "Status",
  "status_ready": "Ready",
  "status_in_progress": "In Progress",
  "status_in_review": "In Review"
}
```

The four status keys have defaults in the plugin's `autopilot.default.json` and
merge per key, so a project usually needs only `project_owner` and
`project_number`. Those two have no default: they are irreducibly
project-specific, and a guessed value fails confusingly.

This is the wrapper's one hard stop. Every later transition failure is recorded
and stepped past — see "Transition failures do not park".

## Delta 1 — resolve the issue, before Phase 1

`gh` accepts a bare number or a full issue URL, so pass the argument through
unchanged:

```bash
node "$AP/scripts/autopilot-github-issue.mjs" resolve --issue <n>
```

It prints one JSON object:

```json
{
  "number": 42,
  "title": "CSV export drops unicode",
  "url": "https://github.com/owner/repo/issues/42",
  "run": "issue-42-csv-export-drops-unicode",
  "task": "GitHub issue #42: CSV export drops unicode\n\n<body>"
}
```

- `task` is the task description you hand to `autopilot:autopilot-brainstorm`.
  It is the same shape autopilot already expects, so **Phase 1 itself needs no
  changes** — the brainstorm asks its clarifying questions against the issue
  text exactly as it would against text a human typed.
- `run` is `<run>` for the whole run. See Delta 2.
- Keep `number` and `url` — the hooks below need them.

### Ledger header

Create the run directory and the ledger before appending `started (phase 1)`.
The header uses the **single-line** form — the first line of `task`, never the
whole string:

```bash
mkdir -p .superpowers/autopilot/<run>
printf '# autopilot run — task: GitHub issue #%s: %s\n' "<n>" "<title>" \
  >> .superpowers/autopilot/<run>/run.md
```

giving:

```
# autopilot run — task: GitHub issue #42: CSV export drops unicode
```

`autopilot-ledger.mjs`'s header regex is single-line. Writing the multi-line
`task` into `run.md` would strand the body as untimestamped lines that
`parseLedger` silently drops.

## Delta 2 — run naming

`<run>` is the `run` field from Delta 1: `issue-<n>-<slug>`, e.g.
`issue-42-csv-export-drops-unicode`. The git branch becomes
`worktree-issue-42-csv-export-drops-unicode`, the `worktree-` prefix coming from
`superpowers:using-git-worktrees` as it already does; `<run>` itself never
carries the prefix, per autopilot's "The run directory" rule.

The value is **computed once, at resolution** — before Phase 1 begins, which is
what lets the start hook name it — and **declared at `setup`** as the
worktree/branch name passed to `superpowers:using-git-worktrees`, in place of a
name falling out of the brainstorm. Everything downstream threads it exactly as
autopilot already does: the ledger directory, the generated agent definitions
under `.superpowers/autopilot/<run>/agents/`, the PR branch.

**Never re-derive the slug by hand.** It is the ledger directory's key: a
different string points at a different directory and loses the run. Take it from
`resolve`, or from the run name on a resume.

## Delta 3 — issue transitions

### The commands

```bash
node "$AP/scripts/autopilot-github-issue.mjs" move --issue <n> --to "<option>"
node "$AP/scripts/autopilot-github-issue.mjs" comment --issue <n> --body "<text>"
node "$AP/scripts/autopilot-github-issue.mjs" comment --issue <n> --body-file <path>
```

Use these. Do not write raw `gh project` invocations yourself — the script owns
project-item, field, and option resolution, and reports each failure with the
issue number, the configured owner and board number, and the names the board
actually has.

`--body-file` is for multi-line bodies (park reasons, PR announcements). Write
the body into the run directory first, the way the `pr` stage already writes
`pr-body.md`, rather than shell-quoting it.

`<option>` is a status name from config: `status_ready`, `status_in_progress`,
or `status_in_review`.

### Ledger entries and idempotency

Every hook appends its own `github: `-prefixed line through
`autopilot-ledger.mjs` — the same `append()` call every other stage uses, so the
entry carries an ISO timestamp and is visible to `parseLedger`:

```bash
node -e "const{pathToFileURL}=require('node:url');import(pathToFileURL(process.argv[1]+'/scripts/autopilot-ledger.mjs').href).then(m=>m.append('.superpowers/autopilot/<run>/run.md','<entry text>'))" "$AP"
```

The five lines, in pipeline order:

```
github: moved to in-progress
github: start comment posted
github: moved to in-review
github: pr comment posted
github: parked comment posted
```

Before acting, **re-read the ledger and skip the step if its own line is already
present** — the same `entries.some(e => e.text.startsWith(prefix))` semantics
`nextStage` uses. Resuming a run therefore never double-moves a card and never
double-posts a comment.

Move and comment get **separate** lines rather than one line per hook, so a hook
that moved the card but failed to comment resumes into the comment alone instead
of redoing the move or skipping the comment.

### Delta 3a — start hook

Anchor: **immediately after `started (phase 1)` is appended.**

1. `move --issue <n> --to "<status_in_progress>"` (from Ready). Append
   `github: moved to in-progress`.
2. `comment --issue <n>` saying the run started, naming `<run>` and the ledger
   path `.superpowers/autopilot/<run>/run.md`. Append
   `github: start comment posted`.

### Delta 3b — PR hook

Anchor: **immediately after `pr: <url>` is appended** in the `pr` stage.

1. `move --issue <n> --to "<status_in_review>"`. Append
   `github: moved to in-review`.
2. `comment --issue <n>` with the PR link. Append `github: pr comment posted`.

Appending after `pr:` is safe: `nextStage` matches `pr:` anywhere in the ledger,
not only as the last entry.

### Delta 3c — park hook, and the ordering constraint

Anchor: **immediately before a `PARKED — <reason>` entry is appended.**

Leave the card where it is (In Progress). The park hook adds **no new parking
condition** — a run still parks for exactly autopilot's five existing reasons.
The only new behavior is the comment.

The order is fixed:

1. Post the park comment (`--body-file`, pointing at the ledger path).
2. Append `github: parked comment posted`.
3. Append `PARKED — <reason>` — **last**.
4. Report the duration, as autopilot's parking section prescribes.

This ordering is load-bearing and is pinned by a test. `nextStage` returns
`parked` only when the **last** ledger entry starts with `PARKED`. A
`github: parked comment posted` line appended *after* the `PARKED` line would
make a parked run look resumable, and `/autopilot resume` would drive it
straight past the park — precisely the failure autopilot's parking section
warns about.

### Transition failures do not park

If a `move` or `comment` exits non-zero, append
`github: <action> failed — <reason>` and **continue**. Do not park, and do not
retry.

This follows the precedent autopilot's `pr` stage already sets: "If the
`gh pr edit` fails, do not park — the PR exists and the branch is green." The
run's product is the pull request; a stale board card is a reporting defect, not
a reason to abandon a green branch. The ledger line is what makes it visible
afterwards.

The one hard stop is Delta 0's preflight, which runs before anything else.

## Resume

`/autopilot-github resume <run>` recovers the issue number from the run name's
`issue-<n>-` prefix, so the hooks still know which issue to act on. Then follow
autopilot's own resume path: read `.superpowers/autopilot/<run>/run.md`, call
`nextStage`, jump to that stage. Each hook's idempotency check decides whether
it has work left to do.

If `nextStage` returns `parked`, stop as autopilot prescribes. The park comment
was already posted and its `github: parked comment posted` line already
recorded, so post nothing new.

## What this skill does not do

Out of scope, deliberately: creating issues, closing issues, reading issue
comments back into the run, reacting to board moves made by humans, and any
board field other than the single-select Status field.

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "I'll dispatch autopilot as a subagent and hook the transitions around it" | The hooks interleave with autopilot's stages and share its ledger. Behind a subagent boundary they are unreachable, and a park reports to you instead of to your human partner. |
| "I know the slug rules — I'll derive the run name myself on resume" | The slug is the ledger directory's key. A second derivation that differs by one character orphans the run. Take it from `resolve` or from the run name. |
| "The full issue body belongs in the ledger header" | The header regex is single-line. The body becomes untimestamped lines that `parseLedger` drops. The body goes to the brainstorm, not to `run.md`. |
| "I'll post the park comment after appending PARKED, it reads better" | Then `PARKED` is no longer the last entry, `nextStage` stops returning `parked`, and the next `/autopilot resume` drives the run past its park. |
| "The card move failed — I should park and ask" | A stale card is a reporting defect. Append `github: move failed — <reason>` and continue; the branch and the PR are the run's product. |
| "The issue isn't on the board, I'll just skip the config" | Preflight is a hard stop for a reason: a run with no board wiring silently produces none of this skill's value. Report the missing keys and stop. |
| "I'll run `gh project item-edit` directly, it's one command" | It needs an item id, a project id, a field id, and an option id, each from a separate call. The script resolves them and names every failure. Prose that shells out by hand gets them wrong silently. |
````

- [ ] **Step 4: Run the guard test to verify it passes**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-github-contract.test.mjs`
Expected: PASS — 15 tests.

- [ ] **Step 5: Verify the skill is a wrapper, not a copy**

Run: `grep -c "" plugins/autopilot/skills/autopilot-github/SKILL.md`
Expected: a line count well under `plugins/autopilot/skills/autopilot/SKILL.md`'s 536 — it restates none of the pipeline.

Run: `git status --porcelain plugins/autopilot/skills/autopilot/SKILL.md`
Expected: **empty** — autopilot's own SKILL.md must be untouched by this plan.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — 268 tests across 13 files.

- [ ] **Step 7: Commit**

```bash
git add plugins/autopilot/skills/autopilot-github/SKILL.md plugins/autopilot/scripts/autopilot-github-contract.test.mjs
git commit -m "feat(autopilot): add the autopilot-github wrapper skill"
```

---

### Task 6: Version bump to 1.6.0 and README

Bump both manifests, fix the existing test that hardcodes the prior version, and document the new command, skill, and config block in the repo README.

**Files:**
- Modify: `plugins/autopilot/.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `plugins/autopilot/scripts/autopilot-findings-contract.test.mjs`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing from earlier tasks programmatically — this is metadata and docs.
- Produces: nothing new.

- [ ] **Step 1: Confirm the current version and the test that pins it**

Run: `grep -n '"version"' plugins/autopilot/.claude-plugin/plugin.json .claude-plugin/marketplace.json`
Expected: `1.5.0` in both files (marketplace.json shows it twice: `metadata.version` and the `autopilot` plugin entry).

Run: `grep -n '1\.5\.0' plugins/autopilot/scripts/autopilot-findings-contract.test.mjs`
Expected: four matches — the `it("is at version 1.5.0", ...)` name and three string literals.

- [ ] **Step 2: Update the pinning test first, so it fails for the right reason**

In `plugins/autopilot/scripts/autopilot-findings-contract.test.mjs`, replace the three version assertions in the `plugin packaging` describe with:

```js
  it("is at version 1.6.0", () => {
    expect(pluginJson.version).toBe("1.6.0");
  });

  it("bumps the marketplace plugin entry to the same version", () => {
    const entry = marketplace.plugins.find((p) => p.name === "autopilot");
    expect(entry.version).toBe("1.6.0");
  });

  it("bumps the marketplace metadata block too", () => {
    // Two places in one file. Bumping only the plugin entry is the drift this
    // pins.
    expect(marketplace.metadata.version).toBe("1.6.0");
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-findings-contract.test.mjs`
Expected: FAIL — 3 assertions expect `"1.6.0"` but get `"1.5.0"`.

- [ ] **Step 4: Bump both manifests**

In `plugins/autopilot/.claude-plugin/plugin.json`, change `"version": "1.5.0",` to `"version": "1.6.0",`.

In `.claude-plugin/marketplace.json`, change BOTH occurrences — `metadata.version` and the `autopilot` entry's `version` under `plugins` — from `"1.5.0"` to `"1.6.0"`.

A new skill is additive, hence a minor bump. No manifest key changes: `"skills": ["./skills/"]` already picks up the new directory, and there is no command file to register.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-findings-contract.test.mjs`
Expected: PASS — 22 tests.

- [ ] **Step 6: Update the README's `### autopilot` section**

In `README.md`, replace the invocation block and the "Provides two skills" paragraph (currently lines 24–33) with:

```markdown
```
/autopilot <task description>
/autopilot resume <branch>
/autopilot-github <issue-number-or-URL>
/autopilot-github resume <run>
```

Provides three skills — `autopilot` (the orchestrator), `autopilot-brainstorm`
(Phase 1, a fork of `superpowers:brainstorming` that hands its design back in
conversation rather than writing a spec file, and drops the design-approval gate
so Phase 2 starts as soon as the questions are answered), and `autopilot-github`
(a thin wrapper that resolves a GitHub issue into the task description and run
name, then drives `autopilot` unchanged while moving the issue's Projects v2
card Ready → In Progress → In Review and commenting on the issue at each
transition). `autopilot-github` needs the `github` config block below; plain
`/autopilot` ignores it entirely.
```

Then, in the `#### Configuration` section, add a `github` row to the key table so it reads:

```markdown
| Key | Default | Purpose |
|---|---|---|
| `test_command` | *(none)* | Verifies the branch after rebase. Unset → `land` parks. |
| `base_ref` | `origin/main` | Branch point and rebase target |
| `worktree_dir` | `.claude/worktrees` | Where run worktrees are created |
| `reaper` | `true` | Prune merged worktrees at `setup` |
| `roles` | see defaults | Per-role `model` and `effort` for the nine dispatch roles |
| `github` | four status names | Projects v2 wiring for `/autopilot-github` only. Ignored by plain `/autopilot`. |
```

And immediately after that table, before the `CLAUDE_CODE_EFFORT_LEVEL` line, add:

```markdown
`/autopilot-github` additionally needs the two keys that cannot be guessed. The
four status names merge per key from the defaults, so this is usually the whole
block:

```json
{
  "test_command": "npm test",
  "github": {
    "project_owner": "BoTime",
    "project_number": 7
  }
}
```

`status_field` (`Status`), `status_ready` (`Ready`), `status_in_progress`
(`In Progress`), and `status_in_review` (`In Review`) default to those values and
only need overriding if your board names them differently. A missing
`project_owner` or `project_number` stops `/autopilot-github` at preflight,
naming the key — it never guesses.
```

- [ ] **Step 7: Update the stale test count in the README**

The `## Development` block says `npm test # vitest, 85 tests`. Run `npm test`, read the number the run actually reports, and replace `85` with it. Do not guess the number — use the suite's own output.

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS — 268 tests across 13 files, unchanged from Task 5.

- [ ] **Step 9: Validate the plugin manifest**

Run: `claude plugin validate ./plugins/autopilot`
Expected: no errors. If the `claude` CLI is unavailable in this environment, skip this step and say so — the vitest packaging assertions in Task 6 Step 5 already cover the version fields.

- [ ] **Step 10: Commit**

```bash
git add plugins/autopilot/.claude-plugin/plugin.json .claude-plugin/marketplace.json plugins/autopilot/scripts/autopilot-findings-contract.test.mjs README.md
git commit -m "chore(autopilot): bump to 1.6.0 and document autopilot-github"
```

---

## Expected test counts

Each task states the suite total it should reach. They assume the tests exactly as written above; if you add or merge a case, the totals shift by that amount and the later tasks' numbers shift with them. The counts are a sanity check, not a contract — a mismatch means recount, not force.

| After task | New tests | Suite total | Files |
|---|---|---|---|
| baseline | — | 175 | 10 |
| 1 | 14 | 189 | 10 |
| 2 | 22 | 211 | 11 |
| 3 | 26 | 237 | 11 |
| 4 | 16 | 253 | 12 |
| 5 | 15 | 268 | 13 |
| 6 | 0 | 268 | 13 |

---

## Open Questions

Noted rather than silently resolved. None blocks implementation — each has a stated default the plan already follows.

1. **The shape of `gh issue view --json projectItems`.** It has varied across `gh` versions, and this plan does not pin one. `matchProjectItem` reads the project under either `project` or `projectV2`, requires a matching number, compares the owner only when the payload supplies one, and returns `null` for anything it does not recognize — at which point `resolveItemId` falls back to `gh project item-list`, whose `content.number` is stable. The fallback is what makes the uncertainty safe; if a live run shows the issue-scoped path never matching, the fix is one branch in `matchProjectItem`, not a redesign.
2. **`resolveProjectId` is an extra `gh` call the spec's four-bullet list does not name.** `gh project item-edit` requires `--project-id` (the ProjectV2 node id), which neither `field-list` nor `item-list` returns, so `gh project view --format json` supplies it. Recorded here because it is an addition to the spec's enumerated calls, not a deviation from its design.
3. **Which subcommands validate the `github` block.** The spec says the validator is called by "the wrapper's preflight and the script's own subcommands". `preflight` and `move` call it — those are the two that read `config.github`. `resolve` and `comment` need only `gh` and an issue number, so requiring board config for them would make the script fail in projects that have `gh` but no board, for no gain. Delta 0's preflight still gates the whole run, so the wrapper's behavior is unchanged either way.
4. **`gh` authentication is assumed, not re-checked.** autopilot's own preflight already requires `gh auth status` to succeed, and this wrapper runs after it. A `gh` call that fails on auth surfaces as a named non-zero exit like any other failure.
5. **Comment bodies are composed by the wrapper's prose, not templated in code.** The script takes `--body`/`--body-file` and posts what it is given. Templating the three comment bodies would move copy into the script for no testability gain — their content is judgment (which paths and links to mention), not logic.
