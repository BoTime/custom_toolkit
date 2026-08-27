# Autopilot Codex Compatibility Design

## Goal

Make every Autopilot-provided skill executable in Codex without reducing the
existing Claude Code workflow: `autopilot-brainstorm` remains interactive,
`autopilot` can run its staged delivery pipeline, and `autopilot-github` can
run that same pipeline with its GitHub synchronization.

## Scope and non-goals

The plugin will provide host-specific orchestration adapters while keeping the
stage templates, ledger, git operations, GitHub integration, and browser
verification shared. This change does not rewrite the external Superpowers
skills; it verifies the dependencies available to each host and stops at
preflight with an actionable error when one is unavailable.

Claude Code remains backward compatible: its manifest, commands, config file,
and definition-file dispatch protocol retain their current behavior.

## Host abstraction

Introduce a small host module that resolves the active host from an explicit
`--host=claude|codex` argument, with the skill supplying that value. The module
defines:

- the project config path (`.claude/autopilot.json` for Claude and
  `.codex/autopilot.json` for Codex);
- the host's environment override for reasoning effort;
- supported role model defaults;
- how a composed stage is represented for dispatch.

The shared configuration loader accepts an explicit project path and host
metadata. A Codex default config maps every existing role to supported Codex
model and `reasoning_effort` values. A project may override those values in
`.codex/autopilot.json` without affecting Claude users or configs.

## Codex dispatch protocol

`autopilot-dispatch.mjs` will retain its existing Claude output unchanged. In
Codex mode it will write a structured dispatch record at
`.superpowers/autopilot/<run>/agents/<stage>.json` containing the stage role,
Codex model, reasoning effort, and fully rendered instruction text.

The Codex branch of the `autopilot` skill will:

1. compose the stage with `--host=codex`;
2. read the structured record;
3. call Codex's `spawn_agent` with its instructions, model, and reasoning
   effort; and
4. process the stage's status/path result using the existing ledger rules.

The composed text stays identical across hosts except for explicit harness
notes that describe a Claude-only tool constraint. Codex instructions use its
native file-edit and agent-spawn capabilities, so no Claude Agent frontmatter
or tool behavior is assumed.

## Skill behavior

`autopilot` detects its host at the start of preflight and selects the matching
config path, supported dependency checks, and dispatch protocol. Its Codex
path no longer refers to Claude's Agent tool or `opus`/`sonnet` models.

`autopilot-github` delegates through the host-aware `autopilot` flow and uses
the same host-specific config path when reading the GitHub block.

`autopilot-brainstorm` retains its shared process. Its visual companion
documentation and server lifecycle instructions will state the Codex behavior
without treating it as an exception or depending on a Claude environment
variable.

## Error handling

Host values, unsupported models, invalid effort values, and malformed dispatch
records are hard preflight failures. A Codex stage is never dispatched with a
missing instruction, model, or reasoning effort. Existing park conditions,
ledger semantics, and non-zero script exits remain unchanged.

## Tests

Tests will establish that:

- Claude output and config behavior remain unchanged;
- Codex config defaults and per-role overrides validate independently;
- each stage produces a valid Codex dispatch record with instruction, model,
  and reasoning effort;
- Codex dispatch rejects missing values and unknown hosts;
- all three skills contain a Codex execution path and no Claude-only dispatch
  claim in that path; and
- the Codex manifest and marketplace remain valid.

## Acceptance criteria

1. A Codex installation can discover and invoke all three Autopilot skills.
2. In Codex, `autopilot` completes preflight and composes every supported stage
   into a native agent-spawn request using valid Codex model settings.
3. In Codex, `autopilot-github` uses the Codex config and delegates to that
   native stage protocol.
4. `autopilot-brainstorm`, including its optional visual companion, runs in
   Codex without Claude-specific environment assumptions.
5. Existing Claude tests and behavior remain green.
