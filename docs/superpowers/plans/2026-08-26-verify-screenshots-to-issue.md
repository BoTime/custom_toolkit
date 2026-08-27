# Verify Screenshots to the GitHub Issue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish one screenshot per UI acceptance criterion to Cloudflare R2 and surface those images in the PR body and the GitHub issue thread, degrading silently to today's text-only behaviour when nothing is configured.

**Architecture:** Three seams. **Capture** — `autopilot-verify.mjs` turns Playwright screenshots on for every test and threads each image's local path from the JSON report onto its criterion row. **Upload** — a new `autopilot-artifacts.mjs` signs AWS SigV4 with `node:crypto`, PUTs each image through an injected `fetch`, and writes one manifest, `uploads.json`. **Publish** — two consumers read that one manifest and nothing else: `formatVerifySection()` gains a screenshot column, and `autopilot-github-issue.mjs` gains a `screenshots` subcommand that posts one issue comment.

**Tech Stack:** Node ESM, `node:` builtins only, vitest.

**Spec:** `docs/superpowers/specs/2026-08-26-verify-screenshots-to-issue-design.md`

## Global Constraints

- **Zero runtime dependencies.** Every script in `plugins/autopilot/scripts/` imports only `node:` builtins. Do not add anything to `package.json`'s `dependencies`. Do not add `@aws-sdk/client-s3`. Do not shell out to the `aws` CLI or any other external binary.
- **Never assert a version literal in a test** (per `CLAUDE.md`). Never hand-edit a version field in `package.json`, `package-lock.json`, `.claude-plugin/marketplace.json`, or `plugins/autopilot/.claude-plugin/plugin.json`.
- **No credential ever leaves the env file.** No value of `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, or `R2_SECRET_ACCESS_KEY` may appear in `.claude/autopilot.json`, in `uploads.json`, in the PR body, in an issue comment, in a ledger entry, or in any skip reason. Skip reasons name *variables* and *keys*, never values, and never interpolate a caught error's `message`.
- **Nothing here ever parks a run.** Missing config, an unreadable env file, a missing variable, an unreadable image, a failed PUT: every one of them returns a skip and the pipeline continues.
- **`artifacts` stays out of `autopilot-config.mjs`'s `TOP_LEVEL`.** That list is a hard error on absence, and every existing config — including this repository's own — has no `artifacts` block and must keep loading unchanged. This is already true today; Task 2 adds a test pinning it and changes no code.
- **The verify agent's dispatch contract is untouched.** No prompt, reference, or dispatch fragment gains a mention of a screenshot path, `uploads.json`, or the upload at all. The criterion-to-image mapping is derived mechanically from Playwright's JSON report.
- **Run the whole suite, not one file, before each commit:** `npm test`.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `plugins/autopilot/scripts/autopilot-verify.mjs` | Modify (Tasks 1, 3) | Capture the screenshot paths; render them into the PR section; call the uploader |
| `plugins/autopilot/scripts/autopilot-verify.test.mjs` | Modify (Tasks 1, 3) | Unit cover of the above |
| `plugins/autopilot/scripts/autopilot-artifacts.mjs` | **Create** (Task 2) | Config + env reading, SigV4, the PUT, the manifest. Knows nothing about criteria markdown or GitHub |
| `plugins/autopilot/scripts/autopilot-artifacts.test.mjs` | **Create** (Task 2) | Unit cover of the above, with `fetch` injected |
| `plugins/autopilot/skills/autopilot/SKILL.md` | Modify (Task 3) | `verify` stage's screenshot subsection; `pr` stage's rewritten paragraph |
| `plugins/autopilot/scripts/autopilot-verify-contract.test.mjs` | Modify (Task 3) | Pin the new prose; pin that the agent contract is unchanged |
| `plugins/autopilot/scripts/autopilot-github-issue.mjs` | Modify (Task 4) | The `screenshots` subcommand and the sixth ledger line |
| `plugins/autopilot/scripts/autopilot-github-issue.test.mjs` | Modify (Task 4) | Unit cover of the subcommand |
| `plugins/autopilot/skills/autopilot-github/SKILL.md` | Modify (Task 4) | Delta 3d and the six-line ledger block |
| `plugins/autopilot/scripts/autopilot-github-contract.test.mjs` | Modify (Task 4) | Pin Delta 3d and its park ordering |
| `plugins/autopilot/scripts/autopilot-github-ledger-coupling.test.mjs` | Modify (Task 4) | Weave the new line in at its hook point |

Four tasks: capture, upload, publish-to-PR, publish-to-issue. Task 3 consumes Task 2's module and Task 1's row field, so the order is fixed. Capture and publish are separated because they are reviewable apart — capture is pure data threading through two pure functions, publish is rendering plus side-effect wiring plus two documents of prose.

## Seams between tasks — the values that cross a boundary

No single task's diff shows these, so they are pinned here:

- **Task 1 → Task 3 (and Task 2):** each row returned by `attribute()` carries `screenshot: <absolute local path>` or `screenshot: null`. The field is named `screenshot` on the **row**. On a `summarize()` **result** the same value is named `attachments` — the spec pins that name, and it is deliberately singular-valued despite the plural. Label it in a comment; do not rename either.
- **Task 2 → Task 3:** `uploadScreenshots(...)` resolves to `{ ok: true, manifest, path }` or `{ ok: false, reason }`. It never throws and never rejects.
- **Task 2 → Tasks 3 and 4:** the manifest object is exactly `{ base, prefix, items }` where each item is `{ id, status, url }`.
- **Task 3 → Task 4:** the manifest is written to `<run-dir>/artifacts/uploads.json`, i.e. `.superpowers/autopilot/<run>/verify/artifacts/uploads.json`.
- **Task 4 → the orchestrator:** the `screenshots` subcommand prints `posted <n> screenshots to issue #<n>` on success and `skipped — no screenshot manifest at <path>` when there is nothing to post, and exits 0 either way.

## A known, spec-mandated ordering hazard — do not silently transcribe it

`nextStage` resumes at `learnings` when **any** ledger entry starts with `verify`. The skip line the spec mandates, `verify: screenshot upload skipped — <reason>`, therefore matches that prefix. In the park case there is no other `verify:` entry, so a crash between appending the skip line and appending `PARKED — <reason>` would leave the run looking resumable at `learnings` on a red branch.

The spec pins the string, so the mitigation is ordering, stated in Task 3's prose and pinned by its test: the skip line is appended in the same step as, and immediately before, the `PARKED` entry — never earlier — and `PARKED` stays last. The window is one append. Note that the two never both fire in the interesting way: when the upload skipped there is no manifest, so Delta 3d posts nothing and appends nothing.

---

## Task 1: Capture — one screenshot per test, threaded onto its criterion

**Satisfies:** AC1, AC2, AC3, and the first half of AC26.

**Files:**
- Modify: `plugins/autopilot/scripts/autopilot-verify.mjs` (`playwrightConfig`, `summarize`, `attribute`)
- Test: `plugins/autopilot/scripts/autopilot-verify.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `summarize(report)` results each gain `attachments: string | null` — the local path of that spec's first attachment whose `contentType` is `image/png`.
  - `attribute(criteria, summary)` rows each gain `screenshot: string | null`.
  - `playwrightConfig({baseURL, specDir, artifactsDir})` emits `screenshot: "on"`.

**Prose in this file that this task falsifies and must also fix:** `summarize`'s doc comment says "Only the outcome and the first error message per failing test are kept." It is no longer true. `playwrightConfig`'s doc comment mentions "artifact settings"; leave that, it is still accurate.

- [ ] **Step 1: Write the failing tests**

In `plugins/autopilot/scripts/autopilot-verify.test.mjs`, **replace** the existing test

```js
  it("captures screenshots and traces only on failure", () => {
    expect(cfg).toContain('screenshot: "only-on-failure"');
    expect(cfg).toContain('trace: "retain-on-failure"');
    expect(cfg).toContain('video: "off"');
  });
```

with

```js
  // A passing criterion is the case a reviewer most wants to see, and
  // "only-on-failure" produced no image for it at all.
  it("captures a screenshot on every test, and keeps traces failure-only", () => {
    expect(cfg).toContain('screenshot: "on"');
    expect(cfg).toContain('trace: "retain-on-failure"');
    expect(cfg).toContain('video: "off"');
  });
```

Then, immediately after the existing `const failing = (title, message) => ({...});` fixture helper near the top of the file, add a third helper:

```js
// Playwright records one attachment per artifact on each test result. Only the
// image/png one is a screenshot; a trace attachment sits in the same array.
const withShot = (spec, path) => ({
  ...spec,
  tests: spec.tests.map((t) => ({
    ...t,
    results: t.results.map((r) => ({
      ...r,
      attachments: [
        { name: "trace", contentType: "application/zip", path: "/run/trace.zip" },
        { name: "screenshot", contentType: "image/png", path },
      ],
    })),
  })),
});
```

Add these tests inside the existing `describe("summarize", ...)` block:

```js
  it("carries the local path of the image/png attachment onto the result", () => {
    const s = summarize(report([withShot(passing("AC1 login"), "/run/a/AC1.png")]));
    expect(s.results[0].attachments).toBe("/run/a/AC1.png");
  });

  it("ignores a non-image attachment rather than mistaking it for a screenshot", () => {
    const spec = passing("AC1 login");
    spec.tests[0].results[0].attachments = [
      { name: "trace", contentType: "application/zip", path: "/run/trace.zip" },
    ];
    expect(summarize(report([spec])).results[0].attachments).toBeNull();
  });

  it("returns a null path for a spec with no attachments at all", () => {
    expect(summarize(report([passing("AC1 login")])).results[0].attachments).toBeNull();
  });
