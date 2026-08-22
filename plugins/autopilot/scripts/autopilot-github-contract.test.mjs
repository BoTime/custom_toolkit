// autopilot-github's SKILL.md is a wrapper made of prose. Nothing else in the
// repository fails when it drifts: it can lose the "do not dispatch autopilot
// into a subagent" rule, or the park hook's ordering, or one of the five ledger
// lines, and every test still passes while the wrapper quietly stops working —
// a card left in Ready, or worse, a parked run that /autopilot resume drives
// straight past.
//
// This test reads SKILL.md and asserts the load-bearing phrases are present. It
// matches on phrases and on the exact strings shared with code, not on full
// sentences, so ordinary editing does not break it but removal does.
//
// Style sibling of autopilot-sdd-contract.test.mjs.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { GITHUB_LEDGER_LINES } from "./autopilot-github-issue.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = join(HERE, "..", "skills", "autopilot-github", "SKILL.md");

const skill = readFileSync(SKILL_PATH, "utf8");

// SKILL.md is hard-wrapped prose, so a pinned phrase routinely straddles a
// newline. Collapse whitespace before matching; otherwise a reflow that changes
// no words at all would fail these tests.
const unwrap = (s) => s.replace(/\s+/g, " ");
const flat = unwrap(skill);

describe("autopilot-github frontmatter", () => {
  it("declares the skill name the plugin loads it under", () => {
    expect(skill).toMatch(/^---\nname: autopilot-github\n/);
  });

  it("triggers on /autopilot-github and on its resume form", () => {
    // There is no command file — the skill triggers purely off `description`
    // matching the developer's message, exactly as `autopilot` itself does.
    const description = /description:.*/.exec(skill)?.[0] ?? "";
    expect(description).toContain("/autopilot-github");
    expect(description).toMatch(/resume/i);
  });
});

describe("the wrapper stays a wrapper", () => {
  it("delegates the pipeline to autopilot:autopilot", () => {
    expect(skill).toContain("autopilot:autopilot");
  });

  it("forbids dispatching autopilot into a subagent", () => {
    // Behind a subagent boundary the hooks are unreachable and a park is
    // reported to the wrapper instead of to the human.
    expect(flat).toMatch(/do not dispatch autopilot into a subagent/i);
  });

  it("says the deltas must not touch autopilot's pattern-matched seams", () => {
    expect(flat).toMatch(/nextStage/);
    expect(flat).toMatch(/prefix/i);
  });
});

describe("the five github: ledger lines", () => {
  GITHUB_LEDGER_LINES.forEach((line) => {
    it(`documents "${line}"`, () => {
      expect(skill).toContain(line);
    });
  });
});

describe("the load-bearing rules", () => {
  it("puts the park comment BEFORE the PARKED append", () => {
    // Appended after, the PARKED entry is no longer last and nextStage stops
    // returning "parked" — /autopilot resume then drives the run past the park.
    expect(flat).toMatch(/before[^.]{0,80}PARKED/i);
  });

  it("pins the single-line ledger header", () => {
    expect(flat).toMatch(/single-line/i);
    expect(skill).toContain("# autopilot run — task: GitHub issue #");
  });

  it("says a failed move or comment does not park the run", () => {
    expect(flat).toMatch(/do not park|does not park/i);
    expect(skill).toContain("github: ");
  });

  it("requires each hook to re-read the ledger and skip its own line", () => {
    expect(flat).toMatch(/re-read the ledger/i);
    expect(flat).toMatch(/skip/i);
  });

  it("has resolve write the ledger header rather than a shell printf", () => {
    // The issue title is untrusted text. Prose that builds this line with
    // printf hands a title containing `$(...)` or a backtick straight to a
    // shell in the user's checkout.
    expect(skill).toContain("--write-ledger");
  });

  it("points the wrapper at preflight's printed status names", () => {
    // Without them the wrapper can only guess from the defaults in the example
    // JSON, which are wrong whenever the project overrides one.
    expect(flat).toMatch(/status names/i);
  });

  it("names all four subcommands of the script", () => {
    for (const subcommand of ["preflight", "resolve", "move", "comment"]) {
      expect(skill).toContain(`autopilot-github-issue.mjs ${subcommand}`);
    }
  });
});
