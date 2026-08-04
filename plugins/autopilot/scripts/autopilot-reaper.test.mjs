import { describe, it, expect } from "vitest";
import { parseWorktrees, classify, planReap, resolveMainPath } from "./autopilot-reaper.mjs";

const PORCELAIN = `worktree /repo
HEAD aaaa1111
branch refs/heads/main

worktree /repo/.claude/worktrees/merged-clean
HEAD bbbb2222
branch refs/heads/merged-clean

worktree /repo/.claude/worktrees/in-flight
HEAD cccc3333
branch refs/heads/in-flight

worktree /repo/.claude/worktrees/locked-one
HEAD dddd4444
branch refs/heads/locked-one
locked claude session locked-one (pid 5148)

worktree /repo/.claude/worktrees/detached-one
HEAD eeee5555
detached
`;

describe("parseWorktrees", () => {
  it("parses each stanza into path, head, and branch", () => {
    const list = parseWorktrees(PORCELAIN);
    expect(list).toHaveLength(5);
    expect(list[0]).toEqual({
      path: "/repo", head: "aaaa1111", branch: "main", locked: false,
    });
    expect(list[1]).toEqual({
      path: "/repo/.claude/worktrees/merged-clean",
      head: "bbbb2222", branch: "merged-clean", locked: false,
    });
  });

  it("marks a locked worktree", () => {
    const list = parseWorktrees(PORCELAIN);
    const locked = list.find((w) => w.branch === "locked-one");
    expect(locked.locked).toBe(true);
  });

  it("reports a detached worktree with a null branch", () => {
    const list = parseWorktrees(PORCELAIN);
    const detached = list.find((w) => w.path.endsWith("detached-one"));
    expect(detached.branch).toBe(null);
  });
});

describe("classify", () => {
  const wt = {
    path: "/repo/.claude/worktrees/x", head: "b", branch: "x", locked: false,
  };
  const opts = { mainPath: "/repo", worktreeDir: ".claude/worktrees" };

  it("reaps a merged, clean, unlocked worktree", () => {
    const r = classify(wt, { unmergedPatches: 0, dirtyLines: 0 }, opts);
    expect(r).toEqual({ reapable: true, reason: "merged, clean, unlocked" });
  });

  it("keeps a worktree with unmerged patches", () => {
    const r = classify(wt, { unmergedPatches: 3, dirtyLines: 0 }, opts);
    expect(r).toEqual({ reapable: false, reason: "3 unmerged commit(s)" });
  });

  it("keeps a dirty worktree", () => {
    const r = classify(wt, { unmergedPatches: 0, dirtyLines: 2 }, opts);
    expect(r).toEqual({ reapable: false, reason: "2 uncommitted change(s)" });
  });

  it("keeps a locked worktree even when merged and clean", () => {
    const r = classify({ ...wt, locked: true }, { unmergedPatches: 0, dirtyLines: 0 }, opts);
    expect(r).toEqual({ reapable: false, reason: "locked by another session" });
  });

  it("keeps the main checkout", () => {
    const main = { path: "/repo", head: "a", branch: "main", locked: false };
    const r = classify(main, { unmergedPatches: 0, dirtyLines: 0 }, opts);
    expect(r).toEqual({ reapable: false, reason: "main checkout" });
  });

  it("keeps a worktree outside the configured worktree dir", () => {
    const outside = {
      path: "/repo/.codex/worktrees/y", head: "c", branch: "y", locked: false,
    };
    const r = classify(outside, { unmergedPatches: 0, dirtyLines: 0 }, opts);
    expect(r).toEqual({ reapable: false, reason: "outside .claude/worktrees" });
  });

  it("keeps a detached worktree", () => {
    const det = {
      path: "/repo/.claude/worktrees/d", head: "e", branch: null, locked: false,
    };
    const r = classify(det, { unmergedPatches: 0, dirtyLines: 0 }, opts);
    expect(r).toEqual({ reapable: false, reason: "detached HEAD" });
  });

  it("reports the first failing condition when several fail", () => {
    const r = classify({ ...wt, locked: true }, { unmergedPatches: 2, dirtyLines: 1 }, opts);
    expect(r).toEqual({ reapable: false, reason: "locked by another session" });
  });
});

describe("planReap", () => {
  it("splits worktrees into reap and keep lists", () => {
    const worktrees = parseWorktrees(PORCELAIN);
    const probe = (wt) => {
      if (wt.branch === "merged-clean") return { unmergedPatches: 0, dirtyLines: 0 };
      if (wt.branch === "in-flight") return { unmergedPatches: 4, dirtyLines: 0 };
      return { unmergedPatches: 0, dirtyLines: 0 };
    };
    const plan = planReap(worktrees, probe, {
      mainPath: "/repo", worktreeDir: ".claude/worktrees",
    });

    expect(plan.reap).toEqual(["/repo/.claude/worktrees/merged-clean"]);
    expect(plan.keep).toEqual([
      { path: "/repo", reason: "main checkout" },
      { path: "/repo/.claude/worktrees/in-flight", reason: "4 unmerged commit(s)" },
      { path: "/repo/.claude/worktrees/locked-one", reason: "locked by another session" },
      { path: "/repo/.claude/worktrees/detached-one", reason: "detached HEAD" },
    ]);
  });

  it("never probes the main checkout", () => {
    const worktrees = parseWorktrees(PORCELAIN);
    const probed = [];
    const probe = (wt) => {
      probed.push(wt.path);
      return { unmergedPatches: 0, dirtyLines: 0 };
    };
    planReap(worktrees, probe, { mainPath: "/repo", worktreeDir: ".claude/worktrees" });
    expect(probed).not.toContain("/repo");
  });

  it("returns an empty reap list when nothing qualifies", () => {
    const worktrees = parseWorktrees(PORCELAIN);
    const probe = () => ({ unmergedPatches: 1, dirtyLines: 0 });
    const plan = planReap(worktrees, probe, {
      mainPath: "/repo", worktreeDir: ".claude/worktrees",
    });
    expect(plan.reap).toEqual([]);
  });
});

describe("resolveMainPath", () => {
  it("resolves the primary checkout from a linked worktree's git-common-dir", () => {
    const run = () => "/repo/.git/worktrees/autopilot-workflow";
    expect(resolveMainPath(run)).toBe("/repo");
  });

  it("resolves the primary checkout from the primary checkout's own git-common-dir", () => {
    const run = () => "/repo/.git";
    expect(resolveMainPath(run)).toBe("/repo");
  });
});
