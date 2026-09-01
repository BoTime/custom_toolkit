import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_CAPS,
  measure,
  findTranscript,
  exceeded,
  formatSessionEntry,
  parseSessionEntry,
  checkSessions,
  capsFrom,
  main,
} from "./autopilot-session.mjs";
import { parseLedger } from "./autopilot-ledger.mjs";

/** One assistant record as Claude Code writes it. */
function turn(id, { input = 0, read = 0, write = 0, out = 1 } = {}) {
  return JSON.stringify({
    type: "assistant",
    message: {
      id,
      usage: {
        input_tokens: input,
        cache_read_input_tokens: read,
        cache_creation_input_tokens: write,
        output_tokens: out,
      },
    },
  });
}

describe("measure", () => {
  it("counts one turn per message id, not per record", () => {
    // A single turn emitting thinking, text and a tool_use writes three
    // records that repeat the same id and the same usage.
    const contents = [
      turn("msg_a", { input: 100, read: 900 }),
      turn("msg_a", { input: 100, read: 900 }),
      turn("msg_a", { input: 100, read: 900 }),
      turn("msg_b", { input: 50, read: 2000 }),
    ].join("\n");

    expect(measure(contents)).toEqual({ turns: 2, ctx: 2050 });
  });

  it("reports the latest context, not the peak", () => {
    // Context can fall when a session compacts; what the next turn will
    // re-read is the latest value.
    const contents = [
      turn("a", { read: 200000 }),
      turn("b", { read: 40000 }),
    ].join("\n");

    expect(measure(contents).ctx).toBe(40000);
  });

  it("sums raw input, cache read and cache write", () => {
    const contents = turn("a", { input: 10, read: 20, write: 30 });
    expect(measure(contents).ctx).toBe(60);
  });

  it("ignores user records and records without usage", () => {
    const contents = [
      JSON.stringify({ type: "user", message: { content: "hi" } }),
      JSON.stringify({ type: "assistant", message: { id: "x" } }),
      turn("a", { read: 5 }),
    ].join("\n");

    expect(measure(contents)).toEqual({ turns: 1, ctx: 5 });
  });

  it("survives a torn final line from a session still writing", () => {
    const contents = `${turn("a", { read: 7 })}\n{"type":"assistant","messa`;
    expect(measure(contents)).toEqual({ turns: 1, ctx: 7 });
  });

  it("returns zeroes for an empty transcript", () => {
    expect(measure("")).toEqual({ turns: 0, ctx: 0 });
  });
});

describe("findTranscript", () => {
  const fs = {
    readdirSync: () => ["-Users-x-repo", "-Users-x-repo--claude-worktrees-y"],
    statSync: (p) => {
      // Only the worktree directory holds it — the case that matters, since
      // every autopilot run relocates at `setup`.
      if (p.includes("worktrees-y") && p.endsWith("sess-1.jsonl")) return {};
      throw new Error("ENOENT");
    },
  };

  it("finds a transcript in a relocated project directory", () => {
    expect(findTranscript("sess-1", "/root", fs)).toBe(
      "/root/-Users-x-repo--claude-worktrees-y/sess-1.jsonl",
    );
  });

  it("returns null for an unknown session", () => {
    expect(findTranscript("sess-2", "/root", fs)).toBeNull();
  });

  it("returns null without a session id", () => {
    expect(findTranscript(undefined, "/root", fs)).toBeNull();
  });

  it("returns null when the projects root is unreadable", () => {
    const missing = {
      readdirSync: () => {
        throw new Error("ENOENT");
      },
      statSync: () => ({}),
    };
    expect(findTranscript("sess-1", "/nope", missing)).toBeNull();
  });
});

describe("exceeded", () => {
  it("is empty at the cap — the cap is the last allowed value", () => {
    expect(exceeded({ turns: 120, ctx: 150000 }, DEFAULT_CAPS)).toEqual([]);
  });

  it("names the turn cap when only turns are over", () => {
    expect(exceeded({ turns: 121, ctx: 1000 }, DEFAULT_CAPS)).toEqual([
      "turns 121 > 120",
    ]);
  });

  it("names both caps when both are over", () => {
    expect(exceeded({ turns: 200, ctx: 200000 }, DEFAULT_CAPS)).toHaveLength(2);
  });

  it("ignores an axis the config leaves unset", () => {
    expect(exceeded({ turns: 999, ctx: 999999 }, { max_turns: undefined })).toEqual(
      [],
    );
  });
});

describe("session ledger entries", () => {
  it("round-trips through format and parse", () => {
    const text = formatSessionEntry("sdd", { turns: 103, ctx: 228173 });
    expect(text).toBe("session: sdd — 103 turns, 228173 ctx");
    expect(parseSessionEntry(text)).toEqual({
      stage: "sdd",
      turns: 103,
      ctx: 228173,
    });
  });

  it("does not parse a pipeline entry", () => {
    expect(parseSessionEntry("sdd complete (4 tasks, 0 parked)")).toBeNull();
  });
});

