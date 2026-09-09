// The one place `.superpowers/autopilot` is spelled.
//
// Autopilot keeps two kinds of project file under this root, and the split is
// what makes the layout extensible: `configs/` is durable and tracked (a git
// worktree contains only committed files, and the stage agents run inside one,
// so an untracked config is invisible exactly where it is read), while `runs/`
// is rederived every run, per-machine, and stays ignored. Anything else added
// here later gets its own sibling directory instead of colliding with a run
// name.

import { existsSync } from "node:fs";

export const AUTOPILOT_ROOT = ".superpowers/autopilot";
export const CONFIGS_DIR = `${AUTOPILOT_ROOT}/configs`;
export const RUNS_ROOT = `${AUTOPILOT_ROOT}/runs`;

/** `.superpowers/autopilot/runs/<run>` — the canonical home for a run. */
export const runDir = (run) => `${RUNS_ROOT}/${run}`;

/** `.superpowers/autopilot/<run>` — where runs lived before the move. */
export const legacyRunDir = (run) => `${AUTOPILOT_ROOT}/${run}`;

/**
 * New, then legacy, then new. The last clause is the important one: a run
 * about to start has no ledger anywhere, and it must be created in the new
 * home rather than inheriting the deprecated one. `run.md` is the marker
 * because it is the first file any run writes.
 */
export function resolveRunDir(run, { exists = existsSync } = {}) {
  const dir = runDir(run);
  if (exists(`${dir}/run.md`)) return { dir, legacy: false };
  const legacy = legacyRunDir(run);
  if (exists(`${legacy}/run.md`)) return { dir: legacy, legacy: true };
  return { dir, legacy: false };
}
