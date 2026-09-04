// autopilot-dispatch.mjs is the one thing that builds a subagent definition.
// Every assertion here is about a failure that would otherwise report success:
// a stage dispatched at a defaulted model, a placeholder left empty so the
// agent invents a path, a typo'd flag whose value never reaches the prompt.
// Readers are injected throughout — these tests never touch the filesystem, so
// they run before the body templates exist and stay independent of their text.

import { describe, it, expect } from "vitest";
import {
  STAGES,
  ROLE_TABLE_ROLES,
  compose,
  render,
  readFragment,
  placeholdersIn,
  roleTable,
  outputPath,
  main,
} from "./autopilot-dispatch.mjs";
import { composeStage, defaultConfig, dummyValues } from "./dispatch-fixture.mjs";

/** A merged config shaped like loadConfig's output, with every role present. */
function makeConfig(overrides = {}) {
  const roles = {};
  for (const role of [
    "brainstorm", "spec", "plan", "learnings", "verify", "implement",
    "implement_complex", "task_review", "re_review", "final_review",
    "fix_escalation",
  ]) {
    roles[role] = { model: `model-${role}`, effort: "high" };
  }
  return { roles, worktree_dir: ".claude/worktrees", base_ref: "origin/main",
    reaper: true, findings_threshold: 2,
    tiers: { small: 1, standard: 3, large: 5 }, ...overrides };
}

/** A fragment reader that returns a marker naming the file it was asked for. */
const fakeFragments = (bodies = {}) => (rel) => {
  if (rel in bodies) return bodies[rel];
  if (rel.endsWith("-body.md")) return `BODY(${rel})`;
  return `FRAGMENT(${rel})`;
};

describe("render", () => {
  it("substitutes a placeholder by its snake_case name", () => {
    expect(render("a {{spec_path}} b", { spec_path: "docs/x.md" })).toBe("a docs/x.md b");
  });

  it("is single-pass — a substituted value is never rescanned", () => {
    // A design document containing the literal text {{run}} must reach the
    // agent unchanged rather than being expanded a second time.
    expect(render("{{design}}", { design: "see {{run}}", run: "r1" })).toBe("see {{run}}");
  });

  it("leaves a placeholder with no value in place, for compose to report", () => {
    expect(render("{{a}}", {})).toBe("{{a}}");
  });
});

describe("placeholdersIn", () => {
  it("lists each distinct placeholder once, in order of first appearance", () => {
    expect(placeholdersIn("{{b}} {{a}} {{b}}")).toEqual(["b", "a"]);
  });
});

