// The one thing that builds a subagent definition.
//
// SKILL.md used to hand the orchestrator a heredoc recipe and ask it to
// assemble each stage's prompt itself. Assembling a prompt means holding it,
// and in practice means reading the files around it "just to check" — the
// behaviour that put a median 165k of context and 5MB of resident tool output
// into a run. This script moves the assembly into a node process: the
// orchestrator runs it, gets one path back, and dispatches by that path.
//
// Every failure below exits non-zero and writes nothing. Defaulting is never
// the fallback: a stage dispatched at the wrong model, or missing a contract,
// produces plausible work that skipped the process — the most expensive
// failure this pipeline has, because it reports success.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "./autopilot-config.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where the verbatim prompt fragments and body templates live. */
export const DISPATCH_DIR = join(
  HERE, "..", "skills", "autopilot", "references", "dispatch",
);

/**
 * The six roles the `sdd` dispatch's rendered table names, in the order SKILL.md
 * has always rendered them. SDD picks models by its own judgment and cannot
 * accept an externally supplied map, so the table is how the values reach it.
 */
export const ROLE_TABLE_ROLES = [
  "implement", "implement_complex", "task_review", "re_review",
  "fix_escalation", "final_review",
];

const laddered = (config) => ["lite", "full"].includes(config?.minimalism?.mode);
const fullLadder = (config) => config?.minimalism?.mode === "full";

/**
 * Stage -> role, body template, and the fragments it carries.
 *
 * Keyed by STAGE, not by role, which deviates from issue #25's text
 * deliberately: four stages dispatch the `implement` role, and a role-keyed
 * path would have all four overwrite each other's definitions mid-run. The
 * frontmatter `name` stays role-keyed — see composeFrontmatter.
 *
 * The recipe is JavaScript rather than config or template frontmatter because
 * the conditionals are not one uniform shape (two-value mode gates, a rendered
 * table that is not a file at all, a worktree existence check), and because a
 * project must not be able to silently drop the findings-capture or
 * verification contract from a dispatch and still report success. The
 * contracts a stage carries are not a project's choice.
 *
 * `fragments` returns entries in dispatch order. A string names a file under
 * DISPATCH_DIR; an object with a `text` key is rendered inline.
 */
export const STAGES = {
  spec: {
    role: "spec",
    body: "spec-body.md",
    fragments: () => ["spec-criteria.md"],
  },
  plan: {
    role: "plan",
    body: "plan-body.md",
    fragments: ({ config, worktreeHas }) => [
      "plan-budget.md",
      ...(laddered(config) ? ["plan-minimalism-lite.md"] : []),
      ...(fullLadder(config) ? ["plan-minimalism-full.md"] : []),
      ...(worktreeHas("docs/autopilot/learnings.md") ? ["plan-learnings.md"] : []),
    ],
  },
  sdd: {
    role: "implement",
    body: "sdd-body.md",
    fragments: ({ config }) => [
      "sdd-model-map.md",
      { text: roleTable(config) },
      "sdd-verification.md",
      "sdd-findings.md",
      ...(laddered(config) ? ["sdd-minimalism-lite.md"] : []),
      ...(fullLadder(config) ? ["sdd-minimalism-full.md"] : []),
    ],
  },
  verify: {
    role: "verify",
    body: "verify-body.md",
    fragments: () => ["verify-browser.md"],
  },
  "verify-fix": {
    role: "implement",
    body: "verify-fix-body.md",
    fragments: () => [],
  },
  learnings: {
    role: "learnings",
    body: "learnings-body.md",
    fragments: () => ["learnings.md"],
  },
  "land-conflict": {
    role: "implement",
    body: "land-conflict-body.md",
    fragments: () => [],
  },
  pr: {
    role: "implement",
    body: "pr-body.md",
    fragments: () => [],
  },
};

/** Flags that never fill a placeholder. */
const RESERVED = new Set(["run", "config", "worktree"]);

const flagFor = (placeholder) => `--${placeholder.replace(/_/g, "-")}`;

/**
 * The role's merged config entry, or an error naming what is absent.
 *
 * Deliberately redundant with validateConfig, which already errors on a role
 * missing from ROLES. The guarantee has to be this script's own: a future edit
 * to ROLES must not be able to turn "role missing" into "role defaulted"
 * without failing a test.
 */
function requireRole(config, role) {
  const entry = config?.roles?.[role];
  if (!entry || typeof entry !== "object") {
    throw new Error(`roles.${role}: missing from the merged config — a dispatch cannot default its model`);
  }
  if (!entry.model) throw new Error(`roles.${role}: missing model`);
  if (!entry.effort) throw new Error(`roles.${role}: missing effort`);
  return entry;
}

/** The markdown table of the six roles' actual model and effort values. */
export function roleTable(config) {
  const rows = ROLE_TABLE_ROLES.map((role) => {
    const entry = requireRole(config, role);
    return `| \`${role}\` | ${entry.model} | ${entry.effort} |`;
  });
  return [
    "Values for this run:",
    "",
    "| Role | model | effort |",
    "|---|---|---|",
    ...rows,
  ].join("\n");
}

/** Every distinct `{{placeholder}}` in a template, in order of first appearance. */
export function placeholdersIn(template) {
  const found = [];
  for (const m of template.matchAll(/\{\{([a-z0-9_]+)\}\}/g)) {
    if (!found.includes(m[1])) found.push(m[1]);
  }
  return found;
}

/**
 * Interpolate `{{placeholder}}` markers, single-pass.
 *
 * A substituted value is inserted verbatim and never rescanned, so a design
 * document containing the literal text `{{run}}` reaches the agent unchanged
 * rather than being expanded. An unfilled placeholder is left in place;
 * `compose` reports it before this is ever called on a real dispatch.
 */