```

And these inside the existing `describe("attribute", ...)` block:

```js
  it("threads the screenshot path onto the criterion it matched", () => {
    const rows = attribute(
      criteria,
      summarize(report([withShot(passing("AC1 login"), "/run/a/AC1.png")])),
    );
    expect(rows.find((r) => r.id === "AC1").screenshot).toBe("/run/a/AC1.png");
  });

  it("leaves a criterion with no test missing and with no path", () => {
    const rows = attribute(criteria, summarize(report([passing("AC1 login")])));
    expect(rows.find((r) => r.id === "AC3")).toMatchObject({
      status: "missing",
      screenshot: null,
    });
  });
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-verify.test.mjs`

Expected: FAIL. The config test fails on `screenshot: "on"` not being present; the `summarize` and `attribute` tests fail on `attachments` / `screenshot` being `undefined` rather than a path or `null`.

- [ ] **Step 3: Turn screenshots on in the generated config**

In `plugins/autopilot/scripts/autopilot-verify.mjs`, inside `playwrightConfig`, change exactly one line:

```js
    screenshot: "on",
```

Leave `trace: "retain-on-failure"` and `video: "off"` exactly as they are. Traces are a debugging artifact for a human at a terminal, not evidence for a reviewer.

- [ ] **Step 4: Carry the screenshot path through `summarize`**

Replace the body of the `walk` helper's spec loop so each pushed result gains the field. The whole `summarize` function becomes:

```js
/**
 * Flatten Playwright's JSON report into a verdict.
 *
 * The outcome, the first error message per failing test, and the local path of
 * that spec's screenshot are kept. The full report stays on disk: the verify
 * agent is under a contract not to read it, and this is what makes that
 * contract followable — a path is not an image, and nothing here reads one.
 *
 * `attachments` is singular-valued despite its plural name. The name is fixed
 * by the design spec; the value is one path or null, because a spec produces at
 * most one screenshot and the trace beside it is deliberately not published.
 */
export function summarize(report) {
  const results = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      const failed = (spec.tests ?? []).some((t) => t.status !== "expected");
      const runs = (spec.tests ?? []).flatMap((t) => t.results ?? []);
      const message = runs.map((r) => r.error?.message).find(Boolean);
      const shot = runs
        .flatMap((r) => r.attachments ?? [])
        .find((a) => a?.contentType === "image/png" && a?.path);
      results.push({
        title: spec.title,
        ok: !failed,
        message: failed ? (message ?? "failed with no error message").split("\n")[0] : null,
        attachments: shot?.path ?? null,
      });
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);

  const failures = results.filter((r) => !r.ok);
  return {
    total: results.length,
    passed: results.length - failures.length,
    failed: failures.length,
    results,
    failures,
  };
}
```

- [ ] **Step 5: Thread it onto the criterion rows**

Replace `attribute`'s two `return` statements so both branches carry the field:

```js
export function attribute(criteria, summary) {
  return uiCriteria(criteria).map((c) => {
    const match = summary.results.find((r) => r.title.toUpperCase().startsWith(c.id));
    if (!match) {
      return { ...c, status: "missing", message: "no test covered this criterion", screenshot: null };
    }
    return {
      ...c,
      status: match.ok ? "pass" : "fail",
      message: match.message,
      screenshot: match.attachments ?? null,
    };
  });
}
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`

Expected: PASS, every file. If `autopilot-verify-contract.test.mjs` goes red here, stop and read it — Task 3 owns that file, and a failure now means something in it pinned the old config string.

- [ ] **Step 7: Commit**

```bash
git add plugins/autopilot/scripts/autopilot-verify.mjs plugins/autopilot/scripts/autopilot-verify.test.mjs
git commit -m "feat(verify): capture a screenshot per test and thread its path onto the criterion"
```

---

## Task 2: Upload — `autopilot-artifacts.mjs`, SigV4 by hand

**Satisfies:** AC5, AC6, AC7, AC8, AC9, AC10, AC11, AC12, AC13, AC25, and the "skip, never park" half of AC20.

**Files:**
- Create: `plugins/autopilot/scripts/autopilot-artifacts.mjs`
- Create: `plugins/autopilot/scripts/autopilot-artifacts.test.mjs`

**Interfaces:**
- Consumes: rows shaped as Task 1 produces them — `{ id, kind, text, status, message, screenshot }`.
- Produces, all exported:
  - `ARTIFACT_KEYS = ["env_file", "bucket", "public_base_url"]`
  - `CREDENTIAL_KEYS = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]`
  - `resolveArtifactsConfig(config) -> { ok: true, artifacts } | { ok: false, reason }`
  - `parseEnvFile(text) -> Record<string, string>`
  - `readCredentials(envPath, readFile?) -> { ok: true, credentials: { accountId, accessKeyId, secretAccessKey } } | { ok: false, reason }`
  - `objectKey({ repo, run, round, id }) -> string`
  - `amzDate(date) -> string` (e.g. `"20260826T123456Z"`)
  - `sigv4({ method, path, query?, headers, payloadSha256, accessKeyId, secretAccessKey, region, service, amzDate }) -> { canonicalRequest, stringToSign, signature, authorization }`
  - `putObject({ accountId, bucket, key, body, credentials, contentType?, fetchImpl?, now? }) -> Promise<{ ok, status }>`
  - `uploadScreenshots({ config, rows, repo, run, round, artifactsDir }, deps?) -> Promise<{ ok: true, manifest, path } | { ok: false, reason }>`

**This task adds no CLI and no `main()`.** The module has exactly one consumer today — `verify()` in Task 3 — and no second consumer can be named, so it stays a library. Do not add a `pathToFileURL` entry point.

- [ ] **Step 1: Write the failing test file**

Create `plugins/autopilot/scripts/autopilot-artifacts.test.mjs`:

```js
// The uploader is the one place in the plugin that signs a request and touches
// the network, so it is the one place a bug is expensive: a wrong signature is
// a 403 nobody sees, and a leaked secret is unrecoverable.
//
// Every test here injects `fetch`, so the suite touches no network. The SigV4
// assertions run against AWS's own published "Example: PUT Object" vector, so
// a signer that agrees with them agrees with S3.

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  ARTIFACT_KEYS,
  CREDENTIAL_KEYS,
  resolveArtifactsConfig,
  parseEnvFile,
  readCredentials,
  objectKey,
  amzDate,
  sigv4,
  uploadScreenshots,
} from "./autopilot-artifacts.mjs";
import { validateConfig } from "./autopilot-config.mjs";

const ARTIFACTS = {
  env_file: "apps/api/.env",
  bucket: "e2e-artifacts",
  public_base_url: "https://pub-abcd1234.r2.dev",
};

const ENV_TEXT = [
  "# credentials for the app's own bucket",
  "R2_ACCOUNT_ID=acct123",
  "R2_ACCESS_KEY_ID=AKIAEXAMPLE",
  'R2_SECRET_ACCESS_KEY="s3cr3t-value"',
  "R2_BUCKET=the-application-bucket",
].join("\n");

const rows = [
  { id: "AC1", status: "pass", screenshot: "/run/artifacts/a.png" },
  { id: "AC3", status: "fail", screenshot: "/run/artifacts/b.png" },
  { id: "AC5", status: "missing", screenshot: null },
];

/** A fetch that records its calls and always answers with `response`. */
function recordingFetch(response = { ok: true, status: 200 }) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return response;
  };
  impl.calls = calls;
  return impl;
}

function deps(overrides = {}) {
  return {
    readFile: () => ENV_TEXT,
    readBinary: () => Buffer.from("PNGDATA"),
    writeFile: () => {},
    fetchImpl: recordingFetch(),
    now: () => new Date("2026-08-26T12:34:56.000Z"),
    ...overrides,
  };
}

const call = (overrides = {}, d = deps()) =>
  uploadScreenshots(
    {
      config: { artifacts: ARTIFACTS },
      rows,
      repo: "custom_toolkit",
      run: "issue-42",
      round: 1,
      artifactsDir: "/run/artifacts",
      ...overrides,
    },
    d,
  );

