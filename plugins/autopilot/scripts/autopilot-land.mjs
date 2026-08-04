import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const UNMERGED = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

export function parseConflictPaths(statusPorcelain) {
  return statusPorcelain
    .split("\n")
    .filter((line) => line.length > 3 && UNMERGED.has(line.slice(0, 2)))
    .map((line) => line.slice(3).trim());
}

export function parseRebaseOutcome({ code, stdout, stderr }) {
  if (code === 0) {
    return { status: "clean", conflicts: [], message: stdout.trim() };
  }
  const combined = `${stdout}\n${stderr}`;
  if (combined.includes("CONFLICT") || combined.includes("Merge conflict")) {
    return { status: "conflict", conflicts: [], message: combined.trim() };
  }
  return { status: "error", conflicts: [], message: combined.trim() };
}

export function land(baseRef, run) {
  const fetched = run(["fetch", "origin"]);
  if (fetched.code !== 0) {
    return {
      status: "error",
      conflicts: [],
      message: `git fetch failed: ${fetched.stderr.trim()}`,
    };
  }

  const outcome = parseRebaseOutcome(run(["rebase", baseRef]));
  if (outcome.status !== "conflict") return outcome;

  const status = run(["status", "--porcelain"]);
  return { ...outcome, conflicts: parseConflictPaths(status.stdout) };
}

function runGit(args) {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export function main(argv = process.argv.slice(2)) {
  const baseRef = argv[0] ?? "origin/main";
  const result = land(baseRef, runGit);

  console.log(`status: ${result.status}`);
  if (result.conflicts.length > 0) {
    console.log("conflicts:");
    for (const path of result.conflicts) console.log(`  ${path}`);
  }
  if (result.status !== "clean") console.log(result.message);
  process.exitCode = result.status === "clean" ? 0 : 1;
}

// pathToFileURL rather than a `file://` template: the plugin's install path is
// user-controlled and a space in it would silently skip main().
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
