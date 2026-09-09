import { describe, expect, it } from "vitest";
import {
  AUTOPILOT_ROOT,
  CONFIGS_DIR,
  RUNS_ROOT,
  legacyRunDir,
  resolveRunDir,
  runDir,
} from "./autopilot-paths.mjs";

describe("autopilot path layout", () => {
  it("spells the three roots", () => {
    expect(AUTOPILOT_ROOT).toBe(".superpowers/autopilot");
    expect(CONFIGS_DIR).toBe(".superpowers/autopilot/configs");
    expect(RUNS_ROOT).toBe(".superpowers/autopilot/runs");
  });

  it("puts a run under runs/", () => {
    expect(runDir("r1")).toBe(".superpowers/autopilot/runs/r1");
  });

  it("keeps the legacy run directory addressable", () => {
    expect(legacyRunDir("r1")).toBe(".superpowers/autopilot/r1");
  });
});

describe("resolveRunDir", () => {
  const only = (...paths) => (p) => paths.includes(p);

  it("prefers the new directory when its ledger exists", () => {
    expect(
      resolveRunDir("r1", { exists: only(".superpowers/autopilot/runs/r1/run.md") }),
    ).toEqual({ dir: ".superpowers/autopilot/runs/r1", legacy: false });
  });

  it("falls back to the legacy directory when only its ledger exists", () => {
    expect(
      resolveRunDir("r1", { exists: only(".superpowers/autopilot/r1/run.md") }),
    ).toEqual({ dir: ".superpowers/autopilot/r1", legacy: true });
  });

  it("prefers the new directory when both ledgers exist", () => {
    expect(resolveRunDir("r1", { exists: () => true }))
      .toEqual({ dir: ".superpowers/autopilot/runs/r1", legacy: false });
  });

  it("names the new directory when neither exists — a run about to start", () => {
    expect(resolveRunDir("r1", { exists: () => false }))
      .toEqual({ dir: ".superpowers/autopilot/runs/r1", legacy: false });
  });
});
