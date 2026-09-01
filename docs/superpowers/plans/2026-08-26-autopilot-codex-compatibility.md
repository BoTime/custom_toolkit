# Autopilot Codex Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Autopilot skill execute its workflow in Codex while preserving Claude Code behavior.

**Architecture:** A host module supplies config paths, defaults, and effort overrides. The existing dispatcher preserves Claude Markdown output and emits a structured Codex record; each skill selects the host protocol while retaining shared templates, ledger, GitHub, and browser tooling.

**Tech Stack:** Node.js ESM, Vitest, JSON, Markdown; no new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-26-autopilot-codex-compatibility-design.md`

## Global Constraints

- Keep Claude's `.claude/autopilot.json`, `.md` output, commands, and stage graph unchanged.
- Use `.codex/autopilot.json` only for Codex project overrides.
- Codex records live at `.superpowers/autopilot/<run>/agents/<stage>.json` and contain `role`, `model`, `reasoning_effort`, and `instructions`.
- Reject unknown hosts and dispatches missing model, effort, or instructions.
- Preserve ledger semantics, park conditions, and the no-runtime-dependency policy.

---

## File Structure

- Create `plugins/autopilot/scripts/autopilot-host.mjs`, `plugins/autopilot/autopilot.codex.default.json`, and `plugins/autopilot/scripts/autopilot-host.test.mjs` for host-specific metadata and tests.
- Modify `plugins/autopilot/scripts/autopilot-config.{mjs,test.mjs}` for explicit host defaults and override behavior.
- Modify `plugins/autopilot/scripts/autopilot-dispatch.{mjs,test.mjs}` and create `plugins/autopilot/scripts/autopilot-codex-contract.test.mjs` for JSON dispatches and skill contracts.
- Modify the three `plugins/autopilot/skills/*/SKILL.md` files, `visual-companion.md`, `README.md`, and packaging contract tests for Codex execution and docs.

## Task 1: Host configuration boundary

**Files:** Create `autopilot-host.mjs`, `autopilot.codex.default.json`, `autopilot-host.test.mjs`; modify `autopilot-config.mjs` and its test.

**Interfaces:**

```js
export const HOSTS = ["claude", "codex"];
export function assertHost(host);
export function hostConfigPath(host);
export function hostDefaultsPath(host);
export function hostEffortOverride(host, env);
```

- [ ] Write failing tests asserting `hostConfigPath("claude") === ".claude/autopilot.json"`, `hostConfigPath("codex") === ".codex/autopilot.json"`, Codex's effort override is read from `CODEX_REASONING_EFFORT`, and `assertHost("cursor")` throws.
- [ ] Run `npx vitest run plugins/autopilot/scripts/autopilot-host.test.mjs`; expect failure because the module is absent.
- [ ] Implement the module and Codex defaults. Every `ROLES` entry must define a valid Codex model plus one of `low`, `medium`, `high`, `xhigh`, `max`; use `gpt-5.6` for high-complexity roles and `gpt-5.4` for routine roles.
- [ ] Extend `loadConfig(path, env, readFile, defaultsPath, { host })` so existing Claude calls retain their defaults, Codex selects its defaults, and warnings name the passed config path.
- [ ] Add tests for Codex per-role override, independent `.codex` merge, unknown host, and effort override; run `npx vitest run plugins/autopilot/scripts/autopilot-host.test.mjs plugins/autopilot/scripts/autopilot-config.test.mjs` and expect pass.
- [ ] Commit with `git add plugins/autopilot/scripts/autopilot-host.mjs plugins/autopilot/scripts/autopilot-host.test.mjs plugins/autopilot/autopilot.codex.default.json plugins/autopilot/scripts/autopilot-config.mjs plugins/autopilot/scripts/autopilot-config.test.mjs && git commit -m "feat(autopilot): add host-aware configuration"`.

## Task 2: Codex structured stage dispatch

**Files:** Modify `autopilot-dispatch.mjs` and its test; create `autopilot-codex-contract.test.mjs`.

**Interfaces:**

```js
export function codexOutputPath(run, stage) {
  return `.superpowers/autopilot/${run}/agents/${stage}.json`;
}
export function composeCodexDispatch({ stage, config, values, fragmentReader, worktreeHas }) {
  return { role, model, reasoning_effort, instructions };
}
```

- [ ] Write failing tests expecting a `pr` record with `role: "implement"`, a string model, `reasoning_effort: "high"`, and `instructions` containing `PR STAGE`; expect its output path to end in `pr.json`.
- [ ] Run `npx vitest run plugins/autopilot/scripts/autopilot-dispatch.test.mjs plugins/autopilot/scripts/autopilot-codex-contract.test.mjs`; expect failure because Codex dispatch does not exist.
- [ ] Add reserved `--host=claude|codex` parsing. Claude keeps the existing `compose()` output byte-compatible. Codex uses the same rendered templates/fragments, writes only the JSON record, and maps its existing role `effort` to `reasoning_effort`.
- [ ] Add failure tests for unknown host, missing model, missing effort, unfilled placeholder, and unconsumed flag; assert no record is written. Assert current Claude fixture still writes frontmatter to `<stage>.md`.
- [ ] Run `npx vitest run plugins/autopilot/scripts/autopilot-dispatch.test.mjs plugins/autopilot/scripts/autopilot-dispatch-contract.test.mjs plugins/autopilot/scripts/autopilot-codex-contract.test.mjs`; expect pass.
- [ ] Commit with `git add plugins/autopilot/scripts/autopilot-dispatch.mjs plugins/autopilot/scripts/autopilot-dispatch.test.mjs plugins/autopilot/scripts/autopilot-codex-contract.test.mjs && git commit -m "feat(autopilot): compose Codex stage dispatches"`.

## Task 3: Host-aware skill execution

**Files:** Modify `skills/autopilot/SKILL.md`, `skills/autopilot-github/SKILL.md`, `skills/autopilot-brainstorm/SKILL.md`, `skills/autopilot-brainstorm/visual-companion.md`, and `autopilot-codex-contract.test.mjs`.

**Codex dispatch protocol:**

```text
Run autopilot-dispatch with --host=codex and --config=.codex/autopilot.json.
Read the resulting JSON record.
Call spawn_agent with task_name `${record.role}-${stage}`, message record.instructions,
model record.model, and reasoning_effort record.reasoning_effort.
Use the existing ledger rule to record the stage result.
```

- [ ] Write failing prose contracts that require `--host=codex` and `spawn_agent` in the core skill, `.codex/autopilot.json` in GitHub skill, Codex visual-companion guidance in brainstorm, and no Claude-only `Agent tool` claim in the Codex branch.
- [ ] Run `npx vitest run plugins/autopilot/scripts/autopilot-codex-contract.test.mjs`; expect failure because no Codex-native instructions exist.
- [ ] Update the core skill's preflight and every dispatch example to select the matching host config and protocol. Codex instructions must not use Claude frontmatter, `opus`, `sonnet`, or the Claude worktree Write/Edit caveat.
- [ ] Update GitHub preflight/delegation to use the selected config; make brainstorm's browser wording host-neutral while retaining its existing Codex foreground process handling.
- [ ] Run `npx vitest run plugins/autopilot/scripts/autopilot-codex-contract.test.mjs plugins/autopilot/scripts/autopilot-github-contract.test.mjs plugins/autopilot/scripts/autopilot-no-design-gate.test.mjs`; expect pass.
- [ ] Commit with `git add plugins/autopilot/skills/autopilot plugins/autopilot/skills/autopilot-github plugins/autopilot/skills/autopilot-brainstorm plugins/autopilot/scripts/autopilot-codex-contract.test.mjs && git commit -m "feat(autopilot): add Codex-native skill execution"`.

## Task 4: Package and verify

**Files:** Modify `README.md` and `autopilot-findings-contract.test.mjs`; verify `.codex-plugin/plugin.json` and `.agents/plugins/marketplace.json`.

- [ ] Write a failing package assertion that reads `.agents/plugins/marketplace.json` and requires its `autopilot` entry to have `{ source: { source: "local", path: "./plugins/autopilot" } }`.
- [ ] Run `npx vitest run plugins/autopilot/scripts/autopilot-findings-contract.test.mjs`; expect failure until that assertion is added.
- [ ] Document the actual Codex prerequisites: marketplace installation, a new thread, compatible Superpowers dependencies, and `.codex/autopilot.json` overrides. Do not claim compatibility before Task 3 passes.
- [ ] Run `/tmp/autopilot-plugin-validator/bin/python /Users/bo/workspace/bay-area-chinese-movies/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/autopilot`, `npm test`, and `git diff --check`; expect all to pass.
- [ ] Commit with `git add README.md plugins/autopilot/scripts/autopilot-findings-contract.test.mjs plugins/autopilot/.codex-plugin/plugin.json .agents/plugins/marketplace.json && git commit -m "docs(autopilot): document Codex workflow support"`.

## Plan Self-Review

- Tasks 1–2 implement the host/config and dispatch protocol required by the spec.
- Task 3 covers all three plugin skills and Codex-native execution.
- Task 4 covers packaging, documentation, and final validation.
- All defined interfaces use the same host names, config paths, and record property names.
