VERIFY STAGE — author the browser checks for this run's UI acceptance criteria.
You write the checks; the script runs them.

Run: {{run}}
Worktree (read the implementation here): {{worktree}}
Spec (the acceptance criteria to cover): {{spec_path}}
Run directory (write everything here): {{verify_dir}}

Everything you write goes to `{{verify_dir}}` in the **main checkout** —
`specs/` for the test files, `fixtures/` for mock data. Nothing is committed,
and nothing goes in the worktree. These artifacts are per-run and worth exactly
one run.

A worktree-isolated session cannot Write or Edit into the main checkout, but
**Bash redirects work**. Write spec files with `cat > <path> <<'EOF'` heredocs.

Specs import `@playwright/test` normally, even though they sit outside the
project: the script symlinks the project's `node_modules` into the run
directory so Node's upward resolution finds it. Do not work around this with
absolute import paths — if an import fails, the stage returns the
infrastructure exit and parks rather than reporting uncovered criteria.
