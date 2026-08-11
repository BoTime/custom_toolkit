import { describe, it, expect } from "vitest";
import { ROLES, EFFORTS, validateConfig, mergeConfig, loadConfig } from "./autopilot-config.mjs";

const validConfig = () => ({
  roles: {
    brainstorm: { model: "opus", effort: "high" },
    spec: { model: "opus", effort: "high" },
    plan: { model: "opus", effort: "xhigh" },
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
  it("lists exactly the nine roles", () => {
    expect(ROLES).toEqual([
      "brainstorm", "spec", "plan", "implement", "implement_complex",
      "task_review", "re_review", "final_review", "fix_escalation",
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

  it("overrides one role and preserves the other eight", () => {
    const merged = mergeConfig(validConfig(), {
      roles: { implement: { model: "opus" } },
    });
    expect(merged.roles.implement.model).toBe("opus");
    // effort survives a partial role override
    expect(merged.roles.implement.effort).toBe("medium");
    expect(merged.roles.plan).toEqual({ model: "opus", effort: "xhigh" });
    expect(Object.keys(merged.roles)).toHaveLength(9);
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
