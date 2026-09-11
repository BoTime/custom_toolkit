import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { assertHost, resolveConfigPath } from "./autopilot-host.mjs";
import { WORKTREE_PROVIDERS, loadConfig } from "./autopilot-config.mjs";

export { WORKTREE_PROVIDERS };

const REFS_HEADS = "refs/heads/";

/**
 * The primary checkout, walked up from a `git rev-parse --git-common-dir`
 * result. Lives here rather than in autopilot-reaper.mjs because both the
 * create path and the reaper need it, and the reaper imports this module —
 * the dependency runs one way only.
 */
export function resolveMainPath(run) {
  let dir = resolve(run().trim());
  while (basename(dir) !== ".git" && dirname(dir) !== dir) {
    dir = dirname(dir);
  }
  return dirname(dir);
}

/**
 * `base_ref` is a ref (`origin/main`); Orca's `--base-branch` wants a branch
 * name. The remote list is a parameter rather than a guess: stripping the
 * first path segment blindly would turn `release/2026-09` into `2026-09`.
 */
export function baseBranchOf(baseRef, remotes = ["origin"]) {
  for (const remote of remotes) {
    if (baseRef.startsWith(`${remote}/`)) return baseRef.slice(remote.length + 1);
  }
  return baseRef;
}

export function stripRefsHeads(branch) {
  return branch.startsWith(REFS_HEADS) ? branch.slice(REFS_HEADS.length) : branch;
}

/**
 * One line of human-readable cause from a thrown execFileSync error. `binary`
 * names the command that failed: the restore path shells out to git, and
 * "orca CLI not found" would be a lie there.
 */
export function failureReason(error, binary = "orca") {
  if (error?.code === "ENOENT") return `${binary} CLI not found on PATH`;
  const stderr = typeof error?.stderr === "string" ? error.stderr : "";
  const first = stderr.split("\n").map((l) => l.trim()).find(Boolean);
  return first || error?.message || "the command exited non-zero";
}

/**
 * `--no-parent` is deliberate: an autopilot run is independent work, and Orca
 * would otherwise infer the caller's worktree as a parent and inherit lineage
 * that does not apply.
 */
export function createArgv({ name, repoId, baseBranch, issue }) {
  const argv = [
    "worktree", "create",
    "--name", name,
    "--repo", `id:${repoId}`,
    "--base-branch", baseBranch,
  ];
  if (issue !== undefined && issue !== null && issue !== "") {
    argv.push("--issue", String(issue));
  }
  argv.push("--no-parent", "--json");
  return argv;
}

/** orca's failure envelope carries an object, not a string. */
function envelopeError(parsed) {
  const error = parsed?.error;
  if (typeof error === "string" && error) return error;
  if (error && typeof error === "object") {
    for (const key of ["message", "code"]) {
      if (typeof error[key] === "string" && error[key]) return error[key];
    }
  }
  return "orca reported a failure";
}

function parseEnvelope(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { ok: false, reason: "orca returned output that is not JSON" };
  }
  if (!parsed || typeof parsed !== "object" || parsed.ok !== true) {
    return { ok: false, reason: envelopeError(parsed) };
  }
  if (!parsed.result || typeof parsed.result !== "object") {
    return { ok: false, reason: "orca returned no result object" };
  }
  return { ok: true, result: parsed.result };
}

/**
 * One Orca row in the shape `classify`/`planReap` in autopilot-reaper.mjs
 * read: `locked` is always false (Orca has no lock concept) and a detached
 * checkout keeps its path with a null branch, so the reaper reports it as a
 * detached HEAD rather than silently losing it.
 */
function entryOf(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.path !== "string" || raw.path === "") return null;
  const branch =
    typeof raw.branch === "string" && raw.branch !== "" ? stripRefsHeads(raw.branch) : null;
  return { path: raw.path, branch, locked: false, isMain: raw.isMainWorktree === true };
}