describe("compose", () => {
  const base = {
    config: makeConfig(),
    values: { run: "r1", worktree: "/w" },
    fragmentReader: fakeFragments(),
    worktreeHas: () => false,
  };

  it("writes frontmatter naming the role, not the stage", () => {
    // The README documents PONYTAIL_SUBAGENT_MATCHER as
    // ^autopilot-(plan|implement|implement_complex)$ — a stage-keyed name
    // would silently stop matching it.
    const out = compose({ ...base, stage: "pr" });
    expect(out).toContain("name: autopilot-implement");
    expect(out).toContain("description: pr stage of an autopilot run");
  });

  it("carries the role's configured model and effort", () => {
    const config = makeConfig();
    config.roles.implement = { model: "haiku", effort: "low" };
    const out = compose({ ...base, config, stage: "pr" });
    expect(out).toContain("model: haiku");
    expect(out).toContain("effort: low");
  });

  it("names the missing roles.<role> field rather than defaulting", () => {
    const config = makeConfig();
    delete config.roles.learnings;
    expect(() => compose({ ...base, stage: "learnings", config })).toThrow(/roles\.learnings/);
  });

  it("names the missing field when a role has no model", () => {
    const config = makeConfig();
    delete config.roles.learnings.model;
    expect(() => compose({ ...base, stage: "learnings", config })).toThrow(/roles\.learnings.*model/s);
  });

  it("rejects an unknown stage, naming it and the known stages", () => {
    expect(() => compose({ ...base, stage: "deploy" })).toThrow(/deploy/);
    expect(() => compose({ ...base, stage: "deploy" })).toThrow(/land-conflict/);
  });

  it("rejects an unfilled placeholder, naming the stage, placeholder and flag", () => {
    const fragmentReader = fakeFragments({ "pr-body.md": "{{run}} {{worktree}} {{spec_path}}" });
    expect(() => compose({ ...base, stage: "pr", fragmentReader })).toThrow(/pr/);
    expect(() => compose({ ...base, stage: "pr", fragmentReader })).toThrow(/spec_path/);
    expect(() => compose({ ...base, stage: "pr", fragmentReader })).toThrow(/--spec-path/);
  });

  it("rejects a flag no placeholder consumes, naming the flag and the stage", () => {
    const values = { run: "r1", worktree: "/w", spec_path: "docs/x.md" };
    expect(() => compose({ ...base, stage: "pr", values })).toThrow(/--spec-path/);
    expect(() => compose({ ...base, stage: "pr", values })).toThrow(/pr/);
  });

  it("does not treat the reserved --run and --config as unconsumed", () => {
    const fragmentReader = fakeFragments({ "pr-body.md": "no placeholders here" });
    const values = { run: "r1", config: ".claude/autopilot.json" };
    expect(() => compose({ ...base, stage: "pr", values, fragmentReader })).not.toThrow();
  });

  it("does not treat --tier and --tasks as unconsumed, but still rejects others", () => {
    // AC7 — they select fragments rather than filling placeholders.
    const fragmentReader = fakeFragments({ "pr-body.md": "no placeholders here" });
    const values = { run: "r1", tier: "small", tasks: "1" };
    expect(() => compose({ ...base, stage: "pr", values, fragmentReader })).not.toThrow();
    expect(() =>
      compose({ ...base, stage: "pr", values: { run: "r1", nonsense: "x" }, fragmentReader }),
    ).toThrow(/--nonsense/);
  });

  it("names the fragment's relative path and the absolute path tried", () => {
    const fragmentReader = (rel) => {
      if (rel.endsWith("-body.md")) return "{{run}} {{worktree}}";
      throw new Error(`fragment references/dispatch/${rel} cannot be read at /abs/${rel}`);
    };
    expect(() => compose({ ...base, stage: "learnings", fragmentReader }))
      .toThrow(/references\/dispatch\/learnings\.md/);
    expect(() => compose({ ...base, stage: "learnings", fragmentReader }))
      .toThrow(/\/abs\/learnings\.md/);
  });

  it("orders spec's one fragment after the body", () => {
    const values = { run: "r", worktree: "/w", branch: "b", spec_path: "s",
      design: "d", criteria_source: "c" };
    const out = compose({ ...base, stage: "spec", values,
      fragmentReader: fakeFragments({ "spec-body.md": "{{run}}{{worktree}}{{branch}}{{spec_path}}{{design}}{{criteria_source}}" }) });
    expect(out.indexOf("---")).toBeLessThan(out.indexOf("FRAGMENT(spec-criteria.md)"));
  });
});

describe("the minimalism gate", () => {
  const values = { run: "r", worktree: "/w", plan_path: "p" };
  const composeSdd = (minimalism) =>
    compose({
      stage: "sdd",
      config: makeConfig(minimalism === undefined ? {} : { minimalism }),
      values,
      fragmentReader: fakeFragments({ "sdd-body.md": "{{run}}{{worktree}}{{plan_path}}" }),
      worktreeHas: () => false,
    });

  it("emits no ladder at mode off, byte-identical to no minimalism key at all", () => {
    expect(composeSdd({ mode: "off" })).toBe(composeSdd(undefined));
    expect(composeSdd({ mode: "off" })).not.toContain("minimalism");
  });

  it("appends only the lite fragment at mode lite", () => {
    const out = composeSdd({ mode: "lite" });
    expect(out).toContain("FRAGMENT(sdd-minimalism-lite.md)");
    expect(out).not.toContain("FRAGMENT(sdd-minimalism-full.md)");
  });

  it("appends lite then full at mode full — the ladder is ordered, not a set", () => {
    const out = composeSdd({ mode: "full" });
    expect(out.indexOf("FRAGMENT(sdd-minimalism-lite.md)"))
      .toBeLessThan(out.indexOf("FRAGMENT(sdd-minimalism-full.md)"));
  });
});

