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
