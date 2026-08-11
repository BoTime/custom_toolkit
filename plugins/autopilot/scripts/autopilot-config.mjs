import { readFileSync } from "node:fs";

export const ROLES = [
  "brainstorm", "spec", "plan", "implement", "implement_complex",
  "task_review", "re_review", "final_review", "fix_escalation",
];

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

const TOP_LEVEL = ["worktree_dir", "base_ref", "reaper", "findings_threshold"];

/**
 * Merge a project config over the plugin defaults.
 *
 * Shallow per top-level key, except `roles`, which merges per role so a
 * project can override one role's model without restating all nine.
 */
export function mergeConfig(defaults, project) {
  if (!project || typeof project !== "object") return { ...defaults };

  const merged = { ...defaults, ...project };

  if (defaults.roles || project.roles) {
    merged.roles = { ...defaults.roles };
    for (const [role, entry] of Object.entries(project.roles ?? {})) {
      merged.roles[role] = { ...merged.roles[role], ...entry };
    }
  }

  return merged;
}

export function validateConfig(obj, env) {
  const errors = [];
  const warnings = [];

  if (!obj || typeof obj !== "object") {
    return { ok: false, errors: ["config is not an object"], warnings };
  }

  const roles = obj.roles;
  if (!roles || typeof roles !== "object") {
    errors.push("roles: missing");
  } else {
    for (const role of ROLES) {
      const entry = roles[role];
      if (!entry || typeof entry !== "object") {
        errors.push(`roles.${role}: missing`);
        continue;
      }
      if (!entry.model) errors.push(`roles.${role}: missing model`);
      if (!entry.effort) {
        errors.push(`roles.${role}: missing effort`);
      } else if (!EFFORTS.includes(entry.effort)) {
        errors.push(
          `roles.${role}: effort "${entry.effort}" is not one of ${EFFORTS.join(", ")}`,
        );
      }
    }
  }

  for (const key of TOP_LEVEL) {
    if (obj[key] === undefined) errors.push(`${key}: missing`);
  }

  // A threshold below 1 promotes every one-off finding into a candidate, which
  // is exactly the noise the threshold exists to filter.
  const threshold = obj.findings_threshold;
  if (
    threshold !== undefined &&
    (!Number.isInteger(threshold) || threshold < 1)
  ) {
    errors.push("findings_threshold: must be a positive integer");
  }

  // test_command is the one genuinely project-specific key, so it has no
  // default. Guessing `npm test` in a Python repo fails confusingly, and
  // silently skipping tests is worse: the post-rebase run is the only thing
  // that catches semantic conflicts. Unset is a warning here and a park at
  // the land stage, never a green report.
  if (!obj.test_command) {
    warnings.push(
      "test_command: not set — the land stage will park instead of reporting tests green. " +
        "Set it in your project's .claude/autopilot.json",
    );
  }

  const override = env.CLAUDE_CODE_EFFORT_LEVEL;
  if (override) {
    warnings.push(
      `CLAUDE_CODE_EFFORT_LEVEL=${override} overrides every configured effort level`,
    );
  }

  return { ok: errors.length === 0, errors, warnings };
}

function readJson(path, readFile) {
  let raw;
  try {
    raw = readFile(path);
  } catch {
    return undefined; // absent, not malformed
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }
}

/**
 * Load the effective config: plugin defaults with the project's config
 * layered over them.
 *
 * `defaultsPath` ships with the plugin and must exist. `path` is the
 * project's optional `.claude/autopilot.json`; absent means defaults alone,
 * malformed is an error rather than a silent fallback.
 */
export function loadConfig(
  path,
  env = process.env,
  readFile = (p) => readFileSync(p, "utf8"),
  defaultsPath = new URL("../autopilot.default.json", import.meta.url).pathname,
) {
  const defaults = readJson(defaultsPath, readFile);
  if (defaults === undefined) {
    throw new Error(`${defaultsPath} is missing — the plugin install is incomplete`);
  }

  const project = readJson(path, readFile);
  const merged = mergeConfig(defaults, project);

  const { ok, errors, warnings } = validateConfig(merged, env);
  if (!ok) {
    const source = project === undefined ? defaultsPath : `${path} (merged over defaults)`;
    throw new Error(`${source} is invalid:\n  ${errors.join("\n  ")}`);
  }
  return { config: merged, warnings, usedProjectConfig: project !== undefined };
}