describe("the plan learnings gate", () => {
  const composePlan = (worktreeHas) =>
    compose({
      stage: "plan",
      config: makeConfig(),
      values: { run: "r", worktree: "/w", spec_path: "s" },
      fragmentReader: fakeFragments({ "plan-body.md": "{{run}}{{worktree}}{{spec_path}}" }),
      worktreeHas,
    });

  it("appends the learnings fragment when the worktree has the doc", () => {
    expect(composePlan((rel) => rel === "docs/autopilot/learnings.md"))
      .toContain("FRAGMENT(plan-learnings.md)");
  });

  it("omits it when the worktree does not", () => {
    expect(composePlan(() => false)).not.toContain("FRAGMENT(plan-learnings.md)");
  });
});

describe("roleTable", () => {
  it("renders the six roles' merged model and effort values", () => {
    const config = makeConfig();
    config.roles.implement = { model: "sonnet", effort: "medium" };
    const table = roleTable(config);
    expect(table).toContain("| Role | model | effort |");
    expect(table).toContain("| `implement` | sonnet | medium |");
    for (const role of ROLE_TABLE_ROLES) expect(table).toContain(`\`${role}\``);
    expect(table).not.toContain("`spec`");
  });

  it("throws naming the role when one of the six is missing from config", () => {
    const config = makeConfig();
    delete config.roles.re_review;
    expect(() => roleTable(config)).toThrow(/roles\.re_review/);
  });
});

describe("outputPath", () => {
  it("keys the file by stage, so the four implement stages do not collide", () => {
    const paths = ["sdd", "verify-fix", "land-conflict", "pr"].map((s) => outputPath("r1", s));
    expect(new Set(paths).size).toBe(4);
    expect(paths[0]).toBe(".superpowers/autopilot/r1/agents/sdd.md");
  });
});

