# Relocate autopilot's project files under `.superpowers/autopilot/`

## Goal

Autopilot keeps its project files in two homes today: the project config at
`.claude/autopilot.json` (`.codex/autopilot.json` on Codex), sharing a directory
with unrelated harness settings, and per-run state at
`.superpowers/autopilot/<run>/`, sitting directly under the `autopilot` root so a
run name occupies the same namespace anything else would.

The split is arbitrary, and the run directory has no room to grow: any durable
project file added under `.superpowers/autopilot/` would collide with the run
names already there. This change gives autopilot one root with an explicit
durable-versus-ephemeral split.

| What | Today | After |
|---|---|---|
| Project config (Claude) | `.claude/autopilot.json` | `.superpowers/autopilot/configs/autopilot.json` |
| Project config (Codex) | `.codex/autopilot.json` | `.superpowers/autopilot/configs/autopilot.codex.json` |
| Per-run state | `.superpowers/autopilot/<run>/` | `.superpowers/autopilot/runs/<run>/` |

Everything inside a run directory keeps its current internal shape — `run.md`,
`questions.jsonl`, `findings.jsonl`, `design.md`, `spec.md`, `criteria-source.md`,
`land.txt`, `pr-body.md`, `agents/`, and `verify/` with its `recipe.json`,
`pr-section.md`, `failures.md` and `artifacts/`. Only the prefix changes.

The Codex host follows the same rule rather than keeping its own directory, so
the host/config pairing selected at preflight stays a single decision instead of
becoming two. The two hosts' configs are distinguished by filename, mirroring the
shipped defaults (`autopilot.default.json` / `autopilot.codex.default.json`).

## Git tracking

The durable/ephemeral split exists because of how git and worktrees interact.

- **Configs are tracked.** A git worktree contains only committed files, and the
  stage agents run inside the worktree. A config that is not committed is
  invisible exactly where it is read.
- **Runs stay ignored.** They are rederived every run and are per-machine.

`.superpowers/` is ignored wholesale in projects that use autopilot, and git
cannot un-ignore a file inside an excluded directory, so tracking `configs/`
needs the parent-directory dance — un-ignore each parent before re-ignoring its
contents:

```
# autopilot keeps its project config under .superpowers/, which is otherwise
# ignored. git cannot un-ignore a file inside an excluded directory, so each
# parent is un-ignored before its contents are re-ignored. Runs stay ignored:
# they are rederived every run and are per-machine.
!.superpowers/
.superpowers/*
!.superpowers/autopilot/
.superpowers/autopilot/*
!.superpowers/autopilot/configs/
```

Appended after an existing `.superpowers/` line, this tracks
`.superpowers/autopilot/configs/**` and leaves `.superpowers/autopilot/runs/`,
`.superpowers/autopilot/rules.md`, `.superpowers/brainstorm/` and
`.superpowers/sdd/` ignored. (Verified against a scratch repo before writing this
spec: `git add -A` stages `.gitignore` and the config, and nothing else.)

## Path resolution

A new module, `plugins/autopilot/scripts/autopilot-paths.mjs`, becomes the one
place the `.superpowers/autopilot` literal is spelled. It exports the roots
(`AUTOPILOT_ROOT`, `CONFIGS_DIR`, `RUNS_ROOT`) and:

- `runDir(run)` — `.superpowers/autopilot/runs/<run>`
- `legacyRunDir(run)` — `.superpowers/autopilot/<run>`
- `resolveRunDir(run, { exists })` — returns `{ dir, legacy }`: the new directory
  when `runs/<run>/run.md` exists, else the legacy directory when `<run>/run.md`
  exists, else the new directory (the canonical home for a run about to start).

`autopilot-host.mjs` keeps ownership of the host-keyed decision and builds on
those constants:

- `hostConfigPath(host)` now returns the `configs/` path for the host.
- `legacyHostConfigPath(host)` returns the old harness-directory path.
- `resolveConfigPath(host, { exists })` returns `{ path, legacy }` with the same
  new-then-legacy-then-new precedence.

