// .github/workflows/test.yml carries a `version` job that bumps the repo
// version and pushes back to main. Four of its properties fail SILENTLY rather
// than loudly if they are edited away:
//
//   - `needs: test` — without it, a red main still gets versioned.
//   - `contents: write` — this one actually fails visibly on the push, but it
//     is cheap to pin and the failure is remote-only.
//   - the `chore(release):` skip guard and `[skip ci]` — without them, the
//     job keeps SUCCEEDING while pushing a commit that triggers the next run.
//   - the invocation of scripts/bump-version.mjs — without it, the job runs
//     and commits nothing, forever.
//
// Matched on load-bearing phrases rather than whole lines, so ordinary editing
// of the workflow does not break this but removal does.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = join(HERE, "..", ".github", "workflows", "test.yml");

/**
 * The `version:` job: from its 2-space-indented key to the next job at the
 * same indent, or end of file.
 *
 * Scoped rather than matching the whole file, so a `needs: test` or a
 * `contents: write` that ends up on some OTHER job cannot satisfy assertions
 * about this one.
 */
function versionJob(yaml) {
  const start = /^ {2}version:\s*$/m.exec(yaml);
  if (!start) throw new Error("test.yml has no `version:` job");
  const rest = yaml.slice(start.index);
  // A sibling job header is `\n` + exactly two spaces + a word char. Keys
  // inside this job are indented four or more, so they cannot match.
  const end = /\n {2}[\w-]+:/.exec(rest.slice(start[0].length));
  return end ? rest.slice(0, start[0].length + end.index) : rest;
}

/**
 * The job's `if:` guard, collapsed to one line.
 *
 * The guard is a folded YAML block (`if: >-`) spread over several lines, so a
 * single-line regex would not see it. It is extracted rather than matched
 * against the whole job because `chore(release):` also appears in the commit
 * message further down — searching the whole job would keep passing after the
 * guard itself was deleted, which is the one thing a contract test must never
 * do.
 */
function ifGuard(job) {
  const match = /^ {4}if:([\s\S]*?)\n {4}[\w-]+:/m.exec(job);
  if (!match) throw new Error("the version job has no `if:` guard");
  return match[1].replace(/\s+/g, " ").trim();
}

describe("version workflow contract", () => {
  const yaml = readFileSync(WORKFLOW_PATH, "utf8");
  const job = versionJob(yaml);
  const guard = ifGuard(job);

  it("runs only after the test job passes", () => {
    // Without this, a red main is versioned anyway.
    expect(job).toMatch(/needs:\s*(\[\s*)?test/);
  });

  it("grants contents: write so the bot can push", () => {
    expect(job).toMatch(/contents:\s*write/);
  });

  it("skips when the head commit is already a release commit", () => {
    // Loop-prevention layer 3, and the only one that survives someone swapping
    // GITHUB_TOKEN for a PAT.
    expect(guard).toMatch(
      /startsWith\(github\.event\.head_commit\.message, 'chore\(release\):'\)/,
    );
    expect(guard).toMatch(/!\s*startsWith/);
  });

  it("marks its own commit [skip ci]", () => {
    // Loop-prevention layer 2.
    expect(job).toContain("[skip ci]");
  });

  it("invokes the bump script", () => {
    // Without this the job succeeds while doing nothing at all.
    expect(job).toContain("scripts/bump-version.mjs");
  });

  it("pushes the release commit back to main", () => {
    // Without this the job can commit locally and still never publish the
    // bump — same silent-failure class as a missing bump-script invocation.
    expect(job).toContain("git push origin HEAD:main");
  });

  it("only ever runs on a push to main", () => {
    expect(guard).toContain("github.event_name == 'push'");
    expect(guard).toContain("refs/heads/main");
  });
});
