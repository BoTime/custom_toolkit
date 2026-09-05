This run is tier `small`. Its spec is a scratch document, not a repository
artifact.

Write to `{{spec_path}}` — an absolute path in the main checkout's run
directory, outside the worktree — exactly two things:

1. A design paragraph of a few sentences: what to build, and how.
2. The `## Acceptance criteria` section described below.

Write no other sections. No Problem, no Non-goals, no Measurement, no per-file
sections, no testing section.

Do not commit anything. Do not stage anything. Do not modify any tracked file
in the worktree, and do not open a pull request. The pull request description
is where this document's content ends up; the `pr` stage reads it back from
the path above.
