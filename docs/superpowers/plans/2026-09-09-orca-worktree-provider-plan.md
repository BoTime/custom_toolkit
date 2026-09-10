# Orca as the Worktree Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Orca the default creator of autopilot run worktrees, with git as an explicit alternative and as an automatic, never-parking fallback.

**Architecture:** A new `worktree_provider` config key (`orca` | `git`) is read by a new script, `autopilot-worktree.mjs create`, which prints exactly one of three lines the `setup` stage acts on. The same module holds the Orca primitives — repo-id resolution, JSON parsing, failure wording — and `autopilot-reaper.mjs` imports them for a new `--provider=orca` removal mode. Every provider failure degrades to the existing git path; the only non-zero exit is a usage error.

**Tech Stack:** Node ESM (`.mjs`), vitest, `node:child_process.execFileSync` with argv arrays, the `orca` CLI, markdown SKILL contracts pinned by contract tests.

**Spec:** `docs/superpowers/specs/2026-09-09-orca-worktree-provider-design.md`

## Global Constraints

- Allowed `worktree_provider` values are exactly `"orca"` and `"git"`. An invalid value is a load error reading `worktree_provider: "<value>" is not one of orca, git`.
- The create script's three output lines are literal and load-bearing: `worktree: <path> (branch <branch>)`, `provider: git`, `fallback: git — <reason>`. The dash in the fallback line is an em dash (`—`), matching the spec.
- The ledger's fallback line is literal too: `worktree provider: fell back to git — <reason>`.
- The reaper's unavailable line is literal: `orca unavailable — <reason>; nothing reaped`.
- Provider failure is **never** a park and **never** a non-zero exit. The create script exits non-zero only on a usage error (missing/malformed flag, unreadable config, invalid `worktree_provider`). The reaper's orca mode exits 0 on every Orca problem.
- All subprocesses go through `execFileSync` with **argv arrays**. Run names, paths and branch names never enter a shell string — a run name is derived from an untrusted GitHub issue title.
- Branch names from Orca arrive as `refs/heads/<name>` and are stripped to the bare name before they reach any output line.
- **Never assert a version literal in any test** (see `CLAUDE.md`). The version is CI-owned.
- `plugins/autopilot/skills/autopilot/SKILL.md` must stay under 42,000 JS string characters — `skill-sections.test.mjs` asserts it and there are only **90 characters of headroom today** (41,910). Task 3 budgets this explicitly.

---

## File Structure

**Created**
- `plugins/autopilot/scripts/autopilot-worktree.mjs` — the provider module: `create` subcommand, Orca argv building, envelope/JSON parsing, repo-id resolution, failure wording, `resolveMainPath` (moved here from the reaper so the dependency runs one way only: reaper → worktree).
- `plugins/autopilot/scripts/autopilot-worktree.test.mjs` — unit tests for all of the above, with a stubbed exec. No test shells out to a real binary.
- `plugins/autopilot/skills/autopilot/references/stages/worktree-provider.md` — the three-outcome table and the git path, referenced from SKILL.md's `setup` section so it resolves into the section without costing SKILL.md its size budget.
- `plugins/autopilot/scripts/autopilot-worktree-contract.test.mjs` — pins the SKILL.md prose the orchestrator executes.

**Modified**
- `plugins/autopilot/autopilot.default.json`, `plugins/autopilot/autopilot.codex.default.json` — the `worktree_provider` key.
- `plugins/autopilot/scripts/autopilot-config.mjs` — `WORKTREE_PROVIDERS`, `TOP_LEVEL`, validation.
- `plugins/autopilot/scripts/autopilot-config.test.mjs` — the `validConfig()` fixture plus a new `worktree_provider` describe and one `scaffoldConfig` assertion.
- `plugins/autopilot/scripts/autopilot-artifacts.test.mjs` — its hand-built `base` config fixture, which calls `validateConfig` and expects `ok: true`.
- `plugins/autopilot/scripts/autopilot-reaper.mjs` — `resolveMainPath` moved out and imported back; `structuralReason` extracted; `--provider=` flag; `reapOrca`.
- `plugins/autopilot/scripts/autopilot-reaper.test.mjs` — the `resolveMainPath` describe moves out; orca-mode tests move in.
- `plugins/autopilot/skills/autopilot/SKILL.md` — `setup` calls the script; the reaper gains `--provider=`; the `worktree-`-prefix claim in "The run directory" goes.
- `plugins/autopilot/skills/autopilot-github/SKILL.md` — Delta 2 passes `--issue`, and stops asserting the branch is always `worktree-<run>`.
- `plugins/autopilot/scripts/autopilot-github-contract.test.mjs` — pins the `--issue` prose.
- `README.md` — the config table gains a `worktree_provider` row.

**Repository facts this plan asserts, each verified in this worktree**
- `TOP_LEVEL` in `autopilot-config.mjs:60` is today `["worktree_dir", "base_ref", "reaper", "findings_threshold"]`. Adding a key to it makes an absent value a **hard error**, which is why the two hand-built test fixtures below must be updated in the same task.
- `autopilot-config.test.mjs:32` (`validConfig()`) and `autopilot-artifacts.test.mjs:133` (`base`) are the only hand-built configs that reach `validateConfig`. `dispatch-fixture.mjs`'s `defaultConfig()` reads the shipped defaults file, so it inherits the new key with no edit. Verified: `grep -n "validateConfig(" plugins/autopilot/scripts/*.test.mjs`.
- `plugins/autopilot/skills/autopilot/SKILL.md` is 41,910 JS characters; the ceiling is 42,000.
- `nextStage` matches the worktree entry with `has("worktree:")` (`autopilot-ledger.mjs:92`), so `worktree provider: …` cannot be mistaken for it. Task 3 pins that.
- The orphan-fragment test in `skill-sections.test.mjs` scans `references/dispatch/` only; a new fragment under `references/stages/` is not an orphan candidate, and `references/stages/verify-run.md` is the existing precedent for an orchestrator-facing fragment named from SKILL.md prose.
- Observed Orca CLI shapes (run against the installed binary): `orca worktree current --json` → `result.worktree.{path,branch,repoId,isMainWorktree}`; `orca repo show --repo path:<p> --json` → `result.repo.id`; `orca worktree list --json` → `result.worktrees[]`; a failure envelope is `{"ok": false, "error": {"code": "...", "message": "..."}}` — `error` is an **object**, not a string. The envelope's top-level `id` is a request id, never a repo id.

---

### Task 1: The `worktree_provider` key and the create script

Config and script ship together: the script's only job is to act on the key, and neither can be reviewed or tested without the other.

**Files:**
- Modify: `plugins/autopilot/autopilot.default.json`
- Modify: `plugins/autopilot/autopilot.codex.default.json`
- Modify: `plugins/autopilot/scripts/autopilot-config.mjs:60` (`TOP_LEVEL`) and the validator
- Modify: `plugins/autopilot/scripts/autopilot-config.test.mjs:32` (`validConfig()`) and the `scaffoldConfig` describe
- Modify: `plugins/autopilot/scripts/autopilot-artifacts.test.mjs:133` (`base`)
- Modify: `plugins/autopilot/scripts/autopilot-reaper.mjs` (remove `resolveMainPath`, import it)
- Modify: `plugins/autopilot/scripts/autopilot-reaper.test.mjs` (remove the `resolveMainPath` describe)
- Modify: `README.md` (config table)
- Create: `plugins/autopilot/scripts/autopilot-worktree.mjs`
- Test: `plugins/autopilot/scripts/autopilot-worktree.test.mjs`

**Interfaces:**
- Consumes: `loadConfig(path, env, readFile, defaultsPath, { host })` and `assertHost(host)` / `resolveConfigPath(host)` from the existing modules.
- Produces, all from `plugins/autopilot/scripts/autopilot-worktree.mjs`:
  - `WORKTREE_PROVIDERS: string[]` (re-exported from `autopilot-config.mjs`, where it is defined)
  - `resolveMainPath(run: () => string): string`
  - `baseBranchOf(baseRef: string, remotes?: string[]): string`
  - `stripRefsHeads(branch: string): string`
  - `createArgv({ name, repoId, baseBranch, issue }): string[]`
  - `parseWorktreeResult(stdout: string): {ok:true, worktree:{path,branch,locked,isMain}} | {ok:false, reason:string}`
  - `parseWorktreeList(stdout: string): {ok:true, worktrees:Array<{path,branch,locked,isMain}>} | {ok:false, reason:string}`
  - `resolveRepoId(exec, mainPath): {ok:true,id:string} | {ok:false,reason:string}`
  - `failureReason(error): string`
  - `formatOutcome(outcome): string`
  - `createWithOrca({ exec, cwd, name, base, issue }): outcome`
  - `main(argv?, io?): number`
  - `exec` everywhere has the signature `(file: string, args: string[], opts: {cwd: string}) => string` and throws on a non-zero exit, mirroring `execFileSync`.