export function render(template, values) {
  return template.replace(/\{\{([a-z0-9_]+)\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match,
  );
}

/** Read a fragment or body template, naming both paths when it cannot be read. */
export function readFragment(rel) {
  const path = join(DISPATCH_DIR, rel);
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(
      `references/dispatch/${rel} cannot be read at ${path} — ` +
        `a dispatch that ships without its contract reports success on work that skipped the process`,
    );
  }
}

/** `.superpowers/autopilot/<run>/agents/<stage>.md` — keyed by stage. */
export const outputPath = (run, stage) =>
  `.superpowers/autopilot/${run}/agents/${stage}.md`;

/**
 * Build a stage's subagent definition. Pure: no writes, no process.exit.
 *
 * Order is frontmatter, then the rendered body, then each fragment in the
 * stage's declared order, separated by a blank line. Order is part of the
 * contract: `sdd-minimalism-lite.md` before `sdd-minimalism-full.md` is a
 * ladder, not a set.
 */
export function compose({
  stage,
  config,
  values,
  fragmentReader = readFragment,
  worktreeHas = () => false,
}) {
  const entry = STAGES[stage];
  if (!entry) {
    throw new Error(
      `unknown stage "${stage}" — known stages: ${Object.keys(STAGES).join(", ")}`,
    );
  }

  const role = requireRole(config, entry.role);
  const template = fragmentReader(entry.body);
  const placeholders = placeholdersIn(template);

  // An unfilled placeholder is an error, not an empty string: an empty
  // {{spec_path}} produces an agent told to write its spec to nowhere, which it
  // resolves by inventing a path — and the run continues, wrong, to completion.
  const missing = placeholders.filter(
    (p) => !Object.prototype.hasOwnProperty.call(values, p),
  );
  if (missing.length > 0) {
    throw new Error(
      `stage "${stage}": no value for ${missing.map((p) => `{{${p}}}`).join(", ")} — ` +
        `pass ${missing.map(flagFor).join(", ")}`,
    );
  }

  // And an unconsumed flag on the same grounds: a typo'd flag means the value
  // the orchestrator meant to pass never reached the agent.
  const unconsumed = Object.keys(values).filter(
    (k) => !placeholders.includes(k) && !RESERVED.has(k),
  );
  if (unconsumed.length > 0) {
    throw new Error(
      `stage "${stage}": ${unconsumed.map(flagFor).join(", ")} fills no placeholder in ` +
        `references/dispatch/${entry.body} — the value would never reach the agent`,
    );
  }

  const frontmatter = [
    "---",
    `name: autopilot-${entry.role}`,
    `description: ${stage} stage of an autopilot run`,
    `model: ${role.model}`,
    `effort: ${role.effort}`,
    "---",
  ].join("\n");

  const parts = [frontmatter, render(template, values)];
  for (const fragment of entry.fragments({ config, worktreeHas })) {
    parts.push(typeof fragment === "string" ? fragmentReader(fragment) : fragment.text);
  }
  return `${parts.map((p) => p.replace(/\s+$/, "")).join("\n\n")}\n`;
}

/**
 * Parse `--key=value` flags. `--key=@path` reads the value from a file, because
 * multi-line values do not survive as shell flag values and the github
 * wrapper's untrusted-input rule forbids printf-ing issue text into a command
 * at all. `--key=@@literal` escapes a value that genuinely starts with `@`.
 */
export function parseFlags(argv, readFile) {
  const values = {};
  for (const arg of argv) {
    const m = /^--([a-z0-9-]+)=([\s\S]*)$/.exec(arg);
    if (!m) throw new Error(`unrecognized argument "${arg}" — flags are --key=value`);
    const key = m[1].replace(/-/g, "_");
    let value = m[2];
    if (value.startsWith("@@")) {
      value = value.slice(1);
    } else if (value.startsWith("@")) {
      const path = value.slice(1);
      try {
        value = readFile(path).replace(/\n+$/, "");
      } catch {
        throw new Error(`--${m[1]}=@${path}: cannot read ${path}`);
      }
    }
    values[key] = value;
  }
  return values;
}

export function main(argv = process.argv.slice(2), io = {}) {
  const {
    readFile = (p) => readFileSync(p, "utf8"),
    readFragment: fragmentReader = readFragment,
    exists = existsSync,
    writeOut = (p, text) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, text);
    },
    log = console.log,
    err = console.error,
    env = process.env,
  } = io;

  const [stage, ...rest] = argv;
  if (!stage || stage.startsWith("--")) {
    err("usage: autopilot-dispatch.mjs <stage> --run=<run> [--key=value ...]");
    return 1;
  }

  try {
    const values = parseFlags(rest, readFile);
    if (!values.run) throw new Error("--run=<run> is required — it names the run directory");

    const configPath = values.config ?? ".claude/autopilot.json";
    const { config, warnings } = loadConfig(configPath, env, readFile);
    for (const warning of warnings) err(`warning: ${warning}`);

    const worktree = values.worktree;
    const worktreeHas = (rel) => Boolean(worktree) && exists(join(worktree, rel));

    const text = compose({ stage, config, values, fragmentReader, worktreeHas });
    const path = outputPath(values.run, stage);
    writeOut(path, text);
    log(path);
    return 0;
  } catch (error) {
    err(error.message);
    return 1;
  }
}

// pathToFileURL rather than a `file://` template: the plugin's install path is
// user-controlled and a space in it would silently skip main().
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
