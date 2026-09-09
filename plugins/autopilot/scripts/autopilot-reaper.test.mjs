import { describe, it, expect } from "vitest";
import { parseWorktrees, classify, planReap, structuralReason, orcaRmArgv, reapOrca } from "./autopilot-reaper.mjs";

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