- [ ] **Step 1: Add the key to both shipped defaults**

In `plugins/autopilot/autopilot.default.json` and `plugins/autopilot/autopilot.codex.default.json`, insert the new key on the line immediately after `"worktree_dir": ".claude/worktrees",` in each file:

```json
  "worktree_provider": "orca",
```

- [ ] **Step 2: Write the failing config tests**

Append this describe block to the end of `plugins/autopilot/scripts/autopilot-config.test.mjs`, and add `WORKTREE_PROVIDERS` to the import list at the top of the file that already pulls `ROLES`, `EFFORTS`, `mergeConfig`, `validateConfig`, `loadConfig` from `./autopilot-config.mjs`:

```js
// `worktree_provider` decides who creates the run's worktree. It is in
// TOP_LEVEL — unlike `minimalism` and `tiers` — because the shipped defaults
// always supply it, so a project config that predates the key still loads: the
// merge fills it in. A typo must not degrade quietly into one of the two
// providers; that is indistinguishable from never having configured it.
describe("worktree_provider", () => {
  const DEFAULTS = "/plugin/autopilot.default.json";
  const PROJECT = "/proj/.superpowers/autopilot/configs/autopilot.json";
  const reader = (files) => (p) => {
    if (!(p in files)) throw new Error("ENOENT");
    return files[p];
  };

  it("lists exactly the two providers", () => {
    expect(WORKTREE_PROVIDERS).toEqual(["orca", "git"]);
  });

  it("ships orca in both default config files", () => {
    for (const host of ["claude", "codex"]) {
      const shipped = JSON.parse(readFileSync(hostDefaultsPath(host), "utf8"));
      expect(shipped.worktree_provider).toBe("orca");
    }
  });

  it("returns orca when the project config says nothing", () => {
    const readFile = reader({ [DEFAULTS]: JSON.stringify(validConfig()) });
    const { config } = loadConfig(PROJECT, {}, readFile, DEFAULTS);
    expect(config.worktree_provider).toBe("orca");
  });

  it("accepts git from the project config", () => {
    const readFile = reader({
      [DEFAULTS]: JSON.stringify(validConfig()),
      [PROJECT]: JSON.stringify({ worktree_provider: "git" }),
    });
    const { config } = loadConfig(PROJECT, {}, readFile, DEFAULTS);
    expect(config.worktree_provider).toBe("git");
  });

  it("rejects any other value, naming the offending value and the two legal ones", () => {
    const result = validateConfig(
      { ...validConfig(), worktree_provider: "orka" },
      {},
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      'worktree_provider: "orka" is not one of orca, git',
    );
  });

  it("rejects a missing value", () => {
    const cfg = validConfig();
    delete cfg.worktree_provider;
    const result = validateConfig(cfg, {});
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("worktree_provider: missing");
  });
});
```

`validConfig()` must already carry the key for the last two assertions to be about `worktree_provider` rather than about a fixture that was never valid — Step 5 adds it. `hostDefaultsPath` and `readFileSync` are already imported by this file.

- [ ] **Step 3: Run the config tests to verify they fail**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-config.test.mjs -t worktree_provider`
Expected: FAIL — `WORKTREE_PROVIDERS` is not exported, and no error mentions `worktree_provider`.

- [ ] **Step 4: Implement the key in `autopilot-config.mjs`**

Add the export immediately after the `TIERS` export:

```js
/**
 * Who creates the run's worktree. `orca` hands the job to the Orca CLI, which
 * names the branch itself and links the checkout to its issue; `git` uses
 * `superpowers:using-git-worktrees` as autopilot always has.
 *
 * Unlike `minimalism` and `tiers` this key IS in `TOP_LEVEL`: the shipped
 * defaults always supply it, so the merged view always has one, and a project
 * config that predates the key still loads. What that buys is the rejection
 * below — a typo that silently degraded into a provider would be
 * indistinguishable from never having configured the feature.
 */
export const WORKTREE_PROVIDERS = ["orca", "git"];
```

Extend `TOP_LEVEL`:

```js
const TOP_LEVEL = [
  "worktree_dir", "worktree_provider", "base_ref", "reaper", "findings_threshold",
];
```

And add the value check to `validateConfig`, directly after the `findings_threshold` check:

```js
  // Absent is already an error via TOP_LEVEL; this catches a present typo.
  const provider = obj.worktree_provider;
  if (provider !== undefined && !WORKTREE_PROVIDERS.includes(provider)) {
    errors.push(
      `worktree_provider: "${provider}" is not one of ${WORKTREE_PROVIDERS.join(", ")}`,
    );
  }
```

- [ ] **Step 5: Repair the two hand-built config fixtures**

In `plugins/autopilot/scripts/autopilot-config.test.mjs`, inside `validConfig()`, add the key on the line after `worktree_dir: ".claude/worktrees",`:

```js
  worktree_provider: "orca",
```

In `plugins/autopilot/scripts/autopilot-artifacts.test.mjs`, inside the `base` object, add the same line after its `worktree_dir` line.

Then add one assertion to the existing `scaffoldConfig` describe in `autopilot-config.test.mjs`, so the scaffolded project config is pinned to carry the key:

```js
  it("carries worktree_provider into the scaffolded config", () => {
    const { writes, deps } = harness();
    scaffoldConfig(CLAUDE_PROJECT, { host: "claude", ...deps });
    expect(JSON.parse(writes[0].text).worktree_provider).toBe("orca");
  });
```

- [ ] **Step 6: Run the config and artifacts tests to verify they pass**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-config.test.mjs plugins/autopilot/scripts/autopilot-artifacts.test.mjs`
Expected: PASS, all files.

- [ ] **Step 7: Write the failing worktree-module tests**

Create `plugins/autopilot/scripts/autopilot-worktree.test.mjs`:

```js
// The provider module never shells out in these tests: every subprocess goes
// through an injected `exec`, so the whole failure surface — a missing binary,
// an unregistered repo, a non-`ok` envelope, unparsable output, a failing
// create — is exercised without an `orca` on PATH.
//
// `resolveMainPath` and its tests moved here from autopilot-reaper.mjs: the
// create script needs it too, and the reaper now imports it from here, keeping
// the dependency one-directional (reaper → worktree).

import { describe, it, expect } from "vitest";
import { readFileSync as readFileSyncReal } from "node:fs";
import {
  resolveMainPath,
  baseBranchOf,
  stripRefsHeads,
  createArgv,
  parseWorktreeResult,
  parseWorktreeList,
  resolveRepoId,
  formatOutcome,
  createWithOrca,
  main,
} from "./autopilot-worktree.mjs";

const REPO_ID = "ddda53e7-fa32-4042-baea-8cd6e91aa543";
const WT_PATH = "/Users/x/orca/workspaces/repo/issue-48-thing";
const BRANCH = "refs/heads/BoTime/issue-48-thing";

const okEnvelope = (result) => JSON.stringify({ id: "req-1", ok: true, result });
const worktreeEnvelope = (over = {}) =>
  okEnvelope({
    worktree: {
      repoId: REPO_ID, path: WT_PATH, branch: BRANCH, isMainWorktree: false, ...over,
    },
  });

/** An execFileSync-shaped failure: throws, carrying `code` or `stderr`. */
const boom = (props) => () => {
  const error = new Error(props.message ?? "Command failed");
  Object.assign(error, props);
  throw error;
};

describe("resolveMainPath", () => {
  it("resolves the primary checkout from a linked worktree's git-common-dir", () => {
    expect(resolveMainPath(() => "/repo/.git\n")).toBe("/repo");
  });

  it("resolves the primary checkout from the primary checkout's own git-common-dir", () => {
    expect(resolveMainPath(() => "/repo/.git/worktrees/wt\n")).toBe("/repo");
  });
});

describe("baseBranchOf", () => {
  it("strips a remote prefix", () => {
    expect(baseBranchOf("origin/main", ["origin"])).toBe("main");
  });

  it("strips a non-origin remote prefix", () => {
    expect(baseBranchOf("upstream/trunk", ["origin", "upstream"])).toBe("trunk");
  });

  it("passes a bare branch name through unchanged", () => {
    expect(baseBranchOf("main", ["origin"])).toBe("main");
  });

  it("leaves a slashed branch name that is not a remote alone", () => {
    // The whole reason the remote list is a parameter: blindly stripping the
    // first segment would turn a real branch into a different one.
    expect(baseBranchOf("release/2026-09", ["origin"])).toBe("release/2026-09");
  });
});

describe("stripRefsHeads", () => {
  it("strips the refs/heads/ prefix", () => {
    expect(stripRefsHeads("refs/heads/BoTime/x")).toBe("BoTime/x");
  });

  it("leaves a bare branch name alone", () => {
    expect(stripRefsHeads("BoTime/x")).toBe("BoTime/x");
  });
});

describe("createArgv", () => {
  it("builds the create argv without an issue", () => {
    expect(createArgv({ name: "issue-48-thing", repoId: REPO_ID, baseBranch: "main" }))
      .toEqual([
        "worktree", "create",
        "--name", "issue-48-thing",
        "--repo", `id:${REPO_ID}`,
        "--base-branch", "main",
        "--no-parent", "--json",
      ]);
  });

  it("inserts --issue before --no-parent when one is given", () => {
    expect(createArgv({
      name: "issue-48-thing", repoId: REPO_ID, baseBranch: "main", issue: "48",
    })).toEqual([
      "worktree", "create",
      "--name", "issue-48-thing",
      "--repo", `id:${REPO_ID}`,
      "--base-branch", "main",
      "--issue", "48",
      "--no-parent", "--json",
    ]);
  });
});

describe("parseWorktreeResult", () => {
  it("returns the path and the branch with refs/heads/ stripped", () => {
    const r = parseWorktreeResult(worktreeEnvelope());
    expect(r.ok).toBe(true);
    expect(r.worktree.path).toBe(WT_PATH);
    expect(r.worktree.branch).toBe("BoTime/issue-48-thing");
  });

  it("fails on output that is not JSON", () => {
    const r = parseWorktreeResult("orca: command not found");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not JSON/);
  });

  it("fails on a non-ok envelope, quoting orca's own message", () => {
    const r = parseWorktreeResult(
      JSON.stringify({ ok: false, error: { code: "repo_not_found", message: "repo_not_found" } }),
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("repo_not_found");
  });

  it("fails when the worktree carries no usable path", () => {
    const r = parseWorktreeResult(okEnvelope({ worktree: { branch: BRANCH } }));
    expect(r.ok).toBe(false);
  });

  it("fails when the worktree carries no usable branch", () => {
    const r = parseWorktreeResult(okEnvelope({ worktree: { path: WT_PATH } }));
    expect(r.ok).toBe(false);
  });
});

describe("parseWorktreeList", () => {
  it("reads every row, keeping isMainWorktree and a null branch", () => {
    const r = parseWorktreeList(okEnvelope({
      worktrees: [
        { path: "/repo", branch: "refs/heads/main", isMainWorktree: true },
        { path: "/wt/a", branch: "refs/heads/a", isMainWorktree: false },
        { path: "/wt/detached", isMainWorktree: false },
      ],
    }));
    expect(r.ok).toBe(true);
    expect(r.worktrees).toEqual([
      { path: "/repo", branch: "main", locked: false, isMain: true },
      { path: "/wt/a", branch: "a", locked: false, isMain: false },
      { path: "/wt/detached", branch: null, locked: false, isMain: false },
    ]);
  });

  it("fails when the result carries no worktrees array", () => {
    expect(parseWorktreeList(okEnvelope({ worktree: {} })).ok).toBe(false);
  });
});

describe("resolveRepoId", () => {
  it("takes repoId from `orca worktree current`", () => {
    const r = resolveRepoId(() => worktreeEnvelope(), "/repo");
    expect(r).toEqual({ ok: true, id: REPO_ID });
  });

  it("falls back to `orca repo show` when current reports nothing usable", () => {
    const calls = [];
    const exec = (file, args) => {
      calls.push(args.slice(0, 2).join(" "));
      if (args[0] === "worktree") return JSON.stringify({ ok: false, error: { message: "no worktree" } });
      return okEnvelope({ repo: { id: REPO_ID, path: "/repo" } });
    };
    expect(resolveRepoId(exec, "/repo")).toEqual({ ok: true, id: REPO_ID });
    expect(calls).toEqual(["worktree current", "repo show"]);
  });

  it("passes the main checkout as a path selector to `orca repo show`", () => {
    let seen = null;
    const exec = (file, args) => {
      if (args[0] === "repo") { seen = args; return okEnvelope({ repo: { id: REPO_ID } }); }
      return JSON.stringify({ ok: false, error: { message: "no worktree" } });
    };
    resolveRepoId(exec, "/repo");
    expect(seen).toEqual(["repo", "show", "--repo", "path:/repo", "--json"]);
  });

  it("reports the missing binary when orca is not on PATH", () => {
    const r = resolveRepoId(boom({ code: "ENOENT" }), "/repo");
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("orca CLI not found on PATH");
  });

  it("reports an unregistered repo when both probes come back empty", () => {
    const exec = () => okEnvelope({});
    const r = resolveRepoId(exec, "/repo");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/repo id/);
  });

  it("never mistakes the envelope's request id for a repo id", () => {
    // The envelope's top-level `id` is a request id. Reading it would resolve
    // a different id on every invocation and every create would fail.
    const r = resolveRepoId(() => JSON.stringify({ id: "req-1", ok: true, result: {} }), "/repo");
    expect(r.ok).toBe(false);
  });
});

describe("formatOutcome", () => {
  it("formats an orca success", () => {
    expect(formatOutcome({ kind: "orca", path: "/wt/a", branch: "BoTime/x" }))
      .toBe("worktree: /wt/a (branch BoTime/x)");
  });

  it("formats the git short-circuit", () => {
    expect(formatOutcome({ kind: "git" })).toBe("provider: git");
  });

  it("formats a fallback with its reason", () => {
    expect(formatOutcome({ kind: "fallback", reason: "orca CLI not found on PATH" }))
      .toBe("fallback: git — orca CLI not found on PATH");
  });
});

describe("createWithOrca", () => {
  const gitOk = (args) => {
    if (args[0] === "rev-parse") return "/repo/.git\n";
    if (args[0] === "remote") return "origin\n";
    throw new Error(`unexpected git ${args.join(" ")}`);
  };

  it("creates through orca and reports the path and stripped branch", () => {
    const seen = [];
    const exec = (file, args) => {
      seen.push([file, ...args]);
      if (file === "git") return gitOk(args);
      if (args[1] === "current") return worktreeEnvelope();
      return worktreeEnvelope();
    };
    const outcome = createWithOrca({
      exec, cwd: "/repo", name: "issue-48-thing", base: "origin/main", issue: "48",
    });
    expect(outcome).toEqual({
      kind: "orca", path: WT_PATH, branch: "BoTime/issue-48-thing",
    });
    const create = seen.find((c) => c[0] === "orca" && c[2] === "create");
    expect(create).toEqual([
      "orca", "worktree", "create",
      "--name", "issue-48-thing",
      "--repo", `id:${REPO_ID}`,
      "--base-branch", "main",
      "--issue", "48",
      "--no-parent", "--json",
    ]);
  });

  it("falls back when the orca binary is missing", () => {
    const exec = (file, args) => {
      if (file === "git") return gitOk(args);
      return boom({ code: "ENOENT" })();
    };
    expect(createWithOrca({ exec, cwd: "/repo", name: "n", base: "origin/main" }))
      .toEqual({ kind: "fallback", reason: "orca CLI not found on PATH" });
  });

  it("falls back when the repo id cannot be resolved", () => {
    const exec = (file, args) => (file === "git" ? gitOk(args) : okEnvelope({}));
    const outcome = createWithOrca({ exec, cwd: "/repo", name: "n", base: "origin/main" });
    expect(outcome.kind).toBe("fallback");
    expect(outcome.reason).toMatch(/repo id/);
  });

  it("falls back when create exits non-zero, quoting its first stderr line", () => {
    const exec = (file, args) => {
      if (file === "git") return gitOk(args);
      if (args[1] === "current") return worktreeEnvelope();
      return boom({ stderr: "base branch does not exist\nmore detail\n" })();
    };
    const outcome = createWithOrca({ exec, cwd: "/repo", name: "n", base: "origin/main" });
    expect(outcome.kind).toBe("fallback");
    expect(outcome.reason).toContain("base branch does not exist");
    expect(outcome.reason).not.toContain("more detail");
  });

  it("falls back when create returns a non-ok envelope", () => {
    const exec = (file, args) => {
      if (file === "git") return gitOk(args);
      if (args[1] === "current") return worktreeEnvelope();
      return JSON.stringify({ ok: false, error: { message: "name already in use" } });
    };
    expect(createWithOrca({ exec, cwd: "/repo", name: "n", base: "origin/main" }))
      .toEqual({ kind: "fallback", reason: "name already in use" });
  });

  it("falls back when create returns unparsable output", () => {
    const exec = (file, args) => {
      if (file === "git") return gitOk(args);
      if (args[1] === "current") return worktreeEnvelope();
      return "Created worktree.";
    };
    const outcome = createWithOrca({ exec, cwd: "/repo", name: "n", base: "origin/main" });
    expect(outcome.kind).toBe("fallback");
    expect(outcome.reason).toMatch(/not JSON/);
  });

  it("keeps origin as the remote list when `git remote` fails", () => {
    const exec = (file, args) => {
      if (file === "git" && args[0] === "rev-parse") return "/repo/.git\n";
      if (file === "git") throw new Error("no remotes");
      if (args[1] === "current") return worktreeEnvelope();
      expect(args).toContain("main"); // origin/ still stripped
      return worktreeEnvelope();
    };
    expect(createWithOrca({ exec, cwd: "/repo", name: "n", base: "origin/main" }).kind)
      .toBe("orca");
  });
});

describe("main", () => {
  const DEFAULTS = "/plugin/autopilot.default.json";
  const CONFIG = "/proj/.superpowers/autopilot/configs/autopilot.json";
  const config = (provider) => JSON.stringify({ worktree_provider: provider });

  // Only the merged view matters here, so `readFile` serves a project config
  // and lets loadConfig layer it over the plugin's real shipped defaults.
  const io = (provider, exec) => {
    const out = [];
    const errs = [];
    return {
      out,
      errs,
      io: {
        exec,
        env: {},
        cwd: "/repo",
        readFile: (p) => (p === CONFIG ? config(provider) : readFileSyncReal(p)),
        log: (line) => out.push(line),
        err: (line) => errs.push(line),
      },
    };
  };

  it("prints `provider: git` and exits 0 under the git provider", () => {
    const { out, io: deps } = io("git", () => { throw new Error("must not run"); });
    expect(main(["create", `--config=${CONFIG}`, "--host=claude", "--name=n", "--base=origin/main"], deps))
      .toBe(0);
    expect(out).toEqual(["provider: git"]);
  });

  it("prints the fallback line and exits 0 when orca is unavailable", () => {
    const exec = (file, args) => {
      if (file === "git" && args[0] === "rev-parse") return "/repo/.git\n";
      if (file === "git") return "origin\n";
      const e = new Error("not found"); e.code = "ENOENT"; throw e;
    };
    const { out, io: deps } = io("orca", exec);
    expect(main(["create", `--config=${CONFIG}`, "--host=claude", "--name=n", "--base=origin/main"], deps))
      .toBe(0);
    expect(out).toEqual(["fallback: git — orca CLI not found on PATH"]);
  });

  it("exits non-zero on a missing --name, which is a usage error not a fallback", () => {
    const { out, errs, io: deps } = io("orca", () => { throw new Error("must not run"); });
    expect(main(["create", `--config=${CONFIG}`, "--host=claude", "--base=origin/main"], deps))
      .not.toBe(0);
    expect(out).toEqual([]);
    expect(errs.join(" ")).toMatch(/--name/);
  });

  it("exits non-zero on an unknown subcommand", () => {
    const { io: deps } = io("orca", () => { throw new Error("must not run"); });
    expect(main(["destroy"], deps)).not.toBe(0);
  });
});
```

