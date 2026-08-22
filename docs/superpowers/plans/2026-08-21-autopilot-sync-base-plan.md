# Autopilot: Sync base_ref Before Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make freshening `origin/main` (or whatever `base_ref` is configured to) an unconditional, guaranteed first action of the `setup` stage, instead of a side effect of the reaper running.

**Architecture:** One new pure-function Node helper, `plugins/autopilot/scripts/autopilot-sync-base.mjs`, in the same style as `autopilot-land.mjs`: a testable `syncBase(baseRef, run)` function with git calls injected through `run`, plus a thin `main()` CLI. It reuses `parseWorktrees` from `autopilot-reaper.mjs` rather than re-parsing `git worktree list --porcelain` itself. `SKILL.md`'s `setup` section gains one unconditional line ahead of the existing reaper paragraph. Both plugin manifests bump to 1.5.0.

**Tech Stack:** Node ESM (`.mjs`), vitest 3.2, Claude Code plugin (skills), git CLI via `spawnSync`.

**Spec:** `docs/superpowers/specs/2026-08-21-autopilot-sync-base-design.md`

## Global Constraints

- **Test command:** `npm test` (vitest). Run from the repository root.
- **Baseline:** 164 tests passing across 9 files. Do not weaken, delete, or loosen any existing test. Every task must leave the full suite green.
- **Node helpers** live in `plugins/autopilot/scripts/` with colocated `.test.mjs` vitest files. ESM only (`"type": "module"` at the repo root).
- **No change to `autopilot-reaper.mjs` or `autopilot-land.mjs`'s existing fetch calls.** Both are harmless to run twice; this new script is additive.
- **Version bump to `1.5.0`** in BOTH `plugins/autopilot/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` — and in marketplace.json in BOTH places: the `plugins[0].version` entry AND the `metadata.version` block. An existing test in `autopilot-findings-contract.test.mjs` already pins these to `1.4.0`; it must be updated in the same task that bumps the version, or the suite goes red.
- **Never touch a checkout that belongs to another worktree, and never resolve a real divergence silently.** Every skip path must have a stated reason; nothing is best-effort about the initial `git fetch origin` — its failure is the one path that must exit non-zero.

---

## File Structure

**Created:**

- `plugins/autopilot/scripts/autopilot-sync-base.mjs` — `parseLocalBranch(baseRef)`, `syncBase(baseRef, run)` (the full decision logic), `main()` CLI. Sole owner of the fast-forward-or-skip decision.
- `plugins/autopilot/scripts/autopilot-sync-base.test.mjs` — colocated vitest coverage for the above.

**Modified:**

- `plugins/autopilot/skills/autopilot/SKILL.md` — unconditional first line of the `setup` stage.
- `plugins/autopilot/.claude-plugin/plugin.json` — version `1.5.0`.
- `.claude-plugin/marketplace.json` — version `1.5.0` in both places.
- `plugins/autopilot/scripts/autopilot-findings-contract.test.mjs` — the three existing `1.4.0` assertions become `1.5.0`.

**Task order rationale:** Task 1 builds the decision logic in full — it is one cohesive specification (fetch, then exactly one of five outcomes), so splitting it across two tasks would leave an intermediate task reviewing a function that gives wrong answers for scenarios it hasn't been taught yet. Task 2 wraps it in a real CLI and proves it against a real git repo, which unit tests alone (all injected fakes) cannot prove. Task 3 is the prose change that invokes it. Task 4 is the version bump, kept last and separate because it touches unrelated files (JSON manifests, not code) and must also fix an existing test that hardcodes the old version.

This plan uses 4 tasks rather than the 5–8 target: the spec's scope (one script, one prose line, a version bump) has exactly four independently-reviewable deliverables, and the run/land scripts it mirrors show one cohesive decision function is normally one task. Padding a fourth deliverable into two would not buy reviewability — see the note on Task 1 above.

---

### Task 1: Sync-base decision logic

Implement the core fast-forward-or-skip decision as a pure, injectable function, covering every branch in the spec: initial-fetch failure, checked-out-here clean fast-forward, checked-out-here dirty skip, checked-out-here diverged skip, checked-out-elsewhere skip, not-checked-out-anywhere fast-forward, and not-checked-out-anywhere diverged skip.

**Files:**
- Create: `plugins/autopilot/scripts/autopilot-sync-base.mjs`
- Create: `plugins/autopilot/scripts/autopilot-sync-base.test.mjs`

