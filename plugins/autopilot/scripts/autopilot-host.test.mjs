import { describe, expect, it } from "vitest";
import {
  HOSTS,
  assertHost,
  hostConfigPath,
  hostDefaultsPath,
  hostEffortOverride,
  legacyHostConfigPath,
  resolveConfigPath,
} from "./autopilot-host.mjs";

describe("autopilot host boundaries", () => {
  it("lists the supported hosts", () => {
    expect(HOSTS).toEqual(["claude", "codex"]);
  });

  it("maps claude to the configs/ config path", () => {
    expect(hostConfigPath("claude"))
      .toBe(".superpowers/autopilot/configs/autopilot.json");
  });

  it("maps codex to the configs/ config path", () => {
    expect(hostConfigPath("codex"))
      .toBe(".superpowers/autopilot/configs/autopilot.codex.json");
  });

  it("rejects an unknown host from the config path", () => {
    expect(() => hostConfigPath("cursor")).toThrow(/unknown host/i);
  });

  it("keeps the old harness paths addressable as the legacy fallback", () => {
    expect(legacyHostConfigPath("claude")).toBe(".claude/autopilot.json");
    expect(legacyHostConfigPath("codex")).toBe(".codex/autopilot.json");
    expect(() => legacyHostConfigPath("cursor")).toThrow(/unknown host/i);
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

describe("resolveConfigPath", () => {
  const only = (...paths) => (p) => paths.includes(p);
  const NEW = ".superpowers/autopilot/configs/autopilot.json";

  it("prefers the configs/ path when it exists", () => {
    expect(resolveConfigPath("claude", { exists: only(NEW) }))
      .toEqual({ path: NEW, legacy: false });
  });

  it("falls back to the harness path when only that exists", () => {
    expect(resolveConfigPath("claude", { exists: only(".claude/autopilot.json") }))
      .toEqual({ path: ".claude/autopilot.json", legacy: true });
  });

  it("prefers the configs/ path when both exist", () => {
    expect(resolveConfigPath("claude", { exists: () => true }))
      .toEqual({ path: NEW, legacy: false });
  });

  it("names the configs/ path when neither exists", () => {
    expect(resolveConfigPath("claude", { exists: () => false }))
      .toEqual({ path: NEW, legacy: false });
  });

  it("resolves codex against its own pair", () => {
    expect(resolveConfigPath("codex", { exists: only(".codex/autopilot.json") }))
      .toEqual({ path: ".codex/autopilot.json", legacy: true });
  });
});
