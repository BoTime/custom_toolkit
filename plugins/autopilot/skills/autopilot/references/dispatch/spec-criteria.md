The spec must carry an `## Acceptance criteria` section. It is the run's one
statement of what "done" means, and the `verify` stage reads it to decide both
what to check in a browser and whether to open one at all. Write it in exactly
this shape:

```markdown
## Acceptance criteria

- AC1 (ui) — a signed-out visitor clicking "Save" sees the login prompt
- AC2 (non-ui) — POST /items rejects an empty title with 422
```

Three rules travel with it:

1. **Every criterion carries an `AC<n>` id and a `(ui)` or `(non-ui)` tag.**
   The tag is the gate. An untagged criterion is an error, not a default —
   defaulting it to `non-ui` would drop it from verification while the run
   still reported success.
2. **`(ui)` means observable in a browser** — something a person could confirm
   by looking at or clicking the running app. Everything else is `(non-ui)`,
   including API behavior with no visible surface.
3. **Criteria state observable outcomes, not implementation.** "The list
   re-sorts when the header is clicked" is verifiable; "the sort handler is
   memoized" is not.
