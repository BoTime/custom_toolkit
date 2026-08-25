import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// One repo-wide version, bumped automatically on every landing. The bump kind
// comes from the head commit's conventional-commit message; the current
// version is the HIGHEST across every target field, so no field is ever moved
// backwards and today's drift repairs itself on the first run.

/**
 * The conventional-commit bump rule, plus the fallback.
 *
 * Total: every input, including "" and undefined, returns one of the three
 * kinds. It never throws and never returns null — "every landing updates the
 * version" must hold with no silent no-ops, so an unparseable message is the
 * ordinary case (patch), not an error.
 */
export function bumpKind(message) {
  const text = String(message ?? "");
  const newline = text.indexOf("\n");
  const subject = (newline === -1 ? text : text.slice(0, newline)).trim();
  const body = newline === -1 ? "" : text.slice(newline + 1);

  // A `!` after the type or scope, or a BREAKING CHANGE line in the body.
  // The body, not the subject: a subject that merely mentions the phrase is
  // describing a breaking change, not declaring one.
  if (/^[a-zA-Z]+(\([^)]*\))?!:/.test(subject)) return "major";
  if (/^BREAKING[ -]CHANGE:/m.test(body)) return "major";

  // `feat` must be the whole type — `feature:` is not a conventional type and
  // falls through to patch.
  if (/^feat(\([^)]*\))?:/i.test(subject)) return "minor";

  return "patch";
}

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * Plain X.Y.Z only. A prerelease or build-metadata suffix returns null so the
 * caller can fail loudly — the repo uses plain X.Y.Z throughout, and parsing
 * something else leniently would let a field quietly stop being versioned.
 */
export function parseVersion(text) {
  const match = VERSION_RE.exec(String(text ?? ""));
  if (!match) return null;
  return { major: +match[1], minor: +match[2], patch: +match[3] };
}