describe("main", () => {
  /** io stub: serves config from memory, fragments from markers, captures writes. */
  function io(overrides = {}) {
    const written = [];
    const out = [];
    const errs = [];
    return {
      written, out, errs,
      deps: {
        readFile: (p) => {
          if (p.endsWith("autopilot.default.json")) return JSON.stringify(makeConfig());
          throw new Error("ENOENT");
        },
        readFragment: fakeFragments({
          "pr-body.md": "{{run}} {{worktree}}",
          "spec-body.md": "{{run}} {{worktree}} {{branch}} {{spec_path}} {{design}} {{criteria_source}}",
        }),
        exists: () => false,
        writeOut: (p, text) => written.push({ path: p, text }),
        log: (m) => out.push(m),
        err: (m) => errs.push(m),
        env: {},
        ...overrides,
      },
    };
  }

  it("prints the path and nothing else, and writes the definition there", () => {
    const t = io();
    const code = main(["pr", "--run=r1", "--worktree=/w"], t.deps);
    expect(code).toBe(0);
    expect(t.out).toEqual([".superpowers/autopilot/r1/agents/pr.md"]);
    expect(t.written).toHaveLength(1);
    expect(t.written[0].path).toBe(".superpowers/autopilot/r1/agents/pr.md");
    expect(t.written[0].text).toContain("name: autopilot-implement");
  });

  it("keeps explicit Claude dispatch byte-identical to the existing default", () => {
    const implicit = io();
    const explicit = io();

    expect(main(["pr", "--run=r1", "--worktree=/w"], implicit.deps)).toBe(0);
    expect(main(["pr", "--host=claude", "--run=r1", "--worktree=/w"], explicit.deps)).toBe(0);

    expect(explicit.written).toEqual(implicit.written);
    expect(explicit.written[0].path).toBe(".superpowers/autopilot/r1/agents/pr.md");
    expect(explicit.written[0].text).toBe([
      "---",
      "name: autopilot-implement",
      "description: pr stage of an autopilot run",
      "model: model-implement",
      "effort: high",
      "---",
      "",
      "r1 /w",
      "",
    ].join("\n"));
  });

  it("writes only a structured JSON record for Codex", () => {
    const t = io({
      readFile: (p) => {
        if (p.endsWith("autopilot.codex.default.json")) return JSON.stringify(makeConfig());
        throw new Error("ENOENT");
      },
    });

    expect(main(["pr", "--host=codex", "--run=r1", "--worktree=/w"], t.deps)).toBe(0);
    expect(t.out).toEqual([".superpowers/autopilot/r1/agents/pr.json"]);
    expect(t.written).toHaveLength(1);
    expect(t.written[0].path).toBe(".superpowers/autopilot/r1/agents/pr.json");
    expect(JSON.parse(t.written[0].text)).toEqual({
      role: "implement",
      model: "model-implement",
      reasoning_effort: "high",
      instructions: "r1 /w\n",
    });
  });

  it("rejects an unknown host without writing a record", () => {
    const t = io();
    expect(main(["pr", "--host=cursor", "--run=r1", "--worktree=/w"], t.deps)).toBe(1);
    expect(t.written).toEqual([]);
    expect(t.errs.join("\n")).toMatch(/unknown host.*cursor/i);
  });

  for (const field of ["model", "effort"]) {
    it(`rejects a Codex role missing ${field} without writing a record`, () => {
      const config = makeConfig();
      delete config.roles.implement[field];
      const t = io({
        readFile: (p) => {
          if (p.endsWith("autopilot.codex.default.json")) return JSON.stringify(config);
          throw new Error("ENOENT");
        },
      });

      expect(main(["pr", "--host=codex", "--run=r1", "--worktree=/w"], t.deps)).toBe(1);
      expect(t.written).toEqual([]);
      expect(t.errs.join("\n")).toMatch(new RegExp(`roles\\.implement.*${field}`, "s"));
    });
  }

  it("rejects an unfilled Codex placeholder without writing a record", () => {
    const t = io({
      readFile: (p) => {
        if (p.endsWith("autopilot.codex.default.json")) return JSON.stringify(makeConfig());
        throw new Error("ENOENT");
      },
      readFragment: fakeFragments({ "pr-body.md": "{{run}} {{spec_path}}" }),
    });

    expect(main(["pr", "--host=codex", "--run=r1"], t.deps)).toBe(1);
    expect(t.written).toEqual([]);
    expect(t.errs.join("\n")).toMatch(/spec_path/);
  });

  it("rejects an unconsumed Codex flag without writing a record", () => {
    const t = io({
      readFile: (p) => {
        if (p.endsWith("autopilot.codex.default.json")) return JSON.stringify(makeConfig());
        throw new Error("ENOENT");
      },
    });

    expect(main(["pr", "--host=codex", "--run=r1", "--worktree=/w", "--spec-path=s"], t.deps)).toBe(1);
    expect(t.written).toEqual([]);
    expect(t.errs.join("\n")).toMatch(/--spec-path/);
  });

  it("maps a kebab-case flag onto a snake_case placeholder", () => {
    const t = io();
    main(["spec", "--run=r1", "--worktree=/w", "--branch=b", "--spec-path=docs/x.md",
      "--design=d", "--criteria-source=c"], t.deps);
    expect(t.written[0].text).toContain("docs/x.md");
  });

  it("reads a value from a file when the flag says @path", () => {
    const t = io({
      readFile: (p) => {
        if (p.endsWith("autopilot.default.json")) return JSON.stringify(makeConfig());
        if (p === "run/design.md") return "MULTI\nLINE\n";
        throw new Error("ENOENT");
      },
    });
    main(["spec", "--run=r1", "--worktree=/w", "--branch=b", "--spec-path=s",
      "--design=@run/design.md", "--criteria-source=c"], t.deps);
    expect(t.written[0].text).toContain("MULTI\nLINE");
  });

  it("treats @@ as an escape for a value that starts with @", () => {
    const t = io();
    main(["spec", "--run=r1", "--worktree=/w", "--branch=b", "--spec-path=s",
      "--design=@@literal", "--criteria-source=c"], t.deps);
    expect(t.written[0].text).toContain("@literal");
  });

  it("names the path and the flag when an @path cannot be read", () => {
    const t = io();
    const code = main(["spec", "--run=r1", "--worktree=/w", "--branch=b", "--spec-path=s",
      "--design=@run/missing.md", "--criteria-source=c"], t.deps);
    expect(code).toBe(1);
    expect(t.errs.join("\n")).toMatch(/run\/missing\.md/);
    expect(t.errs.join("\n")).toMatch(/--design/);
  });

  it("writes nothing and prints nothing on stdout when composition fails", () => {
    const t = io();
    const code = main(["deploy", "--run=r1"], t.deps);
    expect(code).toBe(1);
    expect(t.written).toEqual([]);
    expect(t.out).toEqual([]);
    expect(t.errs.join("\n")).toMatch(/deploy/);
  });

  it("requires --run, naming it", () => {
    const t = io();
    expect(main(["pr", "--worktree=/w"], t.deps)).toBe(1);
    expect(t.errs.join("\n")).toMatch(/--run/);
  });

  it("sends config warnings to stderr, keeping stdout to one line", () => {
    const t = io();
    main(["pr", "--run=r1", "--worktree=/w"], t.deps);
    // test_command is unset in makeConfig(), so loadConfig warns.
    expect(t.errs.join("\n")).toMatch(/test_command/);
    expect(t.out).toHaveLength(1);
  });

  it("passes a worktree-relative existence check through to the plan gate", () => {
    const t = io({
      exists: (p) => p === "/w/docs/autopilot/learnings.md",
      readFragment: fakeFragments({ "plan-body.md": "{{run}} {{worktree}} {{spec_path}}" }),
    });
    main(["plan", "--run=r1", "--worktree=/w", "--spec-path=s"], t.deps);
    expect(t.written[0].text).toContain("FRAGMENT(plan-learnings.md)");
  });
});