describe("checkSessions", () => {
  const build = (...entries) =>
    parseLedger(
      [
        "# autopilot run — task: x",
        ...entries.map((e, i) => `2026-07-29T14:0${i}:00Z  ${e}`),
      ].join("\n"),
    );

  it("passes a run whose sessions all stayed under cap", () => {
    const ledger = build(
      "started (phase 1)",
      "session: phase1 — 44 turns, 90000 ctx",
      "design approved",
      "session: sdd — 61 turns, 120000 ctx",
    );
    expect(checkSessions(ledger)).toEqual([]);
  });

  it("reports the stage a session blew through the cap at", () => {
    const ledger = build(
      "started (phase 1)",
      "session: sdd — 103 turns, 228173 ctx",
    );
    const violations = checkSessions(ledger);
    expect(violations).toHaveLength(1);
    expect(violations[0].stage).toBe("sdd");
    expect(violations[0].over).toEqual(["ctx 228173 > 150000"]);
  });

  it("ignores pipeline entries entirely", () => {
    const ledger = build("sdd complete (4 tasks, 0 parked)", "pr: https://x/1");
    expect(checkSessions(ledger)).toEqual([]);
  });
});

describe("capsFrom", () => {
  it("uses the configured block", () => {
    expect(capsFrom({ session: { max_turns: 40 } })).toEqual({
      max_turns: 40,
      max_context_tokens: DEFAULT_CAPS.max_context_tokens,
    });
  });

  it("falls back to the defaults when the key predates this feature", () => {
    expect(capsFrom({})).toEqual(DEFAULT_CAPS);
  });
});

describe("main", () => {
  const env = { CLAUDE_CODE_SESSION_ID: "sess-1", HOME: "/home/x" };
  const transcript = [turn("a", { read: 200000 }), turn("b", { read: 200000 })].join(
    "\n",
  );
  const base = {
    readFile: () => transcript,
    load: () => ({ config: {} }),
    find: () => "/home/x/.claude/projects/p/sess-1.jsonl",
  };

  it("measure prints the size and whether to hand off", () => {
    const log = vi.fn();
    const code = main(["measure"], env, { ...base, log });

    expect(code).toBe(0);
    expect(JSON.parse(log.mock.calls[0][0])).toEqual({
      turns: 2,
      ctx: 200000,
      handoff: true,
      over: ["ctx 200000 > 150000"],
    });
  });

  it("measure exits 0 over cap — handing off is routine, not a failure", () => {
    expect(main(["measure"], env, { ...base, log: vi.fn() })).toBe(0);
  });

  it("record appends the measurement to the ledger", () => {
    const appendLedger = vi.fn();
    main(["record", "run.md", "sdd"], env, { ...base, log: vi.fn(), appendLedger });

    expect(appendLedger).toHaveBeenCalledWith(
      "run.md",
      "session: sdd — 2 turns, 200000 ctx",
    );
  });

  it("record without a stage is a usage error", () => {
    const logError = vi.fn();
    expect(main(["record", "run.md"], env, { ...base, log: vi.fn(), logError })).toBe(1);
  });

  it("check exits 1 when a session ran over cap", () => {
    const logError = vi.fn();
    const code = main(["check", "run.md"], env, {
      ...base,
      logError,
      log: vi.fn(),
      readLedgerAt: () =>
        parseLedger(
          "# autopilot run — task: x\n2026-07-29T14:00:00Z  session: sdd — 300 turns, 400000 ctx",
        ),
    });

    expect(code).toBe(1);
    expect(logError.mock.calls[0][0]).toContain("over cap at sdd");
  });

  it("check exits 0 for a run that handed off", () => {
    const code = main(["check", "run.md"], env, {
      ...base,
      log: vi.fn(),
      readLedgerAt: () =>
        parseLedger(
          "# autopilot run — task: x\n2026-07-29T14:00:00Z  session: sdd — 60 turns, 100000 ctx",
        ),
    });
    expect(code).toBe(0);
  });

  it("falls back to default caps when the project config is malformed", () => {
    const logError = vi.fn();
    const log = vi.fn();
    const code = main(["measure"], env, {
      ...base,
      log,
      logError,
      load: () => {
        throw new Error("not valid JSON");
      },
    });

    // Measuring must survive a broken config: the caps are advisory, and the
    // stages that genuinely need config already fail on their own.
    expect(code).toBe(0);
    expect(JSON.parse(log.mock.calls[0][0]).handoff).toBe(true);
    expect(logError.mock.calls[0][0]).toContain("default caps");
  });

  it("exits 2 when the session cannot find its own transcript", () => {
    const logError = vi.fn();
    const code = main(["measure"], env, { ...base, logError, find: () => null });
    expect(code).toBe(2);
    expect(logError.mock.calls[0][0]).toContain("no transcript found");
  });

  it("exits 2 outside a Claude Code session", () => {
    const logError = vi.fn();
    const code = main(["measure"], { HOME: "/home/x" }, {
      ...base,
      logError,
      find: () => null,
    });
    expect(code).toBe(2);
    expect(logError.mock.calls[0][0]).toContain("CLAUDE_CODE_SESSION_ID");
  });

  it("rejects an unknown command", () => {
    const logError = vi.fn();
    expect(main(["frobnicate"], env, { ...base, logError })).toBe(1);
  });
});