**Interfaces:**
- Consumes: `parseWorktrees` from `./autopilot-reaper.mjs` — already exported, returns `{path, head, branch, locked}[]` from `git worktree list --porcelain` output (see that file for the exact shape).
- Produces:
  - `parseLocalBranch(baseRef: string): string` — strips a single leading `origin/`, otherwise returns the input unchanged.
  - `syncBase(baseRef: string, run: (args: string[]) => {code: number, stdout: string, stderr: string}): {status: "error"|"updated"|"skipped", reason: string}`. Task 2 wires `run` to real `git` calls and prints `reason`.

- [ ] **Step 1: Write the failing test**

Create `plugins/autopilot/scripts/autopilot-sync-base.test.mjs`:

```js
// syncBase keeps the local counterpart of base_ref fresh, best-effort, without
// ever touching a checkout it doesn't own or resolving a real divergence
// silently. The initial `git fetch origin` is the one part that must not fail
// silently — it's what makes base_ref itself fresh for the worktree's base,
// regardless of what happens to the local branch below.
//
// Every git call is injected through `run`, matching the DI pattern
// autopilot-land.mjs's land(baseRef, run) already uses — a fake run(), no real
// git repo needed. See Task 2 for the real-git smoke test.

import { describe, it, expect } from "vitest";
import { parseLocalBranch, syncBase } from "./autopilot-sync-base.mjs";

describe("parseLocalBranch", () => {
  it("strips a leading origin/ prefix", () => {
    expect(parseLocalBranch("origin/main")).toBe("main");
  });

  it("leaves a bare branch name as-is", () => {
    expect(parseLocalBranch("main")).toBe("main");
  });

  it("only strips a LEADING origin/, not one that appears mid-string", () => {
    expect(parseLocalBranch("origin/release/origin/thing")).toBe(
      "release/origin/thing",
    );
  });
});

// One worktree (this checkout, "/repo") has `localBranch` checked out.
const PORCELAIN_HERE = `worktree /repo
HEAD aaaa1111
branch refs/heads/main

worktree /repo/.claude/worktrees/other
HEAD bbbb2222
branch refs/heads/other-branch
`;

// A DIFFERENT worktree has `localBranch` checked out; this checkout ("/repo")
// has something else checked out.
const PORCELAIN_ELSEWHERE = `worktree /repo
HEAD aaaa1111
branch refs/heads/some-other-branch

