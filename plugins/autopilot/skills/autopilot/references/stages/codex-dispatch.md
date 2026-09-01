# Codex dispatch protocol

Read this on a Codex run, once, before the first dispatch. A Claude run never
needs it.

The concrete composition prefix is:

```bash
node "$AP/scripts/autopilot-dispatch.mjs" <stage> \
  --run=<run> --host=codex --config=.codex/autopilot.json [--key=value ...]
```

The printed path is `.superpowers/autopilot/<run>/agents/<stage>.json`. Read
that JSON record, then call `spawn_agent` with `task_name`
`${record.role}-${stage}`, `message` `record.instructions`, `model`
`record.model`, and `reasoning_effort` `record.reasoning_effort`; set
`fork_turns` `"none"` so Codex accepts those explicit model settings and relies
only on the self-contained rendered instructions.

A missing or malformed field is a hard stop; never fill it from memory or
substitute a different model. Read the record exactly once — its four fields
are the native spawn request, and separately opening or reconstructing the
rendered fragments restores the context cost the split exists to avoid.

Wait for that agent's stage status/path result, then apply the same ledger rule
the stage states in SKILL.md.
