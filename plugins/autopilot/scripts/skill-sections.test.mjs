// `skill-sections.mjs` is what lets the contract tests keep asserting "this
// rule reaches the dispatched agent" after the verbatim prompt text moved out
// of SKILL.md and into `references/dispatch/*.md`. If its resolution is wrong,
// every contract test silently weakens: a section that no longer carries a
// rule would still appear to, or a rule that is delivered would read as
// missing. These tests pin the resolution itself.
//
// The last block is a structural check over the real skill directory: every
// fragment on disk is named by something, and everything named exists.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  SKILL_DIR,
  SKILL_PATH,
  readSkill,
  unwrap,
  maskFences,
  referencedFiles,
  resolveReferences,
  sectionOf,
  topSection,
  between,
} from "./skill-sections.mjs";
import { STAGES } from "./autopilot-dispatch.mjs";
import { TIERS } from "./autopilot-config.mjs";
import { defaultConfig } from "./dispatch-fixture.mjs";


describe("referencedFiles", () => {
  it("finds a path inside a cat command", () => {
    expect(referencedFiles('cat "$AP/skills/autopilot/references/dispatch/sdd-findings.md" >> "$A"')).toEqual([
      "references/dispatch/sdd-findings.md",
    ]);
  });

  it("finds a path in prose and in backticks", () => {
    const text = "see `references/rationale.md` and references/stages/verify-run.md too";
    expect(referencedFiles(text)).toEqual([
      "references/rationale.md",
      "references/stages/verify-run.md",
    ]);
  });

  it("preserves the order they are named in", () => {
    // Order is what lets a slice between two prose anchors see the right
    // fragments; a set that reordered them would break those slices.
    const text = "references/b.md then references/a.md";
    expect(referencedFiles(text)).toEqual(["references/b.md", "references/a.md"]);
  });

  it("reports each distinct path once", () => {
    const text = "references/a.md and again references/a.md";
    expect(referencedFiles(text)).toEqual(["references/a.md"]);
  });

  it("finds nothing in text that names no reference", () => {
    expect(referencedFiles("just prose about references generally")).toEqual([]);
  });
});