describe("the STAGES table", () => {
  it("declares exactly the eight dispatched stages", () => {
    // Phase 1's brainstorm is a skill the orchestrator invokes in conversation,
    // not a dispatched definition; `setup` and `land` run scripts. `land`
    // appears here only through its conflict resolver.
    expect(Object.keys(STAGES).sort()).toEqual([
      "land-conflict", "learnings", "plan", "pr", "sdd", "spec", "verify", "verify-fix",
    ]);
  });

  it("names a body template per stage, keyed by stage", () => {
    for (const [stage, entry] of Object.entries(STAGES)) {
      expect(entry.body).toBe(`${stage}-body.md`);
    }
  });

  it("gives four stages the implement role", () => {
    const implementStages = Object.entries(STAGES)
      .filter(([, e]) => e.role === "implement")
      .map(([s]) => s);
    expect(implementStages.sort()).toEqual(["land-conflict", "pr", "sdd", "verify-fix"]);
  });
});

describe("the plan tier gate", () => {
  const composePlan = (values) =>
    compose({
      stage: "plan",
      config: makeConfig(),
      values: { run: "r", worktree: "/w", spec_path: "s", ...values },
      fragmentReader: fakeFragments({ "plan-body.md": "{{run}}{{worktree}}{{spec_path}}" }),
      worktreeHas: () => false,
    });

  it("selects exactly one tier budget, and only the named one", () => {
    // AC4
    for (const tier of ["small", "standard", "large"]) {
      const out = composePlan({ tier });
      expect(out).toContain(`FRAGMENT(plan-budget-${tier}.md)`);
      for (const other of ["small", "standard", "large"].filter((t) => t !== tier)) {
        expect(out).not.toContain(`FRAGMENT(plan-budget-${other}.md)`);
      }
      expect(out).not.toContain("FRAGMENT(plan-budget.md)");
    }
  });

  it("composes the untiered budget when --tier is absent", () => {
    const out = composePlan({});
    expect(out).toContain("FRAGMENT(plan-budget.md)");
    expect(out).not.toMatch(/plan-budget-(small|standard|large)\.md/);
  });

  it("rejects an unrecognised tier, naming the flag and all three values", () => {
    // AC6 — a silent fallback would let a typo produce a run whose ceremony
    // nobody chose.
    expect(() => composePlan({ tier: "medium" })).toThrow(/--tier/);
    expect(() => composePlan({ tier: "medium" })).toThrow(/small/);
    expect(() => composePlan({ tier: "medium" })).toThrow(/standard/);
    expect(() => composePlan({ tier: "medium" })).toThrow(/large/);
  });

  it("refuses to default a ceiling the merged config does not carry", () => {
    const config = makeConfig();
    delete config.tiers;
    expect(() =>
      compose({
        stage: "plan",
        config,
        values: { run: "r", worktree: "/w", spec_path: "s", tier: "small" },
        fragmentReader: fakeFragments({ "plan-body.md": "{{run}}{{worktree}}{{spec_path}}" }),
        worktreeHas: () => false,
      }),
    ).toThrow(/tiers\.small/);
  });
});