/** `orca worktree create|current|show --json` → the single worktree it names. */
export function parseWorktreeResult(stdout) {
  const envelope = parseEnvelope(stdout);
  if (!envelope.ok) return envelope;
  const worktree = entryOf(envelope.result.worktree);
  if (!worktree || worktree.branch === null) {
    return { ok: false, reason: "orca reported no usable worktree path and branch" };
  }
  return { ok: true, worktree };
}

/** `orca worktree list --json` → every row, unusable ones dropped. */
export function parseWorktreeList(stdout) {
  const envelope = parseEnvelope(stdout);
  if (!envelope.ok) return envelope;
  const rows = envelope.result.worktrees;
  if (!Array.isArray(rows)) return { ok: false, reason: "orca returned no worktree list" };
  return { ok: true, worktrees: rows.map(entryOf).filter(Boolean) };
}

/**
 * The Orca repo id for the checkout at `mainPath`. The main checkout may not
 * itself be an Orca-managed worktree, so `worktree current` can come back
 * empty while the repo is still registered — hence the `repo show` fallback.
 *
 * The envelope's top-level `id` is a request id and is never read here.
 */
export function resolveRepoId(exec, mainPath) {
  // Carries orca's own wording out to the caller when it explains itself, so
  // the fallback and `orca unavailable` lines say `repo_not_found` rather than
  // a generic sentence.
  let lastReason = "orca reported no repo id for this checkout";
  const idFrom = (stdout, pick) => {
    const envelope = parseEnvelope(stdout);
    if (!envelope.ok) {
      lastReason = envelope.reason;
      return null;
    }
    const id = pick(envelope.result);
    return typeof id === "string" && id !== "" ? id : null;
  };

  let current;
  try {
    current = exec("orca", ["worktree", "current", "--json"], { cwd: mainPath });
  } catch (error) {
    return { ok: false, reason: failureReason(error) };
  }
  const fromCurrent = idFrom(current, (r) => r.worktree?.repoId);
  if (fromCurrent) return { ok: true, id: fromCurrent };

  let shown;
  try {
    shown = exec("orca", ["repo", "show", "--repo", `path:${mainPath}`, "--json"], {
      cwd: mainPath,
    });
  } catch (error) {
    return { ok: false, reason: failureReason(error) };
  }
  const fromRepo = idFrom(shown, (r) => r.repo?.id);
  if (fromRepo) return { ok: true, id: fromRepo };

  return { ok: false, reason: lastReason };
}

/**
 * The Orca worktree `cwd` sits inside, or null. This is what lets Orca's own
 * handoff path — `worktree create --agent claude --prompt "/autopilot ..."` —
 * start a run inside a worktree Orca already made for it: creating a second
 * checkout would leave that one empty and the work somewhere Orca's dashboard
 * is not watching. The path check is deliberate: `worktree current` resolves
 * by directory, but only a worktree that actually contains `cwd` is reused.
 */
export function enclosingWorktree(exec, cwd) {
  let stdout;
  try {
    stdout = exec("orca", ["worktree", "current", "--json"], { cwd });
  } catch {
    return null;
  }
  const parsed = parseWorktreeResult(stdout);
  if (!parsed.ok || parsed.worktree.isMain) return null;
  const { path } = parsed.worktree;
  const inside = cwd === path || cwd.startsWith(path.endsWith("/") ? path : `${path}/`);
  return inside ? parsed.worktree : null;
}

export function formatOutcome(outcome) {
  if (outcome.kind === "git") return "provider: git";
  if (outcome.kind === "fallback") return `fallback: git — ${outcome.reason}`;
  return `worktree: ${outcome.path} (branch ${outcome.branch})`;
}

/**
 * Every failure here returns a `fallback` outcome. Autopilot's Phase 2 is
 * unattended; a provider that can halt a run is worse than no provider at all.
 */
