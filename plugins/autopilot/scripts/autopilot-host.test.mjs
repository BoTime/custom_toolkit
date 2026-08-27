import { describe, expect, it } from "vitest";
import {
  HOSTS,
  assertHost,
  hostConfigPath,
  hostDefaultsPath,
  hostEffortOverride,
} from "./autopilot-host.mjs";

describe("autopilot host boundaries", () => {
  it("lists the supported hosts", () => {
    expect(HOSTS).toEqual(["claude", "codex"]);
  });

  it("maps claude to the .claude config path", () => {
    expect(hostConfigPath("claude")).toBe(".claude/autopilot.json");
  });

  it("maps codex to the .codex config path", () => {
    expect(hostConfigPath("codex")).toBe(".codex/autopilot.json");
  });

  it("maps each host to its shipped defaults", () => {
    expect(hostDefaultsPath("claude")).toMatch(/autopilot\.default\.json$/);
    expect(hostDefaultsPath("codex")).toMatch(/autopilot\.codex\.default\.json$/);
  });

  it("reads the codex effort override from CODEX_REASONING_EFFORT", () => {
    expect(hostEffortOverride("codex", { CODEX_REASONING_EFFORT: "max" })).toBe("max");
  });

  it("reads the claude effort override from CLAUDE_CODE_EFFORT_LEVEL", () => {
    expect(hostEffortOverride("claude", { CLAUDE_CODE_EFFORT_LEVEL: "low" })).toBe("low");
  });

  it("throws on an unknown host", () => {
    expect(() => assertHost("cursor")).toThrow(/unknown host/i);
  });
});
