import { describe, it, expect } from "vitest";
import {
  ROLES, EFFORTS, GITHUB_KEYS,
  validateConfig, validateGithubConfig, mergeConfig, loadConfig,
} from "./autopilot-config.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const validConfig = () => ({
  roles: {
    brainstorm: { model: "opus", effort: "high" },
    spec: { model: "opus", effort: "high" },
    plan: { model: "opus", effort: "xhigh" },
    learnings: { model: "opus", effort: "high" },
    verify: { model: "sonnet", effort: "high" },
    implement: { model: "sonnet", effort: "medium" },
    implement_complex: { model: "opus", effort: "high" },
    task_review: { model: "opus", effort: "high" },
    re_review: { model: "sonnet", effort: "medium" },
    final_review: { model: "opus", effort: "xhigh" },
    fix_escalation: { model: "opus", effort: "xhigh" },
  },
  worktree_dir: ".claude/worktrees",
  base_ref: "origin/main",
  test_command: "npm test",
  reaper: true,
  findings_threshold: 2,
});

describe("ROLES and EFFORTS", () => {
  it("lists exactly the eleven roles", () => {
    expect(ROLES).toEqual([
      "brainstorm", "spec", "plan", "learnings", "verify", "implement",
      "implement_complex", "task_review", "re_review", "final_review",
      "fix_escalation",
    ]);
  });

  it("lists exactly the five effort levels", () => {
    expect(EFFORTS).toEqual(["low", "medium", "high", "xhigh", "max"]);
  });
});

describe("validateConfig", () => {
  it("accepts a complete config", () => {
    const result = validateConfig(validConfig(), {});
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a missing role", () => {
    const cfg = validConfig();
    delete cfg.roles.final_review;
    const result = validateConfig(cfg, {});
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("roles.final_review: missing");
  });

  it("rejects a missing learnings role", () => {
    const cfg = validConfig();
    delete cfg.roles.learnings;
    const result = validateConfig(cfg, {});
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("roles.learnings: missing");
  });

  it("rejects a role missing its model", () => {
    const cfg = validConfig();
    delete cfg.roles.plan.model;
    const result = validateConfig(cfg, {});
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("roles.plan: missing model");
  });

  it("rejects a role missing its effort", () => {
    const cfg = validConfig();
    delete cfg.roles.plan.effort;
    const result = validateConfig(cfg, {});
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("roles.plan: missing effort");
  });

  it("rejects an effort level outside the allowed set", () => {
    const cfg = validConfig();
    cfg.roles.plan.effort = "ultra";
    const result = validateConfig(cfg, {});
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      'roles.plan: effort "ultra" is not one of low, medium, high, xhigh, max',
    );
  });

  it("rejects a missing top-level key", () => {
    const cfg = validConfig();
    delete cfg.base_ref;
    const result = validateConfig(cfg, {});
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("base_ref: missing");
  });

  it("warns rather than errors when test_command is absent", () => {
    const cfg = validConfig();
    delete cfg.test_command;
    const result = validateConfig(cfg, {});
    expect(result.ok).toBe(true);
    expect(result.warnings.join("\n")).toMatch(/test_command: not set/);
    expect(result.warnings.join("\n")).toMatch(/park/);
  });

  it("does not warn about test_command when it is set", () => {
    const result = validateConfig(validConfig(), {});
    expect(result.warnings.join("\n")).not.toMatch(/test_command/);
  });

  it("warns when CLAUDE_CODE_EFFORT_LEVEL is set", () => {
    const result = validateConfig(validConfig(), { CLAUDE_CODE_EFFORT_LEVEL: "low" });
    expect(result.ok).toBe(true);
    expect(result.warnings).toContain(
      'CLAUDE_CODE_EFFORT_LEVEL=low overrides every configured effort level',
    );
  });

  it("does not warn when CLAUDE_CODE_EFFORT_LEVEL is absent", () => {
    const result = validateConfig(validConfig(), {});
    expect(result.warnings).toEqual([]);
  });

  it("rejects a missing findings_threshold", () => {
    const cfg = validConfig();
    delete cfg.findings_threshold;
    const result = validateConfig(cfg, {});
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("findings_threshold: missing");
  });

  it("rejects a non-integer findings_threshold", () => {
    const cfg = validConfig();
    cfg.findings_threshold = 2.5;
    const result = validateConfig(cfg, {});
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "findings_threshold: must be a positive integer",
    );
  });

  it("rejects a findings_threshold below 1", () => {
    // A threshold of 0 would promote every one-off finding into a candidate,
    // which is the noise the threshold exists to filter.
    const cfg = validConfig();
    cfg.findings_threshold = 0;
    const result = validateConfig(cfg, {});
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "findings_threshold: must be a positive integer",
    );
  });

  it("accepts a findings_threshold of 1", () => {
    const cfg = validConfig();
    cfg.findings_threshold = 1;
    expect(validateConfig(cfg, {}).ok).toBe(true);
  });
});

