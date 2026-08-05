# Quieting the `sdd` stage dispatch

**Date:** 2026-08-04
**Status:** Approved design, ready for planning

## Problem

During autopilot's `sdd` stage, the developer's transcript fills with tool
calls they did not ask for and cannot act on: `md5` comparisons, idempotence
re-runs, throwaway-repo guard checks, `echo` separators, ad-hoc `ls` probes.
Each renders as an `IN`/`OUT` block. The signal — which task is running, what
passed — is buried.

This contradicts what the skill already promises:

> Stage outputs go to files; a stage returns a status line and a path, never
> content. This is what keeps your context small enough to avoid compaction.

The noise is therefore a defect against the existing design, not a missing
feature. It is also a context cost: every suppressed line is a line the
controller does not have to hold.

## What was ruled out, and why

Three approaches were investigated and rejected. Recording them here so the
question is not reopened without new information.

**Hiding output via the UI.** There is no settings key, agent-frontmatter
field, CLI flag, or transcript mode that collapses or hides subagent tool
calls in either the VS Code extension or the CLI. The one related flag,
`--forward-subagent-text`, works in the opposite direction and only in
programmatic `stream-json` mode.

**`suppressOutput` in a `PostToolUse` hook.** This hides the *hook's own
stdout*, not the tool's output. It does not do what the name suggests.

**`updatedToolOutput` in a `PostToolUse` hook.** This is the inverse of the
requirement. Per the hooks documentation, Claude sees the transformed result
while *the original tool output is saved to the transcript*. Condensing a test
run would leave the developer looking at all 47 lines while the agent that
must act on them sees only a summary. The two are not independently
controllable — there is no display-only option. For a subagent call the
substitution lands on the subagent's own view, so an implementer would reason
about tests it cannot see. This is a correctness hazard, not a display
feature.

**Conclusion:** output cannot be hidden from plugin-land. It can only not be
produced. This design does that for the one agent whose prompt we own.

## Scope

**In scope:** the dispatch prompt autopilot writes for the `sdd` stage.

**Out of scope, deliberately:**

- SDD's own nested dispatches (implementer, task reviewer, re-reviewer). Their
  prompts belong to `superpowers:subagent-driven-development`. Pushing a
  verification contract down into them was considered and dropped: the
  mechanism exists (our prompt already overrides SDD's Model Selection with
  literal text) but compliance cannot be verified from here, and an
  unverifiable instruction is not worth the prose.
- A `progress` summary command. Complementary, separately scoped.

The consequence is stated plainly: **this reduces transcript noise, it does
not eliminate it.** Nested agent calls continue to render.

## Design

Add a verification contract to the `sdd` dispatch prompt, in the same style as
the existing Model Selection override — literal text the dispatched agent can
act on, not a reference to a policy it cannot read.

The contract has four rules:

1. **Verify through `test_command`.** The project states its test command in
   `.claude/autopilot.json`. That is the gate. Do not construct ad-hoc
   equivalents.
2. **Do not narrate verification.** No `md5` before/after comparisons, no
   `echo` separators, no `ls` existence probes, no re-running a command to
   show it is idempotent. If a check is worth running, its result is worth
   recording in the report file — not in the transcript.
3. **Do not build throwaway repositories to prove guards fire.** If a guard
   needs testing, it needs a test in the suite.
4. **One gate, one result.** Run the suite once per verification point and
   report the outcome.

Rules 2 and 3 name the specific patterns observed in real runs. Naming them
matters: a general instruction to "be concise" has no purchase on an agent
that believes each individual check is justified.

### Why this is expected to work

SDD's implementer prompt already caps the *return value* at "under 15 lines —
the detail lives in the report file." The return contract was designed; the
middle was not. This adds the missing half at the layer we control.

### Failure mode

An agent that follows the contract too literally could skip verification it
should have done. Rule 1 mitigates this by naming what to run rather than only
what to avoid — the contract redirects verification, it does not remove it.
The `land` stage's post-rebase suite run remains the backstop and is
unchanged.

## Testing

The dispatch prompt is prose, so there is no unit test for its effect. What is
testable is that the contract is present and reaches the agent:

- The `sdd` section of `SKILL.md` contains the four rules.
- Existing coupling tests (`autopilot-ledger-coupling.test.mjs`) continue to
  pass — this change touches no ledger entry strings and must not.

Real verification is observational: the next autopilot run's `sdd` stage
should show materially fewer `IN`/`OUT` blocks from the stage agent itself.

## Open question for the developer

The genuine fix — folding tool output under each step, expandable on click —
is a Claude Code feature, not a plugin capability. If that remains the goal, a
`/feedback` request is the honest path, and this design is a stopgap.