- [ ] **Step 8: Run the worktree tests to verify they fail**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-worktree.test.mjs`
Expected: FAIL — cannot resolve `./autopilot-worktree.mjs`.

- [ ] **Step 9: Create `autopilot-worktree.mjs`**

```js
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { assertHost, resolveConfigPath } from "./autopilot-host.mjs";
import { WORKTREE_PROVIDERS, loadConfig } from "./autopilot-config.mjs";

export { WORKTREE_PROVIDERS };

const REFS_HEADS = "refs/heads/";

/**
 * The primary checkout, walked up from a `git rev-parse --git-common-dir`
 * result. Lives here rather than in autopilot-reaper.mjs because both the
 * create path and the reaper need it, and the reaper imports this module —
 * the dependency runs one way only.
 */
export function resolveMainPath(run) {
  let dir = resolve(run().trim());
  while (basename(dir) !== ".git" && dirname(dir) !== dir) {
    dir = dirname(dir);
  }
  return dirname(dir);
}

/**
 * `base_ref` is a ref (`origin/main`); Orca's `--base-branch` wants a branch
 * name. The remote list is a parameter rather than a guess: stripping the
 * first path segment blindly would turn `release/2026-09` into `2026-09`.
 */
export function baseBranchOf(baseRef, remotes = ["origin"]) {
  for (const remote of remotes) {
    if (baseRef.startsWith(`${remote}/`)) return baseRef.slice(remote.length + 1);
  }
  return baseRef;
}

export function stripRefsHeads(branch) {
  return branch.startsWith(REFS_HEADS) ? branch.slice(REFS_HEADS.length) : branch;
}

/** One line of human-readable cause from a thrown execFileSync error. */
export function failureReason(error) {
  if (error?.code === "ENOENT") return "orca CLI not found on PATH";
  const stderr = typeof error?.stderr === "string" ? error.stderr : "";
  const first = stderr.split("\n").map((l) => l.trim()).find(Boolean);
  return first || error?.message || "the command exited non-zero";
}

/**
 * `--no-parent` is deliberate: an autopilot run is independent work, and Orca
 * would otherwise infer the caller's worktree as a parent and inherit lineage
 * that does not apply.
 */
export function createArgv({ name, repoId, baseBranch, issue }) {
  const argv = [
    "worktree", "create",
    "--name", name,
    "--repo", `id:${repoId}`,
    "--base-branch", baseBranch,
  ];
  if (issue !== undefined && issue !== null && issue !== "") {
    argv.push("--issue", String(issue));
  }
  argv.push("--no-parent", "--json");
  return argv;
}

/** orca's failure envelope carries an object, not a string. */
function envelopeError(parsed) {
  const error = parsed?.error;
  if (typeof error === "string" && error) return error;
  if (error && typeof error === "object") {
    for (const key of ["message", "code"]) {
      if (typeof error[key] === "string" && error[key]) return error[key];
    }
  }
  return "orca reported a failure";
}

function parseEnvelope(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { ok: false, reason: "orca returned output that is not JSON" };
  }
  if (!parsed || typeof parsed !== "object" || parsed.ok !== true) {
    return { ok: false, reason: envelopeError(parsed) };
  }
  if (!parsed.result || typeof parsed.result !== "object") {
    return { ok: false, reason: "orca returned no result object" };
  }
  return { ok: true, result: parsed.result };
}

/**
 * One Orca row in the shape `classify`/`planReap` in autopilot-reaper.mjs
 * read: `locked` is always false (Orca has no lock concept) and a detached
 * checkout keeps its path with a null branch, so the reaper reports it as a
 * detached HEAD rather than silently losing it.
 */
function entryOf(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.path !== "string" || raw.path === "") return null;
  const branch =
    typeof raw.branch === "string" && raw.branch !== "" ? stripRefsHeads(raw.branch) : null;
  return { path: raw.path, branch, locked: false, isMain: raw.isMainWorktree === true };
}

/** `orca worktree create|current|show --json` → the single worktree it names. */
export function parseWorktreeResult(stdout) {
  const envelope = parseEnvelope(stdout);
  if (!envelope.ok) return envelope;
  const worktree = entryOf(envelope.result.worktree);
  if (!worktree || worktree.branch === null) {
    return { ok: false, reason: "orca reported no usable worktree path and branch" };
  }
  return { ok: true, worktree };
}

/** `orca worktree list --json` → every row, unusable ones dropped. */
export function parseWorktreeList(stdout) {
  const envelope = parseEnvelope(stdout);
  if (!envelope.ok) return envelope;
  const rows = envelope.result.worktrees;
  if (!Array.isArray(rows)) return { ok: false, reason: "orca returned no worktree list" };
  return { ok: true, worktrees: rows.map(entryOf).filter(Boolean) };
}

/**
 * The Orca repo id for the checkout at `mainPath`. The main checkout may not
 * itself be an Orca-managed worktree, so `worktree current` can come back
 * empty while the repo is still registered — hence the `repo show` fallback.
 *
 * The envelope's top-level `id` is a request id and is never read here.
 */
export function resolveRepoId(exec, mainPath) {
  // Carries orca's own wording out to the caller when it explains itself, so
  // the fallback and `orca unavailable` lines say `repo_not_found` rather than
  // a generic sentence.
  let lastReason = "orca reported no repo id for this checkout";
  const idFrom = (stdout, pick) => {
    const envelope = parseEnvelope(stdout);
    if (!envelope.ok) {
      lastReason = envelope.reason;
      return null;
    }
    const id = pick(envelope.result);
    return typeof id === "string" && id !== "" ? id : null;
  };

  let current;
  try {
    current = exec("orca", ["worktree", "current", "--json"], { cwd: mainPath });
  } catch (error) {
    return { ok: false, reason: failureReason(error) };
  }
  const fromCurrent = idFrom(current, (r) => r.worktree?.repoId);
  if (fromCurrent) return { ok: true, id: fromCurrent };

  let shown;
  try {
    shown = exec("orca", ["repo", "show", "--repo", `path:${mainPath}`, "--json"], {
      cwd: mainPath,
    });
  } catch (error) {
    return { ok: false, reason: failureReason(error) };
  }
  const fromRepo = idFrom(shown, (r) => r.repo?.id);
  if (fromRepo) return { ok: true, id: fromRepo };

  return { ok: false, reason: lastReason };
}

