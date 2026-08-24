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
