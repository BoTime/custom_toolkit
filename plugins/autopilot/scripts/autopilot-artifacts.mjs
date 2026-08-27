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
