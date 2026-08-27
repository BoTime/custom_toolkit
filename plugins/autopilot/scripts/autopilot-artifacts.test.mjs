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
