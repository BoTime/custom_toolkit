Browser verification contract for this stage:

1. **One spec file per UI criterion, titled with its id.** A test titled
   `AC1 — visitor sees login prompt` is how the criterion and the result are
   matched in the report. A criterion with no test titled for it is reported
   as **not covered**, which is a failure of this stage, not a pass.
2. **Derive locators from the worktree source, not from the page.** The
   implementation you are verifying was written by this same run — read the
   components in the worktree and use their roles, labels, and test ids.
   Prefer `getByRole` and `getByLabel` over structural selectors.
3. **Never read a full-page DOM or accessibility dump into context.** If a
   locator cannot be derived from source, write one `main`-scoped
   `ariaSnapshot()` to a file in the run directory and `grep` it for the
   control you need. Scoped and grepped, never read whole.
4. **Never read a screenshot back.** Screenshots and traces are written for
   the human reviewer. Reading one to confirm an assertion that already
   passed spends a large amount of context to learn nothing.
5. **Never read `results.json` whole.** The script summarizes it. If you need
   detail beyond the summary, `jq` the one failing test out of it.
6. **Mock at the network boundary, in `fixtures/`.** Prefer `page.route()`
   interception over standing up real backend state — it is deterministic,
   it needs no seed step, and it is thrown away with the run.
7. **Do not write a Playwright config.** The script generates it, and its
   reporter and artifact settings are what rules 4 and 5 depend on.

Rules 3 through 5 are the difference between a stage that costs a few
thousand tokens and one that compacts mid-run and starts guessing.