describe("the sdd review-depth gate", () => {
  const composeSdd = (values) =>
    compose({
      stage: "sdd",
      config: makeConfig(),
      values: { run: "r", worktree: "/w", plan_path: "p", ...values },
      fragmentReader: fakeFragments({ "sdd-body.md": "{{run}}{{worktree}}{{plan_path}}" }),
      worktreeHas: () => false,
    });

  it("collapses the two reviews into one at exactly 1 task", () => {
    // AC8
    expect(composeSdd({ tasks: "1" })).toContain("FRAGMENT(sdd-review-single.md)");
  });

  it("keeps two-stage review at 2 tasks and when --tasks is absent", () => {
    // AC8 — absence resolves toward more ceremony, never less.
    expect(composeSdd({ tasks: "2" })).not.toContain("FRAGMENT(sdd-review-single.md)");
    expect(composeSdd({})).not.toContain("FRAGMENT(sdd-review-single.md)");
  });

  it("rejects a --tasks value that is not a positive integer", () => {
    // Not absence: a malformed value is a typo, and the module's rule is that
    // defaulting is never the fallback.
    expect(() => composeSdd({ tasks: "one" })).toThrow(/--tasks/);
    expect(() => composeSdd({ tasks: "0" })).toThrow(/--tasks/);
  });

  it("orders the single-review fragment before the minimalism ladder", () => {
    const out = compose({
      stage: "sdd",
      config: makeConfig({ minimalism: { mode: "lite" } }),
      values: { run: "r", worktree: "/w", plan_path: "p", tasks: "1" },
      fragmentReader: fakeFragments({ "sdd-body.md": "{{run}}{{worktree}}{{plan_path}}" }),
      worktreeHas: () => false,
    });
    expect(out.indexOf("FRAGMENT(sdd-review-single.md)"))
      .toBeLessThan(out.indexOf("FRAGMENT(sdd-minimalism-lite.md)"));
  });
});

// The one block in this file that does touch the filesystem: it pins the
// untiered dispatch's assembly, which only the real fragments can carry.
describe("the untiered plan dispatch", () => {
  it("selects, orders and joins exactly body + writing-plans + budget + learnings", () => {
    // AC4. Rebuilds what compose() must produce from the same primitives,
    // rather than restating the selection logic — so this pins the assembly
    // and not the implementation that emits it.
    const config = defaultConfig();
    const values = dummyValues("plan");
    const role = config.roles.plan;
    const expected =
      [
        [
          "---",
          "name: autopilot-plan",
          "description: plan stage of an autopilot run",
          `model: ${role.model}`,
          `effort: ${role.effort}`,
          "---",
        ].join("\n"),
        render(readFragment("plan-body.md"), values),
        render(readFragment("plan-writing-plans.md"), values),
        readFragment("plan-budget.md"),
        readFragment("plan-learnings.md"),
      ]
        .map((p) => p.replace(/\s+$/, ""))
        .join("\n\n") + "\n";
    expect(composeStage("plan")).toBe(expected);
  });
});

