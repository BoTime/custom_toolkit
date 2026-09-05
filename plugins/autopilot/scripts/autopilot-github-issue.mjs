import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadConfig, validateGithubConfig } from "./autopilot-config.mjs";

/**
 * The six ledger lines the autopilot-github wrapper's hooks append, in
 * pipeline order.
 *
 * Exported so the wrapper's prose guard test and the ledger-coupling test share
 * one source of truth. Every line is `github: `-prefixed, which collides with
 * none of nextStage's ten resume prefixes (`pr:`, `rebase clean`,
 * `learnings committed`, `verify`, `sdd complete`, `plan complete`,
 * `spec committed`, `spec written`, `worktree:`, `design approved`) nor with
 * `PARKED`.
 *
 * `verify` is the near miss to keep in mind when adding a line here: the
 * `github: ` prefix is what keeps `github: verify screenshots posted` from
 * resuming a finished run at `learnings`.
 *
 * Move and comment get separate lines rather than one per hook, so a hook that
 * moved the card but failed to comment resumes into the comment alone instead
 * of redoing the move or skipping the comment.
 */
export const GITHUB_LEDGER_LINES = [
  "github: moved to in-progress",
  "github: start comment posted",
  "github: verify screenshots posted",
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
 * The ledger header line written to a fresh run.md: `ledgerTask` wrapped in
 * the `# autopilot run — task: ` prefix `autopilot-ledger.mjs`'s HEADER regex
 * expects, terminated by one trailing newline.
 */
export function ledgerHeaderLine(issue) {
  return `# autopilot run — task: ${ledgerTask(issue)}\n`;
}

/**
 * Create the run directory (if needed) and append the ledger header —
 * never a shell command built from the issue's title. This is the only path
 * an issue's untrusted title takes on its way into `run.md`, so it never
 * touches a shell string. `mkdir`/`appendFile` are injected so tests need no
 * real filesystem.
 */
export function writeLedgerHeader(
  runDir,
  issue,
  {
    mkdir = (d) => mkdirSync(d, { recursive: true }),
    appendFile = (p, s) => appendFileSync(p, s),
  } = {},
) {
  mkdir(runDir);
  appendFile(`${runDir}/run.md`, ledgerHeaderLine(issue));
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

function ghJson(result, what) {
  if (result.code !== 0) {
    throw new Error(`${what} failed: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${what} returned output that is not JSON: ${result.stdout.slice(0, 200)}`);
  }
}

/**
 * Match an entry from `gh issue view --json projectItems` to the configured
 * board, returning its item id.
 *
 * gh's projectItems payload has varied across versions, so this reads the
 * project under either `project` or `projectV2` and returns null for any shape
 * it does not recognize — resolveItemId then falls back to `item-list`, which
 * has a stable `content.number`. The owner is compared only when the payload
 * carries one: an item that names no owner is not evidence of a different one.
 */
export function matchProjectItem(projectItems, github) {
  for (const item of projectItems ?? []) {
    if (!item?.id) continue;
    const project = item.project ?? item.projectV2;
    if (!project) continue;
    if (Number(project.number) !== Number(github.project_number)) continue;
    const owner = project.owner?.login ?? project.owner;
    if (
      owner &&
      String(owner).toLowerCase() !== String(github.project_owner).toLowerCase()
    ) {
      continue;
    }
    return item.id;
  }
  return null;
}

/** Match an item from `gh project item-list --format json` by its issue number. */
export function matchItemList(itemListJson, issueNumber) {
  for (const item of itemListJson?.items ?? []) {
    if (Number(item?.content?.number) === Number(issueNumber)) return item.id;
  }
  return null;
}

/**
 * The issue's project item id. The issue-scoped call is one request, so it is
 * tried first; `item-list` is the fallback. An issue on no matching board is a
 * named error, never a silent no-op.
 */
export function resolveItemId(issueNumber, config, gh) {
  const github = config.github;

  const view = gh(["issue", "view", String(issueNumber), "--json", "projectItems"]);
  if (view.code === 0) {
    let parsed = null;
    try {
      parsed = JSON.parse(view.stdout);
    } catch {
      parsed = null;
    }
    const id = matchProjectItem(parsed?.projectItems, github);
    if (id) return id;
  }

  const list = ghJson(
    gh([
      "project", "item-list", String(github.project_number),
      "--owner", github.project_owner, "--format", "json",
    ]),
    `gh project item-list for ${github.project_owner}/${github.project_number}`,
  );
  const id = matchItemList(list, issueNumber);
  if (!id) {
    throw new Error(
      `issue #${issueNumber} is not an item on project ${github.project_owner}/${github.project_number} — ` +
        `add the issue to that board, or fix project_owner/project_number in .claude/autopilot.json`,
    );
  }
  return id;
}

/** `gh project item-edit` needs the project's node id, which item-list omits. */
export function resolveProjectId(config, gh) {
  const github = config.github;
  const project = ghJson(
    gh([
      "project", "view", String(github.project_number),
      "--owner", github.project_owner, "--format", "json",
    ]),
    `gh project view for ${github.project_owner}/${github.project_number}`,
  );
  if (!project.id) {
    throw new Error(
      `gh project view returned no project id for ${github.project_owner}/${github.project_number}`,
    );
  }
  return project.id;
}

/** The configured single-select field, or an error listing what the board has. */
export function findStatusField(fieldListJson, fieldName) {
  const fields = fieldListJson?.fields ?? [];
  const field = fields.find((f) => f?.name === fieldName);
  if (!field) {
    const names = fields.map((f) => f?.name).filter(Boolean).join(", ");
    throw new Error(
      `no field named "${fieldName}" on the project — fields present: ${names || "(none)"}`,
    );
  }
  if (!Array.isArray(field.options)) {
    throw new Error(`field "${fieldName}" is not a single-select field — it has no options`);
  }
  return field;
}

/** The named option, or an error listing the options the field actually has. */
export function findStatusOption(field, optionName) {
  const option = field.options.find((o) => o?.name === optionName);
  if (!option) {
    const names = field.options.map((o) => o?.name).filter(Boolean).join(", ");
    throw new Error(
      `no option named "${optionName}" on field "${field.name}" — options present: ${names || "(none)"}`,
    );
  }
  return option;
}

/** Set the issue's Projects v2 Status field to the named option. */
export function move(issueNumber, statusName, config, gh) {
  const github = config.github;
  const itemId = resolveItemId(issueNumber, config, gh);
  const projectId = resolveProjectId(config, gh);
  const fields = ghJson(
    gh([
      "project", "field-list", String(github.project_number),
      "--owner", github.project_owner, "--format", "json",
    ]),
    `gh project field-list for ${github.project_owner}/${github.project_number}`,
  );
  const field = findStatusField(fields, github.status_field);
  const option = findStatusOption(field, statusName);

  const edit = gh([
    "project", "item-edit",
    "--id", itemId,
    "--project-id", projectId,
    "--field-id", field.id,
    "--single-select-option-id", option.id,
  ]);
  if (edit.code !== 0) {
    throw new Error(
      `gh project item-edit failed for issue #${issueNumber} → "${statusName}": ` +
        `${edit.stderr.trim() || edit.stdout.trim()}`,
    );
  }
  return { itemId, projectId, fieldId: field.id, optionId: option.id, status: statusName };
}

/** Post an issue comment from inline text or a file. */
export function comment(
  issueNumber,
  { body, bodyFile },
  gh,
  readFile = (p) => readFileSync(p, "utf8"),
) {
  const text = bodyFile !== undefined ? readFile(bodyFile) : body;
  if (text === undefined || text === null || String(text).trim() === "") {
    throw new Error("comment needs a non-empty --body <text> or --body-file <path>");
  }
  const result = gh(["issue", "comment", String(issueNumber), "--body", String(text)]);
  if (result.code !== 0) {
    throw new Error(
      `gh issue comment failed for #${issueNumber}: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  return result.stdout.trim();
}

/**
 * The issue comment body for a screenshot manifest.
 *
 * One comment, one image per criterion, in manifest order. The status is
 * spelled out beside each image because the reader is looking at the picture,
 * not at the PR table it came from — and the prefix names the round the images
 * came from, which is the run's latest: the comment is posted once, and a fix
 * round rewrites the manifest it reads while leaving round 1's objects intact
 * at their own keys.
 *
 * The public-URL warning is repeated here rather than left to the skill: the
 * comment outlives the run, and whoever reads it later is exactly the person
 * who needs to know the link is not private.
 */
export function screenshotComment(manifest) {
  const mark = { pass: "✅", fail: "❌", missing: "⚠️" };
  const lines = [
    "## Browser verification screenshots",
    "",
    `One image per \`(ui)\` acceptance criterion, as the browser saw it (\`${manifest.prefix}\`).`,
    "",
  ];
  for (const item of manifest.items ?? []) {
    lines.push(`**${item.id}** — ${mark[item.status] ?? ""} ${item.status}`.trim(), "");
    lines.push(`![${item.id}](${item.url})`, "");
  }
  lines.push(
    "These images are hosted on an r2.dev public development URL: anyone with " +
      "the link can read them.",
  );
  return lines.join("\n");
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
  "usage: autopilot-github-issue.mjs <preflight|resolve|move|comment|screenshots> " +
  '[--issue <n>] [--write-ledger <base-dir>] [--to "<status>"] ' +
  "[--body <text>|--body-file <path>] [--manifest <path>]";

function ghRun(args) {
  const r = spawnSync("gh", args, { encoding: "utf8" });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function requireIssue(args) {
  if (!args.issue) throw new Error("--issue <number-or-url> is required");
  return args.issue;
}

export function main(
  argv = process.argv.slice(2),
  gh = ghRun,
  load = loadConfig,
  fsOps = {},
) {
  const [command] = argv;
  const args = parseArgs(argv.slice(1));
  const configPath = args.config ?? ".claude/autopilot.json";

  try {
    if (command === "preflight") {
      const { config } = load(configPath);
      const result = preflightGithub(config);
      if (result.ok) {
        // The wrapper's prose needs the *merged* status names to build its
        // `move --to` calls; the defaults in the skill's example JSON are wrong
        // whenever a project overrides one.
        const g = config.github;
        console.log(
          `${result.message} — status names: ready="${g.status_ready}", ` +
            `in_progress="${g.status_in_progress}", in_review="${g.status_in_review}"`,
        );
      } else {
        console.log(result.message);
      }
      process.exitCode = result.ok ? 0 : 1;
      return;
    }

    if (command === "resolve") {
      const resolved = resolveIssue(requireIssue(args), gh);
      // --write-ledger keeps the untrusted title out of any shell command: the
      // header goes to disk from here, never from prose-built `printf`.
      if (args["write-ledger"]) {
        writeLedgerHeader(`${args["write-ledger"]}/${resolved.run}`, resolved, fsOps);
      }
      console.log(JSON.stringify(resolved, null, 2));
      return;
    }

    if (command === "move") {
      const issue = requireIssue(args);
      if (!args.to) throw new Error('move needs --to "<status option>"');
      const { config } = load(configPath);
      const check = preflightGithub(config);
      if (!check.ok) throw new Error(check.message);
      const result = move(issue, args.to, config, gh);
      console.log(`moved issue #${issue} to ${result.status}`);
      return;
    }

    if (command === "comment") {
      const issue = requireIssue(args);
      const posted = comment(
        issue,
        { body: args.body, bodyFile: args["body-file"] },
        gh,
      );
      console.log(posted || `commented on issue #${issue}`);
      return;
    }

    if (command === "screenshots") {
      const issue = requireIssue(args);
      if (!args.manifest) throw new Error("screenshots needs --manifest <path>");
      const readFile = fsOps.readFile ?? ((p) => readFileSync(p, "utf8"));
      let manifest;
      try {
        manifest = JSON.parse(readFile(args.manifest));
      } catch {
        // Absent or malformed is the no-artifacts-configured case, and it must
        // stay a clean no-op with a zero exit: a non-zero here would make the
        // wrapper record a `github: <action> failed` line in a repository that
        // simply never asked for screenshots.
        console.log(`skipped — no screenshot manifest at ${args.manifest}`);
        return;
      }
      // The type check comes first for the same reason the catch above exists:
      // `JSON.parse` succeeds on `null` and on a bare number, and reading
      // `.items` off either throws into the outer catch and exits non-zero —
      // the one outcome an unconfigured repository must never reach.
      if (
        !manifest ||
        typeof manifest !== "object" ||
        !Array.isArray(manifest.items) ||
        manifest.items.length === 0
      ) {
        console.log(`skipped — screenshot manifest at ${args.manifest} has no items`);
        return;
      }
      comment(issue, { body: screenshotComment(manifest) }, gh);
      console.log(`posted ${manifest.items.length} screenshots to issue #${issue}`);
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
