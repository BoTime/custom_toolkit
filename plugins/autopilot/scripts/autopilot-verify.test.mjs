import { describe, it, expect } from "vitest";
import {
  EXIT,
  parseCriteria,
  uiCriteria,
  summarize,
  attribute,
  formatVerifySection,
  waitForServer,
  playwrightConfig,
  playwrightResolvable,
  loadRecipe,
  resolveBaseUrl,
  teardown,
  findingsLines,
} from "./autopilot-verify.mjs";

const SPEC = `# CSV export drops unicode — design

Some prose.

## Acceptance criteria

- AC1 (ui) — a signed-out visitor clicking "Save" sees the login prompt
- AC2 (non-ui) — POST /items rejects an empty title with 422
- AC3 (ui) — the export button shows a spinner while the file builds

## Approach

- this bullet is not a criterion
`;

describe("parseCriteria", () => {
  it("reads ids, tags, and text from the criteria section", () => {
    const { ok, criteria } = parseCriteria(SPEC);
    expect(ok).toBe(true);
    expect(criteria).toEqual([
      { id: "AC1", kind: "ui", text: 'a signed-out visitor clicking "Save" sees the login prompt' },
      { id: "AC2", kind: "non-ui", text: "POST /items rejects an empty title with 422" },
      { id: "AC3", kind: "ui", text: "the export button shows a spinner while the file builds" },
    ]);
  });

  it("stops at the next heading so later bullets are not criteria", () => {
    const { criteria } = parseCriteria(SPEC);
    expect(criteria.map((c) => c.id)).not.toContain("this");
    expect(criteria).toHaveLength(3);
  });

  it("fails when the section is absent", () => {
    const { ok, reason } = parseCriteria("# design\n\n## Approach\n\n- a bullet\n");
    expect(ok).toBe(false);
    expect(reason).toMatch(/no `## Acceptance criteria` section/);
  });

  it("fails when the section is present but empty", () => {
    const { ok, reason } = parseCriteria("## Acceptance criteria\n\n## Approach\n");
    expect(ok).toBe(false);
    expect(reason).toMatch(/empty/);
  });

  // An untagged criterion must not silently default to non-ui: that drops it
  // from browser verification while the run still reports success.
  it("fails on an untagged criterion rather than defaulting it", () => {
    const { ok, reason } = parseCriteria("## Acceptance criteria\n\n- AC1 — the button works\n");
    expect(ok).toBe(false);
    expect(reason).toMatch(/missing a \(ui\)\/\(non-ui\) tag/);
    expect(reason).toContain("AC1 — the button works");
  });

  it("accepts colon and hyphen separators and either bullet marker", () => {
    const { ok, criteria } = parseCriteria(
      "## Acceptance criteria\n\n* AC1 (ui): the list re-sorts\n- AC2 (UI) - the header sticks\n",
    );
    expect(ok).toBe(true);
    expect(criteria.map((c) => c.kind)).toEqual(["ui", "ui"]);
  });
});

describe("uiCriteria", () => {
  it("keeps only browser-observable criteria", () => {
    expect(uiCriteria(parseCriteria(SPEC).criteria).map((c) => c.id)).toEqual(["AC1", "AC3"]);
  });
});

const report = (specs) => ({ suites: [{ specs }] });
const passing = (title) => ({ title, tests: [{ status: "expected", results: [{}] }] });
const failing = (title, message) => ({
  title,
  tests: [{ status: "unexpected", results: [{ error: { message } }] }],
});

describe("summarize", () => {
  it("counts passes and failures across nested suites", () => {
    const nested = {
      suites: [
        { specs: [passing("AC1 login prompt")] },
        { suites: [{ specs: [failing("AC3 spinner", "expected visible\n  at line 4")] }] },
      ],
    };
    const s = summarize(nested);
    expect(s).toMatchObject({ total: 2, passed: 1, failed: 1 });
    expect(s.failures[0].message).toBe("expected visible");
  });

  it("keeps only the first line of an error message", () => {
    const s = summarize(report([failing("AC1 x", "line one\nline two\nline three")]));
    expect(s.failures[0].message).toBe("line one");
  });

  it("reports a failure with no error message rather than dropping it", () => {
    const s = summarize(report([{ title: "AC1 x", tests: [{ status: "unexpected", results: [] }] }]));
    expect(s.failed).toBe(1);
    expect(s.failures[0].message).toMatch(/no error message/);
  });

  it("returns zeroes for an empty report", () => {
    expect(summarize({})).toMatchObject({ total: 0, passed: 0, failed: 0 });
  });
});

