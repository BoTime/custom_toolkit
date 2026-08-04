import { describe, it, expect } from "vitest";
import { parseConflictPaths, parseRebaseOutcome, land } from "./autopilot-land.mjs";

describe("parseConflictPaths", () => {
  it("extracts every unmerged status code, including AA and DD", () => {
    const status = [
      "UU app/comps-viewer.js",
      "M  app/format.js",
      "AA app/new-file.js",
      "?? scratch.txt",
      "DU app/gone.js",
      "DD app/both-deleted.js",
    ].join("\n");
    expect(parseConflictPaths(status)).toEqual([
      "app/comps-viewer.js",
      "app/new-file.js",
      "app/gone.js",
      "app/both-deleted.js",
    ]);
  });

  it("does not treat a staged-and-modified path as a conflict", () => {
    expect(parseConflictPaths("MM app/format.js\nAM app/new.js")).toEqual([]);
  });

  it("returns an empty array when nothing is conflicted", () => {
    expect(parseConflictPaths("M  app/format.js\n?? scratch.txt")).toEqual([]);
  });

  it("returns an empty array for empty status output", () => {
    expect(parseConflictPaths("")).toEqual([]);
  });
});

describe("parseRebaseOutcome", () => {
  it("reports clean on exit code 0", () => {
    const r = parseRebaseOutcome({ code: 0, stdout: "Successfully rebased", stderr: "" });
    expect(r.status).toBe("clean");
    expect(r.conflicts).toEqual([]);
  });

  it("reports conflict when the output names a merge conflict", () => {
    const r = parseRebaseOutcome({
      code: 1,
      stdout: "CONFLICT (content): Merge conflict in app/comps-viewer.js",
      stderr: "",
    });
    expect(r.status).toBe("conflict");
  });

  it("reports error when the rebase fails without a conflict", () => {
    const r = parseRebaseOutcome({
      code: 128,
      stdout: "",
      stderr: "fatal: invalid upstream 'origin/nope'",
    });
    expect(r.status).toBe("error");
    expect(r.message).toContain("invalid upstream");
  });
});

describe("land", () => {
  it("fetches then rebases, and reports clean", () => {
    const calls = [];
    const run = (args) => {
      calls.push(args.join(" "));
      return { code: 0, stdout: "Successfully rebased", stderr: "" };
    };
    const r = land("origin/main", run);
    expect(calls[0]).toBe("fetch origin");
    expect(calls[1]).toBe("rebase origin/main");
    expect(r.status).toBe("clean");
  });

  it("collects conflicted paths when the rebase conflicts", () => {
    const run = (args) => {
      if (args[0] === "fetch") return { code: 0, stdout: "", stderr: "" };
      if (args[0] === "rebase") {
        return {
          code: 1,
          stdout: "CONFLICT (content): Merge conflict in app/comps-viewer.js",
          stderr: "",
        };
      }
      return { code: 0, stdout: "UU app/comps-viewer.js", stderr: "" };
    };
    const r = land("origin/main", run);
    expect(r.status).toBe("conflict");
    expect(r.conflicts).toEqual(["app/comps-viewer.js"]);
  });

  it("does not query status when the rebase errors", () => {
    const calls = [];
    const run = (args) => {
      calls.push(args[0]);
      if (args[0] === "fetch") return { code: 0, stdout: "", stderr: "" };
      return { code: 128, stdout: "", stderr: "fatal: invalid upstream" };
    };
    const r = land("origin/nope", run);
    expect(r.status).toBe("error");
    expect(calls).not.toContain("status");
  });
});