describe("mergeConfig", () => {
  it("returns the defaults when there is no project config", () => {
    const merged = mergeConfig(validConfig(), undefined);
    expect(merged).toEqual(validConfig());
  });

  it("overrides a scalar key", () => {
    const merged = mergeConfig(validConfig(), { base_ref: "origin/develop" });
    expect(merged.base_ref).toBe("origin/develop");
    expect(merged.worktree_dir).toBe(".claude/worktrees");
  });

  it("overrides one role and preserves the other ten", () => {
    const merged = mergeConfig(validConfig(), {
      roles: { implement: { model: "opus" } },
    });
    expect(merged.roles.implement.model).toBe("opus");
    // effort survives a partial role override
    expect(merged.roles.implement.effort).toBe("medium");
    expect(merged.roles.plan).toEqual({ model: "opus", effort: "xhigh" });
    expect(Object.keys(merged.roles)).toHaveLength(11);
  });

  it("does not mutate the defaults", () => {
    const defaults = validConfig();
    mergeConfig(defaults, { roles: { implement: { model: "opus" } } });
    expect(defaults.roles.implement.model).toBe("sonnet");
  });

  it("adds a key the defaults omit", () => {
    const defaults = validConfig();
    delete defaults.test_command;
    const merged = mergeConfig(defaults, { test_command: "uv run pytest" });
    expect(merged.test_command).toBe("uv run pytest");
  });

  it("lets a project override findings_threshold", () => {
    const merged = mergeConfig(validConfig(), { findings_threshold: 5 });
    expect(merged.findings_threshold).toBe(5);
  });
});

describe("loadConfig", () => {
  // Routes reads by path so defaults and project config can differ.
  const reader = (files) => (p) => {
    if (!(p in files)) throw new Error("ENOENT");
    return files[p];
  };

  const DEFAULTS = "/plugin/autopilot.default.json";
  const PROJECT = "/proj/.claude/autopilot.json";

  it("returns the defaults when the project has no config", () => {
    const readFile = reader({ [DEFAULTS]: JSON.stringify(validConfig()) });
    const { config, usedProjectConfig } = loadConfig(PROJECT, {}, readFile, DEFAULTS);
    expect(config.roles.implement.model).toBe("sonnet");
    expect(usedProjectConfig).toBe(false);
  });

  it("layers the project config over the defaults", () => {
    const readFile = reader({
      [DEFAULTS]: JSON.stringify(validConfig()),
      [PROJECT]: JSON.stringify({ test_command: "uv run pytest" }),
    });
    const { config, usedProjectConfig } = loadConfig(PROJECT, {}, readFile, DEFAULTS);
    expect(config.test_command).toBe("uv run pytest");
    expect(config.roles.implement.model).toBe("sonnet");
    expect(usedProjectConfig).toBe(true);
  });

  it("warns when no layer supplies test_command", () => {
    const defaults = validConfig();
    delete defaults.test_command;
    const readFile = reader({ [DEFAULTS]: JSON.stringify(defaults) });
    const { warnings } = loadConfig(PROJECT, {}, readFile, DEFAULTS);
    expect(warnings.join("\n")).toMatch(/test_command: not set/);
  });

  it("throws when the plugin defaults are missing", () => {
    const readFile = reader({});
    expect(() => loadConfig(PROJECT, {}, readFile, DEFAULTS)).toThrow(
      /install is incomplete/,
    );
  });

  it("throws with all errors joined when the merged config is invalid", () => {
    const defaults = validConfig();
    delete defaults.roles.plan;
    delete defaults.base_ref;
    const readFile = reader({ [DEFAULTS]: JSON.stringify(defaults) });
    expect(() => loadConfig(PROJECT, {}, readFile, DEFAULTS)).toThrow(
      /roles\.plan: missing/,
    );
  });

  it("throws a clear error when the project config is not valid JSON", () => {
    const readFile = reader({
      [DEFAULTS]: JSON.stringify(validConfig()),
      [PROJECT]: "{ not json",
    });
    expect(() => loadConfig(PROJECT, {}, readFile, DEFAULTS)).toThrow(
      /autopilot\.json is not valid JSON/,
    );
  });

  it("ships a findings_threshold default when the project sets none", () => {
    const readFile = reader({ [DEFAULTS]: JSON.stringify(validConfig()) });
    const { config } = loadConfig(PROJECT, {}, readFile, DEFAULTS);
    expect(config.findings_threshold).toBe(2);
  });
});

