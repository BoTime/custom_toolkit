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
  restoreWorktree,
  formatRestore,
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

describe("createWithOrca — reusing the enclosing Orca worktree", () => {
  // Orca's own handoff path (`worktree create --agent claude --prompt
  // "/autopilot-github 48"`) starts the run *inside* a worktree Orca already
  // made for the issue. Creating another one would leave that checkout empty
  // and put the work somewhere the dashboard is not watching.
  const gitOk = (args) => {
    if (args[0] === "rev-parse") return "/repo/.git\n";
    if (args[0] === "remote") return "origin\n";
    throw new Error(`unexpected git ${args.join(" ")}`);
  };

  it("reuses the current worktree when cwd is inside a non-main Orca worktree", () => {
    const seen = [];
    const exec = (file, args, opts) => {
      seen.push([file, ...args]);
      if (file === "git") return gitOk(args);
      if (args[1] === "current" && opts.cwd === WT_PATH) return worktreeEnvelope();
      if (args[1] === "set") return worktreeEnvelope();
      throw new Error(`unexpected orca ${args.join(" ")}`);
    };
    const outcome = createWithOrca({
      exec, cwd: WT_PATH, name: "issue-48-thing", base: "origin/main", issue: "48",
    });
    expect(outcome).toEqual({
      kind: "orca", path: WT_PATH, branch: "BoTime/issue-48-thing", reused: true,
    });
    expect(seen.some((c) => c[0] === "orca" && c[2] === "create")).toBe(false);
    expect(seen).toContainEqual([
      "orca", "worktree", "set", "--worktree", `path:${WT_PATH}`, "--issue", "48", "--json",
    ]);
  });

  it("reuses when cwd is a subdirectory of the current worktree", () => {
    const exec = (file, args) => {
      if (file === "git") return gitOk(args);
      if (args[1] === "current") return worktreeEnvelope();
      throw new Error(`unexpected orca ${args.join(" ")}`);
    };
    const outcome = createWithOrca({
      exec, cwd: `${WT_PATH}/plugins/autopilot`, name: "n", base: "origin/main",
    });
    expect(outcome.kind).toBe("orca");
    expect(outcome.reused).toBe(true);
  });

  it("does not link the issue when none was given, and ignores a failing link", () => {
    const seen = [];
    const exec = (file, args) => {
      seen.push([file, ...args]);
      if (file === "git") return gitOk(args);
      if (args[1] === "current") return worktreeEnvelope();
      if (args[1] === "set") return boom({ stderr: "no\n" })();
      throw new Error(`unexpected orca ${args.join(" ")}`);
    };
    expect(createWithOrca({ exec, cwd: WT_PATH, name: "n", base: "origin/main" }).reused)
      .toBe(true);
    expect(seen.some((c) => c[2] === "set")).toBe(false);
    expect(createWithOrca({ exec, cwd: WT_PATH, name: "n", base: "origin/main", issue: 48 })
      .reused).toBe(true);
  });

  it("creates a new worktree when the current one is the main worktree", () => {
    const exec = (file, args) => {
      if (file === "git") return gitOk(args);
      if (args[1] === "current") return worktreeEnvelope({ path: "/repo", isMainWorktree: true });
      if (args[1] === "create") return worktreeEnvelope();
      throw new Error(`unexpected orca ${args.join(" ")}`);
    };
    const outcome = createWithOrca({ exec, cwd: "/repo", name: "n", base: "origin/main" });
    expect(outcome).toEqual({ kind: "orca", path: WT_PATH, branch: "BoTime/issue-48-thing" });
  });

  it("creates a new worktree when `worktree current` names a directory cwd is not in", () => {
    const exec = (file, args) => {
      if (file === "git") return gitOk(args);
      if (args[1] === "current") return worktreeEnvelope({ path: "/elsewhere" });
      if (args[1] === "create") return worktreeEnvelope();
      throw new Error(`unexpected orca ${args.join(" ")}`);
    };
    expect(createWithOrca({ exec, cwd: "/repo", name: "n", base: "origin/main" }).reused)
      .toBeUndefined();
  });

  it("creates a new worktree when `worktree current` is not ok", () => {
    const exec = (file, args) => {
      if (file === "git") return gitOk(args);
      if (args[1] === "current") return okEnvelope({});
      if (args[1] === "create") return worktreeEnvelope();
      if (args[1] === "show") return okEnvelope({ repo: { id: REPO_ID } });
      throw new Error(`unexpected orca ${args.join(" ")}`);
    };
    const outcome = createWithOrca({ exec, cwd: "/repo", name: "n", base: "origin/main" });
    expect(outcome.kind).toBe("orca");
    expect(outcome.reused).toBeUndefined();
  });

  it("still falls back when `worktree current` throws — orca is unusable, not merely absent here", () => {
    const exec = (file, args) => {
      if (file === "git") return gitOk(args);
      if (args[1] === "current") return boom({ stderr: "runtime not reachable\n" })();
      throw new Error(`unexpected orca ${args.join(" ")}`);
    };
    expect(createWithOrca({ exec, cwd: "/repo", name: "n", base: "origin/main" }))
      .toEqual({ kind: "fallback", reason: "runtime not reachable" });
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

describe("restoreWorktree", () => {
  // A run's worktree can disappear mid-run: Orca's UI removes the card, a
  // concurrent run's reaper reaps it while it is still merged and clean, or a
  // human deletes the directory. The branch survives all three, so the
  // checkout is recoverable — but only git can put an existing branch back at
  // an existing path, which is why the orca provider reports a downgrade
  // rather than pretending Orca still owns the result.
  const REF = `refs/heads/${"BoTime/issue-48-thing"}`;
  const BR = "BoTime/issue-48-thing";

  /** git that answers the three probes: branch exists, path's HEAD, add/prune. */
  const gitStub = ({ headAt = BR, branchRef = true, onAdd } = {}) => {
    const seen = [];
    const exec = (file, args) => {
      seen.push([file, ...args]);
      if (file !== "git") throw new Error(`unexpected ${file}`);
      if (args[0] === "rev-parse" && args[1] === "--git-common-dir") return "/repo/.git\n";
      if (args[0] === "show-ref") {
        if (!branchRef) throw new Error("not a ref");
        return "";
      }
      if (args[0] === "-C" && args[2] === "rev-parse") {
        if (headAt === null) throw new Error("not a git repository");
        return `${headAt}\n`;
      }
      if (args[0] === "worktree" && args[1] === "prune") return "";
      if (args[0] === "worktree" && args[1] === "add") {
        if (onAdd) return onAdd();
        return "Preparing worktree\n";
      }
      throw new Error(`unexpected git ${args.join(" ")}`);
    };
    return { exec, seen };
  };

  const restore = (stub, over = {}) => restoreWorktree({
    exec: stub.exec, cwd: "/repo", path: WT_PATH, branch: BR, provider: "orca", ...over,
  });

  it("reports the checkout intact and touches nothing when it is still there", () => {
    const stub = gitStub();
    expect(restore(stub)).toEqual({ kind: "intact", path: WT_PATH, branch: BR });
    expect(stub.seen.some((c) => c[1] === "worktree" && c[2] === "add")).toBe(false);
  });

  it("restores the recorded path onto the recorded branch when the checkout is gone", () => {
    const stub = gitStub({ headAt: null });
    const outcome = restore(stub);
    expect(outcome.kind).toBe("restored");
    expect(outcome.path).toBe(WT_PATH);
    expect(outcome.branch).toBe(BR);
    expect(stub.seen).toContainEqual(["git", "worktree", "add", WT_PATH, BR]);
  });

  it("prunes the stale admin record before adding, or `add` would refuse the path", () => {
    const stub = gitStub({ headAt: null });
    restore(stub);
    const order = stub.seen.filter((c) => c[1] === "worktree").map((c) => c[2]);
    expect(order).toEqual(["prune", "add"]);
  });

  it("says the run is no longer orca-managed under the orca provider", () => {
    // Probed against the real CLI: `orca worktree set --worktree path:<orphan>`
    // answers ok:true while `worktree current` still denies the path, so there
    // is no honest way to hand the restored checkout back to Orca.
    const outcome = restore(gitStub({ headAt: null }));
    expect(outcome.note).toMatch(/no longer orca-managed/);
  });

  it("adds no note under the git provider, where restoring in place loses nothing", () => {
    const outcome = restore(gitStub({ headAt: null }), { provider: "git" });
    expect(outcome.kind).toBe("restored");
    expect(outcome.note).toBeUndefined();
  });

  it("parks when the branch is gone — the run's commits went with it", () => {
    const outcome = restore(gitStub({ headAt: null, branchRef: false }));
    expect(outcome.kind).toBe("park");
    expect(outcome.reason).toMatch(/branch BoTime\/issue-48-thing no longer exists/);
  });

  it("parks rather than guessing when the path holds a different branch", () => {
    const outcome = restore(gitStub({ headAt: "BoTime/something-else" }));
    expect(outcome.kind).toBe("park");
    expect(outcome.reason).toMatch(/BoTime\/something-else/);
  });

  it("names a detached HEAD as such rather than reporting a branch called HEAD", () => {
    const outcome = restore(gitStub({ headAt: "HEAD" }));
    expect(outcome.kind).toBe("park");
    expect(outcome.reason).toMatch(/detached HEAD/);
  });

  it("parks when `git worktree add` fails, carrying git's own reason", () => {
    const stub = gitStub({
      headAt: null,
      onAdd: boom({ stderr: "fatal: 'BoTime/issue-48-thing' is already checked out\n" }),
    });
    const outcome = restore(stub);
    expect(outcome.kind).toBe("park");
    expect(outcome.reason).toMatch(/already checked out/);
  });

  it("parks when the main checkout cannot be located", () => {
    const exec = (file, args) => {
      if (args[1] === "--git-common-dir") return boom({ stderr: "not a git repo\n" })();
      throw new Error("must not probe further");
    };
    expect(restoreWorktree({ exec, cwd: "/nowhere", path: WT_PATH, branch: BR, provider: "orca" }))
      .toEqual({ kind: "park", reason: "cannot locate the main checkout (not a git repo)" });
  });

  it("verifies the branch by full ref so a tag of the same name cannot satisfy it", () => {
    const stub = gitStub();
    restore(stub);
    expect(stub.seen).toContainEqual(["git", "show-ref", "--verify", "--quiet", REF]);
  });
});

describe("formatRestore", () => {
  it("formats an intact checkout", () => {
    expect(formatRestore({ kind: "intact", path: "/w", branch: "b" }))
      .toBe("worktree intact: /w (branch b)");
  });

  it("formats a restore with its note", () => {
    expect(formatRestore({ kind: "restored", path: "/w", branch: "b", note: "no longer x" }))
      .toBe("worktree restored: /w (branch b) — no longer x");
  });

  it("formats a restore without a note", () => {
    expect(formatRestore({ kind: "restored", path: "/w", branch: "b" }))
      .toBe("worktree restored: /w (branch b)");
  });

  it("formats a park", () => {
    expect(formatRestore({ kind: "park", reason: "branch b no longer exists" }))
      .toBe("park: branch b no longer exists");
  });
});

describe("main — restore", () => {
  const CONFIG = "/proj/.superpowers/autopilot/configs/autopilot.json";

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
        readFile: (p) =>
          (p === CONFIG ? JSON.stringify({ worktree_provider: provider }) : readFileSyncReal(p)),
        log: (line) => out.push(line),
        err: (line) => errs.push(line),
      },
    };
  };

  const args = (...extra) => [
    "restore", `--config=${CONFIG}`, "--host=claude", ...extra,
  ];

  it("prints the intact line and exits 0", () => {
    const exec = (file, a) => {
      if (a[1] === "--git-common-dir") return "/repo/.git\n";
      if (a[0] === "show-ref") return "";
      if (a[0] === "-C") return "BoTime/x\n";
      throw new Error(`unexpected git ${a.join(" ")}`);
    };
    const { out, io: deps } = io("orca", exec);
    expect(main(args("--path=/w", "--branch=BoTime/x"), deps)).toBe(0);
    expect(out).toEqual(["worktree intact: /w (branch BoTime/x)"]);
  });

  it("prints the park line and still exits 0 — a park is a run decision, not a usage error", () => {
    const exec = (file, a) => {
      if (a[1] === "--git-common-dir") return "/repo/.git\n";
      if (a[0] === "show-ref") throw new Error("no ref");
      throw new Error(`unexpected git ${a.join(" ")}`);
    };
    const { out, io: deps } = io("orca", exec);
    expect(main(args("--path=/w", "--branch=BoTime/x"), deps)).toBe(0);
    expect(out[0]).toMatch(/^park: branch BoTime\/x no longer exists/);
  });

  it("exits non-zero without --path or --branch", () => {
    const { errs, io: deps } = io("orca", () => { throw new Error("must not run"); });
    expect(main(args("--branch=BoTime/x"), deps)).not.toBe(0);
    expect(errs.join(" ")).toMatch(/--path/);
    const second = io("orca", () => { throw new Error("must not run"); });
    expect(main(args("--path=/w"), second.io)).not.toBe(0);
    expect(second.errs.join(" ")).toMatch(/--branch/);
  });
});