Every script that today defaults a config path to a `.claude/autopilot.json` /
`.codex/autopilot.json` literal defaults to `resolveConfigPath(host).path`
instead: `autopilot-session.mjs`, `autopilot-verify.mjs`,
`autopilot-github-issue.mjs`, and `autopilot-dispatch.mjs` (which already calls
`hostConfigPath`). Prose inside error messages in `autopilot-github-issue.mjs`
and `autopilot-artifacts.mjs` names the new path. Every script that constructs a
run path builds it from `autopilot-paths.mjs`: `autopilot-dispatch.mjs`
(`agentPath`, `agentJsonPath`), `autopilot-findings.mjs` and
`autopilot-questions.mjs` (their default report roots become `RUNS_ROOT`).

## Back-compat

A read fallback, not a migration prompt.

Config resolution tries `configs/` first and falls back to the old
harness-directory path, so a project that has not moved keeps working across the
release. An explicit `--config` flag keeps overriding both. Run-state resolution
does the same, so a resume against an in-flight run started before the move finds
its ledger and is not stranded mid-pipeline.

The fallback is a deprecation, not a permanent second path. `loadConfig` compares
the path it actually loaded a project config from against
`legacyHostConfigPath(host)` for either host, and when they match pushes a
warning naming both the file and where to move it. The warning rides the existing
`warnings` channel, which preflight already prints, so no new plumbing is needed.
The resume prose reports the same when `resolveRunDir` returns `legacy: true`.

## Scaffolder

`scaffoldConfig` in `autopilot-config.mjs` learns the new location and two new
responsibilities:

1. It creates the parent directory. `.claude/` and `.codex/` already existed
   whenever the plugin ran; `.superpowers/autopilot/configs/` does not. A `mkdir`
   dependency is injected the same way `readFile` / `writeFile` / `exists`
   already are, defaulting to a recursive `mkdirSync` of the path's dirname.
2. It writes the ignore rules when they are absent, through a new exported
   `ensureIgnoreRules(gitignorePath, deps)` that returns `{ path, changed }`.
   Absent rules are appended as the commented block above; rules already present
   are left alone and `changed` is `false`. Rerunning the scaffolder on a project
   that already has the rules changes nothing.

Both stay injectable so the unit tests run without touching disk. The refusal to
overwrite an existing config is unchanged.

Preflight step 4 in `plugins/autopilot/skills/autopilot/SKILL.md` reports the
created config path and the gitignore change, and now tells the developer to
**commit** the config rather than leaving it uncommitted — a config a worktree
cannot see is a config the stage agents cannot read. The scaffold-branch contract
test in `autopilot-config-scaffold-contract.test.mjs` currently asserts the
opposite sentence (`"The file is left uncommitted on the current branch"`) and is
updated with it.

## Markdown

Every skill and command file that states a path states the new one:
`skills/autopilot/SKILL.md`, `skills/autopilot-github/SKILL.md`,
`skills/autopilot-brainstorm/SKILL.md`, `commands/autopilot-findings.md`,
`skills/autopilot/references/stages/claude-dispatch.md`,
`references/stages/codex-dispatch.md`, `references/stages/verify-run.md`,
`references/dispatch/learnings.md`, `references/dispatch/sdd-findings.md`,
`references/dispatch/sdd-model-map.md`, `references/dispatch/sdd-verification.md`,
and the repository `README.md`. The contract tests that assert those path strings
(`autopilot-codex-contract`, `autopilot-verify-contract`,
`autopilot-questions-contract`, `autopilot-dispatch-contract`) move with them.

The corpus glob in `references/dispatch/learnings.md` becomes
`.superpowers/autopilot/runs/*/findings.jsonl`; left as-is it would match the
`runs` directory itself and miss every run.

## This repository