export function formatOutcome(outcome) {
  if (outcome.kind === "git") return "provider: git";
  if (outcome.kind === "fallback") return `fallback: git — ${outcome.reason}`;
  return `worktree: ${outcome.path} (branch ${outcome.branch})`;
}

/**
 * Every failure here returns a `fallback` outcome. Autopilot's Phase 2 is
 * unattended; a provider that can halt a run is worse than no provider at all.
 */
export function createWithOrca({ exec, cwd, name, base, issue }) {
  let mainPath;
  try {
    mainPath = resolveMainPath(() => exec("git", ["rev-parse", "--git-common-dir"], { cwd }));
  } catch (error) {
    return { kind: "fallback", reason: `cannot locate the main checkout (${failureReason(error)})` };
  }

  const repo = resolveRepoId(exec, mainPath);
  if (!repo.ok) return { kind: "fallback", reason: repo.reason };

  let remotes = ["origin"];
  try {
    const listed = exec("git", ["remote"], { cwd: mainPath })
      .split("\n").map((l) => l.trim()).filter(Boolean);
    if (listed.length > 0) remotes = listed;
  } catch {
    // Not a provider problem: `origin` is the shipped default's prefix.
  }

  let stdout;
  try {
    stdout = exec(
      "orca",
      createArgv({ name, repoId: repo.id, baseBranch: baseBranchOf(base, remotes), issue }),
      { cwd: mainPath },
    );
  } catch (error) {
    return { kind: "fallback", reason: failureReason(error) };
  }

  const parsed = parseWorktreeResult(stdout);
  if (!parsed.ok) return { kind: "fallback", reason: parsed.reason };
  return { kind: "orca", path: parsed.worktree.path, branch: parsed.worktree.branch };
}

export function parseFlags(argv) {
  const values = {};
  for (const arg of argv) {
    const m = /^--([a-z0-9-]+)=([\s\S]*)$/.exec(arg);
    if (!m) throw new Error(`unrecognized argument "${arg}" — flags are --key=value`);
    values[m[1].replace(/-/g, "_")] = m[2];
  }
  return values;
}

const USAGE =
  "usage: autopilot-worktree.mjs create --config=<path> --host=<host> " +
  "--name=<run> --base=<ref> [--issue=<n>]";

export function main(argv = process.argv.slice(2), io = {}) {
  const {
    exec = (file, args, opts) =>
      execFileSync(file, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        ...opts,
      }),
    env = process.env,
    readFile = (p) => readFileSync(p, "utf8"),
    cwd = process.cwd(),
    log = console.log,
    err = console.error,
  } = io;

  const [subcommand, ...rest] = argv;
  if (subcommand !== "create") {
    err(USAGE);
    return 2;
  }

  let values;
  let config;
  try {
    values = parseFlags(rest);
    const host = values.host ?? "claude";
    assertHost(host);
    if (!values.name) throw new Error(`--name=<run> is required — ${USAGE}`);
    if (!values.base) throw new Error(`--base=<ref> is required — ${USAGE}`);
    const configPath = values.config ?? resolveConfigPath(host).path;
    ({ config } = loadConfig(configPath, env, readFile, undefined, { host }));
  } catch (error) {
    err(error.message);
    return 2;
  }

  // loadConfig has already rejected anything that is not one of the two.
  if (config.worktree_provider === "git") {
    log(formatOutcome({ kind: "git" }));
    return 0;
  }

  log(formatOutcome(createWithOrca({
    exec, cwd, name: values.name, base: values.base, issue: values.issue,
  })));
  return 0;
}

// pathToFileURL rather than a `file://` template: the plugin's install path is
// user-controlled and a space in it would silently skip main().
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
```

- [ ] **Step 10: Move `resolveMainPath` out of the reaper**

In `plugins/autopilot/scripts/autopilot-reaper.mjs`:
- Delete the `resolveMainPath` function body.
- Delete the now-dead `import { resolve, dirname, basename } from "node:path";` line — those three are used nowhere else in the file (verify with `grep -n "resolve(\|dirname(\|basename(" plugins/autopilot/scripts/autopilot-reaper.mjs`).
- Add, below the `execFileSync` import:

```js
import { resolveMainPath } from "./autopilot-worktree.mjs";
```

In `plugins/autopilot/scripts/autopilot-reaper.test.mjs`:
- Delete the whole `describe("resolveMainPath", ...)` block (it now lives in `autopilot-worktree.test.mjs`).
- Drop `resolveMainPath` from the import list at the top, leaving `parseWorktrees, classify, planReap`.

- [ ] **Step 11: Run the worktree and reaper tests to verify they pass**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-worktree.test.mjs plugins/autopilot/scripts/autopilot-reaper.test.mjs`
Expected: PASS, both files.

- [ ] **Step 12: Document the key in the README**

In `README.md`, in the config table, insert directly below the `worktree_dir` row:

```markdown
| `worktree_provider` | `orca` | `orca` / `git` — who creates the run's worktree. `orca` uses the Orca CLI, which names the branch and links the checkout to its GitHub issue; `git` uses `superpowers:using-git-worktrees`. An Orca that is missing or failing falls back to `git` automatically. |
```

- [ ] **Step 13: Run the full suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add plugins/autopilot/autopilot.default.json plugins/autopilot/autopilot.codex.default.json \
  plugins/autopilot/scripts/autopilot-config.mjs plugins/autopilot/scripts/autopilot-config.test.mjs \
  plugins/autopilot/scripts/autopilot-artifacts.test.mjs \
  plugins/autopilot/scripts/autopilot-worktree.mjs plugins/autopilot/scripts/autopilot-worktree.test.mjs \
  plugins/autopilot/scripts/autopilot-reaper.mjs plugins/autopilot/scripts/autopilot-reaper.test.mjs \
  README.md
