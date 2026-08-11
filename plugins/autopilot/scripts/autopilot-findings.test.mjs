// The findings corpus is JSONL appended by many different review agents across
// many runs. A single bad line must never cost the rest of the file: parsing is
// deliberately tolerant, counting what it could not read rather than throwing.

import { describe, it, expect } from "vitest";
import { STAGES, parseFindings } from "./autopilot-findings.mjs";

const finding = (over = {}) => ({
  task: 4,
  round: 1,
  severity: "major",
  stage_at_fault: "brief",
  pattern: "brief introduced dead code",
  detail: "service._logger is unused",
  verdict: "CONFIRMED",
  ...over,
});

const jsonl = (...objs) => objs.map((o) => JSON.stringify(o)).join("\n");

describe("STAGES", () => {
  it("lists exactly the four stages that can be at fault", () => {
    expect(STAGES).toEqual(["brief", "plan", "spec", "implementation"]);
  });
});

describe("parseFindings", () => {
  it("parses a finding line into a record", () => {
    const { findings } = parseFindings(jsonl(finding()));
    expect(findings).toHaveLength(1);
    expect(findings[0].stage_at_fault).toBe("brief");
    expect(findings[0].pattern).toBe("brief introduced dead code");
    expect(findings[0].task).toBe(4);
    expect(findings[0].round).toBe(1);
  });

  it("separates clean lines from findings", () => {
    const { findings, cleans } = parseFindings(
      jsonl({ task: 1, clean: true }, finding({ task: 2 })),
    );
    expect(cleans).toEqual([{ task: 1, clean: true }]);
    expect(findings).toHaveLength(1);
    expect(findings[0].task).toBe(2);
  });

  it("skips malformed lines and counts them", () => {
    const { findings, malformed } = parseFindings(
      [JSON.stringify(finding()), "{ not json", JSON.stringify(finding({ task: 9 }))].join("\n"),
    );
    expect(findings).toHaveLength(2);
    expect(malformed).toBe(1);
  });

  it("ignores blank lines without counting them as malformed", () => {
    const { findings, malformed } = parseFindings(
      `\n${JSON.stringify(finding())}\n\n  \n`,
    );
    expect(findings).toHaveLength(1);
    expect(malformed).toBe(0);
  });

  it("counts a line missing required fields as malformed", () => {
    // A JSON object that parses but carries no stage_at_fault cannot be
    // clustered, so silently keeping it would corrupt every count downstream.
    const { findings, malformed } = parseFindings(jsonl({ task: 1, detail: "x" }));
    expect(findings).toHaveLength(0);
    expect(malformed).toBe(1);
  });

  it("counts a finding with an unknown stage_at_fault as malformed", () => {
    const { findings, malformed } = parseFindings(
      jsonl(finding({ stage_at_fault: "reviewer" })),
    );
    expect(findings).toHaveLength(0);
    expect(malformed).toBe(1);
  });

  it("returns empty results for an empty file", () => {
    expect(parseFindings("")).toEqual({ findings: [], cleans: [], malformed: 0 });
  });

  it("treats a non-object JSON line as malformed", () => {
    const { findings, cleans, malformed } = parseFindings(jsonl(42, "hello"));
    expect(findings).toEqual([]);
    expect(cleans).toEqual([]);
    expect(malformed).toBe(2);
  });
});