describe("resolveArtifactsConfig", () => {
  it("accepts a complete block", () => {
    expect(resolveArtifactsConfig({ artifacts: ARTIFACTS })).toMatchObject({ ok: true });
  });

  it("names an absent block rather than reporting a missing key", () => {
    const result = resolveArtifactsConfig({});
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no `artifacts` block/);
  });

  it("rejects a flattened block instead of indexing into a string", () => {
    expect(resolveArtifactsConfig({ artifacts: "e2e-artifacts" }).ok).toBe(false);
  });

  // A silent skip and a misconfigured bucket are indistinguishable from the
  // ledger unless the reason says which key was missing.
  ARTIFACT_KEYS.forEach((key) => {
    it(`names ${key} individually when it is the only one missing`, () => {
      const artifacts = { ...ARTIFACTS };
      delete artifacts[key];
      const result = resolveArtifactsConfig({ artifacts });
      expect(result.ok).toBe(false);
      expect(result.reason).toContain(key);
      for (const other of ARTIFACT_KEYS.filter((k) => k !== key)) {
        expect(result.reason).not.toContain(other);
      }
    });
  });

  it("names every missing key when more than one is absent", () => {
    const result = resolveArtifactsConfig({ artifacts: { env_file: "apps/api/.env" } });
    expect(result.reason).toContain("bucket");
    expect(result.reason).toContain("public_base_url");
  });

  it("treats an empty string as missing, not as configured", () => {
    expect(resolveArtifactsConfig({ artifacts: { ...ARTIFACTS, bucket: "" } }).ok).toBe(false);
  });
});

// `artifacts` is deliberately NOT in autopilot-config.mjs's TOP_LEVEL list:
// that list is a hard error on absence, and every config that predates this
// feature — including this repository's own — has no artifacts block.
describe("a config with no artifacts block still validates", () => {
  const base = {
    roles: Object.fromEntries(
      [
        "brainstorm", "spec", "plan", "learnings", "verify", "implement",
        "implement_complex", "task_review", "re_review", "final_review",
        "fix_escalation",
      ].map((r) => [r, { model: "opus", effort: "high" }]),
    ),
    worktree_dir: ".claude/worktrees",
    base_ref: "origin/main",
    reaper: true,
    findings_threshold: 2,
    test_command: "npm test",
  };

  it("reports no error about artifacts", () => {
    const result = validateConfig(base, {});
    expect(result.ok).toBe(true);
    expect(result.errors.join(" ")).not.toContain("artifacts");
  });
});

describe("parseEnvFile", () => {
  it("reads plain, quoted and exported assignments and skips everything else", () => {
    const env = parseEnvFile(
      ["# a comment", "A=1", 'B="two"', "C='three'", "export D=4", "not a line"].join("\n"),
    );
    expect(env).toEqual({ A: "1", B: "two", C: "three", D: "4" });
  });
});