git commit -m "feat(autopilot): add the worktree_provider key and the orca create script"
```

---

### Task 2: The reaper's orca mode

**Files:**
- Modify: `plugins/autopilot/scripts/autopilot-reaper.mjs`
- Test: `plugins/autopilot/scripts/autopilot-reaper.test.mjs`

**Interfaces:**
- Consumes, from Task 1's `./autopilot-worktree.mjs`: `WORKTREE_PROVIDERS`, `resolveMainPath`, `resolveRepoId(exec, mainPath)`, `parseWorktreeList(stdout)`, `failureReason(error)`. Orca rows arrive as `{ path, branch, locked: false, isMain }` — exactly the shape `classify` already reads, plus `isMain`.
- Produces: `structuralReason(wt, opts)`, `orcaRmArgv(path)`, `reapOrca({ exec, mainPath, baseRef, apply, probe, log })`. `classify`/`planReap` keep their existing signatures; `opts.worktreeDir` may now be `null`, meaning "no containment filter".

**Preconditions:** Task 1 has landed — `autopilot-worktree.mjs` exists and `autopilot-reaper.mjs` already imports `resolveMainPath` from it.

- [ ] **Step 1: Write the failing reaper tests**

Extend the import at the top of `plugins/autopilot/scripts/autopilot-reaper.test.mjs` to
`import { parseWorktrees, classify, planReap, structuralReason, orcaRmArgv, reapOrca } from "./autopilot-reaper.mjs";`
and append:

```js
// Orca mode. Orca chooses the worktree layout (`~/orca/workspaces/<repo>/…`),
// so the `worktree_dir` containment filter cannot apply — a filter written for
// `.claude/worktrees` would reject every candidate. What replaces it is the
// `isMainWorktree` guard: paths now come from Orca rather than from
// `git worktree list`, so `mainPath` alone no longer identifies the checkout
// that must never be removed.
describe("orca mode", () => {
  const REPO_ID = "repo-1";
  const envelope = (result) => JSON.stringify({ id: "req", ok: true, result });
  // The main row's path deliberately differs from `mainPath` below, so the
  // `isMainWorktree` guard is the only thing that can save it. Orca reports
  // paths the `mainPath` comparison alone no longer recognises.
  const LIST = envelope({
    worktrees: [
      { path: "/orca/repo-main", branch: "refs/heads/main", isMainWorktree: true },
      { path: "/orca/wt/merged", branch: "refs/heads/BoTime/merged", isMainWorktree: false },
      { path: "/orca/wt/inflight", branch: "refs/heads/BoTime/inflight", isMainWorktree: false },
    ],
  });
  const CURRENT = envelope({ worktree: { repoId: REPO_ID, path: "/repo", branch: "refs/heads/main" } });

  const probe = (wt) =>
    wt.path === "/orca/wt/inflight"
      ? { unmergedPatches: 2, dirtyLines: 0 }
      : { unmergedPatches: 0, dirtyLines: 0 };

  const harness = ({ apply = true, failList = false } = {}) => {
    const calls = [];
    const out = [];
    const exec = (file, args) => {
      calls.push([file, ...args]);
      if (args[1] === "current") return CURRENT;
      if (args[1] === "list") {
        if (failList) { const e = new Error("nope"); e.code = "ENOENT"; throw e; }
        return LIST;
      }
      return envelope({ ok: true });
    };
    reapOrca({ exec, mainPath: "/repo", baseRef: "origin/main", apply, probe,
      log: (l) => out.push(l) });
    return { calls, out };
  };

  it("removes the merged, clean worktree through `orca worktree rm`", () => {
    const { calls, out } = harness();
    expect(calls.some((c) => c.join(" ") ===
      "orca worktree rm --worktree path:/orca/wt/merged --json")).toBe(true);
    expect(out).toContain("removed /orca/wt/merged");
  });

  it("keeps the unmerged worktree and says why", () => {
    const { calls, out } = harness();
    expect(out.some((l) => l.startsWith("keep  /orca/wt/inflight"))).toBe(true);
    expect(calls.some((c) => c.includes("path:/orca/wt/inflight"))).toBe(false);
  });

  it("never removes the entry orca reports as the main worktree", () => {
    const { calls, out } = harness();
    expect(calls.some((c) => c.includes("path:/orca/repo-main"))).toBe(false);
    expect(out).toContain("keep  /orca/repo-main — main checkout");
  });

  it("removes nothing without --apply", () => {
    const { calls, out } = harness({ apply: false });
    expect(calls.some((c) => c[2] === "rm")).toBe(false);
    expect(out).toContain("reapable /orca/wt/merged (dry run; pass --apply to remove)");
  });

  it("prints the unavailable line and reaps nothing when orca is missing", () => {
    const { calls, out } = harness({ failList: true });
    expect(out).toEqual(["orca unavailable — orca CLI not found on PATH; nothing reaped"]);
    expect(calls.some((c) => c[2] === "rm")).toBe(false);
  });

  it("prints the unavailable line when the repo id cannot be resolved", () => {
    const out = [];
    reapOrca({
      exec: () => JSON.stringify({ ok: false, error: { message: "repo_not_found" } }),
      mainPath: "/repo", baseRef: "origin/main", apply: true, probe,
      log: (l) => out.push(l),
    });
    expect(out).toEqual(["orca unavailable — repo_not_found; nothing reaped"]);
  });

  it("builds the rm argv as a path selector", () => {
    expect(orcaRmArgv("/orca/wt/a"))
      .toEqual(["worktree", "rm", "--worktree", "path:/orca/wt/a", "--json"]);
  });
});

describe("structuralReason", () => {
  it("skips the containment filter when worktreeDir is null", () => {
    // The line that makes orca mode possible: delete it and every Orca path
    // is reported as `outside .claude/worktrees`.
    const wt = { path: "/orca/wt/a", branch: "a", locked: false };
    expect(structuralReason(wt, { mainPath: "/repo", worktreeDir: null })).toBe(null);
    expect(structuralReason(wt, { mainPath: "/repo", worktreeDir: ".claude/worktrees" }))
      .toBe("outside .claude/worktrees");
  });

  it("names the main checkout by isMain as well as by path", () => {
    expect(structuralReason(
      { path: "/repo", branch: "main", locked: false, isMain: true },
      { mainPath: "/somewhere/else", worktreeDir: null },
    )).toBe("main checkout");
  });
});
```

- [ ] **Step 2: Run the reaper tests to verify they fail**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-reaper.test.mjs`
Expected: FAIL — `structuralReason`, `orcaRmArgv` and `reapOrca` are not exported.

- [ ] **Step 3: Extract `structuralReason` and rewire `classify` / `planReap`**

Replace `classify` and `planReap` in `plugins/autopilot/scripts/autopilot-reaper.mjs` with:

```js
/**
 * The reasons that decide a worktree's fate without probing git — one source
 * of truth so `classify` and `planReap` cannot drift apart on which entries
 * are probed.
 *
 * `opts.worktreeDir` may be `null`: orca mode has no containment filter,
 * because Orca chooses the layout. `wt.isMain` covers the same ground as
 * `mainPath` for rows that came from Orca rather than from git.
 */
export function structuralReason(wt, opts) {
  if (wt.path === opts.mainPath || wt.isMain === true) return "main checkout";
  if (opts.worktreeDir != null && !wt.path.includes(`/${opts.worktreeDir}/`)) {
    return `outside ${opts.worktreeDir}`;
  }
  if (wt.locked) return "locked by another session";
  if (wt.branch === null) return "detached HEAD";
  return null;
}

export function classify(worktree, probeResult, opts) {
  const structural = structuralReason(worktree, opts);
  if (structural) return { reapable: false, reason: structural };
  const { unmergedPatches, dirtyLines } = probeResult;
  if (unmergedPatches > 0) {
    return { reapable: false, reason: `${unmergedPatches} unmerged commit(s)` };
  }
  if (dirtyLines > 0) {
    return { reapable: false, reason: `${dirtyLines} uncommitted change(s)` };
  }
  return { reapable: true, reason: "merged, clean, unlocked" };
}

export function planReap(worktrees, probe, opts) {
  const reap = [];
  const keep = [];
  for (const wt of worktrees) {
    const probeResult = structuralReason(wt, opts)
      ? { unmergedPatches: 0, dirtyLines: 0 }
      : probe(wt);
    const { reapable, reason } = classify(wt, probeResult, opts);
    if (reapable) reap.push(wt.path);
    else keep.push({ path: wt.path, reason });
  }
  return { reap, keep };
}
```

- [ ] **Step 4: Add `orcaRmArgv` and `reapOrca`**

Extend the worktree-module import at the top of `autopilot-reaper.mjs`:

```js
import {
  WORKTREE_PROVIDERS, resolveMainPath, resolveRepoId, parseWorktreeList, failureReason,
} from "./autopilot-worktree.mjs";
```

Replace the private `git` helper with a general runner alongside it, so the same
call shape reaches `reapOrca`:

```js
function run(file, args, opts) {
  return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
}

function git(args, cwd) {
  return run("git", args, { cwd });
}
```

Then add, below `probeWorktree`:

```js
/** Removing through Orca is what makes Orca's own record disappear with the checkout. */
export function orcaRmArgv(path) {
  return ["worktree", "rm", "--worktree", `path:${path}`, "--json"];
}

/**
 * Reaping is opportunistic housekeeping. Every Orca problem prints one line
 * and returns; failing the setup stage over a tidy-up would be a poor trade.
 */
export function reapOrca({ exec, mainPath, baseRef, apply, probe, log = console.log }) {
  const unavailable = (reason) => log(`orca unavailable — ${reason}; nothing reaped`);

  const repo = resolveRepoId(exec, mainPath);
  if (!repo.ok) return unavailable(repo.reason);

  let stdout;
  try {
    stdout = exec("orca", ["worktree", "list", "--repo", `id:${repo.id}`, "--json"], {
      cwd: mainPath,
    });
  } catch (error) {
    return unavailable(failureReason(error));
  }
  const listed = parseWorktreeList(stdout);
  if (!listed.ok) return unavailable(listed.reason);

  // worktreeDir is null on purpose: Orca owns the layout.
  const plan = planReap(listed.worktrees, probe, { mainPath, worktreeDir: null });

  for (const { path, reason } of plan.keep) log(`keep  ${path} — ${reason}`);
  for (const path of plan.reap) {
    if (!apply) {
      log(`reapable ${path} (dry run; pass --apply to remove)`);
      continue;
    }
    try {
      exec("orca", orcaRmArgv(path), { cwd: mainPath });
      log(`removed ${path}`);
    } catch (error) {
      log(`keep  ${path} — orca worktree rm failed (${failureReason(error)})`);
    }
  }
}
```

`baseRef` is unused inside `reapOrca` itself — the probe closes over it — but it
stays in the signature so the call site reads the same in both modes. Keep the
parameter and pass it.

- [ ] **Step 5: Branch `main()` on `--provider=`**

Replace `main()` in `autopilot-reaper.mjs` with:

```js
export function main(argv = process.argv.slice(2), io = {}) {
  const { exec = run, log = console.log } = io;
  const apply = argv.includes("--apply");
  const provider = argv.find((a) => a.startsWith("--provider="))?.slice(11) ?? "git";
  if (!WORKTREE_PROVIDERS.includes(provider)) {
    // Not a throw: the setup stage runs this unattended, and a bad flag must
    // not take the run down with it. The config validator is the real gate.
    log(`unknown --provider "${provider}" — expected ${WORKTREE_PROVIDERS.join(", ")}; nothing reaped`);
    return;
  }

  const mainPath = resolveMainPath(() =>
    git(["rev-parse", "--git-common-dir"], process.cwd()),
  );
  const baseRef = argv.find((a) => a.startsWith("--base="))?.slice(7) ?? "origin/main";
  const worktreeDir =
    argv.find((a) => a.startsWith("--dir="))?.slice(6) ?? ".claude/worktrees";

  git(["fetch", "origin"], mainPath);
  const probe = probeWorktree(baseRef, mainPath);

  if (provider === "orca") {
    reapOrca({ exec, mainPath, baseRef, apply, probe, log });
    return;
  }

  const worktrees = parseWorktrees(git(["worktree", "list", "--porcelain"], mainPath));
  const plan = planReap(worktrees, probe, { mainPath, worktreeDir });

  for (const { path, reason } of plan.keep) {
    log(`keep  ${path} — ${reason}`);
  }
  for (const path of plan.reap) {
    if (apply) {
      git(["worktree", "remove", path], mainPath);
      log(`removed ${path}`);
    } else {
      log(`reapable ${path} (dry run; pass --apply to remove)`);
    }
  }
  if (apply && plan.reap.length > 0) git(["worktree", "prune"], mainPath);
}
```

`"--provider=".length` is 11 — the slice offset matches the existing `--base=` (7) and `--dir=` (6) pattern.

- [ ] **Step 6: Run the reaper tests to verify they pass**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-reaper.test.mjs`
Expected: PASS. The pre-existing git-mode describes (`parseWorktrees`, `classify`, `planReap`) must all still pass unchanged — they pass a string `worktreeDir` and their fixtures carry no `isMain`.

- [ ] **Step 7: Mutation-check the two load-bearing new assertions**

Temporarily change `opts.worktreeDir != null` to `true` in `structuralReason` and re-run: `structuralReason skips the containment filter when worktreeDir is null` and the four orca-mode reap tests must go red. Temporarily change `wt.isMain === true` to `false` and re-run: `never removes the entry orca reports as the main worktree` must go red. Revert both.

- [ ] **Step 8: Run the full suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add plugins/autopilot/scripts/autopilot-reaper.mjs plugins/autopilot/scripts/autopilot-reaper.test.mjs
git commit -m "feat(autopilot): teach the reaper to remove orca worktrees"
```

---

### Task 3: The setup-stage contract in both SKILL.md files

**Files:**
- Create: `plugins/autopilot/skills/autopilot/references/stages/worktree-provider.md`
- Modify: `plugins/autopilot/skills/autopilot/SKILL.md` (the `### \`setup\`` section and the "The run directory" section)
- Modify: `plugins/autopilot/skills/autopilot-github/SKILL.md` (Delta 2)
- Modify: `plugins/autopilot/scripts/autopilot-github-contract.test.mjs`
- Test: `plugins/autopilot/scripts/autopilot-worktree-contract.test.mjs`

**Interfaces:**
- Consumes: the create script's three literal output lines and its `--config/--host/--name/--base/--issue` flags from Task 1; the reaper's `--provider=` flag from Task 2.
- Produces: the ledger line `worktree provider: fell back to git — <reason>`, which is informational only. `nextStage` matches the worktree entry with `has("worktree:")`, so this line cannot advance the run — Step 6 pins that.

**Size budget.** `plugins/autopilot/skills/autopilot/SKILL.md` is 41,910 characters today and `skill-sections.test.mjs` asserts `< 42_000`. The three-outcome table and the git-path prose therefore go into a new `references/stages/` fragment, which `resolveReferences` inlines into `sectionOf(skill, "setup")` for the contract tests while costing SKILL.md only the sentence that names it. `references/stages/verify-run.md` is the existing precedent. The orphan-fragment test in `skill-sections.test.mjs` scans `references/dispatch/` only, so a `references/stages/` fragment is not an orphan candidate. Step 5 measures the post-change number.

- [ ] **Step 1: Write the new reference fragment**

Create `plugins/autopilot/skills/autopilot/references/stages/worktree-provider.md`:

```markdown
# The worktree provider

`autopilot-worktree.mjs create` prints exactly one line. Act on it, then append
to the ledger.

| Script output | What `setup` does |
|---|---|
| `worktree: <path> (branch <branch>)` | Append that line **verbatim**. Orca has already created the checkout — skip `superpowers:using-git-worktrees` entirely. |
| `provider: git` | Create the worktree the git way (below), then append `worktree: <path> (branch <name>)`. |
| `fallback: git — <reason>` | Append `worktree provider: fell back to git — <reason>`, create the worktree the git way (below), then append `worktree: <path> (branch <name>)`. |

A provider problem is never a park and never a non-zero exit. A non-zero exit
means the call itself was wrong — a missing flag, an unreadable config, or a
`worktree_provider` that is neither `orca` nor `git`. Fix the call and rerun it.

**The git way.** Create the worktree from `base_ref` using
`superpowers:using-git-worktrees`. Phase 2 is unattended, so answer its consent
question up front in the same instruction rather than letting it ask: state
explicitly that a worktree is wanted, and pass `worktree_dir` from config as the
declared directory — this repository uses `.claude/worktrees/` (what
`autopilot-reaper.mjs` scans), not that skill's own `.worktrees/` default.

**The ledger's `worktree:` line is the sole source of the worktree path and the
branch name for every later stage.** Orca names the branch, and the name it
picks has nothing to do with `<run>`. Every stage that needs the branch — the
`--branch=` flag on a dispatch, `land`, `pr` — reads it back from that line.
Never derive it from `<run>`.
```

The **The git way.** paragraph is the paragraph currently in SKILL.md's `setup`
section, word for word. Only the line wrapping and the bold lead-in label are
new — do not reword it. It has to keep reading correctly, because it is the
instruction both the `provider: git` and the `fallback: git — …` outcomes run.

- [ ] **Step 2: Rewrite the `setup` section of SKILL.md**

In `plugins/autopilot/skills/autopilot/SKILL.md`, add the provider flag to the reaper invocation, so the fenced block reads:

```bash
node "$AP/scripts/autopilot-reaper.mjs" --apply \
  --dir=<config.worktree_dir> --base=<config.base_ref> \
  --provider=<config.worktree_provider>
```

and change the sentence beneath it from "Pass both flags explicitly from config." to "Pass all three flags explicitly from config."

Then replace this paragraph in full —

```
Create the worktree from `base_ref` using `superpowers:using-git-worktrees`.
Phase 2 is unattended, so answer its consent question up front in the same
instruction rather than letting it ask: state explicitly that a worktree is
wanted, and pass `worktree_dir` from config as the declared directory — this
repository uses `.claude/worktrees/` (what `autopilot-reaper.mjs` scans), not
that skill's own `.worktrees/` default.

Append: `worktree: <path> (branch <name>)`.
```

