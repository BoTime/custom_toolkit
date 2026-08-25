Verification contract for this stage:

1. **Verify through `test_command`.** The project states its test command in
   `.claude/autopilot.json`. That is the gate. Do not construct ad-hoc
   equivalents to check the same thing.
2. **Do not narrate verification.** No `md5` before/after comparisons, no
   `echo` separators, no `ls` existence probes, no re-running a command to
   demonstrate its idempotence. If a check is worth running, its result is
   worth recording in the report file — not in the transcript.
3. **Do not build throwaway repositories to prove a guard fires.** A guard
   that needs testing needs a test in the suite.
4. **One gate, one result.** Run the suite once per verification point and
   report the outcome.

This redirects verification; it does not remove it. Run the gate in rule 1.