export function createWithOrca({ exec, cwd, name, base, issue }) {
  const enclosing = enclosingWorktree(exec, cwd);
  if (enclosing) {
    if (issue !== undefined && issue !== null && issue !== "") {
      // Best effort: the run is already in the right place, and a card
      // without its issue link is a reporting defect, not a provider failure.
      try {
        exec("orca", [
          "worktree", "set", "--worktree", `path:${enclosing.path}`,
          "--issue", String(issue), "--json",
        ], { cwd });
      } catch {
        // deliberately ignored
      }
    }
    return { kind: "orca", path: enclosing.path, branch: enclosing.branch, reused: true };
  }

  let mainPath;
  try {
    mainPath = resolveMainPath(() => exec("git", ["rev-parse", "--git-common-dir"], { cwd }));
  } catch (error) {
    return { kind: "fallback", reason: `cannot locate the main checkout (${failureReason(error)})` };
  }

  const repo = resolveRepoId(exec, mainPath);
  if (!repo.ok) return { kind: "fallback", reason: repo.reason };

  let remotes = ["origin"];
  try {
    const listed = exec("git", ["remote"], { cwd: mainPath })
      .split("\n").map((l) => l.trim()).filter(Boolean);
    if (listed.length > 0) remotes = listed;
  } catch {
    // Not a provider problem: `origin` is the shipped default's prefix.
  }

  let stdout;
  try {
    stdout = exec(
      "orca",
      createArgv({ name, repoId: repo.id, baseBranch: baseBranchOf(base, remotes), issue }),
      { cwd: mainPath },
    );
  } catch (error) {
    return { kind: "fallback", reason: failureReason(error) };
  }

  const parsed = parseWorktreeResult(stdout);
  if (!parsed.ok) return { kind: "fallback", reason: parsed.reason };
  return { kind: "orca", path: parsed.worktree.path, branch: parsed.worktree.branch };
}

/**
 * Orca cannot take back a checkout it did not create. Probed against the real
 * CLI: `orca worktree set --worktree path:<orphan>` answers `ok: true` and
 * echoes a record, while `orca worktree current` in that same directory still
 * reports `selector_not_found`. So a restored checkout is git's, and the run
 * says so rather than carrying on as though the dashboard were still watching.
 */
const ORCA_NOTE = "no longer orca-managed: orca cannot re-adopt a checkout it did not create";

/**
 * A run's worktree can vanish mid-run — Orca's UI removes the card, a
 * concurrent run's reaper reaps it while it is still merged and clean, or
 * someone deletes the directory. The branch survives all three, so the
 * checkout is recoverable, and `git worktree add <path> <branch>` is the only
 * mechanism that puts an *existing* branch back at an *existing* path: Orca's
 * `worktree create` would branch afresh from a base and rename the run.
 *
 * The recorded path is restored in place, never relocated. The ledger's
 * `worktree:` line is the sole source of the path for every later stage, and
 * that line is already written.
 *
 * Two states are not recoverable and park instead of being guessed at: a
 * branch that no longer exists took the run's commits with it, and a path
 * holding some other branch means the ledger no longer describes reality.
 */