describe("resolveReferences", () => {
  // A throwaway skill directory, so these assertions do not depend on the real
  // fragments' wording.
  const dir = join(tmpdir(), `skill-sections-test-${process.pid}`);
  const write = (rel, body) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  };

  beforeAll(() => {
    write("references/leaf.md", "LEAF CONTENT");
    write("references/middle.md", "MIDDLE then references/leaf.md");
    write("references/loop-a.md", "A points at references/loop-b.md");
    write("references/loop-b.md", "B points back at references/loop-a.md");
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("inlines a named file's content", () => {
    const out = resolveReferences("before references/leaf.md after", dir);
    expect(out).toContain("LEAF CONTENT");
    expect(out).toContain("before");
    expect(out).toContain("after");
  });

  it("keeps the path itself, so a test can still assert on it", () => {
    expect(resolveReferences("references/leaf.md", dir)).toContain("references/leaf.md");
  });

  it("inlines at the point of reference, preserving order", () => {
    const out = resolveReferences("FIRST references/leaf.md SECOND", dir);
    expect(out.indexOf("FIRST")).toBeLessThan(out.indexOf("LEAF CONTENT"));
    expect(out.indexOf("LEAF CONTENT")).toBeLessThan(out.indexOf("SECOND"));
  });

  it("follows a chain more than one hop deep", () => {
    // SKILL.md -> references/stages/verify-run.md -> references/dispatch/
    // verify-browser.md is exactly this shape. Resolving only the first hop
    // would report the browser contract as missing while the run delivers it.
    const out = resolveReferences("references/middle.md", dir);
    expect(out).toContain("MIDDLE");
    expect(out).toContain("LEAF CONTENT");
  });

  it("terminates on a cycle instead of recursing forever", () => {
    const out = resolveReferences("references/loop-a.md", dir);
    expect(out).toContain("A points at");
    expect(out).toContain("B points back at");
  });

  it("throws a diagnostic naming the file when one cannot be read", () => {
    expect(() => resolveReferences("references/absent.md", dir)).toThrow(
      /references\/absent\.md.*cannot be read/s,
    );
  });

  it("says why a missing fragment matters, not just that it is missing", () => {
    expect(() => resolveReferences("references/absent.md", dir)).toThrow(
      /without its contract/,
    );
  });

  it("leaves text naming no reference untouched", () => {
    expect(resolveReferences("nothing here", dir)).toBe("nothing here");
  });

});

describe("sectionOf boundaries", () => {
  const md = [
    "# Title",
    "## Phase",
    "### `alpha`",
    "alpha body",
    "#### a subsection",
    "still alpha",
    "### `beta`",
    "beta body",
    "## Next",
    "outside",
  ].join("\n");

  it("returns the named stage's body", () => {
    expect(sectionOf(md, "alpha", { resolve: false })).toContain("alpha body");
  });

  it("includes its #### subsections", () => {
    // Subsections belong to their stage; excluding them would read a rule
    // living in one as absent.
    const alpha = sectionOf(md, "alpha", { resolve: false });
    expect(alpha).toContain("a subsection");
    expect(alpha).toContain("still alpha");
  });

  it("stops at the next stage at the same level", () => {
    expect(sectionOf(md, "alpha", { resolve: false })).not.toContain("beta body");
  });

  it("stops at a shallower heading", () => {
    // The end anchor accepts shallower headings so promoting a following
    // section cannot widen this one and let text elsewhere satisfy an
    // assertion meant to prove where it lives.
    expect(sectionOf(md, "beta", { resolve: false })).not.toContain("outside");
  });

  it("throws when the stage does not exist", () => {
    expect(() => sectionOf(md, "nope", { resolve: false })).toThrow(/no `nope` stage section/);
  });

  it("is not fooled by a heading inside a fenced code block", () => {
    const fenced = [
      "### `alpha`",
      "```markdown",
      "## Acceptance criteria",
      "```",
      "still alpha",
      "### `beta`",
    ].join("\n");
    const alpha = sectionOf(fenced, "alpha", { resolve: false });
    expect(alpha).toContain("still alpha");
  });
});

describe("topSection", () => {
  const md = ["## Parking", "- one", "- two", "## Common Rationalizations", "| a | b |"].join("\n");

  it("slices a top-level section by title", () => {
    const parking = topSection(md, "Parking", { resolve: false });
    expect(parking).toContain("- one");
    expect(parking).not.toContain("| a | b |");
  });
});

describe("between", () => {
  it("slices from an opening anchor to a closing one", () => {
    expect(between("aaa START mid END zzz", /START/, /END/)).toBe("START mid ");
  });

  it("runs to the end when no closing anchor is given", () => {
    expect(between("aaa START mid", /START/)).toBe("START mid");
  });

  it("throws when the opening anchor is absent", () => {
    expect(() => between("nothing", /START/)).toThrow(/opening anchor/);
  });
});

describe("helpers", () => {
  it("unwrap collapses hard-wrapped prose so a pinned phrase still matches", () => {
    expect(unwrap("one\n  two   three")).toBe("one two three");
  });

  it("maskFences blanks a code block but preserves line offsets", () => {
    const src = "a\n```\nhidden\n```\nb";
    const masked = maskFences(src);
    expect(masked).not.toContain("hidden");
    expect(masked.split("\n").length).toBe(src.split("\n").length);
  });
});

describe("the real skill's references resolve", () => {
  const skill = readSkill();

  it("every reference SKILL.md names can be read", () => {
    expect(() => resolveReferences(skill)).not.toThrow();
  });

  it("every fragment on disk is declared by a STAGES row", () => {
    // An orphan fragment is a contract nobody dispatches — it reads as live
    // documentation while reaching no agent at all. SKILL.md no longer names
    // these files; `STAGES` does, so that is what the check follows.
    const declared = new Set();
    for (const [, entry] of Object.entries(STAGES)) {
      declared.add(entry.body);
      // Both minimalism modes, both learnings branches, and both the absent
      // and single-task values, so a fragment reachable only under one
      // setting is not reported as an orphan.
      for (const mode of ["off", "lite", "full"]) {
        for (const has of [true, false]) {
          for (const values of [undefined, { tasks: "1" }]) {
            const config = defaultConfig({ minimalism: { mode } });
            for (const f of entry.fragments({ config, worktreeHas: () => has, values })) {
              if (typeof f === "string") declared.add(f);
            }
          }
        }
      }
    }
    // The tier budgets reach `compose` as rendered `{text}` rather than a file
    // name, so no `fragments()` call can name them. Deriving them from TIERS
    // still reports a fourth tier file nobody wired up.
    for (const tier of TIERS) declared.add(`plan-budget-${tier}.md`);
    const dispatchDir = join(SKILL_DIR, "references", "dispatch");
    const orphans = readdirSync(dispatchDir)
      .filter((f) => f.endsWith(".md"))
      .filter((f) => !declared.has(f));
    expect(orphans).toEqual([]);
  });

  it("the dispatch fragments are not duplicated back into SKILL.md", () => {
    // The point of the split is that this text is paid for once, by `cat`,
    // and never enters the orchestrator's context. A fragment pasted back
    // inline would restore the cost while looking correct.
    const raw = readFileSync(SKILL_PATH, "utf8");
    const dispatchDir = join(SKILL_DIR, "references", "dispatch");
    for (const f of readdirSync(dispatchDir).filter((f) => f.endsWith(".md"))) {
      const first = readFileSync(join(dispatchDir, f), "utf8")
        .split("\n")
        .find((l) => l.trim().length > 40);
      if (first) expect(raw).not.toContain(first.trim());
    }
  });

  it("SKILL.md stays smaller than the fragments it dispatches plus its own prose", () => {
    // A regression guard on the whole point of the refactor: if SKILL.md grows
    // back past this, the extraction has been undone in spirit.
    //
    // Raised from 40k once, for the session cap. The ceiling is a proxy for
    // "the orchestrator holds only what changes what it does", and the test
    // above — no dispatch fragment duplicated back inline — is what actually
    // enforces the extraction. Raise this only after the same exercise: every
    // sentence of rationale moved to `references/rationale.md`, leaving prose
    // whose removal would change an agent's behaviour. The session cap cleared
    // that bar and pays for its ~1.6k many times over, since it bounds the
    // context of every session in the run.
    expect(readFileSync(SKILL_PATH, "utf8").length).toBeLessThan(42_000);
  });
});
