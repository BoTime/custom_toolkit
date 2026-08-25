import { describe, it, expect, vi } from "vitest";
import {
  bumpKind,
  parseVersion,
  formatVersion,
  compareVersions,
  nextVersion,
  TARGETS,
  readVersion,
  replaceVersion,
  currentVersion,
  writeVersion,
  main,
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

// ---------------------------------------------------------------------------
// Fixtures: the six fields exactly as they are drifted on origin/main today —
// package.json 1.0.1, package-lock.json 1.0.0 twice, the other three 1.7.0.
// Four of the six would be REGRESSED by a naive package.json-as-source
// implementation, which is what the no-regression test below pins.
// ---------------------------------------------------------------------------

const PKG = `{
  "name": "custom-toolkit",
  "private": true,
  "version": "1.0.1",
  "description": "Personal Claude Code plugins",
  "type": "module",
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^3.2.4"
  }
}
`;

const MARKETPLACE = `{
  "name": "custom-toolkit",
  "owner": {
    "name": "Botime"
  },
  "metadata": {
    "description": "Personal Claude Code plugins",
    "version": "1.7.0"
  },
  "plugins": [
    {
      "name": "autopilot",
      "source": "./plugins/autopilot",
      "description": "Take a task from idea to pull request",
      "version": "1.7.0",
      "author": {
        "name": "Botime"
      },
      "keywords": ["workflow", "automation"],
      "category": "workflow"
    }
  ]
}
`;

const PLUGIN = `{
  "name": "autopilot",
  "displayName": "Autopilot",
  "description": "Take a task from idea to pull request",
  "version": "1.7.0",
  "author": {
    "name": "Botime"
  },
  "license": "MIT",
  "keywords": ["workflow", "automation"],
  "skills": ["./skills/"],
  "commands": ["./commands/"]
}
`;

const LOCK = `{
  "name": "custom-toolkit",
  "version": "1.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "custom-toolkit",
      "version": "1.0.0",
      "devDependencies": {
        "vitest": "^3.2.4"
      }
    },
    "node_modules/vitest": {
      "version": "3.2.4",
      "resolved": "https://registry.npmjs.org/vitest/-/vitest-3.2.4.tgz",
      "integrity": "sha512-placeholder",
      "dev": true
    },
    "node_modules/@esbuild/aix-ppc64": {
      "version": "0.28.1",
      "resolved": "https://registry.npmjs.org/@esbuild/aix-ppc64/-/aix-ppc64-0.28.1.tgz",
      "integrity": "sha512-placeholder",
      "dev": true
    }
  }
}
`;

function driftedFiles() {
  return {
    "package.json": PKG,
    ".claude-plugin/marketplace.json": MARKETPLACE,
    "plugins/autopilot/.claude-plugin/plugin.json": PLUGIN,
    "package-lock.json": LOCK,
  };
}

/** In-memory io, same shape as fsIo. No temp directories anywhere. */
function fakeIo(files) {
  const store = new Map(Object.entries(files));
  return {
    store,
    read(file) {
      if (!store.has(file)) {
        const err = new Error(`ENOENT: no such file, open '${file}'`);
        err.code = "ENOENT";
        throw err;
      }
      return store.get(file);
    },
    write(file, content) {
      store.set(file, content);
    },
  };
}

const targetFor = (file, field) =>
  TARGETS.find((t) => t.file === file && t.field === field);

const versionsNow = (io) =>
  TARGETS.map((t) => readVersion(io.read(t.file), t));

describe("TARGETS", () => {
  it("covers all six version fields", () => {
    expect(TARGETS.map((t) => `${t.file}#${t.field}`)).toEqual([
      "package.json#version",
      ".claude-plugin/marketplace.json#metadata.version",
      '.claude-plugin/marketplace.json#plugins[name="autopilot"].version',
      "plugins/autopilot/.claude-plugin/plugin.json#version",
      "package-lock.json#version",
      'package-lock.json#packages[""].version',
    ]);
  });
});

describe("readVersion", () => {
  it("reads the single version out of package.json", () => {
    expect(readVersion(PKG, targetFor("package.json", "version"))).toBe("1.0.1");
  });

  it("distinguishes marketplace metadata from the plugin entry", () => {
    const meta = targetFor(".claude-plugin/marketplace.json", "metadata.version");
    const entry = targetFor(
      ".claude-plugin/marketplace.json",
      'plugins[name="autopilot"].version',
    );
    expect(readVersion(MARKETPLACE, meta)).toBe("1.7.0");
    expect(readVersion(MARKETPLACE, entry)).toBe("1.7.0");
  });

  it("reads the lockfile's two root versions, not a dependency's", () => {
    const top = targetFor("package-lock.json", "version");
    const root = targetFor("package-lock.json", 'packages[""].version');
    expect(readVersion(LOCK, top)).toBe("1.0.0");
    expect(readVersion(LOCK, root)).toBe("1.0.0");
    // Not vitest's 3.2.4 and not esbuild's 0.28.1.
  });

  it("throws naming the file and field when the version key is missing", () => {
    const stripped = PKG.replace(/^  "version".*\n/m, "");
    expect(() =>
      readVersion(stripped, targetFor("package.json", "version")),
    ).toThrow(/package\.json.*version/);
  });

  it("throws naming the file and field when the anchor is missing", () => {
    const stripped = MARKETPLACE.replace('"metadata"', '"meta"');
    expect(() =>
      readVersion(
        stripped,
        targetFor(".claude-plugin/marketplace.json", "metadata.version"),
      ),
    ).toThrow(/marketplace\.json.*metadata\.version/);
  });

  it("throws on a version that is not plain X.Y.Z", () => {
    const pre = PKG.replace('"1.0.1"', '"1.0.1-beta.2"');
    expect(() =>
      readVersion(pre, targetFor("package.json", "version")),
    ).toThrow(/package\.json.*1\.0\.1-beta\.2/);
  });
});

describe("currentVersion", () => {
  it("returns the HIGHEST version across the drifted targets", () => {
    // 1.7.0, not package.json's 1.0.1 — this is what makes the first
    // automated run self-healing instead of a six-field regression.
    expect(currentVersion(TARGETS, fakeIo(driftedFiles()))).toBe("1.7.0");
  });

  it("compares numerically, so 1.10.0 beats 1.9.0", () => {
    const files = driftedFiles();
    files["package.json"] = PKG.replace('"1.0.1"', '"1.10.0"');
    files["plugins/autopilot/.claude-plugin/plugin.json"] = PLUGIN.replace(
      '"1.7.0"',
      '"1.9.0"',
    );
    expect(currentVersion(TARGETS, fakeIo(files))).toBe("1.10.0");
  });

  it("throws naming the file when a target file is missing", () => {
    const files = driftedFiles();
    delete files["package-lock.json"];
    expect(() => currentVersion(TARGETS, fakeIo(files))).toThrow(
      /package-lock\.json/,
    );
  });
});

describe("writeVersion", () => {
  it("brings all six fields to the same version (lockstep)", () => {
    const io = fakeIo(driftedFiles());
    writeVersion(TARGETS, "1.7.1", io);
    expect(versionsNow(io)).toEqual([
      "1.7.1", "1.7.1", "1.7.1", "1.7.1", "1.7.1", "1.7.1",
    ]);
  });

  it("never moves any field backwards", () => {
    // Four of the six would regress under a package.json-as-source
    // implementation. This is a structural property, not a rule to remember.
    const io = fakeIo(driftedFiles());
    const before = versionsNow(io);
    const target = nextVersion(currentVersion(TARGETS, io), "patch");
    writeVersion(TARGETS, target, io);
    const after = versionsNow(io);
    after.forEach((value, i) => {
      expect(compareVersions(value, before[i])).toBeGreaterThanOrEqual(0);
    });
  });

  it("changes exactly two lines of package-lock.json and no dependency", () => {
    const io = fakeIo(driftedFiles());
    writeVersion(TARGETS, "1.7.1", io);
    const before = LOCK.split("\n");
    const after = io.store.get("package-lock.json").split("\n");

    expect(after).toHaveLength(before.length);
    const changed = before
      .map((line, i) => [i, line, after[i]])
      .filter(([, oldLine, newLine]) => oldLine !== newLine);
    expect(changed).toHaveLength(2);
    for (const [, , newLine] of changed) expect(newLine).toContain('"1.7.1"');

    // The corruption case: a dependency version changing would alter what
    // `npm ci` installs.
    const parsed = JSON.parse(io.store.get("package-lock.json"));
    expect(parsed.packages["node_modules/vitest"].version).toBe("3.2.4");
    expect(parsed.packages["node_modules/@esbuild/aix-ppc64"].version).toBe("0.28.1");
    expect(parsed.version).toBe("1.7.1");
    expect(parsed.packages[""].version).toBe("1.7.1");
  });

  it("changes exactly two lines of marketplace.json and leaves the rest byte-identical", () => {
    const io = fakeIo(driftedFiles());
    writeVersion(TARGETS, "1.7.1", io);
    const before = MARKETPLACE.split("\n");
    const after = io.store.get(".claude-plugin/marketplace.json").split("\n");
    expect(after).toHaveLength(before.length);
    const changed = before.filter((line, i) => line !== after[i]);
    expect(changed).toHaveLength(2);
  });

  it("reports which files it wrote", () => {
    const io = fakeIo(driftedFiles());
    expect(writeVersion(TARGETS, "1.7.1", io).sort()).toEqual(
      [
        ".claude-plugin/marketplace.json",
        "package-lock.json",
        "package.json",
        "plugins/autopilot/.claude-plugin/plugin.json",
      ].sort(),
    );
  });

  it("is a no-op the second time (idempotence)", () => {
    const io = fakeIo(driftedFiles());
    writeVersion(TARGETS, "1.7.1", io);
    const snapshot = new Map(io.store);
    expect(writeVersion(TARGETS, "1.7.1", io)).toEqual([]);
    for (const [file, content] of snapshot) {
      expect(io.store.get(file)).toBe(content);
    }
  });

  it("throws rather than writing a version that is not plain X.Y.Z", () => {
    const io = fakeIo(driftedFiles());
    expect(() => writeVersion(TARGETS, "1.7.1-rc.1", io)).toThrow(/1\.7\.1-rc\.1/);
    expect(io.store.get("package.json")).toBe(PKG);
  });
});

describe("replaceVersion", () => {
  it("splices only the value's characters", () => {
    const target = targetFor("package.json", "version");
    const out = replaceVersion(PKG, target, "9.9.9");
    expect(out).toBe(PKG.replace('"1.0.1"', '"9.9.9"'));
  });
});

describe("main", () => {
  function withSilencedConsole(fn) {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const savedExitCode = process.exitCode;
    try {
      return fn(log, error);
    } finally {
      log.mockRestore();
      error.mockRestore();
      process.exitCode = savedExitCode;
    }
  }

  it("prints only the new version to stdout and writes the files", () => {
    const io = fakeIo(driftedFiles());
    withSilencedConsole((log) => {
      main([], io, () => "feat: add a thing");
      // max is 1.7.0, feat -> minor -> 1.8.0
      expect(log.mock.calls).toEqual([["1.8.0"]]);
      expect(process.exitCode).toBe(0);
    });
    expect(versionsNow(io)).toEqual([
      "1.8.0", "1.8.0", "1.8.0", "1.8.0", "1.8.0", "1.8.0",
    ]);
  });

  it("accepts a --message override instead of reading git", () => {
    const io = fakeIo(driftedFiles());
    withSilencedConsole((log) => {
      main(["--message=fix!: break it"], io, () => {
        throw new Error("git must not be consulted when --message is given");
      });
      expect(log.mock.calls).toEqual([["2.0.0"]]);
    });
  });

  it("exits non-zero and writes nothing when a target file is missing", () => {
    const files = driftedFiles();
    delete files["plugins/autopilot/.claude-plugin/plugin.json"];
    const io = fakeIo(files);
    withSilencedConsole((log, error) => {
      main([], io, () => "chore: x");
      expect(process.exitCode).toBe(1);
      expect(log).not.toHaveBeenCalled();
      expect(error.mock.calls.flat().join(" ")).toMatch(/plugin\.json/);
    });
    expect(io.store.get("package.json")).toBe(PKG);
  });

  it("exits non-zero when a target has no version field", () => {
    const files = driftedFiles();
    files["package.json"] = PKG.replace(/^  "version".*\n/m, "");
    const io = fakeIo(files);
    withSilencedConsole((log, error) => {
      main([], io, () => "chore: x");
      expect(process.exitCode).toBe(1);
      expect(error.mock.calls.flat().join(" ")).toMatch(/package\.json/);
    });
  });
});
