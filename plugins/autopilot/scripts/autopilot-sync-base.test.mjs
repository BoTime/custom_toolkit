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
