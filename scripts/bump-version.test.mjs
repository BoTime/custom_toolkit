import { describe, it, expect } from "vitest";
import {
  bumpKind,
  parseVersion,
  formatVersion,
  compareVersions,
  nextVersion,
} from "./bump-version.mjs";

describe("bumpKind", () => {
  it("treats a plain feat as minor", () => {
    expect(bumpKind("feat: add a CSV export button")).toBe("minor");
  });

  it("treats a scoped feat as minor", () => {
    expect(bumpKind("feat(autopilot): capture SDD review findings")).toBe("minor");
  });

  it("treats a ! after the type as major", () => {
    expect(bumpKind("feat!: drop the design-approval gate")).toBe("major");
  });

  it("treats a ! after the scope as major", () => {
    expect(bumpKind("feat(autopilot)!: drop the design-approval gate")).toBe("major");
  });

  it("treats a ! on a non-feat type as major", () => {
    expect(bumpKind("fix!: stop writing the wrong lockfile field")).toBe("major");
  });

  it("treats a BREAKING CHANGE line in the body as major", () => {
    const message = [
      "fix: rename the config key",
      "",
      "BREAKING CHANGE: base_ref is now required.",
    ].join("\n");
    expect(bumpKind(message)).toBe("major");
  });

  it("accepts the hyphenated BREAKING-CHANGE spelling too", () => {
    expect(bumpKind("fix: x\n\nBREAKING-CHANGE: y")).toBe("major");
  });

  it("ignores BREAKING CHANGE prose in the subject line", () => {
    // Only a body line counts. A subject that merely mentions the phrase is
    // describing a change, not declaring one.
    expect(bumpKind("docs: explain what BREAKING CHANGE: means")).toBe("patch");
  });

  for (const type of [
    "fix", "perf", "chore", "docs", "refactor", "test", "style", "build", "ci",
  ]) {
    it(`treats ${type} as patch`, () => {
      expect(bumpKind(`${type}: some change`)).toBe("patch");
      expect(bumpKind(`${type}(autopilot): some change`)).toBe("patch");
    });
  }

  it("treats a merge commit as patch rather than skipping", () => {
    // Not hypothetical: this repo's history contains these.
    expect(bumpKind("Merge pull request #3 from BoTime/sdd-visibility")).toBe("patch");
  });

  it("treats a bare non-conventional message as patch", () => {
    expect(bumpKind("update docs")).toBe("patch");
  });

  it("treats an empty message as patch", () => {
    expect(bumpKind("")).toBe("patch");
  });

  it("is total — it never throws on odd input", () => {
    expect(bumpKind(undefined)).toBe("patch");
    expect(bumpKind("\n\n\n")).toBe("patch");
    expect(bumpKind(":")).toBe("patch");
  });

  it("does not mistake a longer type starting with feat for feat", () => {
    // `feature` is not a conventional-commit type, so it falls through.
    expect(bumpKind("feature: add a thing")).toBe("patch");
  });
});

describe("parseVersion", () => {
  it("parses a plain X.Y.Z", () => {
    expect(parseVersion("1.10.3")).toEqual({ major: 1, minor: 10, patch: 3 });
  });

  it("rejects a prerelease or build-metadata suffix", () => {
    expect(parseVersion("1.7.0-beta.1")).toBeNull();
    expect(parseVersion("1.7.0+build5")).toBeNull();
  });

  it("rejects a two-part version and surrounding junk", () => {
    expect(parseVersion("1.7")).toBeNull();
    expect(parseVersion(" 1.7.0")).toBeNull();
    expect(parseVersion("v1.7.0")).toBeNull();
  });
});

describe("formatVersion", () => {
  it("round-trips with parseVersion", () => {
    expect(formatVersion(parseVersion("2.0.9"))).toBe("2.0.9");
  });
});

describe("compareVersions", () => {
  it("compares numerically, not lexicographically", () => {
    // The whole point: "1.10.0" < "1.9.0" as strings.
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.9.0", "1.10.0")).toBeLessThan(0);
  });

  it("returns 0 for equal versions", () => {
    expect(compareVersions("1.7.0", "1.7.0")).toBe(0);
  });

  it("orders by major, then minor, then patch", () => {
    expect(compareVersions("2.0.0", "1.99.99")).toBeGreaterThan(0);
    expect(compareVersions("1.7.1", "1.7.0")).toBeGreaterThan(0);
  });

  it("throws on a non-X.Y.Z argument", () => {
    expect(() => compareVersions("1.7.0-beta", "1.7.0")).toThrow(/1\.7\.0-beta/);
  });
});

describe("nextVersion", () => {
  it("increments the patch digit", () => {
    expect(nextVersion("1.7.0", "patch")).toBe("1.7.1");
  });

  it("increments the minor digit and resets patch", () => {
    expect(nextVersion("1.7.3", "minor")).toBe("1.8.0");
  });

  it("increments the major digit and resets minor and patch", () => {
    expect(nextVersion("1.7.3", "major")).toBe("2.0.0");
  });

  it("throws on a non-X.Y.Z current version", () => {
    expect(() => nextVersion("1.7", "patch")).toThrow(/1\.7/);
  });
});