export function restoreWorktree({ exec, cwd, path, branch, provider }) {
  let mainPath;
  try {
    mainPath = resolveMainPath(() => exec("git", ["rev-parse", "--git-common-dir"], { cwd }));
  } catch (error) {
    return {
      kind: "park",
      reason: `cannot locate the main checkout (${failureReason(error, "git")})`,
    };
  }

  // The full ref, verified: a tag or a remote-tracking ref of the same name
  // must not stand in for the branch the run's commits are on.
  try {
    exec("git", ["show-ref", "--verify", "--quiet", `${REFS_HEADS}${branch}`], { cwd: mainPath });
  } catch {
    return { kind: "park", reason: `branch ${branch} no longer exists — nothing to restore` };
  }

  // `-C` rather than `cwd`: spawning into a directory that is gone throws
  // ENOENT before git runs, which reads as a git failure rather than an
  // absent checkout.
  let headAt;
  try {
    headAt = exec("git", ["-C", path, "rev-parse", "--abbrev-ref", "HEAD"]).trim() || null;
  } catch {
    headAt = null;
  }

  if (headAt === branch) return { kind: "intact", path, branch };
  if (headAt === "HEAD") {
    return { kind: "park", reason: `the checkout at ${path} is on a detached HEAD, not ${branch}` };
  }
  if (headAt !== null) {
    return { kind: "park", reason: `the checkout at ${path} is on ${headAt}, not ${branch}` };
  }

  // A removed directory can leave git's admin record behind, and `worktree
  // add` refuses a path it still believes is registered.
  try {
    exec("git", ["worktree", "prune"], { cwd: mainPath });
  } catch {
    // Best effort: when `add` succeeds anyway, the prune was unnecessary.
  }

  try {
    exec("git", ["worktree", "add", path, branch], { cwd: mainPath });
  } catch (error) {
    return { kind: "park", reason: `cannot restore ${path} (${failureReason(error, "git")})` };
  }

  const outcome = { kind: "restored", path, branch };
  if (provider === "orca") outcome.note = ORCA_NOTE;
  return outcome;
}

export function formatRestore(outcome) {
  if (outcome.kind === "park") return `park: ${outcome.reason}`;
  const verb = outcome.kind === "intact" ? "intact" : "restored";
  const note = outcome.note ? ` — ${outcome.note}` : "";
  return `worktree ${verb}: ${outcome.path} (branch ${outcome.branch})${note}`;
}

export function parseFlags(argv) {
  const values = {};
  for (const arg of argv) {
    const m = /^--([a-z0-9-]+)=([\s\S]*)$/.exec(arg);
    if (!m) throw new Error(`unrecognized argument "${arg}" — flags are --key=value`);
    values[m[1].replace(/-/g, "_")] = m[2];
  }
  return values;
}

const USAGE = [
  "usage: autopilot-worktree.mjs create --config=<path> --host=<host> " +
    "--name=<run> --base=<ref> [--issue=<n>]",
  "       autopilot-worktree.mjs restore --config=<path> --host=<host> " +
    "--path=<worktree> --branch=<branch>",
].join("\n");

export function main(argv = process.argv.slice(2), io = {}) {
  const {
    exec = (file, args, opts) =>
      execFileSync(file, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        ...opts,
      }),
    env = process.env,
    readFile = (p) => readFileSync(p, "utf8"),
    cwd = process.cwd(),
    log = console.log,
    err = console.error,
  } = io;

  const [subcommand, ...rest] = argv;
  if (subcommand !== "create" && subcommand !== "restore") {
    err(USAGE);
    return 2;
  }

  let values;
  let config;
  try {
    values = parseFlags(rest);
    const host = values.host ?? "claude";
    assertHost(host);
    if (subcommand === "create") {
      if (!values.name) throw new Error(`--name=<run> is required — ${USAGE}`);
      if (!values.base) throw new Error(`--base=<ref> is required — ${USAGE}`);
    } else {
      if (!values.path) throw new Error(`--path=<worktree> is required — ${USAGE}`);
      if (!values.branch) throw new Error(`--branch=<branch> is required — ${USAGE}`);
    }
    const configPath = values.config ?? resolveConfigPath(host).path;
    ({ config } = loadConfig(configPath, env, readFile, undefined, { host }));
  } catch (error) {
    err(error.message);
    return 2;
  }

  if (subcommand === "restore") {
    log(formatRestore(restoreWorktree({
      exec, cwd, path: values.path, branch: values.branch,
      provider: config.worktree_provider,
    })));
    return 0;
  }

  // loadConfig has already rejected anything that is not one of the two.
  if (config.worktree_provider === "git") {
    log(formatOutcome({ kind: "git" }));
    return 0;
  }

  log(formatOutcome(createWithOrca({
    exec, cwd, name: values.name, base: values.base, issue: values.issue,
  })));
  return 0;
}

// pathToFileURL rather than a `file://` template: the plugin's install path is
// user-controlled and a space in it would silently skip main().
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