describe("readCredentials", () => {
  it("reads the three R2 variables and ignores the application's own bucket", () => {
    const result = readCredentials("apps/api/.env", () => ENV_TEXT);
    expect(result).toMatchObject({
      ok: true,
      credentials: {
        accountId: "acct123",
        accessKeyId: "AKIAEXAMPLE",
        secretAccessKey: "s3cr3t-value",
      },
    });
  });

  it("names the file when it cannot be read", () => {
    const result = readCredentials("apps/api/.env", () => {
      throw new Error("ENOENT");
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("apps/api/.env");
  });

  CREDENTIAL_KEYS.forEach((key) => {
    it(`names ${key} when it is the missing one`, () => {
      const text = ENV_TEXT.split("\n").filter((l) => !l.startsWith(`${key}=`)).join("\n");
      const result = readCredentials("apps/api/.env", () => text);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain(key);
    });
  });

  it("never puts a credential value in the reason", () => {
    const result = readCredentials("apps/api/.env", () => "R2_ACCOUNT_ID=acct123");
    expect(result.reason).not.toContain("acct123");
  });
});

describe("objectKey", () => {
  it("puts the round in the key so a fix round cannot overwrite round 1", () => {
    const one = objectKey({ repo: "custom_toolkit", run: "issue-42", round: 1, id: "AC3" });
    const two = objectKey({ repo: "custom_toolkit", run: "issue-42", round: 2, id: "AC3" });
    expect(one).toBe("custom_toolkit/issue-42/round-1/AC3.png");
    expect(two).toBe("custom_toolkit/issue-42/round-2/AC3.png");
    expect(one).not.toBe(two);
  });
});

describe("amzDate", () => {
  it("renders the basic-format timestamp SigV4 expects", () => {
    expect(amzDate(new Date("2026-08-26T12:34:56.789Z"))).toBe("20260826T123456Z");
  });
});
```

Continue the same file with the SigV4 vector and the upload behaviour:

```js
// AWS's published "Example: PUT Object" from the Signature Version 4 signing
// documentation. Every literal below is that example's: the access key, the
// secret, the date, the bucket host, the object path, and the resulting
// signature. A signer that reproduces them reproduces S3's.
describe("sigv4 against AWS's published PUT Object vector", () => {
  const PAYLOAD_SHA256 =
    "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072";

  const signed = () =>
    sigv4({
      method: "PUT",
      path: "/test%24file.text",
      headers: {
        date: "Fri, 24 May 2013 00:00:00 GMT",
        host: "examplebucket.s3.amazonaws.com",
        "x-amz-content-sha256": PAYLOAD_SHA256,
        "x-amz-date": "20130524T000000Z",
        "x-amz-storage-class": "REDUCED_REDUNDANCY",
      },
      payloadSha256: PAYLOAD_SHA256,
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "us-east-1",
      service: "s3",
      amzDate: "20130524T000000Z",
    });

  it("builds the documented canonical request", () => {
    expect(signed().canonicalRequest).toBe(
      [
        "PUT",
        "/test%24file.text",
        "",
        "date:Fri, 24 May 2013 00:00:00 GMT",
        "host:examplebucket.s3.amazonaws.com",
        `x-amz-content-sha256:${PAYLOAD_SHA256}`,
        "x-amz-date:20130524T000000Z",
        "x-amz-storage-class:REDUCED_REDUNDANCY",
        "",
        "date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class",
        PAYLOAD_SHA256,
      ].join("\n"),
    );
  });

  it("builds the documented string to sign", () => {
    expect(signed().stringToSign).toBe(
      [
        "AWS4-HMAC-SHA256",
        "20130524T000000Z",
        "20130524/us-east-1/s3/aws4_request",
        "9e0e90d9c76de8fa5b200d8c849cd5b8dc7a3be3951ddb7f6a76b4158342019d",
      ].join("\n"),
    );
  });

  it("derives the documented signature", () => {
    expect(signed().signature).toBe(
      "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd",
    );
  });

  it("assembles an Authorization header naming the key, scope and signed headers", () => {
    expect(signed().authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
        "SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class, " +
        "Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd",
    );
  });

  it("sorts and lowercases header names rather than trusting insertion order", () => {
    const out = sigv4({
      method: "PUT",
      path: "/k",
      headers: { "X-Amz-Date": "20130524T000000Z", Host: "h" },
      payloadSha256: "abc",
      accessKeyId: "k",
      secretAccessKey: "s",
      region: "auto",
      service: "s3",
      amzDate: "20130524T000000Z",
    });
    expect(out.canonicalRequest).toContain("host:h\nx-amz-date:20130524T000000Z");
  });
});

describe("uploadScreenshots issues one signed PUT per screenshot", () => {
  it("PUTs to the account's R2 endpoint as image/png", async () => {
    const fetchImpl = recordingFetch();
    const result = await call({}, deps({ fetchImpl }));
    expect(result.ok).toBe(true);
    expect(fetchImpl.calls).toHaveLength(2);
    const [first] = fetchImpl.calls;
    expect(first.url).toBe(
      "https://acct123.r2.cloudflarestorage.com/e2e-artifacts/custom_toolkit/issue-42/round-1/AC1.png",
    );
    expect(first.init.method).toBe("PUT");
    expect(first.init.headers["content-type"]).toBe("image/png");
    expect(first.init.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\//);
    expect(first.init.headers["x-amz-content-sha256"]).toBe(
      createHash("sha256").update(Buffer.from("PNGDATA")).digest("hex"),
    );
  });

  it("skips a criterion with no screenshot rather than uploading a placeholder", async () => {
    const fetchImpl = recordingFetch();
    await call({}, deps({ fetchImpl }));
    expect(fetchImpl.calls.map((c) => c.url).join(" ")).not.toContain("AC5");
  });

  it("writes the manifest with base, prefix and one item per uploaded image", async () => {
    const written = [];
    const result = await call({}, deps({ writeFile: (p, s) => written.push([p, s]) }));
    expect(result.path).toBe("/run/artifacts/uploads.json");
    expect(written[0][0]).toBe("/run/artifacts/uploads.json");
    expect(JSON.parse(written[0][1])).toEqual({
      base: "https://pub-abcd1234.r2.dev",
      prefix: "custom_toolkit/issue-42/round-1",
      items: [
        {
          id: "AC1",
          status: "pass",
          url: "https://pub-abcd1234.r2.dev/custom_toolkit/issue-42/round-1/AC1.png",
        },
        {
          id: "AC3",
          status: "fail",
          url: "https://pub-abcd1234.r2.dev/custom_toolkit/issue-42/round-1/AC3.png",
        },
      ],
    });
    expect(result.manifest).toEqual(JSON.parse(written[0][1]));
  });

  it("does not double the slash when public_base_url carries a trailing one", async () => {
    const result = await call({
      config: { artifacts: { ...ARTIFACTS, public_base_url: "https://pub-abcd1234.r2.dev/" } },
    });
    expect(result.manifest.items[0].url).toBe(
      "https://pub-abcd1234.r2.dev/custom_toolkit/issue-42/round-1/AC1.png",
    );
  });

  it("keeps no credential anywhere in the manifest", async () => {
    const result = await call();
    const text = JSON.stringify(result.manifest);
    for (const secret of ["acct123", "AKIAEXAMPLE", "s3cr3t-value"]) {
      expect(text).not.toContain(secret);
    }
  });
});

describe("uploadScreenshots skips, and never throws, on every failure path", () => {
  const reasonOf = async (overrides, d) => {
    const result = await call(overrides, d);
    expect(result.ok).toBe(false);
    expect(result.manifest).toBeUndefined();
    return result.reason;
  };

  it("skips when there is no artifacts block", async () => {
    expect(await reasonOf({ config: {} })).toMatch(/no `artifacts` block/);
  });

  it("skips and names the key when the config is incomplete", async () => {
    const artifacts = { ...ARTIFACTS };
    delete artifacts.public_base_url;
    expect(await reasonOf({ config: { artifacts } })).toContain("public_base_url");
  });

  it("skips and names the env file when it cannot be read", async () => {
    const reason = await reasonOf({}, deps({
      readFile: () => {
        throw new Error("ENOENT");
      },
    }));
    expect(reason).toContain("apps/api/.env");
  });

  it("skips and names the variable when the env file is incomplete", async () => {
    const reason = await reasonOf({}, deps({ readFile: () => "R2_ACCOUNT_ID=acct123" }));
    expect(reason).toContain("R2_ACCESS_KEY_ID");
  });

  it("skips when no criterion produced a screenshot", async () => {
    expect(await reasonOf({ rows: [{ id: "AC5", status: "missing", screenshot: null }] }))
      .toMatch(/no screenshots/i);
  });

  it("skips and names the criterion when an image cannot be read", async () => {
    const reason = await reasonOf({}, deps({
      readBinary: () => {
        throw new Error("ENOENT");
      },
    }));
    expect(reason).toContain("AC1");
  });

  it("skips and names the status code when a PUT is rejected", async () => {
    const reason = await reasonOf({}, deps({
      fetchImpl: recordingFetch({ ok: false, status: 403 }),
    }));
    expect(reason).toContain("403");
    expect(reason).toContain("AC1");
  });

  it("skips rather than rejecting when fetch itself throws, and leaks nothing", async () => {
    const reason = await reasonOf({}, deps({
      fetchImpl: async () => {
        throw new TypeError("fetch failed: authorization=AWS4-HMAC-SHA256 s3cr3t-value");
      },
    }));
    expect(reason).toBeTruthy();
    expect(reason).not.toContain("s3cr3t-value");
  });

  it("writes no manifest at all when a PUT fails", async () => {
    const written = [];
    await call({}, deps({
      fetchImpl: recordingFetch({ ok: false, status: 500 }),
      writeFile: (p, s) => written.push([p, s]),
    }));
    expect(written).toHaveLength(0);
  });

  it("skips rather than throwing when called with nothing at all", async () => {
    await expect(uploadScreenshots()).resolves.toMatchObject({ ok: false });
  });
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-artifacts.test.mjs`

Expected: FAIL — `Cannot find module './autopilot-artifacts.mjs'`.

- [ ] **Step 3: Write the module — config, env and keys**

Create `plugins/autopilot/scripts/autopilot-artifacts.mjs` with this first half:

```js
import { createHash, createHmac } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Publish the verify stage's screenshots to an S3-compatible bucket.
 *
 * Two constraints shape everything here. The plugin has zero runtime
 * dependencies — that is what lets it install from a marketplace and run
 * against any repository without an install step of its own — so
 * `@aws-sdk/client-s3` is out, and so is invoking the `aws` CLI, which
 * would add an unstated machine prerequisite of exactly the kind the skill
 * already treats as a park condition. SigV4 is about forty lines of HMAC
 * chaining over `node:crypto` and is exactly testable against a known-answer
 * vector, so this module signs its own requests.
 *
 * And nothing here may park a run. The run's product is the pull request;
 * missing evidence is a reporting defect. Every failure path returns
 * `{ ok: false, reason }` naming which piece was missing, because a silent skip
 * and a misconfigured bucket are indistinguishable from the ledger otherwise.
 *
 * No credential value ever appears in a reason, in the manifest, or in
 * anything this module returns — only variable names and key names do.
 */

/** The `artifacts` config keys, in report order. */
export const ARTIFACT_KEYS = ["env_file", "bucket", "public_base_url"];

/** The env-file variables the signer needs, in report order. */
export const CREDENTIAL_KEYS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
];

const sha256Hex = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

const blank = (v) => v === undefined || v === null || v === "";

/**
 * Read the `artifacts` block, naming each missing key individually.
 *
 * A flattened `"artifacts": "bucket-name"` is rejected outright rather than
 * indexed into: unchecked, it would report all three keys missing and read as a
 * block nobody ever wrote.
 */
export function resolveArtifactsConfig(config) {
  const artifacts = config?.artifacts;
  if (!artifacts || typeof artifacts !== "object" || Array.isArray(artifacts)) {
    return {
      ok: false,
      reason:
        "no `artifacts` block in .claude/autopilot.json — add env_file, " +
        "bucket and public_base_url to publish screenshots",
    };
  }
  const missing = ARTIFACT_KEYS.filter((key) => blank(artifacts[key]));
  if (missing.length > 0) {
    return { ok: false, reason: `artifacts config is missing ${missing.join(", ")}` };
  }
  return { ok: true, artifacts };
}

/**
 * Parse a dotenv-style file into a plain object.
 *
 * Deliberately minimal: `KEY=value`, optionally `export`-prefixed, with one
 * layer of surrounding quotes stripped. Anything else is skipped, comments
 * included, because the file belongs to the consuming project and autopilot
 * only ever reads three names out of it.
 */
export function parseEnvFile(text) {
  const out = {};
  for (const line of String(text ?? "").split("\n")) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
    out[match[1]] = value;
  }
  return out;
}

/**
 * Read the R2 credentials out of the project's own env file.
 *
 * Naming the file reuses credentials that already exist in the consuming
 * project: nothing is copied, no new secret is created, and no secret ever
 * enters `.claude/autopilot.json`. `R2_BUCKET` in that same file names the
 * *application's* bucket and is deliberately not read — the artifacts bucket
 * comes from config, so test evidence never lands in production storage.
 */
export function readCredentials(envPath, readFile = (p) => readFileSync(p, "utf8")) {
  let text;
  try {
    text = readFile(envPath);
  } catch {
    return { ok: false, reason: `env file ${envPath} could not be read` };
  }
  const env = parseEnvFile(text);
  const missing = CREDENTIAL_KEYS.filter((key) => blank(env[key]));
  if (missing.length > 0) {
    return { ok: false, reason: `env file ${envPath} is missing ${missing.join(", ")}` };
  }
  return {
    ok: true,
    credentials: {
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  };
}

/**
 * `<repo>/<run>/round-<n>/<CRITERION_ID>.png`.
 *
 * The round is in the key so a verify fix round never overwrites round 1's
 * evidence — which matters precisely in the case a reviewer cares about most:
 * a criterion that was red, got a fix round, and went green. Both images
 * survive, and the issue thread shows the before and the after.
 */
export function objectKey({ repo, run, round, id }) {
  return `${repo}/${run}/round-${round}/${id}.png`;
}

/** SigV4's basic-format timestamp: `YYYYMMDDTHHMMSSZ`. */
export const amzDate = (date) =>
  `${date.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
```

- [ ] **Step 4: Write the module — signing, the PUT, and the manifest**

Append the second half to the same file:

```js
/**
 * Sign a request with AWS Signature Version 4.
 *
 * `path` arrives already URI-encoded — the caller owns encoding — so this stays
 * a pure function of strings and can be run directly against AWS's published
 * test vectors. That is the whole point: a signer nobody can check against a
 * known answer fails as a 403 with no explanation.
 */
export function sigv4({
  method,
  path,
  query = "",
  headers,
  payloadSha256,
  accessKeyId,
  secretAccessKey,
  region,
  service,
  amzDate: stamp,
}) {
  const lower = {};
  for (const [name, value] of Object.entries(headers)) {
    lower[name.toLowerCase()] = String(value).trim();
  }
  const names = Object.keys(lower).sort();
  const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [
    method,
    path,
    query,
    canonicalHeaders,
    signedHeaders,
    payloadSha256,
  ].join("\n");

  const dateStamp = stamp.slice(0, 8);
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    stamp,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  let key = hmac(`AWS4${secretAccessKey}`, dateStamp);
  for (const part of [region, service, "aws4_request"]) key = hmac(key, part);
  const signature = createHmac("sha256", key).update(stringToSign).digest("hex");

  return {
    canonicalRequest,
    stringToSign,
    signature,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

const encodePath = (path) => path.split("/").map(encodeURIComponent).join("/");

/** One signed PUT. `fetch` is injected so the test suite touches no network. */
export async function putObject({
  accountId,
  bucket,
  key,
  body,
  credentials,
  contentType = "image/png",
  fetchImpl = fetch,
  now = () => new Date(),
}) {
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const path = encodePath(`/${bucket}/${key}`);
  const stamp = amzDate(now());
  const payloadSha256 = sha256Hex(body);
  const headers = {
    host,
    "content-type": contentType,
    "x-amz-content-sha256": payloadSha256,
    "x-amz-date": stamp,
  };
  const { authorization } = sigv4({
    method: "PUT",
    path,
    headers,
    payloadSha256,
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    region: "auto",
    service: "s3",
    amzDate: stamp,
  });
  const response = await fetchImpl(`https://${host}${path}`, {
    method: "PUT",
    headers: { ...headers, authorization },
    body,
  });
  return { ok: response?.ok === true, status: response?.status ?? 0 };
}

/**
 * Upload every captured screenshot and write the manifest.
 *
 * All or nothing: one failed PUT abandons the whole batch and writes no
 * manifest, so neither consumer ever renders half a list and calls it the
 * evidence. Every `deps` key defaults on its own, so a partial `deps` object
 * from a test or a future caller cannot throw.
 */
export async function uploadScreenshots(
  { config, rows, repo, run, round = 1, artifactsDir } = {},
  deps = {},
) {
  const readFile = deps.readFile ?? ((p) => readFileSync(p, "utf8"));
  const readBinary = deps.readBinary ?? ((p) => readFileSync(p));
  const writeFile = deps.writeFile ?? ((p, s) => writeFileSync(p, s, "utf8"));
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => new Date());

  try {
    const resolved = resolveArtifactsConfig(config);
    if (!resolved.ok) return { ok: false, reason: resolved.reason };
    const { env_file, bucket, public_base_url } = resolved.artifacts;

    const creds = readCredentials(env_file, readFile);
    if (!creds.ok) return { ok: false, reason: creds.reason };

    const shots = (rows ?? []).filter((row) => row?.screenshot);
    if (shots.length === 0) {
      return { ok: false, reason: "no screenshots were captured for any ui criterion" };
    }

    const base = String(public_base_url).replace(/\/+$/, "");
    const prefix = `${repo}/${run}/round-${round}`;
    const items = [];

    for (const row of shots) {
      const key = objectKey({ repo, run, round, id: row.id });
      let body;
      try {
        body = readBinary(row.screenshot);
      } catch {
        return { ok: false, reason: `screenshot for ${row.id} could not be read` };
      }
      const put = await putObject({
        accountId: creds.credentials.accountId,
        bucket,
        key,
        body,
        credentials: creds.credentials,
        fetchImpl,
        now,
      });
      if (!put.ok) {
        return { ok: false, reason: `upload of ${row.id} failed with HTTP ${put.status}` };
      }
      items.push({ id: row.id, status: row.status, url: `${base}/${key}` });
    }

    const manifest = { base, prefix, items };
    const path = join(artifactsDir, "uploads.json");
    writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
    return { ok: true, manifest, path };
  } catch (err) {
    // The reason is built from the error's constructor name, never its
    // message: a thrown fetch error can quote the request it failed on, and
    // the Authorization header in that request is derived from the secret key.
    return { ok: false, reason: `screenshot upload failed (${err?.name ?? "Error"})` };
  }
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-artifacts.test.mjs`

Expected: PASS, every test.

- [ ] **Step 6: Prove the SigV4 assertions can actually fail**

Temporarily swap the signing-key chain from `[region, service, "aws4_request"]` to `[service, region, "aws4_request"]` and re-run. "derives the documented signature" must go red. Put it back and re-run; it must go green again. A known-answer vector that cannot fail is decoration, not a test.

- [ ] **Step 7: Confirm the zero-dependency constraint still holds**

Run these three checks:

```bash
grep -n "^import" plugins/autopilot/scripts/autopilot-artifacts.mjs
grep -c "dependencies" package.json
grep -n "child_process" plugins/autopilot/scripts/autopilot-artifacts.mjs
```

Expected: every import line names a `node:` builtin; `package.json` mentions only `devDependencies`; the third grep prints nothing.

- [ ] **Step 8: Run the whole suite and commit**

```bash
npm test
git add plugins/autopilot/scripts/autopilot-artifacts.mjs plugins/autopilot/scripts/autopilot-artifacts.test.mjs
git commit -m "feat(artifacts): sign and upload verify screenshots to R2 with node:crypto alone"
```

---

## Task 3: Publish to the PR — the screenshot column, the wiring, and the prose

**Satisfies:** AC4, AC14, AC15, AC20, AC21, AC22, AC23, AC24, and the second half of AC26.

**Files:**
- Modify: `plugins/autopilot/scripts/autopilot-verify.mjs` (imports, `formatVerifySection`, `verify`, `main`)
- Modify: `plugins/autopilot/skills/autopilot/SKILL.md` (`verify` stage: a new `#### Screenshots` subsection; `pr` stage: one rewritten paragraph)
- Test: `plugins/autopilot/scripts/autopilot-verify.test.mjs`
- Test: `plugins/autopilot/scripts/autopilot-verify-contract.test.mjs`

**Interfaces:**
- Consumes: `uploadScreenshots(...)` from Task 2; `row.screenshot` from Task 1.
- Produces:
  - `formatVerifySection(rows, { artifactsDir, skipped, manifest })` — the new option is `manifest`, the object Task 2 returns as `result.manifest`.
  - `verify(...)` resolves with an added `uploadSkipped: string | null`.
  - `main`'s `run` branch prints one extra line, `upload: skipped — <reason>`, only when `uploadSkipped` is set.

**Prose this task falsifies and must also fix:**
- `formatVerifySection`'s doc comment: "Kept text-only: artifacts stay local to the run." — no longer true.
- `autopilot/SKILL.md`'s `pr` stage paragraph beginning "Screenshots and traces stay local to the run directory" — must be rewritten; `autopilot-verify-contract.test.mjs` pins that sentence and must be rewritten with it, or `npm test` goes red.

- [ ] **Step 1: Write the failing unit tests**

In `plugins/autopilot/scripts/autopilot-verify.test.mjs`, add to the existing `describe("formatVerifySection", ...)` block:

```js
  const manifest = {
    base: "https://pub-abcd1234.r2.dev",
    prefix: "custom_toolkit/issue-42/round-1",
    items: [
      {
        id: "AC1",
        status: "pass",
        url: "https://pub-abcd1234.r2.dev/custom_toolkit/issue-42/round-1/AC1.png",
      },
      {
        id: "AC3",
        status: "fail",
        url: "https://pub-abcd1234.r2.dev/custom_toolkit/issue-42/round-1/AC3.png",
      },
    ],
  };

  it("adds a screenshot column built from the manifest", () => {
    const md = formatVerifySection(rows, { artifactsDir: "/run/artifacts", manifest });
    expect(md).toContain("| Criterion | Result | Screenshot |");
    expect(md).toContain("| --- | --- | --- |");
    expect(md).toContain(
      "[![AC1](https://pub-abcd1234.r2.dev/custom_toolkit/issue-42/round-1/AC1.png)]" +
        "(https://pub-abcd1234.r2.dev/custom_toolkit/issue-42/round-1/AC1.png)",
    );
    expect(md).toContain("1/2 UI criteria verified");
  });

  it("leaves an em dash in the column for a criterion the manifest does not cover", () => {
    const partial = { ...manifest, items: [manifest.items[0]] };
    const md = formatVerifySection(rows, { artifactsDir: "/run/artifacts", manifest: partial });
    expect(md).toContain("| AC3 — spinner | ❌ expected visible | — |");
  });

  // Byte-identical output is what keeps every repository with no `artifacts`
  // block unaffected by this feature. Compare the whole string, not a phrase.
  it("renders exactly the two-column form when there is no manifest", () => {
    const withoutOption = formatVerifySection(rows, { artifactsDir: "/run/artifacts" });
    const withEmptyManifest = formatVerifySection(rows, {
      artifactsDir: "/run/artifacts",
      manifest: { base: "b", prefix: "p", items: [] },
    });
    expect(withoutOption).toBe(withEmptyManifest);
    expect(withoutOption).toContain("| Criterion | Result |");
    expect(withoutOption).not.toContain("Screenshot");
    expect(withoutOption).toContain("Artifacts (local to the run): `/run/artifacts`");
  });

  it("still renders the skipped form when a manifest is passed alongside it", () => {
    const md = formatVerifySection([], { skipped: "no ui criteria", manifest });
    expect(md).toContain("Skipped — no ui criteria.");
    expect(md).not.toContain("| Criterion |");
  });
```

- [ ] **Step 2: Write the failing contract tests**

In `plugins/autopilot/scripts/autopilot-verify-contract.test.mjs`, **replace** this test entirely:

```js
  it("is honest that screenshots do not reach the PR", () => {
    const pr = unwrap(skill.slice(skill.indexOf("### `pr`")));
    expect(pr).toMatch(/stay local to the run directory and are \*{0,2}not\*{0,2} attached/i);
  });
```

with:

```js
  // The old sentence said screenshots never reach the PR. They do now, through
  // a URL rather than through the repository, and a skill that asserts the
  // opposite of what the pipeline does is worse than one that says nothing.
  it("describes the manifest-driven screenshots and how they degrade", () => {
    const pr = unwrap(skill.slice(skill.indexOf("### `pr`")));
    expect(pr).toContain("uploads.json");
    expect(pr).toMatch(/with no manifest/i);
    expect(pr).toMatch(/this stage formats nothing|concatenates/i);
    expect(pr).not.toMatch(/stay local to the run directory and are \*{0,2}not\*{0,2} attached/i);
  });

  // An r2.dev Public Development URL is world-readable. A reader must not have
  // to infer that from the phrase "public development URL".
  it("says plainly that the published images are world-readable", () => {
    const pr = unwrap(skill.slice(skill.indexOf("### `pr`")));
    expect(pr).toMatch(/world-readable/i);
    expect(pr).toMatch(/anyone with the link/i);
  });
```

Then add these two tests. The first goes inside `describe("verify outcomes", ...)`; the second inside `describe("verify token contract", ...)`, beside the existing "forbids reading screenshots and the raw results file back" test:

```js
  it("names the screenshot-upload skip line and its park ordering", () => {
    expect(verify).toContain("verify: screenshot upload skipped — <reason>");
    expect(verify).toMatch(/does not park/i);
    expect(verify).toMatch(/before[^.]{0,120}PARKED/i);
  });
```

```js
  // The whole point of deriving the criterion-to-image mapping from the JSON
  // report is that the agent never learns a screenshot exists. Publishing them
  // must not have leaked a single path, filename or manifest into the prompt.
  it("still asks the agent for no screenshot of any kind", () => {
    expect(verifyPrompt).toMatch(/never read a screenshot back/i);
    expect(verifyPrompt).not.toMatch(/uploads\.json/);
    expect(verifyPrompt).not.toMatch(/\.png/);
    expect(verifyPrompt).not.toMatch(/r2\.dev/);
  });
```

- [ ] **Step 3: Run both test files and watch them fail**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-verify.test.mjs plugins/autopilot/scripts/autopilot-verify-contract.test.mjs`

Expected: FAIL. The unit tests fail because `formatVerifySection` ignores `manifest`; the contract tests fail because SKILL.md still carries the old sentence and no `#### Screenshots` subsection.

- [ ] **Step 4: Render the screenshot column**

In `plugins/autopilot/scripts/autopilot-verify.mjs`, replace the whole of `formatVerifySection`, doc comment included:

```js
/**
 * The PR body section.
 *
 * Two shapes, decided by one thing: whether the upload produced a manifest.
 * With one, each row gains a thumbnail that links to the full image, so a
 * reviewer reading `AC3 — ✅` sees what the browser saw instead of trusting a
 * line of markdown a script wrote. With none — no `artifacts` block, an
 * unreadable env file, a failed PUT — this renders byte-for-byte what it
 * rendered before screenshots existed. That equivalence is the feature's whole
 * safety story, and it is pinned by a test.
 *
 * The local artifacts path is named in both shapes: the trace beside each
 * screenshot is never uploaded, and it is on disk either way.
 */
export function formatVerifySection(rows, { artifactsDir, skipped, manifest } = {}) {
  const lines = ["## Browser verification", ""];
  if (skipped) {
    lines.push(`Skipped — ${skipped}.`);
    return lines.join("\n");
  }

  const shots = new Map((manifest?.items ?? []).map((item) => [item.id, item.url]));
  const withShots = shots.size > 0;

  lines.push(
    withShots ? "| Criterion | Result | Screenshot |" : "| Criterion | Result |",
    withShots ? "| --- | --- | --- |" : "| --- | --- |",
  );
  const mark = { pass: "✅", fail: "❌", missing: "⚠️ not covered" };
  for (const row of rows) {
    const label = `${row.id} — ${row.text}`.replaceAll("|", "\\|");
    const detail = row.status === "pass" ? "" : ` ${(row.message ?? "").replaceAll("|", "\\|")}`;
    if (!withShots) {
      lines.push(`| ${label} | ${mark[row.status]}${detail} |`);
      continue;
    }
    const url = shots.get(row.id);
    // A linked thumbnail rather than a bare image: GitHub scales it to the
    // column, and the click still reaches full size.
    const cell = url ? `[![${row.id}](${url})](${url})` : "—";
    lines.push(`| ${label} | ${mark[row.status]}${detail} | ${cell} |`);
  }

  const passed = rows.filter((r) => r.status === "pass").length;
  lines.push("", `${passed}/${rows.length} UI criteria verified · Chromium`);
  if (artifactsDir) lines.push(`Artifacts (local to the run): \`${artifactsDir}\``);
  return lines.join("\n");
}
```

- [ ] **Step 5: Call the uploader from `verify()`**

Add to the imports at the top of `plugins/autopilot/scripts/autopilot-verify.mjs`:

```js
import { basename } from "node:path";
import { uploadScreenshots } from "./autopilot-artifacts.mjs";
```

`join` and `resolve as resolvePath` are already imported from `node:path`; add `basename` to the existing `import { join } from "node:path";` line rather than adding a third import from the same module.

Then, inside `verify()`, replace these two lines:

```js
    const rows = attribute(parsed.criteria, summary);
    writeFileSync(join(runDir, "pr-section.md"), formatVerifySection(rows, { artifactsDir }), "utf8");