worktree /repo/.claude/worktrees/other
HEAD bbbb2222
branch refs/heads/main
`;

// No worktree has `localBranch` checked out at all.
const PORCELAIN_NOT_CHECKED_OUT = `worktree /repo
HEAD aaaa1111
branch refs/heads/some-other-branch
`;

/**
 * Builds a fake `run(args)` from a map keyed by the git subcommand
 * (`args[0]`), so each test only has to describe the git calls it cares
 * about. Throws on an unexpected call so a wrong call sequence fails loudly
 * instead of silently returning undefined.
 */
function fakeRun(responses) {
  const calls = [];
  const run = (args) => {
    calls.push(args.join(" "));
    const handler = responses[args[0]];
    if (!handler) throw new Error(`unexpected git call: ${args.join(" ")}`);
    return handler(args);
  };
  run.calls = calls;
  return run;
}

const ok = (stdout = "") => () => ({ code: 0, stdout, stderr: "" });
const fail = (stderr = "") => () => ({ code: 1, stdout: "", stderr });

describe("syncBase", () => {
  it("errors when the initial fetch fails, and calls nothing else", () => {
    const run = fakeRun({
      fetch: fail("fatal: could not resolve host"),
    });
    const result = syncBase("origin/main", run);
    expect(result.status).toBe("error");
    expect(result.reason).toContain("could not resolve host");
    expect(run.calls).toEqual(["fetch origin"]);
  });

  it("fast-forwards in place when the branch is checked out here and clean", () => {
    const run = fakeRun({
      fetch: ok(),
      "rev-parse": ok("/repo\n"),
      worktree: ok(PORCELAIN_HERE),
      status: ok(""),
      merge: ok("Fast-forward"),
    });
    const result = syncBase("origin/main", run);
    expect(result.status).toBe("updated");
    expect(result.reason).toContain("main");
    expect(run.calls).toContain("merge --ff-only origin/main");
  });

  it("skips when the branch is checked out here but the tree is dirty", () => {
    const run = fakeRun({
      fetch: ok(),
      "rev-parse": ok("/repo\n"),
      worktree: ok(PORCELAIN_HERE),
      status: ok(" M some/file.js\n"),
    });
    const result = syncBase("origin/main", run);
    expect(result.status).toBe("skipped");
    expect(result.reason).toMatch(/dirty/);
    // Never risk uncommitted work: merge must not even be attempted.
    expect(run.calls).not.toContain("merge --ff-only origin/main");
  });

  it("skips when the branch has diverged in the current checkout", () => {
    const run = fakeRun({
      fetch: ok(),
      "rev-parse": ok("/repo\n"),
      worktree: ok(PORCELAIN_HERE),
      status: ok(""),
      merge: fail("fatal: Not possible to fast-forward, aborting."),
    });
    const result = syncBase("origin/main", run);
    expect(result.status).toBe("skipped");
    expect(result.reason).toMatch(/diverged/);
  });

  it("skips when the branch is checked out in a different worktree", () => {
    const run = fakeRun({
      fetch: ok(),
      "rev-parse": ok("/repo\n"),
      worktree: ok(PORCELAIN_ELSEWHERE),
    });
    const result = syncBase("origin/main", run);
    expect(result.status).toBe("skipped");
    expect(result.reason).toMatch(/another worktree/);
    expect(result.reason).toContain("/repo/.claude/worktrees/other");
    // Never touch a checkout that belongs to another worktree.
    expect(run.calls).not.toContain("status --porcelain");
    expect(run.calls.some((c) => c.startsWith("merge "))).toBe(false);
  });

  it("moves the ref directly when the branch is not checked out anywhere and is a fast-forward", () => {
    const run = fakeRun({
      fetch: ok(),
      "rev-parse": ok("/repo\n"),
      worktree: ok(PORCELAIN_NOT_CHECKED_OUT),
      "merge-base": ok(),
      "update-ref": ok(),
    });
    const result = syncBase("origin/main", run);
    expect(result.status).toBe("updated");
    expect(run.calls).toContain("merge-base --is-ancestor main origin/main");
    expect(run.calls).toContain("update-ref refs/heads/main origin/main");
  });

  it("skips when the branch is not checked out anywhere and has diverged", () => {
    const run = fakeRun({
      fetch: ok(),
      "rev-parse": ok("/repo\n"),
      worktree: ok(PORCELAIN_NOT_CHECKED_OUT),
      "merge-base": fail(),
    });
    const result = syncBase("origin/main", run);
    expect(result.status).toBe("skipped");
    expect(result.reason).toMatch(/diverged/);
    expect(run.calls).not.toContain("update-ref refs/heads/main origin/main");
  });

  it("works with a bare branch name (no origin/ prefix) in base_ref", () => {
    const run = fakeRun({
      fetch: ok(),
      "rev-parse": ok("/repo\n"),
      worktree: ok(PORCELAIN_HERE),
      status: ok(""),
      merge: ok("Fast-forward"),
    });
    const result = syncBase("main", run);
    expect(result.status).toBe("updated");
    expect(run.calls).toContain("merge --ff-only main");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-sync-base.test.mjs`
Expected: FAIL — `Failed to resolve import "./autopilot-sync-base.mjs"`

- [ ] **Step 3: Write the implementation**

Create `plugins/autopilot/scripts/autopilot-sync-base.mjs`:

```js
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseWorktrees } from "./autopilot-reaper.mjs";

/**
 * `base_ref` may be `origin/main` (the plugin default) or a bare local branch
 * name like `main`. This finds that local branch's name: strip a leading
 * `origin/` if present, otherwise use the value as-is.
 */
export function parseLocalBranch(baseRef) {
  return baseRef.startsWith("origin/") ? baseRef.slice("origin/".length) : baseRef;
}

/**
 * Best-effort freshen of base_ref's local branch counterpart. Never a merge
 * commit, never overwrites anything, never resolves a real divergence
 * silently, and never touches a checkout belonging to another worktree.
 *
 * The initial fetch is the one step that must not fail silently: it's what
 * keeps base_ref itself current for the caller (e.g. the reaper's
 * merge-check, or the new worktree's base), independent of whatever happens
 * to the local branch below.
 */
export function syncBase(baseRef, run) {
  const fetched = run(["fetch", "origin"]);
  if (fetched.code !== 0) {
    return {
      status: "error",
      reason: `git fetch failed: ${fetched.stderr.trim()}`,
    };
  }

  const localBranch = parseLocalBranch(baseRef);
  const toplevel = run(["rev-parse", "--show-toplevel"]).stdout.trim();
  const worktrees = parseWorktrees(
    run(["worktree", "list", "--porcelain"]).stdout,
  );
  const entry = worktrees.find((wt) => wt.branch === localBranch);

  if (!entry) {
    // Not checked out anywhere: fast-forward the ref directly if it is one,
    // never resolving a real divergence silently.
    const ancestor = run(["merge-base", "--is-ancestor", localBranch, baseRef]);
    if (ancestor.code !== 0) {
      return {
        status: "skipped",
        reason: `${localBranch} has diverged from ${baseRef} (or does not exist locally)`,
      };
    }
    run(["update-ref", `refs/heads/${localBranch}`, baseRef]);
    return {
      status: "updated",
      reason: `${localBranch} fast-forwarded to ${baseRef} (was not checked out anywhere)`,
    };
  }

  if (entry.path !== toplevel) {
    // Checked out in a DIFFERENT worktree: never touch a checkout that
    // belongs to another worktree.
    return {
      status: "skipped",
      reason: `${localBranch} is checked out in another worktree (${entry.path})`,
    };
  }

  // Checked out HERE (this checkout).
  const dirty = run(["status", "--porcelain"]).stdout.trim() !== "";
  if (dirty) {
    // Never risk uncommitted work.
    return {
      status: "skipped",
      reason: `${localBranch} is checked out here with a dirty working tree`,
    };
  }

  const ff = run(["merge", "--ff-only", baseRef]);
  if (ff.code !== 0) {
    return {
      status: "skipped",
      reason: `${localBranch} has diverged from ${baseRef}`,
    };
  }
  return {
    status: "updated",
    reason: `${localBranch} fast-forwarded in place to ${baseRef}`,
  };
}

function runGit(args) {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export function main(argv = process.argv.slice(2)) {
  const baseRef = argv.find((a) => a.startsWith("--base="))?.slice(7) ?? "origin/main";
  const result = syncBase(baseRef, runGit);

  console.log(`${result.status}: ${result.reason}`);
  // Only the initial fetch failure blocks the run; a skipped local
  // fast-forward is convenience, not correctness (the worktree's actual base
  // is base_ref as a git rev, already made fresh by the fetch above).
  process.exitCode = result.status === "error" ? 1 : 0;
}

// pathToFileURL rather than a `file://` template: the plugin's install path is
// user-controlled and a space in it would silently skip main().
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-sync-base.test.mjs`
Expected: PASS (11 tests)

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — 175 tests across 10 files (164 baseline + 11 new)

- [ ] **Step 6: Commit**

```bash
git add plugins/autopilot/scripts/autopilot-sync-base.mjs plugins/autopilot/scripts/autopilot-sync-base.test.mjs
git commit -m "feat(autopilot): add sync-base decision logic for base_ref freshening"
```

---

### Task 2: Real-git smoke test for the CLI

The unit tests in Task 1 inject fake `run()` calls; nothing yet proves `main()` and `runGit` work against a real git repository — real `spawnSync` argument shapes, real `git worktree list --porcelain` output, a real fast-forward. Prove it end to end in a throwaway repo, then verify the run exits cleanly.

**Files:**
- No source changes — `main()`, `runGit`, and the `pathToFileURL` guard were already written in Task 1's implementation step. This task is verification only.

**Interfaces:**
- Consumes: `main(argv)` from Task 1, invoked as a subprocess exactly as `SKILL.md` will invoke it (Task 3).
- Produces: nothing new — confirms the CLI is safe to wire into the `setup` stage.

- [ ] **Step 1: Build a throwaway origin + clone**

```bash
D=$(mktemp -d)
git init --bare -q "$D/origin.git"
git clone -q "$D/origin.git" "$D/work"
cd "$D/work"
git config user.email "test@example.com"
git config user.name "Test"
git commit --allow-empty -q -m "initial"
git push -q origin main
```

- [ ] **Step 2: Put the local clone one commit behind origin/main**

```bash
git commit --allow-empty -q -m "second (origin only)"
git push -q origin main
git reset --hard -q HEAD~1
git status --porcelain   # expect: empty (clean)
git rev-parse main origin/main   # expect: two DIFFERENT hashes right now
```

- [ ] **Step 3: Run the real CLI and verify it fast-forwards**

Use the absolute path to this repo's script (replace `<repo-root>` with the actual absolute path printed by `git rev-parse --show-toplevel` in the worktree, e.g. `/Users/bo/workspace/custom_toolkit/.claude/worktrees/autopilot-sync-base-ref`):

```bash
node <repo-root>/plugins/autopilot/scripts/autopilot-sync-base.mjs --base=origin/main
echo "exit: $?"
```

Expected: prints `updated: main fast-forwarded in place to origin/main` (wording may vary slightly; status must be `updated`), and `exit: 0`.

- [ ] **Step 4: Verify the fast-forward actually happened**

```bash
git rev-parse main origin/main   # expect: the SAME hash now
```

Expected: both `rev-parse` outputs match.

- [ ] **Step 5: Verify the dirty-tree skip path against real git**

```bash
echo "scratch" >> README.md 2>/dev/null || echo "scratch" > dirty.txt
git add -A
node <repo-root>/plugins/autopilot/scripts/autopilot-sync-base.mjs --base=origin/main
echo "exit: $?"
```

Expected: prints a `skipped: ... dirty working tree` line, and `exit: 0` (a skip is not an error).

- [ ] **Step 6: Clean up the throwaway repo**

```bash
cd /
rm -rf "$D"
```

- [ ] **Step 7: Re-run the full suite to confirm nothing in the repo was touched**

Run: `npm test`
Expected: PASS — 175 tests across 10 files, unchanged from Task 1.

- [ ] **Step 8: Nothing to commit**

This task made no source changes, so there is no commit. If Step 3 or Step 5 exposed a bug, fix it in `autopilot-sync-base.mjs`, re-run Task 1's unit tests and this task's steps, then commit the fix:

```bash
git add plugins/autopilot/scripts/autopilot-sync-base.mjs
git commit -m "fix(autopilot): correct sync-base CLI behavior found by smoke test"
```

---

### Task 3: Wire into the `setup` stage

Add the unconditional first line of the `setup` stage in `SKILL.md`, ahead of the existing reaper paragraph, and tell the orchestrator to report its outcome the same way the reaper's keep/reason list is already reported.

**Files:**
- Modify: `plugins/autopilot/skills/autopilot/SKILL.md` (the `### \`setup\`` section, lines 199–213 in the current file)

