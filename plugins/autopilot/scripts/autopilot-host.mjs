export const HOSTS = ["claude", "codex"];

export function assertHost(host) {
  if (!HOSTS.includes(host)) {
    throw new Error(`unknown host "${host}" (expected one of ${HOSTS.join(", ")})`);
  }
}

export function hostConfigPath(host) {
  assertHost(host);
  return host === "codex" ? ".codex/autopilot.json" : ".claude/autopilot.json";
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