```

with:

```js
    const rows = attribute(parsed.criteria, summary);

    // The upload is inside the stage rather than dispatched, and the manifest
    // is handed straight to the formatter rather than read back off disk: the
    // criterion-to-image mapping is derived from Playwright's own report, and
    // no agent is asked about a screenshot at any point.
    //
    // `runDir` is `<base>/<run>/verify`, so the run name is its parent's
    // basename — the same one-level-up move `appendFindings` makes for the
    // findings corpus.
    const upload = await uploadScreenshots({
      config,
      rows,
      repo: basename(resolvePath(cwd)),
      run: basename(resolvePath(join(runDir, ".."))),
      round,
      artifactsDir,
    });

    writeFileSync(
      join(runDir, "pr-section.md"),
      formatVerifySection(rows, {
        artifactsDir,
        manifest: upload.ok ? upload.manifest : undefined,
      }),
      "utf8",
    );
```

Then add `uploadSkipped` to the object `verify()` returns, beside `artifactsDir`:

```js
      artifactsDir,
      uploadSkipped: upload.ok ? null : upload.reason,
```

- [ ] **Step 6: Surface the skip on stdout**

In `main()`'s `run` branch, after the two existing `console.log` calls and before `process.exitCode` is set:

```js
    if (result.uploadSkipped) console.log(`upload: skipped — ${result.uploadSkipped}`);