describe("the spec tier gate", () => {
  const composeSpec = (values) =>
    compose({
      stage: "spec",
      config: makeConfig(),
      values: {
        run: "r", worktree: "/w", branch: "b", spec_path: "s",
        design: "d", criteria_source: "c", ...values,
      },
      fragmentReader: fakeFragments({
        "spec-body.md": "{{run}}{{worktree}}{{branch}}{{spec_path}}{{design}}{{criteria_source}}",
      }),
      worktreeHas: () => false,
    });

  it("emits the commit fragment on the default, standard and large paths", () => {
    // AC1 — the untiered path and the two untouched tiers select one shape.
    for (const values of [{}, { tier: "standard" }, { tier: "large" }]) {
      const out = composeSpec(values);
      expect(out).toContain("FRAGMENT(spec-commit.md)");
      expect(out).not.toContain("FRAGMENT(spec-small.md)");
      expect(out).toContain("FRAGMENT(spec-criteria.md)");
    }
  });

  it("swaps in the small fragment on small, keeping the criteria contract", () => {
    // AC2
    const out = composeSpec({ tier: "small" });
    expect(out).toContain("FRAGMENT(spec-small.md)");
    expect(out).not.toContain("FRAGMENT(spec-commit.md)");
    expect(out).toContain("FRAGMENT(spec-criteria.md)");
  });

  it("rejects an unrecognised tier, naming the flag and all three values", () => {
    // AC3
    expect(() => composeSpec({ tier: "medium" })).toThrow(/--tier/);
    expect(() => composeSpec({ tier: "medium" })).toThrow(/small/);
    expect(() => composeSpec({ tier: "medium" })).toThrow(/standard/);
    expect(() => composeSpec({ tier: "medium" })).toThrow(/large/);
  });
});

describe("the pr tier gate", () => {
  const composePr = (values, bodies = { "pr-body.md": "{{run}}{{worktree}}" }) =>
    compose({
      stage: "pr",
      config: makeConfig(),
      values: { run: "r", worktree: "/w", ...values },
      fragmentReader: fakeFragments(bodies),
      worktreeHas: () => false,
    });

  it("adds nothing on the default, standard and large paths", () => {
    // AC8
    for (const values of [{}, { tier: "standard" }, { tier: "large" }]) {
      expect(composePr(values)).not.toContain("FRAGMENT(pr-small.md)");
    }
  });

  it("emits pr-small.md on small", () => {
    // AC8. No `spec_path` here: the marker this fake reader returns for
    // `pr-small.md` declares no placeholder, so passing the flag would trip
    // the unconsumed-flag guard the next two cases are about.
    expect(composePr({ tier: "small" })).toContain("FRAGMENT(pr-small.md)");
  });

  it("requires --spec-path on small, through the ordinary placeholder error", () => {
    // The fragment is what consumes it, so the fragment is what makes it
    // required. No bespoke error, and no literal {{spec_path}} shipped.
    const bodies = {
      "pr-body.md": "{{run}}{{worktree}}",
      "pr-small.md": "read {{spec_path}}",
    };
    expect(() => composePr({ tier: "small" }, bodies)).toThrow(/spec_path/);
    expect(() => composePr({ tier: "small" }, bodies)).toThrow(/--spec-path/);
    expect(composePr({ tier: "small", spec_path: "/run/spec.md" }, bodies))
      .toContain("read /run/spec.md");
  });

  it("still rejects --spec-path when the tier is absent or not small", () => {
    // AC9 — a fragment consumes it only on small; everywhere else it is a
    // typo whose value would never reach the agent.
    expect(() => composePr({ spec_path: "/run/spec.md" })).toThrow(/--spec-path/);
    expect(() => composePr({ tier: "large", spec_path: "/run/spec.md" }))
      .toThrow(/--spec-path/);
  });

  it("rejects an unrecognised tier on pr too", () => {
    // AC3's sibling: the same message, from the same helper.
    expect(() => composePr({ tier: "medium" })).toThrow(/--tier/);
    expect(() => composePr({ tier: "medium" })).toThrow(/standard/);
  });
});