describe("attribute", () => {
  const criteria = parseCriteria(SPEC).criteria;

  it("matches tests to criteria by id prefix and ignores non-ui criteria", () => {
    const rows = attribute(criteria, summarize(report([passing("AC1 login"), passing("AC3 spinner")])));
    expect(rows.map((r) => [r.id, r.status])).toEqual([
      ["AC1", "pass"],
      ["AC3", "pass"],
    ]);
  });

  // The gap this whole stage exists to close: a criterion nobody tested is
  // not a criterion that passed.
  it("marks an untested ui criterion missing, not passing", () => {
    const rows = attribute(criteria, summarize(report([passing("AC1 login")])));
    expect(rows.find((r) => r.id === "AC3")).toMatchObject({
      status: "missing",
      message: "no test covered this criterion",
    });
  });

  it("carries the failure message onto the criterion", () => {
    const rows = attribute(criteria, summarize(report([passing("AC1 x"), failing("AC3 y", "nope")])));
    expect(rows.find((r) => r.id === "AC3")).toMatchObject({ status: "fail", message: "nope" });
  });
});

describe("formatVerifySection", () => {
  const rows = [
    { id: "AC1", text: "login prompt", status: "pass", message: null },
    { id: "AC3", text: "spinner", status: "fail", message: "expected visible" },
  ];

  it("renders a criterion table with a pass count", () => {
    const md = formatVerifySection(rows, { artifactsDir: ".superpowers/autopilot/x/verify/artifacts" });
    expect(md).toContain("## Browser verification");
    expect(md).toContain("| AC1 — login prompt | ✅ |");
    expect(md).toContain("expected visible");
    expect(md).toContain("1/2 UI criteria verified");
    expect(md).toContain(".superpowers/autopilot/x/verify/artifacts");
  });

  it("escapes pipes so a criterion cannot break the table", () => {
    const md = formatVerifySection([{ id: "AC1", text: "a | b", status: "pass", message: null }], {});
    expect(md).toContain("a \\| b");
  });

  it("renders the skipped form instead of an empty table", () => {
    const md = formatVerifySection([], { skipped: "no ui criteria" });
    expect(md).toContain("Skipped — no ui criteria.");
    expect(md).not.toContain("| Criterion |");
  });
});

describe("waitForServer", () => {
  it("returns ready as soon as the server answers", async () => {
    let calls = 0;
    const probe = async () => ++calls >= 3;
    const result = await waitForServer("http://x", { timeoutMs: 10000 }, probe, async () => {});
    expect(result.ready).toBe(true);
    expect(calls).toBe(3);
  });

  it("gives up at the deadline", async () => {
    let clock = 0;
    const result = await waitForServer(
      "http://x",
      { timeoutMs: 1000, intervalMs: 400 },
      async () => false,
      async () => { clock += 400; },
      () => clock,
    );
    expect(result.ready).toBe(false);
  });

  it("probes at least once even with a zero budget", async () => {
    let calls = 0;
    await waitForServer("http://x", { timeoutMs: 0 }, async () => { calls++; return false; }, async () => {});
    expect(calls).toBe(1);
  });
});

describe("playwrightConfig", () => {
  const cfg = playwrightConfig({
    baseURL: "http://localhost:3000",
    specDir: "/run/verify/specs",
    artifactsDir: "/run/verify/artifacts",
  });

  // The verify contract forbids the agent from reading raw output; that is
  // only followable because the generated config always emits the JSON report.
  it("always emits the json reporter the token contract depends on", () => {
    expect(cfg).toContain('["json"');
    expect(cfg).toContain("/run/verify/artifacts/results.json");
  });

  it("captures screenshots and traces only on failure", () => {
    expect(cfg).toContain('screenshot: "only-on-failure"');
    expect(cfg).toContain('trace: "retain-on-failure"');
    expect(cfg).toContain('video: "off"');
  });

  it("points at the run directory's specs and sets the base url", () => {
    expect(cfg).toContain('testDir: "/run/verify/specs"');
    expect(cfg).toContain('baseURL: "http://localhost:3000"');
  });

  // Retries would let a flaky assertion pass on a second attempt and report a
  // criterion verified that failed once — the false green this stage exists
  // to prevent.
  it("does not retry", () => {
    expect(cfg).toContain("retries: 0");
  });
});

