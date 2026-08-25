# Autopilot browser verification — design

## Problem

Autopilot's `land` stage runs the project's test suite and treats green as
proof the branch works. For a frontend change that is not the same claim: the
suite proves the code does what the code says, while an acceptance criterion is
something a person confirms by opening the app. Nothing in the pipeline ever
opens it.

The gap has a specific shape. A GitHub issue states what "done" looks like in
user terms; the run implements it, tests it against its own unit assertions,
and opens a PR whose description asserts success. Whether the button actually
appears is checked for the first time by a human reviewer.

## Approach

One new stage, `verify`, between `sdd` and `learnings`, plus deltas on `spec`,
`plan` and `pr`. Everything else in the pipeline is unchanged.

```
phase1 → setup → spec → plan → sdd → verify → learnings → land → pr
                  ▲      ▲              │        ▲          ▲
                  │      │              └────────┘          │
                  │      │         what the browser saw     │
                  │      └─ verify recipe            tests green
                  └─ acceptance criteria
```

`nextStage` in `autopilot-ledger.mjs` reorders to match:

```
has("pr:")                 → done
has("rebase clean")        → pr
has("learnings committed") → land
has("verify")              → learnings
has("sdd complete")        → verify
```

The `verify` prefix still has to cover both outcomes that let a run continue —
a pass and a documented skip — for the reason the existing code comment already
gives: a skipped stage that appends nothing sends every later resume back
through `verify` forever.

### What moving it costs, said plainly

The previous design put `verify` between `land` and `pr` and argued for that
placement on a real risk: a semantic conflict rebases clean and still breaks
the UI, which is exactly why the post-rebase test run is not optional. That
argument has not been refuted. It is being **traded away deliberately**, and
this document names the trade rather than quietly dropping the old rationale.

What is given up: the browser now sees the pre-rebase tree, so a UI break
introduced by the rebase itself is not caught by a browser. The post-rebase
`test_command` run inside `land` remains the only gate after landing, and it
sees no pixels.

What the trade buys, and why it was judged worth more:

- **Fix rounds land while implementation context is fresh.** A failed criterion
  discovered before `land` is a fix on the working branch, in the same run,
  against a tree nobody has rebased. Discovered after `land`, the same fix is a
  new commit on a rebased branch whose reviewer may already be looking at it.
- **`learnings` now runs after `verify`, so it can see what the browser saw.**
  The learnings stage distills the run's findings; previously it ran before any
  browser opened and could only distill what code reviewers said. A criterion
  that failed in a browser is the strongest evidence the run produces about
  whether the spec described the feature correctly, and it was arriving too
  late to be distilled.

## Acceptance criteria are the gate

**Writing a `(ui)` acceptance criterion in the spec turns this stage on.**
There is no flag, no path glob, no auto-detection heuristic, and nothing to
configure.

The `spec` stage's required `## Acceptance criteria` section is unchanged:

```markdown
- AC1 (ui) — a signed-out visitor clicking "Save" sees the login prompt
- AC2 (non-ui) — POST /items rejects an empty title with 422
```

The `(ui)` / `(non-ui)` tag answers three questions with one classification:
what to check, whether to open a browser at all, and what the PR reports
against.

An untagged criterion is an error rather than a default. Defaulting it to
`non-ui` would drop a criterion from verification while the run still reported
success, which is the failure mode this whole stage exists to remove.

Criteria enter from the issue body under `/autopilot-github` and from the
brainstorm under plain `/autopilot`. Both land in the spec, which is already
committed and already the `plan` stage's input, so no new plumbing carries them.

Four situations follow from that one sentence:

| Situation | Outcome |
|---|---|
| Zero `(ui)` criteria | Skip, silently |
| `(ui)` criteria, recipe derived | Run |
| `(ui)` criteria, no derivable recipe | **Park** |
| `(ui)` criteria, `@playwright/test` absent | **Park** |

A backend repo therefore costs nothing: it writes no `(ui)` criteria and the
stage never speaks. The two parks are the deliberate part. This document's own
standing rule is that **a criterion with no test is a failure, not a pass** —
so a run that declared UI criteria and then could not open a browser must not
report success. Skipping there would report green on the exact gap the stage
exists to close.

Autopilot still never installs Playwright. `@playwright/test` is the project's
responsibility, because an unattended run that provisions its own tooling
downloads hundreds of megabytes nobody approved and produces a green nobody can
reproduce.

## The verify recipe is derived, not configured

`browser.dev_command`, `browser.base_url` and `browser.seed` leave the config
schema entirely. Nobody hand-writes them any more.

Instead the `plan` stage **derives** a verify recipe by reading the project the
way a new contributor would — `package.json` scripts, compose files, `scripts/`,
the README — and writes it, in the **main checkout**, to:

```
.superpowers/autopilot/<run>/verify/recipe.json
```

gitignored, per-run, rederived every run. Shape:

```json
{
  "dev_command":      "bash scripts/worktree-up.sh",
  "base_url_command": "grep '^WEB_ORIGIN=' apps/api/.env | cut -d= -f2-",
  "stop_command":     "bash scripts/worktree-down.sh",
  "seed_command":     "npm run db:seed:test"
}
```

Rederiving each run was chosen over committing the recipe once. A committed
recipe is a second copy of the project's dev setup that drifts the moment
someone changes a port, renames a script, or swaps `npm` for `pnpm` — and it
drifts silently, because nothing runs it except autopilot. A rederived recipe
is always current, so a project that changes its dev setup needs no migration
and no autopilot-specific file to remember to update.

The cost is real and is accepted rather than hidden: **every run pays the
derivation**, and **a wrong derivation is invisible until `verify` parks**.
Nothing checks the recipe at the moment it is written; the first evidence that
`plan` guessed wrong is an infrastructure park several stages later. That is a
worse error message than a config file's, and it is the price of not keeping a
hand-maintained copy of facts the repository already states.

## The base URL is resolved at run time, not written down

`base_url_command` runs **in the worktree, after `dev_command`**, and its
trimmed stdout is the base URL. `waitForServer` then polls that URL until
`ready_timeout_ms`.

The motivating case is a worktree-up script that derives its ports from the
worktree name and **reassigns them when a block is already occupied**. The URL
genuinely cannot be known at the time any config file is written, because it
depends on which other worktrees happen to be running. A static `base_url` is
not merely inconvenient there; it is wrong on the second concurrent run.

The rejected alternative was a `url_pattern` regex scraped from `dev_command`'s
stdout. The command form won on two counts:

- **It subsumes every other mechanism.** Reading an env file, `docker compose
  port`, a `--print-url` flag, grepping a log — all of them are just a shell
  command, and autopilot carries no parsing rules for any of them.
- **Scraping fails for exactly the motivating case.** A setup script of that
  shape wraps its summary in ANSI colour codes and then *exits*, so the URL may
  never appear on the pipe autopilot is holding at the moment it is looking.

The URL is never persisted. It is resolved fresh on every run, which is
precisely what makes reassignable ports work.

## Lifecycle: setup scripts, not a spawned server

Two coupled corrections follow from deriving commands and resolving the URL
late. Both were wrong in the committed design for the same underlying reason:
it assumed `dev_command` *is* the server.

**A zero exit means setup finished, not that the server died.** The committed
design spawns `dev_command` as a child and treats its exit as failure. That is
right for `npm run dev`, which blocks. It is wrong for the far more common
project script that starts docker containers, backgrounds its app processes,
prints a summary and returns 0 — which the old rule reads as a crash on a
perfectly healthy stack. Only a **non-zero** exit is an infrastructure park;
whether the server is actually up is answered by `waitForServer` against the
resolved URL, which is the question that actually matters.

**Teardown runs `stop_command` in a `finally`**, falling back to killing the
spawned child only when the recipe supplies no stop command. Without this, a
script that starts docker containers and backgrounds app processes leaks its
entire stack after every run: the child autopilot holds has already exited, so
there is nothing left to signal, and the containers outlive the run
indefinitely. The process-group kill is retained as the fallback for the
blocking-server case, where it remains correct — a dev server that spawns a
child compiler must be signalled as a group or the port stays held and the next
run times out against a stale server on a healthy branch.

## Nothing generated here enters the repository

E2E specs and mock fixtures are worth exactly one run. They go to
`.superpowers/autopilot/<run>/verify/` in the **main checkout** — gitignored,
outside the worktree, and untouched by the reaper that deletes worktrees after
merge. The repository never carries a per-PR test. The derived `recipe.json`
lives in the same directory for the same reasons.

This forced one non-obvious mechanism. Node resolves `@playwright/test` by
walking up from the importing file, which from the run directory never reaches
the project's `node_modules`. The script symlinks the project's tree into the
run directory so the walk finds it one level up. Without this every spec fails
to import, Playwright reports "No tests found", and the run reads as a feature
whose criteria were merely never covered — a false negative that looks exactly
like a true one. It was found by running the stage end to end, not by reading
the code.

## Playwright CLI, not a browser tool

Three modes were available: a Playwright MCP browser tool, the Playwright CLI,
and a hosted agent browser.

The MCP tool returns a full accessibility snapshot into the agent's context on
every interaction, so a six-step flow can consume the stage's entire budget.
The CLI costs roughly the spec file the agent authors. Since the stage runs as
a dispatch, an expensive driver does not compact the controller — it compacts
the verification agent mid-stage, which fails quietly by running out of room
three criteria into six and guessing the rest.

The usual objection to CLI-only is authoring selectors blind. That does not
apply here: the `sdd` stage wrote the UI in this same run, so locators come
from the worktree source, which is both cheaper and more accurate than the
rendered tree. Moving `verify` earlier strengthens this, not weakens it: the
source the locators come from is now the tree that was just written.

