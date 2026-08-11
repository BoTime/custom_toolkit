---
description: Cluster autopilot's captured review findings into rule candidates for you to approve, reject, or edit
---

# Autopilot findings

Read the findings corpus across all runs, cluster it, and present the
candidates that cleared the threshold.

## Run the report

Resolve the plugin root the same way the autopilot skill does — the harness
prefixes this command with a `Base directory` line pointing at the plugin.
Then, from the repository root:

```bash
AP="<the plugin root>"
THRESHOLD=$(node -e "import('$AP/scripts/autopilot-config.mjs').then(m=>console.log(m.loadConfig('.claude/autopilot.json').config.findings_threshold))")
node "$AP/scripts/autopilot-findings.mjs" report .superpowers/autopilot "$THRESHOLD"
```

`findings_threshold` comes from `.claude/autopilot.json`, layered over the
plugin default of 2. If the corpus is empty, say so and stop — no run has
captured findings yet.

## Present the candidates

Show the report as printed. For each candidate, state the stage at fault, the
pattern, the count, and the evidence — run, task, and round per occurrence. The
evidence is the point: a bare count gives your human partner nothing to judge.

Then ask, one candidate at a time:

- **Approve** — record the rule as a candidate for later injection.
- **Reject** — say why in one line, so the same cluster is not re-proposed
  blind next time.
- **Edit** — reword the rule and then approve the reworded version.

## Recording an approval

Append approved candidates to `.superpowers/autopilot/rules.md` in the **main
checkout**, each with its stage, its pattern, and a one-line count of the
evidence behind it. From a worktree-isolated session, append with Bash (`>>`) —
Write and Edit to the main checkout do not work, though Bash appends and reads
still do.

**Do not write any rule into a stage prompt.** Injection is deliberately out of
scope: an approved candidate is recorded for a human to act on later, never
wired into a prompt automatically. A pipeline that silently rewrites its own
prompts from its own review output drifts, and instruction drift is harder to
notice and trace than code drift.

Nothing is written without an explicit yes.