export function formatVersion({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

function requireVersion(text) {
  const parsed = parseVersion(text);
  if (!parsed) throw new Error(`"${text}" is not a plain X.Y.Z version`);
  return parsed;
}

/** Numeric and field-wise, never lexicographic: 1.10.0 is greater than 1.9.0. */
export function compareVersions(a, b) {
  const left = requireVersion(a);
  const right = requireVersion(b);
  return (
    left.major - right.major ||
    left.minor - right.minor ||
    left.patch - right.patch
  );
}

export function nextVersion(current, kind) {
  const { major, minor, patch } = requireVersion(current);
  if (kind === "major") return `${major + 1}.0.0`;
  if (kind === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every version field this repo keeps in lockstep. `file` is repo-relative.
 *
 * `anchor` disambiguates files with more than one "version" key: the rewrite
 * takes the FIRST `"version"` at or after the anchor's end. A null anchor means
 * the file's first "version" is the right one.
 */
export const TARGETS = [
  { file: "package.json", field: "version", anchor: null },
  {
    file: ".claude-plugin/marketplace.json",
    field: "metadata.version",
    anchor: /"metadata"\s*:\s*\{/,
  },
  {
    file: ".claude-plugin/marketplace.json",
    field: 'plugins[name="autopilot"].version',
    // By name, not by array index: adding a second plugin later must not
    // silently retarget this rewrite at the wrong entry.
    anchor: /"name"\s*:\s*"autopilot"/,
  },
  {
    file: "plugins/autopilot/.claude-plugin/plugin.json",
    field: "version",
    anchor: null,
  },
  {
    file: "package-lock.json",
    field: "version",
    // The first "version" in the lockfile is the top-level one.
    // "lockfileVersion" cannot match: the pattern below needs a quote directly
    // before `v`, and that key's V is capital.
    anchor: null,
  },
  {
    file: "package-lock.json",
    field: 'packages[""].version',
    // The root package entry. Every OTHER "version" in this file belongs to a
    // dependency; rewriting one would change what `npm ci` installs.
    anchor: /"packages"\s*:\s*\{\s*""\s*:\s*\{/,
  },
];

// Three groups so the value's exact character range is known without guessing.
const VERSION_FIELD = /("version"\s*:\s*")([^"]*)(")/;

function locate(content, target) {
  let from = 0;
  if (target.anchor) {
    const anchored = target.anchor.exec(content);
    if (!anchored) {
      throw new Error(
        `${target.file}: cannot locate ${target.field} — anchor ${target.anchor} not found`,
      );
    }
    from = anchored.index + anchored[0].length;
  }
  const match = VERSION_FIELD.exec(content.slice(from));
  if (!match) {
    throw new Error(`${target.file}: no "version" field found for ${target.field}`);
  }
  const start = from + match.index + match[1].length;
  return { start, end: start + match[2].length, raw: match[2] };
}

/**
 * A repo-structure bug fails loudly. A missing file, a missing field, or a
 * value that is not plain X.Y.Z means the target table and the repo have gone
 * out of sync — and a silent skip would let a field quietly stop being
 * versioned, reintroducing drift through a different door.
 */
export function readVersion(content, target) {
  const { raw } = locate(content, target);
  if (!parseVersion(raw)) {
    throw new Error(
      `${target.file}: ${target.field} is "${raw}", not a plain X.Y.Z version`,
    );
  }
  return raw;
}

/**
 * Splices the value's characters. Deliberately NOT a JSON.parse/stringify
 * round-trip: that would rewrite all 1603 lines of package-lock.json on every
 * landing, burying the two-line real change in every future `git log -p`.
 */
export function replaceVersion(content, target, version) {
  const { start, end } = locate(content, target);
  return content.slice(0, start) + version + content.slice(end);
}

function readTarget(target, io) {
  try {
    return io.read(target.file);
  } catch (err) {
    throw new Error(`${target.file}: cannot read target file (${err.message})`);
  }
}

/**
 * The HIGHEST version across every target — deliberately not one designated
 * source file.
 *
 * It makes "no field is ever moved backwards" structural rather than a rule to
 * remember, and it makes the first run self-healing: it reads 1.7.0, not
 * 1.0.1, so package.json and package-lock.json are pulled UP to join the other
 * four instead of dragging them down.
 */
export function currentVersion(targets, io) {
  let best = null;
  for (const target of targets) {
    const found = readVersion(readTarget(target, io), target);
    if (best === null || compareVersions(found, best) > 0) best = found;
  }
  if (best === null) throw new Error("no version targets configured");
  return best;
}

/**
 * Rewrites every target to `version`. Returns the repo-relative paths actually
 * written — [] when every file already reads that version, which is what makes
 * a second run a no-op.
 */
export function writeVersion(targets, version, io) {
  if (!parseVersion(version)) {
    throw new Error(`"${version}" is not a plain X.Y.Z version`);
  }

  const originals = new Map();
  const updated = new Map();
  for (const target of targets) {
    if (!originals.has(target.file)) {
      const content = readTarget(target, io);
      originals.set(target.file, content);
      updated.set(target.file, content);
    }
    // Apply to the accumulated content: marketplace.json and package-lock.json
    // each carry two targets, and each locate() runs against the latest text.
    const before = updated.get(target.file);
    readVersion(before, target); // validates the existing value before touching it
    updated.set(target.file, replaceVersion(before, target, version));
  }

  const written = [];
  for (const [file, content] of updated) {
    if (content !== originals.get(file)) {
      io.write(file, content);
      written.push(file);
    }
  }
  return written;
}

/** The real filesystem, resolving repo-relative target paths against the root. */
export const fsIo = {
  read: (file) => readFileSync(join(REPO_ROOT, file), "utf8"),
  write: (file, content) => writeFileSync(join(REPO_ROOT, file), content),
};

function headCommitMessage() {
  const result = spawnSync("git", ["log", "-1", "--pretty=%B"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`git log failed: ${(result.stderr ?? "").trim()}`);
  }
  return result.stdout ?? "";
}

/**
 * stdout carries the resulting version and nothing else — the workflow captures
 * it with $(...) to build its commit message. Diagnostics go to stderr.
 */
export function main(argv = process.argv.slice(2), io = fsIo, readMessage = headCommitMessage) {
  try {
    const override = argv.find((arg) => arg.startsWith("--message="));
    const message = override ? override.slice("--message=".length) : readMessage();
    const kind = bumpKind(message);
    const current = currentVersion(TARGETS, io);
    const next = nextVersion(current, kind);
    const written = writeVersion(TARGETS, next, io);

    console.log(next);
    console.error(
      written.length
        ? `bump-version: ${current} → ${next} (${kind}); wrote ${written.join(", ")}`
        : `bump-version: already at ${next}; nothing written`,
    );
    process.exitCode = 0;
  } catch (err) {
    console.error(`bump-version: ${err.message}`);
    process.exitCode = 1;
  }
}

// pathToFileURL rather than a `file://` template: a space in the checkout path
// would otherwise silently skip main().
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
