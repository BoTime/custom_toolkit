# Running the `verify` stage

Loaded by the orchestrator when the `verify` stage actually runs — that is,
when the committed spec carries at least one `(ui)` acceptance criterion. A
repo whose spec declares none never reads this file.

`SKILL.md` keeps the gate, the outcome table and the park conditions, because
those decide *whether* to run. This is everything needed to *execute*.

## The recipe the `plan` stage derived

The commands come from `.superpowers/autopilot/<run>/verify/recipe.json` in the
**main checkout**, written by the `plan` stage. Nothing here is configured by
hand:

```json
{
  "dev_command":      "bash scripts/worktree-up.sh",
  "base_url_command": "grep '^WEB_ORIGIN=' apps/api/.env | cut -d= -f2-",
  "stop_command":     "bash scripts/worktree-down.sh",
  "seed_command":     "npm run db:seed:test"
}
```

`dev_command` and `base_url_command` are required; `stop_command` and
`seed_command` are optional. Do not write this file at this stage and do not
patch it by hand — a recipe that verify repaired for itself would hide the
derivation bug rather than surfacing it as a park.

`base_url_command` runs **in the worktree, after `dev_command`**, and its
trimmed stdout is the base URL. It is never written down and never persisted: a
worktree-up script that derives ports from the worktree name and reassigns them
when a block is occupied cannot state its URL in advance, and a static one is
wrong on the second concurrent run.

## What the project must already have

`@playwright/test` resolvable from the project, and its browsers installed. The
script checks this before it starts anything and returns exit 4 if it is
missing.

**Autopilot never installs it.** A background `npx playwright install` on an
unattended run downloads hundreds of megabytes into a developer's machine
without asking, and a run that quietly provisions its own tooling is a run
whose green result nobody can reproduce. The park message names the two
commands to run; a human runs them once.

## The dispatch

Dispatch the `verify` role. It authors the checks; the script runs them.

Everything it writes goes to `.superpowers/autopilot/<run>/verify/` in the
**main checkout** — `specs/` for the test files, `fixtures/` for mock data.
Nothing is committed, and nothing goes in the worktree. These artifacts are
per-run and worth exactly one run.

The same harness constraint as the ledger applies: a worktree-isolated session
cannot Write or Edit into the main checkout, but **Bash redirects work**. The
role writes spec files with `cat > <path> <<'EOF'` heredocs.

Specs import `@playwright/test` normally, even though they sit outside the
project: the script symlinks the project's `node_modules` into the run
directory so Node's upward resolution finds it. Do not work around this with
absolute import paths — if an import fails, the stage returns the
infrastructure exit and parks rather than reporting uncovered criteria.

The dispatch prompt carries the browser verification contract:

```bash
cat "$AP/skills/autopilot/references/dispatch/verify-browser.md" >> "$A"
```

Then run the checks:

```bash
node "$AP/scripts/autopilot-verify.mjs" run \
  --config=.claude/autopilot.json \
  --run-dir=.superpowers/autopilot/<run>/verify \
  --cwd=<worktree path> \
  --spec=<path-to-spec>
```

The script owns everything mechanical: it reads the recipe, checks that
`@playwright/test` resolves, starts `dev_command` in its own process group,
resolves the base URL with `base_url_command`, polls that URL until it answers
or `ready_timeout_ms` (default 120000) expires, runs the optional
`seed_command` — after the stack is up, because the canonical `dev_command`
starts the database the seed talks to — generates the Playwright config, runs
the specs, and tears the stack down with `stop_command` in a `finally` —
falling back to killing the process group only when the recipe supplies no stop
command. A clean `dev_command` exit means setup finished, not that the server
died; only a non-zero exit is a failure. Do not start a dev server by hand, and
do not check the port yourself — a stray server from a hand-started run holds
the port and makes the next run look broken.

