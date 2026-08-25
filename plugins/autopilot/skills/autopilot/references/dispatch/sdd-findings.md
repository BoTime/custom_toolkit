Findings capture contract for this stage:

1. **Append one JSON line per review finding** to
   `.superpowers/autopilot/<run>/findings.jsonl` in the **main checkout**,
   beside `run.md` — not inside the worktree, which the reaper deletes. Use a
   Bash append (`>>`); a worktree-isolated session cannot Write/Edit to the
   main checkout, but Bash appends work.
2. **Every finding line carries all seven fields**: `task` (number), `round`
   (number), `severity`, `stage_at_fault`, `pattern`, `detail`, `verdict`.
   A line missing any of them is dropped by the analyzer.
3. **`stage_at_fault` is one of `brief`, `plan`, `spec`, `implementation`** —
   the stage that produced the bad input, not the stage that surfaced it. A
   defect the brief introduced must not be recorded as an implementation
   error; framing every finding as a model mistake tunes the wrong stage.
   Invent no other values.
4. **`pattern` is a short canonical phrase; `detail` carries the specifics.**
   Clustering is a pure lexical match over `pattern`, so a phrase rewritten
   per finding clusters with nothing. Reuse a phrase you have used before
   when the defect is the same kind.
5. **A task that passes review writes an explicit clean line**:
   `{"task": N, "clean": true}`. This is not optional bookkeeping. Without
   it, absence of evidence is indistinguishable from evidence of absence:
   occurrence counts become a floor rather than a count, and no threshold can
   be trusted.

Example lines:

```
{"task":4,"round":1,"severity":"major","stage_at_fault":"brief","pattern":"brief introduced dead code","detail":"service._logger added by the brief is never wired","verdict":"CONFIRMED"}
{"task":5,"clean":true}
```
