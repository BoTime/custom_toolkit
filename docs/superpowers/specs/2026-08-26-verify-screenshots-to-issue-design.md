# Upload verify screenshots to the GitHub issue (and the PR body)

**Date:** 2026-08-26
**Status:** Approved design, ready for planning

## Problem

The `verify` stage already opens a real browser and drives every `(ui)`
acceptance criterion. It is the only stage in the pipeline that produces
visual evidence — and that evidence dies where it is born.

Playwright is configured with `screenshot: "only-on-failure"`, so a passing
criterion produces no image at all. The images that *are* produced stay in
`.superpowers/autopilot/<run>/verify/artifacts/`, in the main checkout, on the
machine that ran the pipeline. `SKILL.md`'s `pr` stage says so outright:

> Screenshots and traces stay local to the run directory and are **not**
> attached to the PR: `gh pr edit` takes markdown, and an image only renders
> from a URL, which would mean committing the files.

That reasoning is sound as far as it goes, and its conclusion — do not commit
binaries to the repository — still holds. But it treats "a URL" as impossible.
It is not; it just needs a host. Give the images a host and both consumers open
up at once: the PR body renders them inline, and the issue thread the
`autopilot-github` wrapper is already commenting on can carry them too.

The value is concrete. Today a reviewer reading `AC3 — ✅` is trusting a line
of markdown that a script wrote about a browser nobody watched. With the
screenshot beside it, the reviewer sees what the browser saw.

This design publishes one screenshot per UI acceptance criterion to a
Cloudflare R2 bucket, then surfaces those images in the GitHub issue thread and
in the PR body's existing verification section.

## Constraint that shapes everything

Every script in `plugins/autopilot/scripts/` imports **only** `node:` builtins.
The package has zero runtime dependencies — `vitest` is the sole devDependency.
That is not an accident of history; it is what lets the plugin be installed as
a marketplace plugin and run against any repository without an install step of
its own.

Two consequences follow, and they decide the shape of the whole feature:

- `@aws-sdk/client-s3` is out. Adding it would be the first runtime dependency
  the plugin has ever had, for one upload path in one optional stage.
- Shelling out to the `aws` CLI is also out. It would add an unstated machine
  prerequisite of exactly the kind the skill already treats as a park condition
  for `@playwright/test` — and the skill's own reasoning there is that "a run
  that quietly provisions its own tooling is a run whose green result nobody
  can reproduce."

So the uploader signs AWS SigV4 itself using `node:crypto` and issues the PUT
with `fetch`. SigV4 is roughly forty lines of HMAC chaining; it is well within
what a single-purpose module should carry, and it is exactly testable against a
known-answer vector.

## Seam 1 — capture (`autopilot-verify.mjs`)

The capture side changes in three small places and nowhere else.

- `playwrightConfig()` changes `screenshot: "only-on-failure"` to
  `screenshot: "on"`, so Playwright writes one image per test — passing tests
  included — and records each in that spec's `attachments` array in
  `results.json`. Without this, a green run has nothing to publish, which is
  the case a reviewer most wants to see.
- `summarize()` gains an `attachments` field per result, carrying the local
  path of that spec's screenshot attachment (content-type `image/png`). It
  stays as narrow as the rest of `summarize`: a path, not the file, and not the
  trace.
- `attribute()` threads that path onto each criterion row it returns, reusing
  the criterion-id title-prefix matching it already performs. A criterion whose
  test is missing entirely keeps `status: "missing"` and simply has no path.
- `trace: "retain-on-failure"` is unchanged. Traces are a debugging artifact
  for a human at a terminal, not evidence for a reviewer, and they stay local.

**No change to the verify agent's contract.** The agent still authors only spec
files, and still never reads a screenshot back — the token discipline the whole
`verify` dispatch is built around is untouched. The criterion-to-image mapping
is derived mechanically from the JSON report, not from the agent.

## Seam 2 — upload (new `plugins/autopilot/scripts/autopilot-artifacts.mjs`)

A single-purpose module, in the style of `autopilot-github-issue.mjs`: pure
functions plus one thin side-effecting entry point, with `fetch` and file access
injected so tests touch no network and no fixture tree.

Given the attributed rows (each with an optional local screenshot path), the run
name, and the round number, it:

1. Reads the `artifacts` block from merged config.
2. Loads the configured env file and reads `R2_ACCOUNT_ID`,
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` from it.
3. PUTs each screenshot to R2 with SigV4, `Content-Type: image/png`.
4. Writes a manifest to `<run>/verify/artifacts/uploads.json`.

### Config

A new top-level key in `.claude/autopilot.json`:

```json
"artifacts": {
  "env_file": "apps/api/.env",
  "bucket": "samba-e2e-tests-artifacts",
  "public_base_url": "https://pub-XXXXXXXX.r2.dev"
}
```

Rationale for each key:

- `env_file` — the R2 credentials already exist in the consuming project (samba
  keeps them in `apps/api/.env`, consumed by `r2-storage.provider.ts`). Naming
  the file reuses them verbatim: nothing is copied, no new secret is created,
  and **no secret ever enters `.claude/autopilot.json` or the repo**. This is
  the key that makes the feature safe to configure in a committed file.
- `bucket` — overridden in config because the env file's `R2_BUCKET` names the
  *application's* storage bucket, not the artifacts bucket. Reusing it would
  write test evidence into a production bucket.
- `public_base_url` — the bucket's r2.dev Public Development URL. Cloudflare
  assigns this per bucket; it cannot be derived from the account id, so it
  cannot be defaulted.

Like `minimalism`, `artifacts` stays out of `autopilot-config.mjs`'s
`TOP_LEVEL` list: that list is a hard error on absence, and every existing
config — including this repository's own — has no `artifacts` block and must
keep loading unchanged.

### Object key layout

```
<repo>/<run>/round-<n>/<CRITERION_ID>.png
```

The round is in the key so a verify fix round never overwrites round 1's stored
objects. That matters precisely in the case a reviewer cares about most: a
criterion that was red, got a fix round, and went green — both images survive in
the bucket, each at its own URL. The manifest is not round-scoped: it is written
to a fixed path, so a round-2 run replaces it, and the single issue comment the
run posts carries the latest round's images.

### Manifest shape (`uploads.json`)

```json
{
  "base": "https://pub-XXXXXXXX.r2.dev",
  "prefix": "custom_toolkit/issue-42/round-1",
  "items": [
    {"id": "AC1", "status": "pass", "url": "https://pub-XXXXXXXX.r2.dev/custom_toolkit/issue-42/round-1/AC1.png"},
    {"id": "AC2", "status": "fail", "url": "https://pub-XXXXXXXX.r2.dev/custom_toolkit/issue-42/round-1/AC2.png"}
  ]
}
```

One file, two consumers. The manifest is the seam: neither consumer knows
anything about R2, credentials, or signing — each reads a list of ids, statuses
and URLs.

## Seam 3 — publish (two consumers of the one manifest)

- **PR body.** `formatVerifySection()` gains an image column (or a per-row image
  link) built from the manifest, so a reviewer sees the evidence without leaving
  the PR. When no manifest exists the section renders **exactly** as it does
  today: text-only, with the local artifacts path. This is what keeps every
  repository with no `artifacts` block byte-identical to today's output.
- **Issue comment.** `autopilot-github-issue.mjs` gains a `screenshots`
  subcommand that reads the manifest and posts one issue comment containing the
  images. The `autopilot-github` SKILL.md gains **Delta 3d**, anchored
  immediately after the `verify` stage's ledger entry, guarded for idempotency
  by the ledger line `github: verify screenshots posted` — the same
  `github: `-prefixed shape every other hook uses, which collides with none of
  `nextStage`'s resume prefixes.

`GITHUB_LEDGER_LINES` gains the new line, so the wrapper's prose guard test and
the ledger-coupling test keep sharing one source of truth.

### Ordering constraint (park case)

When verify is red after its one fix round, the screenshot comment is posted and
its ledger line appended **before** the `PARKED — <reason>` entry, exactly as
Delta 3c already requires for the park comment. `PARKED` must remain the last
ledger entry or `nextStage` stops returning `parked`, and a parked run starts
looking resumable — the precise failure Delta 3c's ordering rule exists to
prevent.

The park case is also the case where the screenshots are worth the most: a human
is about to be asked what went wrong, and the images are the answer.

### The `pr` stage's paragraph is now wrong

`autopilot/SKILL.md`'s `pr` stage currently states that screenshots are not
attached, and `autopilot-verify-contract.test.mjs` pins that sentence ("is
honest that screenshots do not reach the PR"). Both must be rewritten as part of
this change — the prose to describe the manifest-driven behaviour and its
degradation, the test to pin the new statement. Leaving either in place would
leave the skill asserting the opposite of what the pipeline does.

## Failure posture

Missing `artifacts` config, an unreadable or incomplete env file, or a failed
PUT **never parks the run**. The pipeline degrades to today's text-only
behaviour and records `verify: screenshot upload skipped — <reason>`.

This follows the precedent already set by the `pr` stage ("If the `gh pr edit`
fails, do not park — the PR exists and the branch is green") and by the
wrapper's "Transition failures do not park". The run's product is the pull
request; missing evidence is a reporting defect, not a reason to abandon a green
branch. It is also what keeps every repository with no `artifacts` block working
unchanged, without a feature flag.

The reason string is part of the contract: it names *which* piece was missing,
because a silent skip and a misconfigured bucket are indistinguishable from the
ledger otherwise.

## Testing

- New `autopilot-artifacts.test.mjs`: config validation (each missing key named
  individually), env-file parsing, object-key layout including the round, SigV4
  canonical-request and signature against a known-answer vector, manifest shape,
  and the skip-not-throw behaviour on every failure path. `fetch` is injected so
  no network is touched.
- `autopilot-verify.test.mjs` extends to cover `screenshot: "on"` in the
  generated config (replacing the existing `only-on-failure` assertion),
  attachment threading through `summarize`/`attribute`, and the image column in
  `formatVerifySection` — both with and without a manifest.
- `autopilot-verify-contract.test.mjs`'s "screenshots do not reach the PR"
  assertion is replaced by one pinning the new `pr`-stage prose.
- A github contract test pins the Delta 3d ledger prefix
  (`github: verify screenshots posted`) and the park ordering rule.

Per `CLAUDE.md`, no test added by this work asserts a version literal.

## Operational note

The bucket's `pub-XXXXXXXX.r2.dev` host must be filled into the consuming
project's `.claude/autopilot.json`. Until it is set, uploads skip cleanly and
the pipeline behaves as it does today.

Consequence to document, in the skill and not only here: an r2.dev public
development URL is **world-readable**. Anything visible in a verified
screenshot — seeded user data, an internal admin surface, a staging banner — is
public to anyone with the link. That is an acceptable trade for a test-evidence
bucket seeded with fixture data, and an unacceptable one for a bucket that ever
sees production screens. The documentation must say so plainly rather than
leaving a reader to infer it from "public development URL".

## Out of scope

- Any change to the verify agent's dispatch contract or its token discipline.
- Publishing traces or videos. Traces stay local and `video` stays `off`.
- Any storage backend other than S3-compatible R2. The signer is SigV4, so
  another S3-compatible host would work by changing config alone, but no such
  host is designed for or tested here.
- Lifecycle management of uploaded objects. Retention is the bucket's concern,
  configured in Cloudflare, not autopilot's.
- Deleting or reconciling objects when a run is reaped.

## Acceptance criteria source note

This repository has no UI, so every acceptance criterion for this change is
`(non-ui)` and the `verify` stage will skip for this run.

## Acceptance criteria

- AC1 (non-ui) — `playwrightConfig()` emits `screenshot: "on"` in the generated
  config, so Playwright writes one image per test including passing ones, and
  leaves `trace: "retain-on-failure"` and `video: "off"` unchanged
- AC2 (non-ui) — `summarize(report)` returns, per result, an `attachments` field
  carrying the local path of that spec's screenshot attachment whose content
  type is `image/png`, and returns the result with no path when the spec has no
  such attachment
- AC3 (non-ui) — `attribute(criteria, summary)` threads the screenshot path onto
  each criterion row using the existing criterion-id title-prefix match, and a
  criterion with no matching test still returns `status: "missing"` with no path
- AC4 (non-ui) — the `verify` role's dispatch contract is unchanged: no prompt,
  reference, or dispatch fixture asks the agent to read, name, or return a
  screenshot, and the criterion-to-image mapping is derived only from the JSON
  report
- AC5 (non-ui) — `plugins/autopilot/scripts/autopilot-artifacts.mjs` imports
  only `node:` builtins, adds no runtime dependency to `package.json`, and
  shells out to no external binary (in particular not the `aws` CLI)
- AC6 (non-ui) — the module reads an `artifacts` block from merged config and
  reports each missing key (`env_file`, `bucket`, `public_base_url`)
  individually by name rather than as one aggregate "misconfigured" message
- AC7 (non-ui) — `artifacts` is absent from `autopilot-config.mjs`'s `TOP_LEVEL`
  list, so a config with no `artifacts` block still loads and validates exactly
  as it does today
- AC8 (non-ui) — the module loads the file named by `env_file` and reads
  `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` from it; an
  unreadable file or any missing variable produces a skip whose reason names
  what was missing
- AC9 (non-ui) — no credential value ever appears in `.claude/autopilot.json`,
  in `uploads.json`, in the PR body, in the issue comment, in a ledger entry, or
  in any skip reason
- AC10 (non-ui) — each object key is `<repo>/<run>/round-<n>/<CRITERION_ID>.png`,
  so a round-2 upload of the same criterion writes a distinct key and does not
  overwrite round 1's object
- AC11 (non-ui) — the SigV4 canonical request and the derived signature match a
  known-answer vector, computed with `node:crypto` alone
- AC12 (non-ui) — each screenshot is issued as a PUT through an injected
  `fetch`, with `Content-Type: image/png`, so the test suite touches no network
- AC13 (non-ui) — the module writes `<run>/verify/artifacts/uploads.json`
  carrying `base`, `prefix`, and an `items` array whose entries each carry `id`,
  `status`, and the full public `url`
- AC14 (non-ui) — with a manifest present, `formatVerifySection()` renders the
  screenshot for each criterion (as an image column or a per-row image link)
  built from the manifest's URLs
- AC15 (non-ui) — with no manifest, `formatVerifySection()` renders exactly the
  output it renders today: text-only, with the local artifacts path, and the
  skipped case unchanged
- AC16 (non-ui) — `autopilot-github-issue.mjs` gains a `screenshots` subcommand
  that reads the manifest and posts one issue comment containing the images, and
  its usage string lists the new subcommand
- AC17 (non-ui) — `GITHUB_LEDGER_LINES` gains `github: verify screenshots
  posted`, keeping the `github: ` prefix that collides with none of
  `nextStage`'s resume prefixes nor with `PARKED`
- AC18 (non-ui) — `autopilot-github/SKILL.md` carries a **Delta 3d** anchored
  immediately after the `verify` stage's ledger entry, guarded for idempotency
  by the ledger line `github: verify screenshots posted`
- AC19 (non-ui) — in the park case, Delta 3d posts the screenshot comment and
  appends its ledger line **before** the `PARKED — <reason>` entry, leaving
  `PARKED` as the last ledger entry so `nextStage` still returns `parked`
- AC20 (non-ui) — missing `artifacts` config, an unreadable or incomplete env
  file, and a failed PUT each leave the run unparked, degrade to the text-only
  section, and append `verify: screenshot upload skipped — <reason>` naming the
  cause
- AC21 (non-ui) — a repository with no `artifacts` block produces the same PR
  body section, the same ledger lines, and the same issue comments as it does
  today, with no new failure and no new park condition
- AC22 (non-ui) — `autopilot/SKILL.md`'s `pr` stage no longer states that
  screenshots stay local and are not attached; it describes the manifest-driven
  behaviour and its degradation when no manifest exists
- AC23 (non-ui) — `autopilot-verify-contract.test.mjs`'s assertion that
  screenshots do not reach the PR is replaced by one pinning the new `pr`-stage
  prose, so no test asserts prose the skill no longer carries
- AC24 (non-ui) — the documentation states plainly that an r2.dev public
  development URL is world-readable and that anything visible in a verified
  screenshot is public to anyone with the link
- AC25 (non-ui) — `autopilot-artifacts.test.mjs` covers config validation with
  each key named individually, env-file parsing, the object-key layout including
  the round, the SigV4 known-answer vector, the manifest shape, and
  skip-not-throw on every failure path, with `fetch` injected
- AC26 (non-ui) — `autopilot-verify.test.mjs` covers `screenshot: "on"` in the
  generated config, attachment threading through `summarize` and `attribute`,
  and `formatVerifySection` both with and without a manifest
- AC27 (non-ui) — a github contract test pins both the Delta 3d ledger prefix
  and the park ordering rule
- AC28 (non-ui) — no test added or modified by this work asserts a version
  literal, per `CLAUDE.md`
