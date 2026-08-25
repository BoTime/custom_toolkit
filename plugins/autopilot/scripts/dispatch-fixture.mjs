// Composing a stage definition against the real files, for the tests that
// assert what a dispatch actually carries.
//
// Six test files need this. `skill-sections.mjs` was extracted when six test
// files had independently grown the same SKILL.md slicer; this is the same
// extraction for its successor. It is not production code — nothing under
// `main()` imports it — but it is not a test file either, so it lives here
// beside the module it exercises.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { STAGES, compose, placeholdersIn, readFragment } from "./autopilot-dispatch.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULTS_PATH = join(HERE, "..", "autopilot.default.json");

/**
 * The plugin's shipped defaults, optionally with the `minimalism` block
 * replaced or removed. `minimalism: null` deletes the key entirely — which is
 * how the byte-identity pin builds a config that predates the key.
 */
export function defaultConfig({ minimalism } = {}) {
  const config = JSON.parse(readFileSync(DEFAULTS_PATH, "utf8"));
  if (minimalism === null) delete config.minimalism;
  else if (minimalism !== undefined) config.minimalism = minimalism;
  return config;
}

/**
 * A value for every placeholder the stage's body template declares, derived
 * from the template itself so a new placeholder cannot silently go unfilled.
 * Values are `<name>` markers, distinguishable in an assertion failure.
 */
export function dummyValues(stage) {
  const template = readFragment(STAGES[stage].body);
  return Object.fromEntries(placeholdersIn(template).map((p) => [p, `<${p}>`]));
}

/**
 * The stage's composed definition, exactly as a dispatch would carry it.
 *
 * `hasLearnings` answers the `plan` stage's worktree check; it defaults to
 * true so assertions about the learnings instruction see it.
 */
export function composeStage(stage, { minimalism, hasLearnings = true } = {}) {
  return compose({
    stage,
    config: defaultConfig({ minimalism }),
    values: dummyValues(stage),
    worktreeHas: () => hasLearnings,
  });
}
