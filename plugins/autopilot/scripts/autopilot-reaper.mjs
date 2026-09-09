import { execFileSync } from "node:child_process";
import {
  WORKTREE_PROVIDERS, resolveMainPath, resolveRepoId, parseWorktreeList, failureReason,
} from "./autopilot-worktree.mjs";
import { pathToFileURL } from "node:url";

export function parseWorktrees(porcelain) {
  const stanzas = porcelain.trim().split(/\n\s*\n/);
  return stanzas.map((stanza) => {
    const lines = stanza.split("\n");
    const out = { path: null, head: null, branch: null, locked: false };
    for (const line of lines) {
      if (line.startsWith("worktree ")) out.path = line.slice(9);
      else if (line.startsWith("HEAD ")) out.head = line.slice(5);
      else if (line.startsWith("branch refs/heads/")) out.branch = line.slice(18);
      else if (line === "detached") out.branch = null;
      else if (line === "locked" || line.startsWith("locked ")) out.locked = true;
    }
    return out;
  });
}

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

function run(file, args, opts) {
  return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
}

function git(args, cwd) {
  return run("git", args, { cwd });
}

export function probeWorktree(baseRef, mainPath) {
  return (wt) => {
    const cherry = git(["cherry", baseRef, wt.branch], mainPath);
    const unmergedPatches = cherry.split("\n").filter((l) => l.startsWith("+")).length;
    const status = git(["status", "--porcelain"], wt.path);
    const dirtyLines = status.split("\n").filter((l) => l.trim() !== "").length;
    return { unmergedPatches, dirtyLines };
  };
}

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

// pathToFileURL rather than a `file://` template: the plugin's install path is
// user-controlled and a space in it would silently skip main().
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
