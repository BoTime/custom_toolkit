// Section extraction for the contract tests that pin SKILL.md's prose.
//
// Six test files independently grew the same "slice out a `### <stage>`
// section" helper, and a seventh needed it to see through the reference files
// the skill now dispatches from. This is that helper, once.
//
// # Why references are resolved
//
// The contract tests exist to prove a rule REACHES THE DISPATCHED AGENT — not
// merely that it appears somewhere in the repository. Originally that meant
// asserting the rule sat inside the stage's own section, because the
// orchestrator composed each dispatch prompt out of text it had read inline.
//
// The skill now keeps those verbatim prompt fragments in
// `references/dispatch/*.md` and concatenates them into the subagent
// definition with `cat`, so the orchestrator never reads them into its own
// context. The rule still reaches the dispatched agent — by a different route.
//
// `sectionOf` follows that route. It inlines the content of every
// `references/**.md` file a section names, at the point where the section
// names it. So "the sdd section" continues to mean "everything the sdd
// dispatch actually carries", and the existing assertions keep their original
// meaning without being weakened.
//
// This is strictly stronger than matching the raw section text: a reference
// whose path is wrong, whose file was deleted, or whose `cat` line was dropped
// from the stage all fail loudly here, where before there was nothing to fail.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The autopilot skill directory — where `references/` lives. */
export const SKILL_DIR = join(HERE, "..", "skills", "autopilot");
export const SKILL_PATH = join(SKILL_DIR, "SKILL.md");

/** Read the orchestrator skill. */
export const readSkill = () => readFileSync(SKILL_PATH, "utf8");

/**
 * Collapse whitespace.
 *
 * These files are hard-wrapped prose, so a pinned phrase routinely straddles a
 * newline. Without this a reflow that changes no words at all fails the tests.
 */
export const unwrap = (s) => s.replace(/\s+/g, " ");

/**
 * Blank out fenced code blocks, preserving offsets.
 *
 * The `spec` section embeds a markdown example containing a literal
 * `## Acceptance criteria` line. Unmasked, the boundary search below mistakes
 * that example for the start of the next section and truncates — so a rule
 * further down reads as absent and the test passes a contract nobody wrote.
 */
export function maskFences(markdown) {
  return markdown.replace(/^```[\s\S]*?^```/gm, (block) => block.replace(/[^\n]/g, " "));
}

/**
 * Every `references/...md` path named in a chunk of text, in the order named.
 *
 * Matches the path wherever it appears — inside a `cat` command, in backticks,
 * or in prose — because the point is that the stage names the file, not how it
 * is punctuated.
 */
export function referencedFiles(text) {
  const found = [];
  for (const m of text.matchAll(/references\/[A-Za-z0-9_./-]+\.md/g)) {
    if (!found.includes(m[0])) found.push(m[0]);
  }
  return found;
}

/**
 * Inline the content of every reference file the text names, at the point it
 * is named. Order is preserved, so a slice taken between two prose anchors
 * still sees the fragments that sit between them.
 *
 * Resolution is recursive, because the route a contract travels can be more
 * than one hop: SKILL.md's `verify` section points at
 * `references/stages/verify-run.md`, and that file is what `cat`s
 * `references/dispatch/verify-browser.md` into the dispatch. Following only the
 * first hop would report the browser contract as missing while the run
 * delivers it perfectly well.
 *
 * `seen` breaks cycles and stops a file being inlined twice when two stages
 * name it.
 *
 * Throws if a named file cannot be read: a stage that names a fragment which
 * does not exist would dispatch a prompt missing its contract, and that must
 * fail here rather than at 2am in an unattended run.
 */
export function resolveReferences(text, skillDir = SKILL_DIR, seen = new Set()) {
  let out = text;
  for (const rel of referencedFiles(text)) {
    if (seen.has(rel)) continue;
    seen.add(rel);
    const path = normalize(join(skillDir, rel));
    let body;
    try {
      body = readFileSync(path, "utf8");
    } catch {
      throw new Error(
        `SKILL.md names ${rel}, but it cannot be read at ${path}. ` +
          `A dispatch that concatenates a missing fragment ships without its contract.`,
      );
    }
    const resolved = resolveReferences(body, skillDir, seen);
    // Replace every mention with the path followed by its content, so the
    // fragment lands where the stage puts it and the path stays assertable.
    out = out.split(rel).join(`${rel}\n${resolved}\n`);
  }
  return out;
}

/**
 * A `### \`<name>\`` stage section: from its heading line to the next heading
 * at the same level or shallower (`###`, `##`, `#`).
 *
 * Both boundaries anchor to the start of a line. The start anchor stops a
 * deeper heading (`#### \`sdd\``) being mistaken for the section. The end
 * anchor accepts shallower headings so promoting the following section cannot
 * widen this one and let text living elsewhere satisfy assertions meant to
 * prove where it lives.
 *
 * Subsections (`####`) belong to their stage and are included.
 *
 * @param {string} markdown  the skill source
 * @param {string} name      stage name, as it appears in backticks
 * @param {object} [opts]
 * @param {boolean} [opts.resolve=true]  inline referenced dispatch fragments
 */
export function sectionOf(markdown, name, { resolve = true, skillDir = SKILL_DIR } = {}) {
  const masked = maskFences(markdown);
  const start = new RegExp("^### `" + name + "`.*$", "m").exec(masked);
  if (!start) throw new Error(`SKILL.md has no \`${name}\` stage section`);
  const afterHeading = start.index + start[0].length;
  const end = /\n#{1,3} .*$/m.exec(masked.slice(afterHeading));
  const raw = markdown.slice(start.index, end ? afterHeading + end.index : markdown.length);
  return resolve ? resolveReferences(raw, skillDir) : raw;
}

/**
 * A `## <title>` top-level section, by literal heading text.
 */
export function topSection(markdown, title, { resolve = true, skillDir = SKILL_DIR } = {}) {
  const masked = maskFences(markdown);
  const start = new RegExp("^## " + title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ".*$", "m").exec(
    masked,
  );
  if (!start) throw new Error(`SKILL.md has no "## ${title}" section`);
  const afterHeading = start.index + start[0].length;
  const end = /\n#{1,2} .*$/m.exec(masked.slice(afterHeading));
  const raw = markdown.slice(start.index, end ? afterHeading + end.index : markdown.length);
  return resolve ? resolveReferences(raw, skillDir) : raw;
}

/**
 * The slice of a section between two prose anchors — used where a test needs
 * one contract out of a section that carries several.
 *
 * @param {string} text   section text, already resolved
 * @param {RegExp} from   anchor that opens the slice (its match starts it)
 * @param {RegExp} [to]   anchor that closes it; to the end when absent
 */
export function between(text, from, to) {
  const start = from.exec(text);
  if (!start) throw new Error(`no match for opening anchor ${from}`);
  const rest = text.slice(start.index);
  if (!to) return rest;
  const end = to.exec(rest);
  return end ? rest.slice(0, end.index) : rest;
}