```

Printed, never appended: this script does not write the ledger, and the orchestrator's ordering around `PARKED` is the reason why. Step 7's prose is what turns this line into a ledger entry.

- [ ] **Step 7: Rewrite the two pieces of SKILL.md prose**

In `plugins/autopilot/skills/autopilot/SKILL.md`, in the `### \`verify\`` stage, immediately after the line `Append: \`verify: <n>/<n> ui criteria passed\`.` at the end of `#### Outcomes`, insert this new subsection:

````markdown
#### Screenshots

When the project's `.claude/autopilot.json` carries an `artifacts` block, the
`run` subcommand also uploads one screenshot per UI criterion to the configured
bucket and writes `verify/artifacts/uploads.json`. Nothing is dispatched and
nothing is configured at this stage: the script does it, and the
criterion-to-image mapping is derived from Playwright's JSON report, never from
the agent — which is why the browser-verification contract's rule 4 still
stands untouched.

When it cannot — no `artifacts` block, an unreadable env file, a missing
credential, a failed upload — the run **does not park**. The section degrades to
its text-only form and the script prints one extra line:

```
upload: skipped — <reason>
```

Append `verify: screenshot upload skipped — <reason>` when, and only when, that
line is printed. Place it immediately **after** this stage's own `verify:`
entry — or, when the stage is parking, immediately **before** the
`PARKED — <reason>` entry, in the same step. `PARKED` must stay the ledger's
last entry, or `nextStage` stops returning `parked` and a parked run reads as
resumable.

A repository with no `artifacts` block prints no such line and appends none. Its
ledger, its PR body section and its issue comments are exactly what they were
before screenshots existed — that is the point, and it needs no feature flag.
````

Then, in the `### \`pr\`` stage, **replace** this paragraph:

```markdown
Screenshots and traces stay local to the run directory and are **not** attached
to the PR: `gh pr edit` takes markdown, and an image only renders from a URL,
which would mean committing the files. The section names the artifact path
instead.
```

with:

```markdown
Screenshots reach the PR through a URL, not through the repository. When the
project configures an `artifacts` block, the `verify` stage has already uploaded
one image per UI criterion and written `verify/artifacts/uploads.json`, and the
section it wrote already carries a `Screenshot` column built from that manifest
— so this stage still concatenates and still formats nothing. With no manifest,
the section renders exactly as it always has: text-only, naming the local
artifact path. Traces are never uploaded. They are a debugging artifact for a
human at a terminal, and they stay local.

An r2.dev public development URL is **world-readable**. Anything visible in a
verified screenshot — seeded user data, an internal admin surface, a staging
banner — is public to anyone with the link. That is an acceptable trade for a
bucket seeded with fixture data and an unacceptable one for a bucket that ever
sees production screens, so point `artifacts` at the former.
```

- [ ] **Step 8: Run the whole suite**

Run: `npm test`