describe("EXIT", () => {
  // The stage branches on these: a failed criterion earns a fix round, a dead
  // dev server does not, and a run with no (ui) criteria is neither.
  it("maps every outcome to a distinct code", () => {
    expect(EXIT).toEqual({
      pass: 0,
      criteria_failed: 1,
      infrastructure: 2,
      skipped: 3,
      cannot_verify: 4,
    });
  });
});

describe("playwrightResolvable", () => {
  const fakeRequire = (ok) => () => ({
    resolve: (id) => {
      if (ok && id === "@playwright/test") return "/proj/node_modules/@playwright/test";
      throw new Error(`Cannot find module '${id}'`);
    },
  });

  it("is true when the project can supply the runner", () => {
    expect(playwrightResolvable("/proj", fakeRequire(true))).toBe(true);
  });

  // Never an install: an unattended run that provisions its own tooling
  // produces a green nobody can reproduce.
  it("is false rather than throwing when the runner is absent", () => {
    expect(playwrightResolvable("/proj", fakeRequire(false))).toBe(false);
  });
});

describe("loadRecipe", () => {
  const reader = (files) => (p) => {
    if (!(p in files)) throw new Error("ENOENT");
    return files[p];
  };
  const full = JSON.stringify({
    dev_command: "bash scripts/worktree-up.sh",
    base_url_command: "grep '^WEB_ORIGIN=' apps/api/.env | cut -d= -f2-",
    stop_command: "bash scripts/worktree-down.sh",
    seed_command: "npm run db:seed:test",
  });

  it("reads the recipe the plan stage derived", () => {
    const r = loadRecipe("/run/verify", reader({ "/run/verify/recipe.json": full }));
    expect(r.ok).toBe(true);
    expect(r.recipe.stop_command).toBe("bash scripts/worktree-down.sh");
  });

  // A missing recipe is a park, not a skip: the spec asked for browser
  // verification and the stage cannot deliver it.
  it("reports an absent recipe rather than throwing", () => {
    const r = loadRecipe("/run/verify", reader({}));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/recipe\.json/);
  });

  it("reports malformed JSON distinctly from an absent file", () => {
    const r = loadRecipe("/run/verify", reader({ "/run/verify/recipe.json": "{oops" }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not valid JSON/);
  });

  it("names the required keys the recipe left out", () => {
    const r = loadRecipe(
      "/run/verify",
      reader({ "/run/verify/recipe.json": JSON.stringify({ dev_command: "x" }) }),
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("base_url_command");
  });

  it("treats stop_command and seed_command as optional", () => {
    const r = loadRecipe(
      "/run/verify",
      reader({
        "/run/verify/recipe.json": JSON.stringify({ dev_command: "x", base_url_command: "y" }),
      }),
    );
    expect(r.ok).toBe(true);
  });
});

describe("resolveBaseUrl", () => {
  const deps = (overrides) => ({
    intervalMs: 10,
    sleep: async () => {},
    now: () => 0,
    devExitCode: () => null,
    ...overrides,
  });

  it("trims the command's stdout into the base url", async () => {
    const r = await resolveBaseUrl("print-url", "/wt", deps({
      runCommand: () => ({ code: 0, stdout: "http://localhost:4310\n", stderr: "" }),
    }));
    expect(r).toEqual({ ok: true, url: "http://localhost:4310" });
  });

  // The motivating case: a worktree-up script assigns ports late, so the
  // command answers nothing until setup finishes.
  it("retries until the command yields a url", async () => {
    let calls = 0;
    const r = await resolveBaseUrl("print-url", "/wt", deps({
      timeoutMs: 1000,
      runCommand: () => (++calls < 3
        ? { code: 1, stdout: "", stderr: "no such file" }
        : { code: 0, stdout: "http://localhost:4310", stderr: "" }),
    }));
    expect(r.ok).toBe(true);
    expect(calls).toBe(3);
  });

  // A clean exit means setup finished, not that the server died.
  it("keeps polling after the dev command exits zero", async () => {
    let calls = 0;
    const r = await resolveBaseUrl("print-url", "/wt", deps({
      timeoutMs: 1000,
      devExitCode: () => 0,
      runCommand: () => (++calls < 2
        ? { code: 1, stdout: "", stderr: "" }
        : { code: 0, stdout: "http://x", stderr: "" }),
    }));
    expect(r.ok).toBe(true);
  });

  it("gives up immediately when the dev command exits non-zero", async () => {
    const r = await resolveBaseUrl("print-url", "/wt", deps({
      timeoutMs: 1000,
      devExitCode: () => 3,
      runCommand: () => ({ code: 0, stdout: "http://x", stderr: "" }),
    }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/exited 3/);
  });

  it("gives up at the deadline", async () => {
    let clock = 0;
    const r = await resolveBaseUrl("print-url", "/wt", deps({
      timeoutMs: 100,
      sleep: async () => { clock += 50; },
      now: () => clock,
      runCommand: () => ({ code: 1, stdout: "", stderr: "still booting" }),
    }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no url within 100ms/);
  });
});

describe("teardown", () => {
  // Without this, a script that starts docker containers and backgrounds its
  // app processes leaks the whole stack: the child autopilot holds has already
  // exited, so there is nothing left to signal.
  it("prefers the recipe's stop command", () => {
    const calls = [];
    const how = teardown(
      { child: { pid: 42 }, stopCommand: "bash scripts/worktree-down.sh", cwd: "/wt" },
      (cmd, cwd) => { calls.push([cmd, cwd]); return { code: 0, stdout: "", stderr: "" }; },
      () => calls.push(["kill"]),
    );
    expect(how).toBe("stop_command");
    expect(calls).toEqual([["bash scripts/worktree-down.sh", "/wt"]]);
  });

  // Still correct for the blocking-server case: a dev server that spawns a
  // child compiler must be signalled as a group or the port stays held.
  it("falls back to killing the process group when there is no stop command", () => {
    const killed = [];
    const how = teardown({ child: { pid: 42 }, cwd: "/wt" }, () => {
      throw new Error("must not run a command");
    }, (child) => killed.push(child.pid));
    expect(how).toBe("process-group");
    expect(killed).toEqual([42]);
  });
});

describe("findingsLines", () => {
  const rows = [
    { id: "AC1", text: "login prompt", status: "pass", message: null },
    { id: "AC3", text: "spinner", status: "fail", message: "expected visible" },
    { id: "AC4", text: "toast", status: "missing", message: "no test covered this criterion" },
  ];

  it("emits one seven-field line per unmet criterion, with the task sentinel", () => {
    const lines = findingsLines(rows, { round: 1 });
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(Object.keys(line).sort()).toEqual(
        ["detail", "pattern", "round", "severity", "stage_at_fault", "task", "verdict"],
      );
      expect(line.task).toBe(0);
      expect(line.round).toBe(1);
      expect(line.verdict).toBe("CONFIRMED");
    }
  });

  // The contract is emphatic that stage_at_fault names the stage that produced
  // the bad input, never the stage that surfaced it — so no "verify" value.
  it("uses only the four existing stage_at_fault values", () => {
    for (const line of findingsLines(rows, {})) {
      expect(["brief", "plan", "spec", "implementation"]).toContain(line.stage_at_fault);
    }
  });

  it("names the criterion in the detail so a cluster stays readable", () => {
    const [failed] = findingsLines(rows, {});
    expect(failed.detail).toContain("AC3");
    expect(failed.detail).toContain("expected visible");
  });

  // Absence of evidence: without the clean line, a run with no findings is
  // indistinguishable from a run whose findings were never written.
  it("emits one clean line when every criterion passed", () => {
    const lines = findingsLines([rows[0]], {});
    expect(lines).toEqual([{ task: 0, clean: true }]);
  });
});
