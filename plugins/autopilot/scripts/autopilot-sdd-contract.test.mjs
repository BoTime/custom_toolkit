// SKILL.md's `sdd` section carries a verification contract: four rules that
// stop the dispatched agent from narrating verification into the developer's
// transcript. The contract is prose, so nothing else fails if it is deleted,
// reworded past recognition, or moved out of the `sdd` section — where a
// dispatched agent would never read it.
//
// This test reads SKILL.md and asserts each rule is present within the `sdd`
// section. It matches on the load-bearing phrases, not full sentences, so
// ordinary editing does not break it but removal does.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = join(HERE, "..", "skills", "autopilot", "SKILL.md");

/**
 * The `### \`sdd\`` section: from its heading line to the next heading at the
 * same level or shallower (`###`, `##`, or `#`).
 *
 * Both boundaries are anchored to the start of a line. The start anchor stops
 * a deeper heading (`#### \`sdd\``) from being mistaken for the section. The
 * end anchor accepts shallower headings too, so that promoting the following
 * `### \`land\`` to `## \`land\`` cannot widen this section to swallow it —
 * which would let contract text living in `land` satisfy assertions that are
 * supposed to prove it lives in `sdd`.
 */
function sddSection(markdown) {
  const startMatch = /^### `sdd`.*$/m.exec(markdown);
  if (!startMatch) throw new Error("SKILL.md has no `### \\`sdd\\`` section");
  const rest = markdown.slice(startMatch.index);
  const endMatch = /\n#{1,3} .*$/m.exec(rest.slice(startMatch[0].length));
  return endMatch
    ? rest.slice(0, startMatch[0].length + endMatch.index)
    : rest;
}

describe("sdd dispatch verification contract", () => {
  const section = sddSection(readFileSync(SKILL_PATH, "utf8"));

  it("names test_command as the verification gate", () => {
    expect(section).toContain("test_command");
  });

  it("forbids narrating verification", () => {
    expect(section).toMatch(/do not narrate/i);
  });

  it("names the specific noise patterns it forbids", () => {
    // Naming them is the point — a general "be concise" does not bind an
    // agent that believes each individual check is justified.
    expect(section).toMatch(/md5/i);
    expect(section).toMatch(/echo/i);
    expect(section).toMatch(/idempotence/i);
  });

  it("forbids throwaway repositories for proving guards fire", () => {
    expect(section).toMatch(/throwaway/i);
  });

  it("keeps the contract inside the sdd section, not merely in the file", () => {
    // A rule outside the `sdd` section never reaches the dispatched agent.
    expect(section).toMatch(/verification contract/i);
  });
});
