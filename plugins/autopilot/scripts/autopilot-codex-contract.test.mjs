// Codex cannot dispatch Claude subagent frontmatter. It needs the same rendered
// instructions carried in a structured record with Codex's field names.

import { describe, expect, it } from "vitest";
import {
  codexOutputPath,
  composeCodexDispatch,
} from "./autopilot-dispatch.mjs";

function config() {
  return {
    roles: {
      implement: { model: "gpt-5.6", effort: "high" },
    },
  };
}

describe("Codex dispatch contract", () => {
  it("composes the pr stage as a structured Codex record", () => {
    const record = composeCodexDispatch({
      stage: "pr",
      config: config(),
      values: { run: "run-7", worktree: "/tmp/worktree" },
      fragmentReader: (rel) => rel === "pr-body.md"
        ? "PR STAGE for {{run}} in {{worktree}}"
        : `FRAGMENT(${rel})`,
      worktreeHas: () => false,
    });

    expect(record).toMatchObject({
      role: "implement",
      model: expect.any(String),
      reasoning_effort: "high",
      instructions: expect.stringContaining("PR STAGE"),
    });
  });

  it("writes the pr record to a JSON stage path", () => {
    expect(codexOutputPath("run-7", "pr"))
      .toBe(".superpowers/autopilot/run-7/agents/pr.json");
  });
});
