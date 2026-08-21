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
