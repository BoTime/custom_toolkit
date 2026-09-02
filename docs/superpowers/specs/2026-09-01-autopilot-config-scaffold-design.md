# Scaffold the project config from plugin defaults at preflight

## Goal

When `/autopilot` runs in a project with no `<config>` file (`.claude/autopilot.json` on Claude Code, `.codex/autopilot.json` on Codex), preflight materializes that host's full shipped plugin defaults into the project so every knob — including per-role model and effort selection — is visible and editable. The project pins those values from then on; that trade-off is accepted (a project holding a copied file stops tracking later plugin-default changes until the developer edits it).

Context: the plugin already ships a complete defaults file per host (`plugins/autopilot/autopilot.default.json` and `plugins/autopilot/autopilot.codex.default.json`), resolved by `hostDefaultsPath(host)` in `autopilot-host.mjs`, and `loadConfig` in `autopilot-config.mjs` layers the project's optional file over it per key. A project with no file already runs on all defaults; what is missing is that the developer never sees them. No separate template file is introduced — the shipped defaults file *is* the template.

## Scaffold function

`plugins/autopilot/scripts/autopilot-config.mjs` exports a new function:

```
scaffoldConfig(path, { host = "claude", readFile, writeFile, exists })
```

- Throws if `path` already exists (never overwrites, even a malformed file).
- Reads the selected host's shipped defaults via the existing `hostDefaultsPath(host)`.
- Builds an object whose first key is `test_command: ""`, followed by every default key in the shipped file's order. The empty string is the placeholder: the existing validator already treats `""` as unset, so the scaffolded file loads with exactly the single `test_command` warning an absent file produces today.
- Writes the object as two-space-indented JSON with a trailing newline.
- Returns the written path.
- No merging, no interpretation, no validation on write: the shipped defaults are already valid.
- Dependencies (`readFile`, `writeFile`, `exists`) are injectable the same way `loadConfig` takes `readFile`, so unit tests run without touching disk; the defaults are `node:fs` equivalents.
- Reuses `assertHost` semantics via `hostDefaultsPath`, so an unknown host throws the existing error.

## Preflight change

Step 4 ("Config is valid") of `plugins/autopilot/skills/autopilot/SKILL.md` gains a check **before** the existing validate command:

- If the selected `<config>` is absent, run a one-line `node -e` against the plugin root that calls `scaffoldConfig(<config>, { host: <host> })`, then report two things and **stop the run**: the created path, and that `test_command` must be filled in before rerunning `/autopilot`. The file is left uncommitted on the current branch; committing it is the developer's decision. Do not start the brainstorm.
- If the file exists, step 4 proceeds exactly as today.
- The trailing sentence "A project with no config file runs on that host's defaults" is rewritten to say that a plain `/autopilot` run scaffolds the file and stops instead.

Scope: only the `/autopilot` preflight changes. `/autopilot-github` inherits the behavior because it reaches the autopilot preflight once it hands off. `/autopilot-findings` and `loadConfig` itself are unchanged and still run on plugin defaults when the file is absent.

## Error handling

- An existing file is never overwritten, even if malformed; `scaffoldConfig` throws naming the path.
- An unwritable directory surfaces the write error and stops, like any other preflight failure. `scaffoldConfig` does not create parent directories beyond what `writeFile` needs; on Claude Code the `.claude/` directory already exists whenever the plugin runs, and on Codex `.codex/` likewise — if it does not, the error names the path.

## Testing

Unit tests in `plugins/autopilot/scripts/autopilot-config.test.mjs`, using injected `readFile`/`writeFile`/`exists`:

1. On host `claude`, writes the Claude defaults plus the leading `test_command: ""` placeholder.
2. On host `codex`, writes the Codex defaults (reads the codex defaults path).
3. Refuses to overwrite when `exists` reports the file present; `writeFile` is never called.
4. Output round-trips through `loadConfig` with `ok` and exactly one warning, the `test_command` one.
5. Key order: `test_command` is the first key in the written JSON; the remaining keys follow the shipped defaults' order.
6. Written text is two-space-indented and ends with a newline.

A contract test on the skill prose (beside the existing `autopilot-*-contract.test.mjs` files, e.g. `autopilot-config-scaffold-contract.test.mjs` or added to an existing config-related contract test) asserts that preflight step 4 names the `scaffoldConfig` call and the stop-after-create instruction, matching the existing contract-test pattern that reads `SKILL.md` and checks for required phrases.

## Acceptance criteria

- AC1 (non-ui) — `scaffoldConfig` on host `claude` writes the Claude shipped defaults with `test_command: ""` as the first key, the remaining keys in the shipped file's order, two-space indentation, and a trailing newline
- AC2 (non-ui) — `scaffoldConfig` on host `codex` reads and writes the Codex shipped defaults; an unknown host throws the existing `assertHost` error
- AC3 (non-ui) — `scaffoldConfig` throws naming the path when the file already exists, and `writeFile` is never called
- AC4 (non-ui) — the scaffolded file loads through `loadConfig` with `ok` and exactly one warning, the `test_command` one
- AC5 (non-ui) — the autopilot skill's preflight step 4 instructs: if `<config>` is absent, call `scaffoldConfig` for the selected host, report the created path and the `test_command` instruction, and stop the run without starting the brainstorm; a contract test asserts those phrases in `SKILL.md`
- AC6 (non-ui) — `npm test` stays green, including the existing config and contract tests, and no version literal is asserted anywhere