`custom_toolkit` dogfoods the plugin, so its own config moves in the same change:
`git mv .claude/autopilot.json .superpowers/autopilot/configs/autopilot.json`, the
`!.claude/autopilot.json` un-ignore is dropped from `.gitignore` (the `.claude/*`
ignore stays), and the ignore block above is added.

## Unchanged

- `.superpowers/autopilot/rules.md` stays where it is. It is not named in this
  change, and under the new ignore rules it remains ignored exactly as today.
- Historical specs and plans under `docs/superpowers/` are records of what was
  true when written and keep their original paths.
- Version fields are never hand-edited and no test asserts a version literal.

## Out of scope

The test-data convention that motivated this work — a project advertising the
grades of test data it offers in `.superpowers/autopilot/configs/test-data.md`,
with the scripted seed as the default profile and the plan stage choosing among
them. That lands in a follow-up run on top of this settled layout.

## Acceptance criteria

- AC1 (non-ui) — `hostConfigPath("claude")` is `.superpowers/autopilot/configs/autopilot.json` and `hostConfigPath("codex")` is `.superpowers/autopilot/configs/autopilot.codex.json`; an unknown host still throws the existing `assertHost` error
- AC2 (non-ui) — `resolveConfigPath` returns the `configs/` path when it exists, the legacy harness path when only that exists, and the `configs/` path when neither exists; `autopilot-session.mjs`, `autopilot-verify.mjs`, `autopilot-github-issue.mjs` and `autopilot-dispatch.mjs` default their config path through it, and an explicit `--config` still overrides both
- AC3 (non-ui) — `loadConfig` on a project config at a legacy harness path returns a warning naming that file and the new `configs/` location, and returns no such warning when the config is at the new path
- AC4 (non-ui) — `runDir("r1")` is `.superpowers/autopilot/runs/r1`, and dispatch writes stage artifacts to `.superpowers/autopilot/runs/<run>/agents/<stage>.md` (Claude) and `.../agents/<stage>.json` (Codex); the findings and questions report roots default to `.superpowers/autopilot/runs`
- AC5 (non-ui) — `resolveRunDir` reports `{ legacy: false }` for a run with `runs/<run>/run.md`, `{ legacy: true }` for one with only `<run>/run.md`, and the new directory when neither exists
- AC6 (non-ui) — `scaffoldConfig` creates `.superpowers/autopilot/configs/` before writing, writes the host's shipped defaults with `test_command: ""` leading as it does today, and still refuses to overwrite an existing file
- AC7 (non-ui) — `ensureIgnoreRules` appends the five-rule block to a `.gitignore` that lacks it and reports `changed: true`; run again on the result it writes nothing and reports `changed: false`
- AC8 (non-ui) — with those rules in place, `.superpowers/autopilot/configs/autopilot.json` is tracked by git while `.superpowers/autopilot/runs/`, `.superpowers/autopilot/rules.md` and `.superpowers/brainstorm/` stay ignored
- AC9 (non-ui) — no skill, command, reference or README file states a run path under `.superpowers/autopilot/<run>` or a config path under `.claude/`|`.codex/` any more, except where it names the legacy path as the deprecated fallback; the learnings corpus glob is `.superpowers/autopilot/runs/*/findings.jsonl`
- AC10 (non-ui) — preflight step 4 in `skills/autopilot/SKILL.md` names the new config location and instructs the developer to commit the scaffolded config, and its contract test asserts the commit instruction instead of the removed "left uncommitted" sentence
- AC11 (non-ui) — this repository's own config is tracked at `.superpowers/autopilot/configs/autopilot.json`, `.claude/autopilot.json` is gone, and `.gitignore` carries the ignore block without the `!.claude/autopilot.json` line
- AC12 (non-ui) — files under `docs/superpowers/specs/` and `docs/superpowers/plans/` are unchanged apart from this spec, and no version literal is asserted anywhere
- AC13 (non-ui) — `npm test` passes