Expected: PASS. If `skill-sections`-based tests complain about section boundaries, check that the new `#### Screenshots` heading uses four hashes — `sectionOf` ends a stage at `###` or shallower, so a three-hash heading would truncate the `verify` section and silently drop assertions.

- [ ] **Step 9: Prove the byte-identical claim by hand**

```bash
node -e "import('./plugins/autopilot/scripts/autopilot-verify.mjs').then((m)=>{const rows=[{id:'AC1',text:'x',status:'pass',message:null,screenshot:null}];console.log(JSON.stringify(m.formatVerifySection(rows,{artifactsDir:'/run/a'})))})"
```

Expected: a two-column table, a pass count, and the `Artifacts (local to the run)` line — no `Screenshot` column anywhere.

- [ ] **Step 10: Commit**

```bash
git add plugins/autopilot/scripts/autopilot-verify.mjs plugins/autopilot/scripts/autopilot-verify.test.mjs plugins/autopilot/scripts/autopilot-verify-contract.test.mjs plugins/autopilot/skills/autopilot/SKILL.md
git commit -m "feat(verify): render uploaded screenshots in the PR body and document the degradation"
```

---

## Task 4: Publish to the issue — the `screenshots` subcommand and Delta 3d

**Satisfies:** AC16, AC17, AC18, AC19, AC27, and the issue-comment half of AC21.

**Files:**
- Modify: `plugins/autopilot/scripts/autopilot-github-issue.mjs` (`GITHUB_LEDGER_LINES`, a new `screenshotComment`, the `screenshots` branch of `main`, `USAGE`)
- Modify: `plugins/autopilot/skills/autopilot-github/SKILL.md` (the commands block, the ledger-lines block, a new Delta 3d)
- Test: `plugins/autopilot/scripts/autopilot-github-issue.test.mjs`
- Test: `plugins/autopilot/scripts/autopilot-github-contract.test.mjs`
- Test: `plugins/autopilot/scripts/autopilot-github-ledger-coupling.test.mjs`

**Interfaces:**
- Consumes: the manifest Task 2 writes to `.superpowers/autopilot/<run>/verify/artifacts/uploads.json`.
- Produces:
  - `GITHUB_LEDGER_LINES` gains `"github: verify screenshots posted"` at index 2 (pipeline order).
  - `screenshotComment(manifest) -> string`
  - `main` gains a `screenshots` command taking `--issue <n> --manifest <path>`.

**Prose, test names and one hard-coded array this task falsifies and must also fix — five places say "five" or "four" and every one of them is now wrong:**
1. `autopilot-github-issue.mjs`'s doc comment above `GITHUB_LEDGER_LINES`: "The five ledger lines the autopilot-github wrapper's hooks append" → six.
2. `autopilot-github/SKILL.md`: "The five lines, in pipeline order:" → six.
3. `autopilot-github-contract.test.mjs`: `describe("the five github: ledger lines", ...)` → six. The loop inside already derives from the array; only the name is wrong.
4. `autopilot-github-contract.test.mjs`: `it("names all four subcommands of the script", ...)` → five, and add `"screenshots"` to its list.
5. `autopilot-github-issue.test.mjs`: `describe("GITHUB_LEDGER_LINES", ...)` holds a `toEqual` against the literal five-element array. **This one fails the build if it is missed** — the other four only go stale. Rename it to "the six lines" and add `"github: verify screenshots posted"` in pipeline order, third.

- [ ] **Step 1: Write the failing tests**

In `plugins/autopilot/scripts/autopilot-github-issue.test.mjs`, add:

```js
describe("screenshotComment", () => {
  const manifest = {
    base: "https://pub-abcd1234.r2.dev",
    prefix: "custom_toolkit/issue-42/round-1",
    items: [
      { id: "AC1", status: "pass", url: "https://pub-abcd1234.r2.dev/x/AC1.png" },
      { id: "AC3", status: "fail", url: "https://pub-abcd1234.r2.dev/x/AC3.png" },
    ],
  };

  it("embeds one image per criterion, with its status beside it", () => {
    const body = screenshotComment(manifest);
    expect(body).toContain("![AC1](https://pub-abcd1234.r2.dev/x/AC1.png)");
    expect(body).toContain("![AC3](https://pub-abcd1234.r2.dev/x/AC3.png)");
    expect(body).toContain("**AC1**");
    expect(body).toContain("pass");
    expect(body).toContain("fail");
  });

  it("names the run prefix so two rounds are told apart in the thread", () => {
    expect(screenshotComment(manifest)).toContain("custom_toolkit/issue-42/round-1");
  });

  it("warns in the comment itself that the images are public", () => {
    expect(screenshotComment(manifest)).toMatch(/anyone with the link/i);
  });
});

// Same conventions as `describe("main — move and comment")` above: reset
// process.exitCode around each case, and capture console output through vi.
describe("main — screenshots", () => {
  beforeEach(() => {
    process.exitCode = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  const capture = () => {
    const out = [];
    vi.spyOn(console, "log").mockImplementation((m) => out.push(String(m)));
    vi.spyOn(console, "error").mockImplementation((m) => out.push(String(m)));
    return out;
  };

  const manifest = {
    base: "https://pub-abcd1234.r2.dev",
    prefix: "custom_toolkit/issue-42/round-1",
    items: [{ id: "AC1", status: "pass", url: "https://pub-abcd1234.r2.dev/x/AC1.png" }],
  };

  const recorder = (calls) => (args) => {
    calls.push(args);
    return ok("https://github.com/o/r/issues/42#c1");
  };

  it("posts one issue comment carrying the images", () => {
    capture();
    const calls = [];
    main(
      ["screenshots", "--issue", "42", "--manifest", "/run/uploads.json"],
      recorder(calls),
      undefined,
      { readFile: () => JSON.stringify(manifest) },
    );
    expect(process.exitCode).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("issue");
    expect(calls[0][1]).toBe("comment");
    expect(calls[0].join(" ")).toContain("![AC1](https://pub-abcd1234.r2.dev/x/AC1.png)");
  });

  // A repository with no `artifacts` block must reach exactly the ledger it
  // reached before this hook existed: nothing posted, nothing appended, and
  // above all no non-zero exit for the wrapper to record as a failure.
  it("is a clean no-op when the manifest is absent", () => {
    const out = capture();
    const calls = [];
    main(
      ["screenshots", "--issue", "42", "--manifest", "/run/uploads.json"],
      recorder(calls),
      undefined,
      {
        readFile: () => {
          throw new Error("ENOENT");
        },
      },
    );
    expect(process.exitCode).toBe(0);
    expect(calls).toHaveLength(0);
    expect(out.join("\n")).toContain("skipped — no screenshot manifest at /run/uploads.json");
  });

  it("is a clean no-op when the manifest carries no items", () => {
    capture();
    const calls = [];
    main(
      ["screenshots", "--issue", "42", "--manifest", "/run/uploads.json"],
      recorder(calls),
      undefined,
      { readFile: () => JSON.stringify({ base: "b", prefix: "p", items: [] }) },
    );
    expect(process.exitCode).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("exits non-zero when --manifest is not given at all", () => {
    capture();
    main(["screenshots", "--issue", "42"], recorder([]), undefined, {});
    expect(process.exitCode).toBe(1);
  });

  // A subcommand the usage string does not list is a subcommand nobody finds.
  it("is listed in the usage string an unknown command prints", () => {
    const out = capture();
    main(["nonsense"], recorder([]), undefined, {});
    expect(process.exitCode).toBe(1);
    expect(out.join("\n")).toContain("screenshots");
    expect(out.join("\n")).toContain("--manifest");
  });
});
```

Add `screenshotComment` to the file's existing import list from `./autopilot-github-issue.mjs`. `ok`, `vi`, `beforeEach` and `afterEach` are already in scope at the top of this file.

And in the same file, update `describe("GITHUB_LEDGER_LINES", ...)`:

```js
describe("GITHUB_LEDGER_LINES", () => {
  it("lists the six lines the wrapper's hooks append, all github:-prefixed", () => {
    expect(GITHUB_LEDGER_LINES).toEqual([
      "github: moved to in-progress",
      "github: start comment posted",
      "github: verify screenshots posted",
      "github: moved to in-review",
      "github: pr comment posted",
      "github: parked comment posted",
    ]);
  });
});
```

In `plugins/autopilot/scripts/autopilot-github-contract.test.mjs`, rename the two describes/tests listed above, add `"screenshots"` to the subcommand list, and add:

```js
describe("Delta 3d — the verify screenshots hook", () => {
  const from = skill.indexOf("### Delta 3d");
  const rest = skill.slice(from);
  const end = rest.indexOf("\n### ", 1);
  const delta = unwrap(end === -1 ? rest : rest.slice(0, end));

  it("exists at all", () => {
    expect(from).toBeGreaterThan(-1);
  });

  it("anchors immediately after the verify stage's ledger entry", () => {
    expect(delta).toContain("immediately after the `verify` stage's ledger entry");
  });

  it("guards itself with its own ledger line", () => {
    expect(delta).toContain("github: verify screenshots posted");
  });

  it("reads the manifest the verify stage writes", () => {
    expect(delta).toContain("uploads.json");
  });

  // Same failure Delta 3c exists to prevent: a line appended after PARKED
  // makes a parked run read as resumable, and /autopilot resume drives it
  // straight past the park.
  it("posts and appends BEFORE the PARKED entry", () => {
    expect(delta).toMatch(/before[^.]{0,120}PARKED/i);
  });

  it("appends no ledger line when there is nothing to post", () => {
    expect(delta).toMatch(/append \*{0,2}nothing\*{0,2}/i);
  });
});
```

