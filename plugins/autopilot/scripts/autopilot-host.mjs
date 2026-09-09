import { existsSync } from "node:fs";
import { CONFIGS_DIR } from "./autopilot-paths.mjs";

export const HOSTS = ["claude", "codex"];

export function assertHost(host) {
  if (!HOSTS.includes(host)) {
    throw new Error(`unknown host "${host}" (expected one of ${HOSTS.join(", ")})`);
  }
}

/** The project config for `host`, under the tracked `configs/` directory. */
export function hostConfigPath(host) {
  assertHost(host);
  return host === "codex"
    ? `${CONFIGS_DIR}/autopilot.codex.json`
    : `${CONFIGS_DIR}/autopilot.json`;
}

/**
 * Where `host` kept its project config before the move. Read-only: nothing
 * writes here any more, and `loadConfig` warns when it reads from here.
 */
export function legacyHostConfigPath(host) {
  assertHost(host);
  return host === "codex" ? ".codex/autopilot.json" : ".claude/autopilot.json";
}

/**
 * New, then legacy, then new — the same precedence as `resolveRunDir`, so a
 * project that has not moved keeps working across the release and one that
 * has never had a config gets told about the new home.
 */
export function resolveConfigPath(host, { exists = existsSync } = {}) {
  const path = hostConfigPath(host);
  if (exists(path)) return { path, legacy: false };
  const legacy = legacyHostConfigPath(host);
  if (exists(legacy)) return { path: legacy, legacy: true };
  return { path, legacy: false };
}

export function hostDefaultsPath(host) {
  assertHost(host);
  const file =
    host === "codex" ? "../autopilot.codex.default.json" : "../autopilot.default.json";
  return new URL(file, import.meta.url).pathname;
}

export function hostEffortOverride(host, env) {
  assertHost(host);
  return host === "codex"
    ? env.CODEX_REASONING_EFFORT
    : env.CLAUDE_CODE_EFFORT_LEVEL;
}