**Interfaces:**
- Consumes: nothing programmatic — this is prose instructing a future dispatched agent to invoke `node "$AP/scripts/autopilot-sync-base.mjs" --base=<config.base_ref>` from Task 1/2.
- Produces: prose only.

- [ ] **Step 1: Confirm the current text**

Run: `grep -n "^### \`setup\`$" -A 15 plugins/autopilot/skills/autopilot/SKILL.md`
Expected: shows the `### \`setup\`` heading followed by "Unless \`reaper\` is \`false\` in config, run from the repository root:" and the reaper code block.

- [ ] **Step 2: Edit the setup section**

In `plugins/autopilot/skills/autopilot/SKILL.md`, replace:

```markdown
### `setup`

Unless `reaper` is `false` in config, run from the repository root:

```bash
node "$AP/scripts/autopilot-reaper.mjs" --apply \
  --dir=<config.worktree_dir> --base=<config.base_ref>
```
```

with:

```markdown
### `setup`

Run this unconditionally, first, from the repository root — before the
reaper conditional below, regardless of `reaper`'s value. It fetches
`origin` and best-effort fast-forwards `base_ref`'s local branch, so the
worktree below is always built from fresh state even when the reaper is
disabled or `base_ref` names a bare local branch the reaper's own fetch
never touches:

```bash
node "$AP/scripts/autopilot-sync-base.mjs" --base=<config.base_ref>
```

Report its outcome (updated or skipped, with reason) the same way the
reaper's keep/reason list is already reported.

Unless `reaper` is `false` in config, also run from the repository root:

```bash
node "$AP/scripts/autopilot-reaper.mjs" --apply \
  --dir=<config.worktree_dir> --base=<config.base_ref>
```
```

Do not change anything below this point in the `setup` section (the "Pass both flags explicitly from config" paragraph, "Report what it kept and why.", the worktree-creation paragraph, or the `Append:` line) — those are unrelated to this change and stay exactly as they are.

- [ ] **Step 3: Verify the edit**

Run: `grep -n "autopilot-sync-base.mjs" plugins/autopilot/skills/autopilot/SKILL.md`
Expected: one match, inside the `setup` section, showing the `--base=<config.base_ref>` invocation.