In `plugins/autopilot/scripts/autopilot-github-ledger-coupling.test.mjs`, weave the new line in at its hook point by adding one entry to `GITHUB_AFTER`:

```js
  "verify: 3/3 ui criteria passed": ["github: verify screenshots posted"],
```

The existing `describe("github: lines collide with none of nextStage's prefixes", ...)` loop picks the new line up from `GITHUB_LEDGER_LINES` with no further change, and it is the assertion that matters most here: `github: verify screenshots posted` must not start with `verify`, or a run would resume at `learnings` off the wrapper's own bookkeeping.

- [ ] **Step 2: Run the three test files and watch them fail**

Run: `npx vitest run plugins/autopilot/scripts/autopilot-github-issue.test.mjs plugins/autopilot/scripts/autopilot-github-contract.test.mjs plugins/autopilot/scripts/autopilot-github-ledger-coupling.test.mjs`

Expected: FAIL — `screenshotComment` is not exported, `main` does not know the `screenshots` command, and SKILL.md has no Delta 3d.

- [ ] **Step 3: Add the sixth ledger line**

In `plugins/autopilot/scripts/autopilot-github-issue.mjs`, change the doc comment's opening words from "The five ledger lines" to "The six ledger lines", and insert the new line in pipeline order:

```js
export const GITHUB_LEDGER_LINES = [
  "github: moved to in-progress",
  "github: start comment posted",
  "github: verify screenshots posted",
  "github: moved to in-review",
  "github: pr comment posted",
  "github: parked comment posted",
];
```

- [ ] **Step 4: Add `screenshotComment`**

Add beside `comment()` in the same file:

```js
/**
 * The issue comment body for a screenshot manifest.
 *
 * One comment, one image per criterion, in manifest order. The status is
 * spelled out beside each image because the reader is looking at the picture,
 * not at the PR table it came from — and the prefix names the round, so a
 * criterion that was red, got a fix round and went green reads as two comments
 * in the thread rather than one image replacing another.
 *
 * The public-URL warning is repeated here rather than left to the skill: the
 * comment outlives the run, and whoever reads it later is exactly the person
 * who needs to know the link is not private.
 */
export function screenshotComment(manifest) {
  const mark = { pass: "✅", fail: "❌", missing: "⚠️" };
  const lines = [
    "## Browser verification screenshots",
    "",
    `One image per \`(ui)\` acceptance criterion, as the browser saw it (\`${manifest.prefix}\`).`,
    "",
  ];
  for (const item of manifest.items ?? []) {
    lines.push(`**${item.id}** — ${mark[item.status] ?? ""} ${item.status}`.trim(), "");
    lines.push(`![${item.id}](${item.url})`, "");
  }
  lines.push(
    "These images are hosted on an r2.dev public development URL: anyone with " +
      "the link can read them.",
  );
  return lines.join("\n");
}
```

- [ ] **Step 5: Add the `screenshots` command and extend `USAGE`**

In `main()`, add this branch beside the `comment` branch:

```js
    if (command === "screenshots") {
      const issue = requireIssue(args);
      if (!args.manifest) throw new Error("screenshots needs --manifest <path>");
      const readFile = fsOps.readFile ?? ((p) => readFileSync(p, "utf8"));
      let manifest;
      try {
        manifest = JSON.parse(readFile(args.manifest));
      } catch {
        // Absent or malformed is the no-artifacts-configured case, and it must
        // stay a clean no-op with a zero exit: a non-zero here would make the
        // wrapper record a `github: <action> failed` line in a repository that
        // simply never asked for screenshots.
        console.log(`skipped — no screenshot manifest at ${args.manifest}`);
        return;
      }
      if (!Array.isArray(manifest.items) || manifest.items.length === 0) {
        console.log(`skipped — screenshot manifest at ${args.manifest} has no items`);
        return;
      }
      comment(issue, { body: screenshotComment(manifest) }, gh);
      console.log(`posted ${manifest.items.length} screenshots to issue #${issue}`);
      return;
    }
```

`fsOps` already carries `mkdir` and `appendFile` for `writeLedgerHeader`; reading its `readFile` key with its own `??` default keeps a partial `fsOps` from throwing, exactly as the existing keys do.

And update `USAGE`:

```js
const USAGE =
  "usage: autopilot-github-issue.mjs <preflight|resolve|move|comment|screenshots> " +
  '[--issue <n>] [--write-ledger <base-dir>] [--to "<status>"] ' +
  "[--body <text>|--body-file <path>] [--manifest <path>]";
```

- [ ] **Step 6: Write Delta 3d and fix the count**

In `plugins/autopilot/skills/autopilot-github/SKILL.md`:

Add the new invocation to the `### The commands` block, after the two `comment` lines:

```bash
node "$AP"/scripts/autopilot-github-issue.mjs screenshots --issue <n> --manifest <path>
```

Change "The five lines, in pipeline order:" to "The six lines, in pipeline order:" and insert `github: verify screenshots posted` between `github: start comment posted` and `github: moved to in-review`.

Then insert this section immediately after `### Delta 3c — park hook, and the ordering constraint` and before `### Transition failures do not park`:

````markdown
### Delta 3d — verify screenshots hook

Anchor: **immediately after the `verify` stage's ledger entry** — and, when
verify is red after its one fix round, immediately **before** the
`PARKED — <reason>` entry, for exactly the reason Delta 3c gives.

```bash
node "$AP"/scripts/autopilot-github-issue.mjs screenshots \
  --issue <n> \
  --manifest .superpowers/autopilot/<run>/verify/artifacts/uploads.json
```

The `verify` stage writes that manifest only when the project configures an
`artifacts` block and every upload succeeded, so the command has two outcomes
and they are not the same:

1. It prints `posted <n> screenshots to issue #<n>` — append
   `github: verify screenshots posted`.
2. It prints `skipped — no screenshot manifest at <path>` — append **nothing**
   and continue. A repository with no `artifacts` block must reach exactly the
   ledger it reached before this hook existed.

The ledger line is the idempotency guard: re-read the ledger first and skip the
step when `github: verify screenshots posted` is already present, the same way
every other hook does.

The park case is where these images are worth the most — a human is about to be
asked what went wrong, and the pictures are the answer — so the hook runs there
too, and the ordering is the same one Delta 3c fixes: post, append the
`github: ` line, then append `PARKED — <reason>` **last**. `PARKED` must remain
the ledger's final entry, or `nextStage` stops returning `parked` and
`/autopilot resume` drives the run straight past the park.

An r2.dev public development URL is world-readable. Anything visible in a
verified screenshot is public to anyone with the link, which is why the comment
the script writes says so too.
````

- [ ] **Step 7: Run the whole suite**

Run: `npm test`

Expected: PASS, every file.

- [ ] **Step 8: Prove the new ledger line is inert**

```bash
node -e "import('./plugins/autopilot/scripts/autopilot-ledger.mjs').then((l)=>{const h='# autopilot run — task: x';const rows=['2026-08-21T14:00:00Z  sdd complete (1 tasks, 0 parked, 0 fix rounds across 0 tasks)','2026-08-21T14:01:00Z  github: verify screenshots posted','2026-08-21T14:02:00Z  PARKED — verify red after fix round: AC3'];console.log(l.nextStage(l.parseLedger([h,...rows].join('\n'))))})"
```

Expected: `parked`. If it prints `verify` or `learnings`, the new line is colliding with a resume prefix and Delta 3d's ordering is unsafe — stop and report rather than continuing.

- [ ] **Step 9: Commit**

```bash
git add plugins/autopilot/scripts/autopilot-github-issue.mjs plugins/autopilot/scripts/autopilot-github-issue.test.mjs plugins/autopilot/scripts/autopilot-github-contract.test.mjs plugins/autopilot/scripts/autopilot-github-ledger-coupling.test.mjs plugins/autopilot/skills/autopilot-github/SKILL.md
git commit -m "feat(github): post verify screenshots to the issue thread as Delta 3d"
```

---

## Notes for the reviewer

- **Nothing in this plan touches `.claude/autopilot.json`.** This repository has no UI, writes no `(ui)` criteria, and its `verify` stage skips — so it gains no `artifacts` block and gains no behaviour. The feature is exercised entirely by unit tests here; the operational step of filling in a real `pub-XXXXXXXX.r2.dev` host belongs to the consuming project, as the spec's operational note says.
- **`artifacts` is not added to `TOP_LEVEL` and not added to `mergeConfig`'s per-key merges.** The plugin defaults ship no `artifacts` block, so the shallow top-level merge is already correct for it; a per-key merge would be a branch with nothing on either side of it. If a default is ever added, that merge becomes necessary — this is the trigger to add it, and not before.
- **No new park condition.** The base skill's parking count and both of the wrapper's restatements of it are unchanged, and the contract test that derives the wrapper's number from the base skill's own list keeps them honest.
