import { execFileSync } from "node:child_process";
import { resolve, dirname, basename } from "node:path";
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

export function classify(worktree, probeResult, opts) {
  if (worktree.path === opts.mainPath) {
    return { reapable: false, reason: "main checkout" };
  }
  if (!worktree.path.includes(`/${opts.worktreeDir}/`)) {
    return { reapable: false, reason: `outside ${opts.worktreeDir}` };
  }
  if (worktree.locked) {
    return { reapable: false, reason: "locked by another session" };
  }
  if (worktree.branch === null) {
    return { reapable: false, reason: "detached HEAD" };
  }
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
    const skip =
      wt.path === opts.mainPath ||
      !wt.path.includes(`/${opts.worktreeDir}/`) ||
      wt.locked ||
      wt.branch === null;
    const probeResult = skip ? { unmergedPatches: 0, dirtyLines: 0 } : probe(wt);
    const { reapable, reason } = classify(wt, probeResult, opts);
    if (reapable) reap.push(wt.path);
    else keep.push({ path: wt.path, reason });
  }
  return { reap, keep };
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

export function resolveMainPath(run) {
  let dir = resolve(run().trim());
  while (basename(dir) !== ".git" && dirname(dir) !== dir) {
    dir = dirname(dir);
  }
  return dirname(dir);
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

export function main(argv = process.argv.slice(2)) {
  const apply = argv.includes("--apply");
  const mainPath = resolveMainPath(() =>
    git(["rev-parse", "--git-common-dir"], process.cwd()),
  );
  const baseRef = argv.find((a) => a.startsWith("--base="))?.slice(7) ?? "origin/main";
  const worktreeDir =
    argv.find((a) => a.startsWith("--dir="))?.slice(6) ?? ".claude/worktrees";

  git(["fetch", "origin"], mainPath);
  const worktrees = parseWorktrees(git(["worktree", "list", "--porcelain"], mainPath));
  const plan = planReap(worktrees, probeWorktree(baseRef, mainPath), {
    mainPath,
    worktreeDir,
  });

  for (const { path, reason } of plan.keep) {
    console.log(`keep  ${path} — ${reason}`);
  }
  for (const path of plan.reap) {
    if (apply) {
      git(["worktree", "remove", path], mainPath);
      console.log(`removed ${path}`);
    } else {
      console.log(`reapable ${path} (dry run; pass --apply to remove)`);
    }
  }
  if (apply && plan.reap.length > 0) git(["worktree", "prune"], mainPath);
}

// pathToFileURL rather than a `file://` template: the plugin's install path is
// user-controlled and a space in it would silently skip main().
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