Run: `grep -n "autopilot-reaper.mjs" plugins/autopilot/skills/autopilot/SKILL.md`
Expected: still exactly the invocations that existed before (this edit must not have duplicated or removed the reaper block).

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS — 175 tests across 10 files, unchanged. (No test currently pins the `setup` section's prose, matching the existing convention that the reaper's own CLI invocation line isn't pinned by a guard test either — see `autopilot-no-design-gate.test.mjs` for what IS pinned in this file, and note it does not cover `setup`.)

- [ ] **Step 5: Commit**

```bash
git add plugins/autopilot/skills/autopilot/SKILL.md
git commit -m "feat(autopilot): freshen base_ref unconditionally at the start of setup"
```

---

### Task 4: Version bump to 1.5.0

Bump the plugin version in both manifests, and fix the existing test that hardcodes the prior version.

**Files:**
- Modify: `plugins/autopilot/.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`
- Modify: `plugins/autopilot/scripts/autopilot-findings-contract.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks — independent of the script and prose changes.
- Produces: nothing new — this is metadata only.

- [ ] **Step 1: Confirm the current version and the test that pins it**

Run: `grep -n '"version"' plugins/autopilot/.claude-plugin/plugin.json .claude-plugin/marketplace.json`
Expected: `1.4.0` in both files (marketplace.json shows it twice: `metadata.version` and the `autopilot` plugin entry).

Run: `grep -n '"1.4.0"' plugins/autopilot/scripts/autopilot-findings-contract.test.mjs`
Expected: three matches — `is at version 1.4.0`, `bumps the marketplace plugin entry`, `bumps the marketplace metadata block`.

- [ ] **Step 2: Update the pinning test first (so it fails for the right reason)**

In `plugins/autopilot/scripts/autopilot-findings-contract.test.mjs`, change all three `"1.4.0"` string literals to `"1.5.0"` (the test names themselves — e.g. `it("is at version 1.4.0", ...)` — can stay as-is or be updated to say 1.5.0; update them too, for a test suite that reads correctly):

```js
  it("is at version 1.5.0", () => {
    expect(pluginJson.version).toBe("1.5.0");
  });

  it("bumps the marketplace plugin entry to the same version", () => {
    const entry = marketplace.plugins.find((p) => p.name === "autopilot");
    expect(entry.version).toBe("1.5.0");
  });

  it("bumps the marketplace metadata block too", () => {
    expect(marketplace.metadata.version).toBe("1.5.0");
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-findings-contract.test.mjs`
Expected: FAIL — 3 assertions expect `"1.5.0"` but get `"1.4.0"`.

- [ ] **Step 4: Bump the versions**

In `plugins/autopilot/.claude-plugin/plugin.json`, change:

```json
  "version": "1.4.0",
```

to:

```json
  "version": "1.5.0",
```

In `.claude-plugin/marketplace.json`, change BOTH occurrences — `metadata.version` and the `autopilot` entry's `version` under `plugins` — from `"1.4.0"` to `"1.5.0"`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-findings-contract.test.mjs`
Expected: PASS (22 tests)

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — 175 tests across 10 files

- [ ] **Step 7: Commit**

```bash
git add plugins/autopilot/.claude-plugin/plugin.json .claude-plugin/marketplace.json plugins/autopilot/scripts/autopilot-findings-contract.test.mjs
git commit -m "chore(autopilot): bump to 1.5.0 for the sync-base-before-setup change"
```

---

## Open Questions

Noted rather than silently resolved. None of these block implementation — each has a stated default the plan already follows.

1. **What if the local branch has never been created at all** (e.g. a fresh clone of a project whose `base_ref` is a bare branch name that was never checked out or fetched into a local branch)? `git merge-base --is-ancestor <localBranch> <baseRef>` errors non-zero in that case too, so `syncBase` reports it as "diverged (or does not exist locally)" and skips — correct per the spec's "best-effort, never blocks the run" framing, since the worktree's actual base is `base_ref` as a git rev, already fresh from the fetch.
2. **Remote name is hardcoded to `origin`**, matching the existing convention in both `autopilot-land.mjs` and `autopilot-reaper.mjs` (`git fetch origin`). Not configurable; out of scope per the spec.
3. **Path comparison for "checked out here" is a plain string equality** between `git rev-parse --show-toplevel`'s output and the worktree-porcelain path. Both come from git on the same OS in the same invocation, so no normalization (symlinks, trailing slashes) is expected to be needed; if CI ever disagrees, `resolveMainPath`'s realpath-walking pattern in `autopilot-reaper.mjs` is the fallback to reach for.
