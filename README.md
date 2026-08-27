# custom_toolkit

Personal [Claude Code](https://claude.com/claude-code) and Codex plugins. The
repo is both the marketplace and the home of the plugins it lists.

## Install

```bash
/plugin marketplace add BoTime/custom_toolkit
/plugin install autopilot@custom-toolkit
```

To update later: `/plugin marketplace update custom-toolkit`.

### Codex

```bash
codex plugin marketplace add BoTime/custom_toolkit
codex plugin add autopilot@custom-toolkit
```

After installing or updating the plugin, start a new Codex thread so its
skills are discovered. Autopilot's full staged workflow also requires its
companion workflow skills to be installed in Codex.

## Plugins

### autopilot

Takes a task from idea to pull request. Phase 1 is an interactive brainstorm —
clarifying questions one at a time, then a design stated once, with no
approval gate afterward. Phase 2 runs unattended from there through spec,
plan, implementation, browser verification, landing, and PR.

```
/autopilot <task description>
/autopilot resume <branch>
/autopilot-github <issue-number-or-URL>
/autopilot-github resume <run>
```

Provides three skills — `autopilot` (the orchestrator), `autopilot-brainstorm`
(Phase 1, a fork of `superpowers:brainstorming` that hands its design back in
conversation rather than writing a spec file, and drops the design-approval gate
so Phase 2 starts as soon as the questions are answered), and `autopilot-github`
(a thin wrapper that resolves a GitHub issue into the task description and run
name, then drives `autopilot` unchanged while moving the issue's Projects v2
card Ready → In Progress → In Review and commenting on the issue at each
transition). `autopilot-github` needs the `github` config block below; plain
`/autopilot` ignores it entirely.

**Requires** the `superpowers` plugin: autopilot's preflight checks for
`writing-plans`, `subagent-driven-development`, `requesting-code-review`,
`finishing-a-development-branch`, and `using-git-worktrees`, and stops if any
is missing. It also needs a git repo with an `origin` remote and a working
`gh auth status`.

#### Configuration

Config resolves in two layers: the plugin's
[`autopilot.default.json`](plugins/autopilot/autopilot.default.json), with the
project's optional `.claude/autopilot.json` layered over it. The merge is per
key, and per role within `roles` — so overriding one role's model leaves its
effort and the other eight roles intact.

Most projects need only one key:

```json
{
  "test_command": "npm test"
}
```

`test_command` is the one setting with **no default**, because no default is
safe: guessing `npm test` in a Python repo fails confusingly, and skipping
tests silently is worse — the post-rebase test run is the only thing that
catches semantic conflicts (task A renames a function, task B adds a caller of
the old name, git reports nothing, the branch is broken). Unset, preflight
warns and the `land` stage parks rather than reporting green.

#### Ceremony tiers

Phase 1 classifies the work into one of three tiers, and states it in the same
message as the approaches so you can override it there. A tier binds one
thing: **how far the `plan` stage may decompose the work**, and — at a single
task — whether the run needs two reviews or one.

| Tier | The work is | Plan ceiling | Escalates to |
|---|---|---|---|
| `small` | confined to one module, satisfying one acceptance criterion | 1 task | `standard`, once |
| `standard` | more than one reviewable diff, not spanning separate subsystems | 3 tasks | `large`, once |
| `large` | genuinely spanning separate subsystems | 5 tasks | — |

**A tier never decides which documents get written.** `spec` and `plan` run on
every tier without exception. Across this repository's findings corpus, 36 of
39 review findings — and every major one — were defects in the spec or the
plan, caught in prose before they became code. The document that catches them
is not the ceremony worth cutting; decomposition is.

A plan that finds its tier too tight escalates one step on its own, opens with
an `## Escalation` heading naming the reason, and the run records
`tier escalated: small → standard — <reason>` in its ledger. It never parks and
never asks. Each escalation entry is a labelled classifier miss, so the ledgers
say over time whether Phase 1 is judging complexity well.

Ceilings are tunable, merged per key like `roles`:

```json
{
  "tiers": {
    "small": 1,
    "standard": 3,
    "large": 5
  }
}
```

A project that widens `standard` to 4 gets a plan prompt that says 4. Omitting
the block entirely, or resuming a run whose ledger predates tiering, composes
the untiered budget of 1–5 tasks with two-stage review — absence resolves
toward more ceremony, never less.

#### Turning browser verification on

**Writing a `(ui)` acceptance criterion in the spec turns it on.** There is no
flag and nothing to configure:

```markdown
## Acceptance criteria

- AC1 (ui) — a signed-out visitor clicking "Save" sees the login prompt
- AC2 (non-ui) — POST /items rejects an empty title with 422
```

The `verify` stage — between `sdd` and `learnings` — then drives Playwright
against the running app and reports each criterion in the PR. A repo that
writes no `(ui)` criterion never pays for it, and the stage never speaks. What
the app needs is `@playwright/test` as a devDependency, with its browsers
installed; autopilot never installs it. The commands that bring the app up are
**derived**, not configured: the `plan` stage reads `package.json`, compose
files, `scripts/` and the README, and writes a per-run recipe under
`.superpowers/`. A declared `(ui)` criterion the stage cannot verify parks the
run rather than reporting green.

| Key | Default | Purpose |
|---|---|---|
| `test_command` | *(none)* | Verifies the branch after rebase. Unset → `land` parks. |
| `base_ref` | `origin/main` | Branch point and rebase target |
| `worktree_dir` | `.claude/worktrees` | Where run worktrees are created |
| `reaper` | `true` | Prune merged worktrees at `setup` |
| `roles` | see defaults | Per-role `model` and `effort` for the nine dispatch roles |
| `browser.ready_timeout_ms` | `120000` | How long `verify` waits for the app to answer before calling the stack dead |
| `minimalism.mode` | `off` | `off` / `lite` / `full` — injects a YAGNI ladder into the `plan` and `sdd` dispatch prompts. At `off` both prompts are unchanged. |
| `github` | four status names | Projects v2 wiring for `/autopilot-github` only. Ignored by plain `/autopilot`. |
| `artifacts` | *(none)* | Where `verify` publishes its screenshots. Absent → screenshots stay local and the PR body is text-only. |

`/autopilot-github` additionally needs the two keys that cannot be guessed. The
four status names merge per key from the defaults, so this is usually the whole
block:

```json
{
  "test_command": "npm test",
  "github": {
    "project_owner": "BoTime",
    "project_number": 7
  }
}
```

`status_field` (`Status`), `status_ready` (`Ready`), `status_in_progress`
(`In Progress`), and `status_in_review` (`In Review`) default to those values and
only need overriding if your board names them differently. A missing
`project_owner` or `project_number` stops `/autopilot-github` at preflight,
naming the key — it never guesses.

`CLAUDE_CODE_EFFORT_LEVEL` in the environment overrides every configured
effort level.

#### Publishing verify screenshots (optional)

`verify` always captures one browser screenshot per `(ui)` criterion into the
run directory. With an `artifacts` block it also uploads each one to an
S3-compatible bucket (Cloudflare R2) and renders it in the PR body — and, under
`/autopilot-github`, in the issue thread:

```json
{
  "artifacts": {
    "env_file": "apps/api/.env",
    "bucket": "autopilot-artifacts",
    "public_base_url": "https://pub-XXXXXXXX.r2.dev"
  }
}
```

| Key | Purpose |
|---|---|
| `env_file` | Project-relative path to the env file holding the credentials |
| `bucket` | The bucket the screenshots are written to |
| `public_base_url` | The bucket's public URL, which the rendered links are built from. R2 assigns this per bucket; it cannot be derived from the account id |

**No credential goes in `.claude/autopilot.json`.** The three the signer needs —
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` — are read from
the env file named above, which is the project's own and already git-ignored.
Autopilot never writes them anywhere: not into the repository, the PR body, an
issue comment, a ledger entry or a skip reason, which name keys and variables
only. `R2_BUCKET` in that same file names the *application's* bucket and is
deliberately not read, so test evidence never lands in production storage.

**An r2.dev public development URL is world-readable.** Anything visible in a
verified screenshot — seeded user data, an internal admin surface — is public to
anyone with the link. Point `artifacts` at a bucket whose contents you are
willing to make public.

The block is entirely optional and nothing about it can park a run. With no
`artifacts` block, or with an unreadable env file, a missing credential or a
failed upload, the run degrades to exactly the text-only PR section it produced
before screenshots existed.

#### Pointing ponytail at autopilot's own roles (optional)

[ponytail](https://github.com/DietrichGebert/ponytail) is a separate YAGNI
decision-ladder plugin that injects its ruleset into spawned subagents. It is
**optional and never required** — autopilot ships its own minimalism ladder
under `minimalism.mode` above, with no dependency on ponytail, no preflight
check for it and no version pin.

If you do install it, scope its subagent hook to autopilot's own stage roles:

```sh
export PONYTAIL_SUBAGENT_MATCHER='^autopilot-(plan|implement|implement_complex)$'
```

That matcher deliberately **excludes the three reviewer roles** — `task_review`,
`re_review` and `final_review` — for the same reason autopilot's own `sdd`
contract withholds its ladder from them: a reviewer told the best code is the
code you never wrote reads a thin implementation as discipline rather than as a
gap, and rigor is the entire point of those roles. ponytail's own default when
`PONYTAIL_SUBAGENT_MATCHER` is unset is **all** subagents, reviewers included,
so the variable must be **set** rather than omitted if you want them protected.

This reaches autopilot's own stage agents only. The nested implementers inside
`subagent-driven-development` all run as identically-named `general-purpose`
subagents, so no matcher can single them out; `minimalism.mode` is what covers
that depth.

## Development

```bash
npm install
npm test                                    # vitest, 498 tests
claude plugin validate ./plugins/autopilot  # manifest check
claude --plugin-dir ./plugins/autopilot     # load locally for one session
```

The plugin's helper scripts use only the Node standard library, so the plugin
ships with zero runtime dependencies; vitest is the sole devDependency.

Scripts bundled with a plugin are located from the skill's base directory,
which resolves to the plugin's install directory in either host. Paths that
belong to the *user's* project — the run ledger under `.superpowers/`,
worktrees, the spec output — stay project-relative.
