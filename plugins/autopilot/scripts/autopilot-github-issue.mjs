import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadConfig, validateGithubConfig } from "./autopilot-config.mjs";

/**
 * The five ledger lines the autopilot-github wrapper's hooks append, in
 * pipeline order.
 *
 * Exported so the wrapper's prose guard test and the ledger-coupling test share
 * one source of truth. Every line is `github: `-prefixed, which collides with
 * none of nextStage's seven resume prefixes (`pr:`, `rebase clean`,
 * `sdd complete`, `plan complete`, `spec committed`, `worktree:`,
 * `design approved`) nor with `PARKED`.
 *
 * Move and comment get separate lines rather than one per hook, so a hook that
 * moved the card but failed to comment resumes into the comment alone instead
 * of redoing the move or skipping the comment.
 */
export const GITHUB_LEDGER_LINES = [
  "github: moved to in-progress",
  "github: start comment posted",
  "github: moved to in-review",
  "github: pr comment posted",
  "github: parked comment posted",
];

/**
 * The run-name slug, derived in code rather than prose.
 *
 * The slug is the ledger directory's key: prose rules re-applied by a different
 * session on resume can produce a different string and orphan the run.
 *
 * Lowercase, every run of non-`[a-z0-9]` becomes a single `-`, ends stripped,
 * truncated to 40 characters, then a trailing `-` the cut left behind stripped
 * again. Empty is a legitimate result (a title that is entirely punctuation or
 * non-ASCII); runName below handles it.
 */
export function slugify(title) {
  return String(title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/** `issue-<n>-<slug>`, or just `issue-<n>` when the slug normalizes to empty. */
export function runName(number, title) {
  const slug = slugify(title);
  return slug === "" ? `issue-${number}` : `issue-${number}-${slug}`;
}

/**
 * The ledger header's task text: `GitHub issue #<n>: <title>`.
 *
 * autopilot-ledger.mjs's HEADER regex is single-line, so the title's whitespace
 * is collapsed here. Writing a multi-line header into run.md would strand the
 * remainder as untimestamped lines that parseLedger silently drops.
 */
export function ledgerTask({ number, title }) {
  return `GitHub issue #${number}: ${String(title ?? "").replace(/\s+/g, " ").trim()}`;
}

/**
 * The task description handed to autopilot:autopilot-brainstorm — the same
 * shape autopilot already expects, so Phase 1 itself needs no changes.
 */
export function taskDescription(issue) {
  const header = ledgerTask(issue);
  const body = String(issue.body ?? "").trim();
  return body === "" ? header : `${header}\n\n${body}`;
}

/** `gh issue view <n> --json number,title,body,url`, plus the derived fields. */
export function resolveIssue(issueArg, gh) {
  const result = gh(["issue", "view", String(issueArg), "--json", "number,title,body,url"]);
  if (result.code !== 0) {
    throw new Error(
      `gh issue view ${issueArg} failed: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  const issue = JSON.parse(result.stdout);
  return {
    number: issue.number,
    title: issue.title,
    url: issue.url,
    run: runName(issue.number, issue.title),
    task: taskDescription(issue),
  };
}

/** The hard preflight gate: every `github` key present, or exactly which are not. */
export function preflightGithub(config) {
  const missing = validateGithubConfig(config);
  return missing.length === 0
    ? { ok: true, missing, message: "ok" }
    : {
        ok: false,
        missing,
        message:
          `github config is incomplete — missing: ${missing.join(", ")}. ` +
          `Add them under "github" in .claude/autopilot.json.`,
      };
}

/** Minimal `--flag value` / `--flag=value` parsing; positionals land in `_`. */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq !== -1) out[arg.slice(2, eq)] = arg.slice(eq + 1);
    else out[arg.slice(2)] = argv[++i];
  }
  return out;
}

const USAGE =
  "usage: autopilot-github-issue.mjs <preflight|resolve|move|comment> " +
  '[--issue <n>] [--to "<status>"] [--body <text>|--body-file <path>]';

function ghRun(args) {
  const r = spawnSync("gh", args, { encoding: "utf8" });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function requireIssue(args) {
  if (!args.issue) throw new Error("--issue <number-or-url> is required");
  return args.issue;
}

export function main(argv = process.argv.slice(2), gh = ghRun, load = loadConfig) {
  const [command] = argv;
  const args = parseArgs(argv.slice(1));
  const configPath = args.config ?? ".claude/autopilot.json";

  try {
    if (command === "preflight") {
      const result = preflightGithub(load(configPath).config);
      console.log(result.message);
      process.exitCode = result.ok ? 0 : 1;
      return;
    }

    if (command === "resolve") {
      console.log(JSON.stringify(resolveIssue(requireIssue(args), gh), null, 2));
      return;
    }

    console.error(USAGE);
    process.exitCode = 1;
  } catch (err) {
    // A failure here is never a silent success: the message reaches stderr and
    // the exit code is non-zero, so the wrapper can record it and move on.
    console.error(err.message);
    process.exitCode = 1;
  }
}

// pathToFileURL rather than a `file://` template: the plugin's install path is
// user-controlled and a space in it would silently skip main().
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