A hosted agent browser is equally cheap from the controller's seat, since its
observation loop runs elsewhere. It lost on three other axes. Its verdict is a
model judgment — "the form submitted successfully" — which is the false green
the `test_command` rule already exists to prevent. Re-running it after a fix
re-runs a *prompt*, so a pass cannot be distinguished from a more lenient
reading of the same broken page. And it cannot intercept network requests,
which is how throwaway mock data is supposed to work.

The driver is therefore not configurable in this version. A single-value enum
is dead surface: it needs validation, a park branch, and a test for a path
nothing exercises. Adding the second driver later is purely additive — an
absent key means Playwright.

## Failure taxonomy

The script's exit code distinguishes failures that earn a fix round from ones
that do not, because "non-zero" collapses very different situations. The table
is remapped now that "unconfigured" no longer exists as a state — there is
nothing to configure, so there is nothing to half-configure:

| Exit | Meaning | Action |
|---|---|---|
| 0 | Every criterion passed | Continue |
| 1 | A criterion failed | One fix round, then park |
| 2 | Infrastructure | Park — the branch was never exercised |
| 3 | No `(ui)` criteria | Skip |
| 4 | Cannot verify despite `(ui)` criteria | Park |

Exit 4 is where a missing recipe and a missing `@playwright/test` land: the
spec asked for browser verification and the stage could not deliver it.

One fix round mirrors `land`'s conflict resolver: one dispatched attempt, then
a human decides. A stage that retries until green tunes the test to the bug.

Two classifications are deliberate and were both wrong in the first draft:

- **A criterion with no test is a failure, not a pass.** It is this stage
  failing to do its job, and reporting it as success is the exact gap the
  stage was built to close.
- **Zero collected tests is infrastructure, not a criteria failure.** A spec
  that failed to import looks identical to a feature nobody tested. Sending an
  implementer to fix code that was never exercised wastes a round and produces
  a confident, meaningless diff.

## Findings

Each failed criterion appends one line to
`.superpowers/autopilot/<run>/findings.jsonl` in the **main checkout**, under
the **existing seven-field contract** — `task`, `round`, `severity`,
`stage_at_fault`, `pattern`, `detail`, `verdict`. Nothing about that contract
is widened; this stage simply becomes a second producer for it, which is what
makes the corpus comparable across stages and what lets `learnings` — now
downstream — read browser evidence and review evidence in one pass.

`task: 0` is the sentinel for "not a task". Verify is not a numbered SDD task,
but the field is required, and inventing a nullable variant would fork the
contract for one producer.

A fully-passing verify appends `{"task":0,"clean":true}` for the same
absence-of-evidence reason the existing clean-line rule gives: without it, a
run with no findings is indistinguishable from a run whose findings were never
written, and the corpus quietly under-counts every stage that worked.

`stage_at_fault` keeps its existing four values — `brief`, `plan`, `spec`,
`implementation`. A criterion that failed because the spec described the
feature wrong is `spec`, not `implementation`. A fifth value, `verify`, was
considered and **rejected**: the contract is emphatic that `stage_at_fault`
names the stage that *produced the bad input*, not the stage that *surfaced
it*. Adding `verify` would make the field mean two different things depending
on which producer wrote the line, and every consumer that aggregates by stage
would silently start measuring detection instead of causation.

```json
{"task":0,"round":1,"severity":"major","stage_at_fault":"implementation","pattern":"ui criterion failed in browser","detail":"AC1: signed-out click on Save showed no login prompt","verdict":"CONFIRMED"}
```

## Configuration

Split by what is universal and what is local. Process — extracting criteria,
authoring checks, the token contract, the failure taxonomy — lives in the
skill, because it is identical in every project and this plugin is consumed by
several. Commands are no longer local *configuration*; they are local *facts*,
and facts are derived (above). What remains is one key:

```json
"browser": {
  "ready_timeout_ms": 120000
}
```

`ready_timeout_ms` is the only surviving `browser` key, and it survives because
it is a **policy knob, not a discovered fact**. How long a human is willing to
wait before calling a stack dead cannot be read off `package.json`; every other
key could be.

Its default rises from 60000 to 120000. A docker-backed stack does not come up
in sixty seconds, and the old default turned a slow-but-healthy project into an
infrastructure park on its first run — the worst possible first impression for
a stage whose entire value is not lying about what happened.

## Documentation is in scope

The README and the autopilot skill must both carry the enablement sentence:
writing a `(ui)` acceptance criterion turns the stage on. This is not
housekeeping. A feature whose activation rule is only inferable from source is
a feature most users will never knowingly turn on, and the question "how do I
enable browser verification?" deserves a written answer rather than an
archaeological one.

## Known limitation

Screenshots and traces do not reach the PR. `gh pr edit` takes markdown, and an
image renders only from a URL, which would mean committing the files — the one
thing this design refuses. The PR section names the artifact path instead, so a
reviewer who wants the pixels knows where they are. Closing this properly needs
a project-supplied upload hook, deliberately left out of this version.
