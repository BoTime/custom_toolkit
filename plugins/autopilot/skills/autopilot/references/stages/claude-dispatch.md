# Claude dispatch protocol

Read this on a Claude run, once, before the first dispatch. A Codex run never
needs it.

The printed path is `.superpowers/autopilot/<run>/agents/<stage>.md`. It is the
subagent definition; dispatch the Agent by that printed path. The Agent tool has
no `effort` parameter, so the definition's frontmatter carries it.

Do not read the composed definition. Dispatching it by path is what keeps its
text out of the orchestrator's context, which is the whole point of composing
it in a script.

**Worktree caveat:** a worktree-isolated Claude session cannot Write or Edit
files in the main checkout, though **Bash appends (`>>`) and redirects still
work**. Use Bash for `run.md`, `findings.jsonl`, and everything under `verify/`.
