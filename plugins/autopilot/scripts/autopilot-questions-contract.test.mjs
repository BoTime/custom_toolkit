// The capture contract is prose. Nothing else fails if it is deleted or
// reworded past recognition: Phase 1 would simply stop capturing, and an empty
// corpus is indistinguishable from a run that needed no clarifying questions.
//
// These tests pin the load-bearing pieces where the agent actually reads them
// — the Phase 1 section of the orchestrator skill, and the findings command —
// matching on phrases rather than whole sentences, so ordinary rewording
// survives but a dropped rule does not.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ANSWER_SOURCES } from "./autopilot-questions.mjs";
import { readSkill, unwrap, topSection } from "./skill-sections.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const phase1 = unwrap(topSection(readSkill(), "Phase 1 — brainstorm"));

const commandMd = readFileSync(join(HERE, "..", "commands", "autopilot-findings.md"), "utf8");
const runTheReport = unwrap(topSection(commandMd, "Run the report", { resolve: false }));
const questionSection = unwrap(
  topSection(commandMd, "Present the missing-context candidates", { resolve: false }),
);

describe("Phase 1 carries the question-capture contract", () => {
  it("names the capture invocation and both its flags", () => {
    expect(phase1).toMatch(/autopilot-questions\.mjs"? capture/);
    expect(phase1).toContain("--run-dir=");
    expect(phase1).toContain("--questions=@");
  });

  it("names the corpus file and its main-checkout placement", () => {
    // The file must exist before the worktree does and survive the reaper.
    expect(phase1).toContain("questions.jsonl");
    expect(phase1).toMatch(/main checkout/i);
  });

  it("names every field a question line must carry", () => {
    for (const field of ["seq", "question", "answer", "answer_source", "pattern"]) {
      expect(phase1).toContain(field);
    }
  });

  it("enumerates the closed answer_source list", () => {
    // Without the closed list, agents invent values and the clustering key
    // fragments.
    for (const source of ANSWER_SOURCES) {
      expect(phase1).toMatch(new RegExp(`\\b${source}\\b`));
    }
  });

  it("captures once in a single batch, not per question", () => {
    expect(phase1).toMatch(/single batch/i);
  });

  it("orders capture strictly before the `design approved` ledger entry", () => {
    // `design approved` is what a resume matches to jump to `setup`, so a run
    // that captured after it would re-capture on every resume.
    expect(phase1).toMatch(/Capture before appending .design approved./i);
    expect(phase1).toMatch(/re-?capture/i);
  });

  it("says a capture failure never parks the run", () => {
    expect(phase1).toMatch(/never parks/i);
    expect(phase1).toContain("questions capture failed —");
    expect(phase1).toMatch(/continue the run/i);
  });

  it("requires judgment questions to be recorded rather than dropped", () => {
    expect(phase1).toMatch(/denominator/i);
  });
});

describe("the findings command reports the question corpus", () => {
  it("runs the questions report as a second invocation", () => {
    expect(runTheReport).toContain("autopilot-questions.mjs");
    expect(runTheReport).toContain("autopilot-findings.mjs");
    expect(runTheReport).toContain("findings_threshold");
  });

  it("fixes the output order: review findings first, then the questions", () => {
    expect(runTheReport).toMatch(/review-finding candidates first/i);
  });

  it("documents the one-line summary in the shape the report prints", () => {
    expect(questionSection).toContain(
      "Brainstorm questions: N across R runs — J judgment, A answerable",
    );
  });

  it("documents the candidates section and its full evidence", () => {
    expect(questionSection).toContain("## Missing-context candidates");
    expect(questionSection).toMatch(/run, seq, question, and answer/i);
  });

  it("states that judgment is never proposed as something to fix", () => {
    expect(questionSection).toMatch(/judgment/);
    expect(questionSection).toMatch(/never proposed/i);
  });

  it("records an approval into the existing rules file, with the source and a count", () => {
    expect(questionSection).toContain(".superpowers/autopilot/rules.md");
    expect(questionSection).toContain("answer_source");
    expect(questionSection).toMatch(/count of the evidence/i);
  });

  it("keeps the no-write-without-a-yes and no-injection rules", () => {
    expect(questionSection).toMatch(/explicit yes/i);
    expect(questionSection).toMatch(/do not write/i);
  });
});

describe("the brainstorm fork stays uncoupled", () => {
  it("never mentions the corpus or the capture script", () => {
    // The fork's header sets out to keep it free of autopilot-specific
    // coupling; the run directory is the orchestrator's concern.
    const brainstorm = readFileSync(
      join(HERE, "..", "skills", "autopilot-brainstorm", "SKILL.md"),
      "utf8",
    );
    expect(brainstorm).not.toContain("questions.jsonl");
    expect(brainstorm).not.toContain("autopilot-questions.mjs");
  });
});