// Touches the real files: the sentence-preservation half of the plan's
// byte-identity ruling, which only the real fragments can carry.
describe("the default spec dispatch", () => {
  const values = dummyValues("spec");

  it("selects, orders and joins exactly body + spec-commit + spec-criteria", () => {
    const config = defaultConfig();
    const role = config.roles.spec;
    const expected =
      [
        [
          "---",
          "name: autopilot-spec",
          "description: spec stage of an autopilot run",
          `model: ${role.model}`,
          `effort: ${role.effort}`,
          "---",
        ].join("\n"),
        render(readFragment("spec-body.md"), values),
        render(readFragment("spec-commit.md"), values),
        readFragment("spec-criteria.md"),
      ]
        .map((p) => p.replace(/\s+$/, ""))
        .join("\n\n") + "\n";
    expect(composeStage("spec")).toBe(expected);
  });

  it("keeps every commit sentence on the default path and drops all of them on small", () => {
    // AC2. The negative half would pass trivially on its own, so the same
    // literals are asserted present on the default path first.
    const dflt = composeStage("spec");
    const small = composeStage("spec", { extraValues: { tier: "small" } });
    const moved = render(readFragment("spec-commit.md"), values).replace(/\s+$/, "");

    expect(dflt).toContain(moved);
    expect(dflt).toContain("commit it");
    expect(dflt).toContain("first commit");

    expect(small).not.toContain(moved);
    expect(small).not.toContain("commit it");
    expect(small).not.toContain("first commit");
    expect(small).toContain(readFragment("spec-criteria.md").replace(/\s+$/, ""));
  });
});

describe("the plan document-shape gate", () => {
  const composePlan = (values) =>
    compose({
      stage: "plan",
      config: makeConfig(),
      values: { run: "r", worktree: "/w", spec_path: "s", plan_path: "p", ...values },
      fragmentReader: fakeFragments({
        "plan-body.md": "{{run}}{{worktree}}{{spec_path}}{{plan_path}}",
      }),
      worktreeHas: () => false,
    });

  it("carries the writing-plans fragment on default, standard and large", () => {
    // AC4
    for (const values of [{}, { tier: "standard" }, { tier: "large" }]) {
      const out = composePlan(values);
      expect(out).toContain("FRAGMENT(plan-writing-plans.md)");
      expect(out).not.toContain("FRAGMENT(plan-inline-small.md)");
    }
  });

  it("swaps in the inline shape on small", () => {
    // AC5
    const out = composePlan({ tier: "small" });
    expect(out).toContain("FRAGMENT(plan-inline-small.md)");
    expect(out).not.toContain("FRAGMENT(plan-writing-plans.md)");
  });

  it("puts the document shape ahead of the task-count budget", () => {
    const out = composePlan({ tier: "small" });
    expect(out.indexOf("FRAGMENT(plan-inline-small.md)"))
      .toBeLessThan(out.indexOf("plan-budget-small"));
  });

  it("requires --plan-path on every tier", () => {
    // AC7
    for (const tier of [undefined, "small", "standard", "large"]) {
      const values = { run: "r", worktree: "/w", spec_path: "s" };
      if (tier) values.tier = tier;
      const call = () =>
        compose({
          stage: "plan", config: makeConfig(), values,
          fragmentReader: fakeFragments({
            "plan-body.md": "{{run}}{{worktree}}{{spec_path}}{{plan_path}}",
          }),
          worktreeHas: () => false,
        });
      expect(call).toThrow(/\{\{plan_path\}\}/);
      expect(call).toThrow(/--plan-path/);
    }
  });
});

// Touches the real files.
describe("the small plan dispatch", () => {
  const small = () => composeStage("plan", { extraValues: { tier: "small" } });

  it("never names writing-plans", () => {
    // AC5 — the point of the inline shape is that no planning sub-skill runs.
    expect(small()).not.toContain("superpowers:writing-plans");
    expect(small()).not.toContain("writing-plans");
  });

  it("states the one-step escalation to standard and its return-line form", () => {
    // AC6. Whitespace-tolerant where the fragment may wrap: the assertion is
    // about the sentence reaching the agent, not about the column it breaks at.
    const out = small();
    expect(out).toMatch(/escalat/i);
    expect(out).toMatch(/tier\s+`standard`/);
    expect(out).toContain("escalated to standard: <reason>");
    expect(out).toContain("## Escalation");
    expect(out).toMatch(/at most once|never moves more than one step/i);
  });

  it("keeps the writing-plans text in the default dispatch and out of the small one", () => {
    // Both directions, so neither half passes trivially.
    const values = dummyValues("plan");
    const moved = render(readFragment("plan-writing-plans.md"), values).replace(/\s+$/, "");
    expect(composeStage("plan")).toContain(moved);
    expect(small()).not.toContain(moved);
    expect(small()).toContain(
      render(readFragment("plan-inline-small.md"), values).replace(/\s+$/, ""),
    );
  });
});