// The `github` block powers the autopilot-github wrapper only. Two properties
// have to hold at once: a project that supplies just the two irreducibly
// project-specific keys must keep the four default status names (otherwise the
// shallow top-level merge silently drops them), and a project with no `github`
// block at all must keep loading exactly as before — plain /autopilot has no
// board and must not start erroring.

const validGithub = () => ({
  project_owner: "BoTime",
  project_number: 7,
  status_field: "Status",
  status_ready: "Ready",
  status_in_progress: "In Progress",
  status_in_review: "In Review",
});

describe("validateGithubConfig", () => {
  it("returns an empty list for a complete github block", () => {
    expect(validateGithubConfig({ github: validGithub() })).toEqual([]);
  });

  it("names every key when the block is absent entirely", () => {
    expect(validateGithubConfig({})).toEqual(GITHUB_KEYS);
  });

  it("names every key when the block is not an object", () => {
    expect(validateGithubConfig({ github: "yes" })).toEqual(GITHUB_KEYS);
  });

  it("names only the keys that are actually missing", () => {
    const github = validGithub();
    delete github.project_owner;
    delete github.status_in_review;
    expect(validateGithubConfig({ github })).toEqual([
      "project_owner",
      "status_in_review",
    ]);
  });

  it("treats an empty string as missing", () => {
    // A key present but blank fails at gh-call time with a confusing message.
    // Catching it in preflight is the whole point of the check.
    expect(validateGithubConfig({ github: { ...validGithub(), status_ready: "" } }))
      .toEqual(["status_ready"]);
  });

  it("does not throw on a null config", () => {
    expect(validateGithubConfig(null)).toEqual(GITHUB_KEYS);
  });
});

describe("mergeConfig with github", () => {
  it("merges github per key so a project supplying only the two project keys keeps the status names", () => {
    const defaults = {
      ...validConfig(),
      github: {
        status_field: "Status",
        status_ready: "Ready",
        status_in_progress: "In Progress",
        status_in_review: "In Review",
      },
    };
    const merged = mergeConfig(defaults, {
      github: { project_owner: "BoTime", project_number: 7 },
    });
    expect(merged.github).toEqual(validGithub());
  });

  it("lets a project override one status name and keep the rest", () => {
    const defaults = { ...validConfig(), github: validGithub() };
    const merged = mergeConfig(defaults, { github: { status_in_review: "Review" } });
    expect(merged.github.status_in_review).toBe("Review");
    expect(merged.github.status_ready).toBe("Ready");
    expect(merged.github.project_owner).toBe("BoTime");
  });

  it("leaves github absent when neither layer supplies one", () => {
    const merged = mergeConfig(validConfig(), { test_command: "npm test" });
    expect(merged.github).toBeUndefined();
  });

  it("does not mutate the defaults' github block", () => {
    const defaults = { ...validConfig(), github: validGithub() };
    mergeConfig(defaults, { github: { status_ready: "Backlog" } });
    expect(defaults.github.status_ready).toBe("Ready");
  });
});

describe("github is not a hard requirement", () => {
  it("validateConfig accepts a config with no github block", () => {
    // github in TOP_LEVEL would break every plain /autopilot run in a project
    // with no board. This is the test that stops someone adding it there.
    const result = validateConfig(validConfig(), {});
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("loadConfig warns about nothing new when the project has no github block", () => {
    const readFile = (p) => {
      if (p !== "/plugin/autopilot.default.json") throw new Error("ENOENT");
      return JSON.stringify({ ...validConfig(), github: { status_ready: "Ready" } });
    };
    const { config, warnings } = loadConfig(
      "/proj/.claude/autopilot.json", {}, readFile, "/plugin/autopilot.default.json",
    );
    expect(warnings).toEqual([]);
    expect(config.github).toEqual({ status_ready: "Ready" });
  });
});

describe("shipped autopilot.default.json", () => {
  const defaults = JSON.parse(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "autopilot.default.json"),
      "utf8",
    ),
  );

  it("ships the four non-project-specific github keys", () => {
    expect(defaults.github).toEqual({
      status_field: "Status",
      status_ready: "Ready",
      status_in_progress: "In Progress",
      status_in_review: "In Review",
    });
  });

  it("ships no default for the two project-specific keys", () => {
    // Same reason test_command has no default: a guessed owner or board number
    // fails confusingly instead of failing at preflight with the key's name.
    expect(defaults.github.project_owner).toBeUndefined();
    expect(defaults.github.project_number).toBeUndefined();
  });

  it("ships the learnings role", () => {
    expect(defaults.roles.learnings).toEqual({ model: "opus", effort: "high" });
  });
});
