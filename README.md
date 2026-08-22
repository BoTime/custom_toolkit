# custom_toolkit

Personal [Claude Code](https://claude.com/claude-code) plugins. The repo is
both the marketplace and the home of the plugins it lists.

## Install

```bash
/plugin marketplace add BoTime/custom_toolkit
/plugin install autopilot@custom-toolkit
```

To update later: `/plugin marketplace update custom-toolkit`.

## Plugins

### autopilot

Takes a task from idea to pull request. Phase 1 is an interactive brainstorm —
clarifying questions one at a time, then a design stated once, with no
approval gate afterward. Phase 2 runs unattended from there through spec,
plan, implementation, landing, and PR.

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

| Key | Default | Purpose |
|---|---|---|
| `test_command` | *(none)* | Verifies the branch after rebase. Unset → `land` parks. |
| `base_ref` | `origin/main` | Branch point and rebase target |
| `worktree_dir` | `.claude/worktrees` | Where run worktrees are created |
| `reaper` | `true` | Prune merged worktrees at `setup` |
| `roles` | see defaults | Per-role `model` and `effort` for the nine dispatch roles |
| `github` | four status names | Projects v2 wiring for `/autopilot-github` only. Ignored by plain `/autopilot`. |

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

## Development

```bash
npm install
npm test                                    # vitest, 268 tests
claude plugin validate ./plugins/autopilot  # manifest check
claude --plugin-dir ./plugins/autopilot     # load locally for one session
```

The plugin's helper scripts use only the Node standard library, so the plugin
ships with zero runtime dependencies; vitest is the sole devDependency.

Scripts bundled with a plugin are referenced through `$CLAUDE_PLUGIN_ROOT`,
which resolves to the plugin's install directory. Paths that belong to the
*user's* project — the run ledger under `.superpowers/`, worktrees, the spec
output — stay project-relative.