— with this (the inner ```` ```bash ```` fence is part of the replacement text
and goes into SKILL.md as written):

````
Then create the worktree:

```bash
node "$AP/scripts/autopilot-worktree.mjs" create \
  --config=<config> --host=<host> --name=<run> --base=<config.base_ref>
```

Under `/autopilot-github`, add `--issue=<n>`. The script prints one line;
`references/stages/worktree-provider.md` says what each line means, what to
append for it, and where the git path still applies.
````

- [ ] **Step 3: Drop the `worktree-` prefix claim from "The run directory"**

In the same file, in the `### The run directory` subsection, replace

```
It is not the worktree directory name and not the
`worktree-` prefixed git branch. Those may differ; `<run>` does not change to
follow them.
```

with

```
It is not the worktree directory name and not the
git branch, which the worktree provider names. Those may differ; `<run>` does
not change to follow them.
```

Note the collision this leaves standing, deliberately: run-directory paths
spell the placeholder `<branch>` and mean `<run>`, while the `spec` dispatch's
`--branch=<branch>` means the git branch — and under Orca those are never the
same string. Resolving it in this subsection would cost SKILL.md characters it
does not have (Step 5). It is resolved in the fragment instead, whose closing
paragraph names `--branch=` explicitly as the flag that reads the git branch
back out of the ledger. Do not also add it here.

- [ ] **Step 4: Update Delta 2 of the autopilot-github skill**

In `plugins/autopilot/skills/autopilot-github/SKILL.md`, replace

```
`issue-42-csv-export-drops-unicode`. The git branch becomes
`worktree-issue-42-csv-export-drops-unicode`, the `worktree-` prefix coming from
`superpowers:using-git-worktrees` as it already does; `<run>` itself never
carries the prefix, per autopilot's "The run directory" rule.
```

with

```
`issue-42-csv-export-drops-unicode`. The git branch is the worktree provider's
to name: under the `git` provider it becomes
`worktree-issue-42-csv-export-drops-unicode`, the `worktree-` prefix coming from
`superpowers:using-git-worktrees`; under `orca` it is whatever Orca picks. Either
way `<run>` itself never carries a prefix, per autopilot's "The run directory"
rule, and every stage that needs the branch reads it from the ledger's
`worktree:` line rather than deriving it.
```

and, in the paragraph immediately below, replace

```
**declared at `setup`** as the
worktree/branch name passed to `superpowers:using-git-worktrees`, in place of a
name falling out of the brainstorm.
```

with

```
**declared at `setup`** as the
`--name=<run>` passed to `autopilot-worktree.mjs create`, in place of a name
falling out of the brainstorm. That call also carries `--issue=<n>`, so Orca
links the new worktree to the issue that started the run and the Orca app shows
the run against it.
```

- [ ] **Step 5: Measure SKILL.md against its budget**

Run:

```bash
node -e 'const n=require("fs").readFileSync("plugins/autopilot/skills/autopilot/SKILL.md","utf8").length;console.log(n,"headroom",42000-n)'
```

Expected: a number below 42,000. The edits above remove roughly 460 characters
of prose and add roughly 430 (the bash block and its sentence, the reaper's
`--provider=` line, the reworded run-directory clause), so the count should land
at or just under where it started — 41,910, 90 characters of headroom. If it
comes out **above** 42,000, move the setup section's remaining rationale — not
its commands — into `references/rationale.md` and re-measure. Do not raise the
ceiling in `skill-sections.test.mjs`, and do not thin the fragment: the fragment
costs SKILL.md nothing.

- [ ] **Step 6: Write the contract tests**

Create `plugins/autopilot/scripts/autopilot-worktree-contract.test.mjs`:

```js
// SKILL.md's `setup` section is the only thing that makes the orchestrator run
// the create script and record what it prints. The contract is prose: nothing
// else fails if it is deleted or reworded past recognition — the run would
// simply go on making git worktrees and the ledger would stop being the source
// of the branch name. These assertions pin the load-bearing pieces of it, in
// the text a `setup` orchestrator actually reads (references resolved).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readSkill, sectionOf as section, unwrap } from "./skill-sections.mjs";
import { parseLedger, nextStage } from "./autopilot-ledger.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const GITHUB_SKILL_PATH = join(HERE, "..", "skills", "autopilot-github", "SKILL.md");

const skill = readSkill();
const setup = unwrap(section(skill, "setup"));
const whole = unwrap(skill);
const github = unwrap(readFileSync(GITHUB_SKILL_PATH, "utf8"));

describe("the setup stage runs the create script", () => {
  it("names the script", () => {
    expect(setup).toContain("autopilot-worktree.mjs");
  });

  it("passes the run name and the base ref", () => {
    expect(setup).toContain("--name=<run>");
    expect(setup).toContain("--base=<config.base_ref>");
  });

  it("passes the provider to the reaper", () => {
    expect(setup).toContain("--provider=<config.worktree_provider>");
  });
});

describe("the three outcomes reach the orchestrator", () => {
  it("documents the orca line", () => {
    expect(setup).toContain("worktree: <path> (branch <branch>)");
  });

  it("documents the git short-circuit", () => {
    expect(setup).toContain("provider: git");
  });

  it("documents the fallback line and what it appends", () => {
    expect(setup).toContain("fallback: git — <reason>");
    expect(setup).toContain("worktree provider: fell back to git — <reason>");
  });

  it("says a provider problem never parks the run", () => {
    expect(setup).toMatch(/never a park/);
  });
});

describe("the ledger is the source of the branch", () => {
  it("says so in the setup section", () => {
    expect(setup).toContain(
      "the sole source of the worktree path and the branch name",
    );
  });

  it("no longer claims the branch carries a worktree- prefix", () => {
    // AC8. The `git` provider still produces that prefix, so the wrapper may
    // name it as one case; what must be gone is the unconditional claim.
    expect(whole).not.toContain("`worktree-` prefixed git branch");
  });

  it("the fallback ledger line cannot advance the run", () => {
    // `nextStage` matches the worktree entry with `has("worktree:")`. The
    // fallback line is appended BEFORE the real one, so if it ever matched,
    // a resume would skip setup on a run that has no worktree yet.
    const ledger = [
      "# autopilot run — task: x",
      "2026-09-09T10:00:00Z  design approved",
      "2026-09-09T10:01:00Z  worktree provider: fell back to git — orca CLI not found on PATH",
    ].join("\n");
    expect(nextStage(parseLedger(ledger))).toBe("setup");
  });
});

describe("the github wrapper links the worktree to its issue", () => {
  it("passes --issue to the create script", () => {
    expect(github).toContain("--issue=<n>");
  });

  it("names the create script rather than the worktree skill", () => {
    expect(github).toContain("autopilot-worktree.mjs create");
  });
});
```

Then add one assertion to `plugins/autopilot/scripts/autopilot-github-contract.test.mjs`, inside the existing `describe("the load-bearing rules", ...)` block, so the wrapper's own contract file also owns it:

```js
  it("says the branch is the provider's to name, not always worktree-<run>", () => {
    expect(flat).toContain("The git branch is the worktree provider's to name");
    expect(flat).toContain("reads it from the ledger's `worktree:` line");
  });
```

`flat` is the file's existing module-level `unwrap(skill)` binding — verified at
`plugins/autopilot/scripts/autopilot-github-contract.test.mjs:29`. Do not add an
import; the file already reads the wrapper's SKILL.md.

- [ ] **Step 7: Run the contract tests**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-worktree-contract.test.mjs plugins/autopilot/scripts/autopilot-github-contract.test.mjs plugins/autopilot/scripts/skill-sections.test.mjs`
Expected: PASS, all three — including `SKILL.md stays smaller than the fragments it dispatches plus its own prose` and `every reference SKILL.md names can be read`.

- [ ] **Step 8: Sweep both SKILL.md files for prose this change falsifies**

Run:

```bash
grep -rn "worktree-" plugins/autopilot/skills README.md
grep -rn "using-git-worktrees" plugins/autopilot/skills README.md
```

Every remaining hit must be either (a) an unrelated `worktree-up`/`worktree-down` script name, (b) the `git` provider's branch prefix named as one case in `autopilot-github/SKILL.md`, or (c) the companion-skill install lists in `README.md` and SKILL.md's preflight, which stay: the git path is still reachable as the fallback. Fix anything else.

- [ ] **Step 9: Run the full suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add plugins/autopilot/skills/autopilot/SKILL.md \
  plugins/autopilot/skills/autopilot/references/stages/worktree-provider.md \
  plugins/autopilot/skills/autopilot-github/SKILL.md \
  plugins/autopilot/scripts/autopilot-worktree-contract.test.mjs \
  plugins/autopilot/scripts/autopilot-github-contract.test.mjs
git commit -m "feat(autopilot): drive the setup stage through the worktree provider"
```

---

## Acceptance criteria coverage

| AC | Where |
|---|---|
| AC1 — key in both defaults, invalid value rejected by name | Task 1, Steps 1, 2, 4 |
| AC2 — `git` prints `provider: git`, git path unchanged | Task 1 Step 7 (`main` describe) + Task 3 Step 1 (the fragment's "git way" paragraph, moved verbatim from the old SKILL.md prose) |
| AC3 — orca creates, ledger records the path and stripped branch | Task 1 Steps 7, 9; Task 3 Steps 1, 6 |
| AC4 — failure prints `fallback: git — …`, exits 0, ledger records the fallback | Task 1 Step 7 (five fallback cases); Task 3 Steps 1, 6 |
| AC5 — `--issue <n>` under `/autopilot-github` | Task 1 Step 7 (`createArgv`, `createWithOrca`); Task 3 Steps 2, 4, 6 |
| AC6 — `--provider=orca --apply` removes through `orca worktree rm`, never the main worktree | Task 2 Steps 1, 4, 7 |
| AC7 — `orca unavailable — …; nothing reaped`, exit 0 | Task 2 Step 1 (two cases: missing binary, unresolvable repo id) |
| AC8 — later stages read the branch from the ledger; neither SKILL.md claims `worktree-<run>` | Task 3 Steps 1, 3, 4, 6, 8 |
