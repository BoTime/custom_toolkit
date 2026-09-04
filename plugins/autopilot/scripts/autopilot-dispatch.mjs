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
import { TIERS, loadConfig } from "./autopilot-config.mjs";
import { assertHost, hostConfigPath } from "./autopilot-host.mjs";

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
 * DISPATCH_DIR, inserted verbatim and never rendered; an object with a `text`
 * key is already-rendered inline text; an object with a `file` key names a file
 * under DISPATCH_DIR that is rendered, so its placeholders count towards what
 * the dispatch requires and consumes.
 */
export const STAGES = {
  spec: {
    role: "spec",
    body: "spec-body.md",
    fragments: ({ values }) => {
      const tier = values?.tier === undefined ? undefined : assertTier(values.tier);
      return [
        { file: tier === "small" ? "spec-small.md" : "spec-commit.md" },
        "spec-criteria.md",
      ];
    },
  },
  plan: {
    role: "plan",
    body: "plan-body.md",
    fragments: ({ config, worktreeHas, values, fragmentReader }) => [
      values?.tier === undefined
        ? "plan-budget.md"
        : { text: tierBudget({ config, tier: values.tier, fragmentReader }) },
      ...(laddered(config) ? ["plan-minimalism-lite.md"] : []),
      ...(fullLadder(config) ? ["plan-minimalism-full.md"] : []),
      ...(worktreeHas("docs/autopilot/learnings.md") ? ["plan-learnings.md"] : []),
    ],
  },
  sdd: {
    role: "implement",
    body: "sdd-body.md",
    fragments: ({ config, values }) => [
      "sdd-model-map.md",
      { text: roleTable(config) },
      "sdd-verification.md",
      "sdd-findings.md",
      ...(isSingleTask(values?.tasks) ? ["sdd-review-single.md"] : []),
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
    fragments: ({ values }) => {
      const tier = values?.tier === undefined ? undefined : assertTier(values.tier);
      return tier === "small" ? [{ file: "pr-small.md" }] : [];
    },
  },
};

/** Flags that never fill a placeholder. */
export const RESERVED = new Set(["run", "config", "host", "worktree", "tier", "tasks"]);

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

/** The tier one step up the ladder, or undefined for the top tier. */
const nextTier = (tier) => TIERS[TIERS.indexOf(tier) + 1];

/** The tier a `--tier` flag names, or an error naming all three accepted values. */
export function assertTier(tier) {
  if (!TIERS.includes(tier)) {
    throw new Error(
      `--tier=${tier} is not one of ${TIERS.join(", ")} — ` +
        `a silent fallback would produce a run whose ceremony nobody chose`,
    );
  }
  return tier;
}

/**
 * The tier's task-count budget, with the configured ceiling rendered in.
 *
 * This is inline text rather than a plain fragment name because `compose`
 * reads a string fragment verbatim and never renders it — a `{{ceiling}}`
 * written into a file selected by name would ship to the agent literally.
 */
export function tierBudget({ config, tier, fragmentReader }) {
  assertTier(tier);
  const ceilingFor = (name) => {
    const ceiling = config?.tiers?.[name];
    if (!Number.isInteger(ceiling) || ceiling < 1) {
      const problem =
        ceiling === undefined
          ? "missing from"
          : `${JSON.stringify(ceiling)} is not a positive integer in`;
      throw new Error(
        `tiers.${name}: ${problem} the merged config — a tier budget cannot default its ceiling`,
      );
    }
    return String(ceiling);
  };

  const values = { ceiling: ceilingFor(tier) };
  const next = nextTier(tier);
  if (next) {
    values.next_tier = next;
    values.next_ceiling = ceilingFor(next);
  }
  return render(fragmentReader(`plan-budget-${tier}.md`), values);
}

/**
 * True when the plan wrote exactly one task. A malformed count throws rather
 * than resolving to "not one": absence is the documented untiered path, but a
 * typo is not absence.
 */
function isSingleTask(tasks) {
  if (tasks === undefined) return false;
  if (!/^\d+$/.test(tasks) || Number(tasks) < 1) {
    throw new Error(`--tasks=${tasks} is not a positive integer`);
  }
  return Number(tasks) === 1;
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

/** `.superpowers/autopilot/<run>/agents/<stage>.json` — keyed by stage. */
export const codexOutputPath = (run, stage) =>
  `.superpowers/autopilot/${run}/agents/${stage}.json`;

function composeInstructions({
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

  // Fragments are resolved before the checks below, because a `{file}`
  // fragment's placeholders are part of what this dispatch requires and
  // consumes. `pr-small.md` is the case that forces it: `--spec-path` reaches
  // the `pr` agent through a fragment and through nothing else, so the body
  // alone cannot say whether the flag is required or a typo.
  const fragments = entry.fragments({ config, worktreeHas, values, fragmentReader });
  const rendered = fragments.map((fragment) => {
    if (typeof fragment === "string") return { text: fragmentReader(fragment) };
    if (fragment.file) {
      const source = fragmentReader(fragment.file);
      return { text: render(source, values), placeholders: placeholdersIn(source) };
    }
    return { text: fragment.text };
  });

  const placeholders = [...placeholdersIn(template)];
  for (const part of rendered) {
    for (const p of part.placeholders ?? []) {
      if (!placeholders.includes(p)) placeholders.push(p);
    }
  }

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

  const parts = [render(template, values), ...rendered.map((r) => r.text)];
  const instructions = `${parts.map((p) => p.replace(/\s+$/, "")).join("\n\n")}\n`;
  return { entry, role, instructions };
}

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
  const { entry, role, instructions } = composeInstructions({
    stage, config, values, fragmentReader, worktreeHas,
  });

  const frontmatter = [
    "---",
    `name: autopilot-${entry.role}`,
    `description: ${stage} stage of an autopilot run`,
    `model: ${role.model}`,
    `effort: ${role.effort}`,
    "---",
  ].join("\n");

  return `${frontmatter}\n\n${instructions}`;
}

/** Build the structured stage record consumed by Codex dispatch. Pure. */
export function composeCodexDispatch({
  stage,
  config,
  values,
  fragmentReader = readFragment,
  worktreeHas = () => false,
}) {
  const { entry, role, instructions } = composeInstructions({
    stage, config, values, fragmentReader, worktreeHas,
  });
  return {
    role: entry.role,
    model: role.model,
    reasoning_effort: role.effort,
    instructions,
  };
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

    const host = values.host ?? "claude";
    assertHost(host);

    const configPath = values.config ?? hostConfigPath(host);
    const { config, warnings } = loadConfig(
      configPath, env, readFile, undefined, { host },
    );
    for (const warning of warnings) err(`warning: ${warning}`);

    const worktree = values.worktree;
    const worktreeHas = (rel) => Boolean(worktree) && exists(join(worktree, rel));

    const codex = host === "codex";
    const text = codex
      ? `${JSON.stringify(composeCodexDispatch({
        stage, config, values, fragmentReader, worktreeHas,
      }), null, 2)}\n`
      : compose({ stage, config, values, fragmentReader, worktreeHas });
    const path = codex
      ? codexOutputPath(values.run, stage)
      : outputPath(values.run, stage);
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
