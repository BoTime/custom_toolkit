// The issue side of autopilot-github-issue.mjs: everything derivable from
// `gh issue view`, with no Projects v2 board involved.
//
// The slug is the load-bearing piece. It is the ledger directory's key, so a
// resumed run that re-derives a different slug points at a different directory
// and loses the run. That is why it lives in code with a stability test, not in
// the wrapper's prose.
//
// Every gh call goes through an injected runner with the {code, stdout, stderr}
// shape autopilot-land.mjs's run() already uses — no network, no gh session.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  GITHUB_LEDGER_LINES,
  slugify,
  runName,
  ledgerTask,
  taskDescription,
  resolveIssue,
  preflightGithub,
  main,
} from "./autopilot-github-issue.mjs";

const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" });
const fail = (stderr = "") => ({ code: 1, stdout: "", stderr });

/** Records every gh invocation so a test can assert the exact argument list. */
function fakeGh(handler) {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    return handler(args);
  };
  gh.calls = calls;
  return gh;
}

const ISSUE = {
  number: 42,
  title: "CSV export drops unicode",
  body: "Steps:\n\n1. export\n2. open in Excel",
  url: "https://github.com/BoTime/custom_toolkit/issues/42",
};

const CONFIG = {
  github: {
    project_owner: "BoTime",
    project_number: 7,
    status_field: "Status",
    status_ready: "Ready",
    status_in_progress: "In Progress",
    status_in_review: "In Review",
  },
};

describe("GITHUB_LEDGER_LINES", () => {
  it("lists the five lines the wrapper's hooks append, all github:-prefixed", () => {
    expect(GITHUB_LEDGER_LINES).toEqual([
      "github: moved to in-progress",
      "github: start comment posted",
      "github: moved to in-review",
      "github: pr comment posted",
      "github: parked comment posted",
    ]);
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates an ordinary title", () => {
    expect(slugify("CSV export drops unicode")).toBe("csv-export-drops-unicode");
  });

  it("collapses runs of non-alphanumerics into one hyphen and strips the ends", () => {
    expect(slugify("  ***Fix: the (broken) thing!!  ")).toBe("fix-the-broken-thing");
  });

  it("truncates to 40 characters and strips the hyphen the cut leaves behind", () => {
    // The 41st character is a space, so a naive truncate would leave "...-".
    const slug = slugify("aaaaaaaaaa bbbbbbbbbb cccccccccc dddddddddd eeeeeeeeee");
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
    expect(slug).toBe("aaaaaaaaaa-bbbbbbbbbb-cccccccccc-ddddddd");
  });

  it("returns an empty string for a title that is entirely punctuation", () => {
    expect(slugify("!!! ??? ---")).toBe("");
  });

  it("is stable — the same title always yields the same slug", () => {
    // Resume depends on this: a second derivation that differs orphans the run.
    const title = "Fix: CSV export drops unicode (again)";
    expect(slugify(title)).toBe(slugify(title));
  });
});

describe("runName", () => {
  it("combines the issue number and the slug", () => {
    expect(runName(42, "CSV export drops unicode")).toBe(
      "issue-42-csv-export-drops-unicode",
    );
  });

  it("falls back to issue-<n> when the title is entirely punctuation", () => {
    expect(runName(42, "!!! ???")).toBe("issue-42");
  });

  it("falls back to issue-<n> for a title with no ASCII alphanumerics", () => {
    expect(runName(7, "日本語のタイトル")).toBe("issue-7");
  });
});

describe("ledgerTask and taskDescription", () => {
  it("builds the task description as header, blank line, body", () => {
    expect(taskDescription(ISSUE)).toBe(
      "GitHub issue #42: CSV export drops unicode\n\nSteps:\n\n1. export\n2. open in Excel",
    );
  });

  it("omits the blank line and body for an issue with an empty body", () => {
    expect(taskDescription({ ...ISSUE, body: "" })).toBe(
      "GitHub issue #42: CSV export drops unicode",
    );
    expect(taskDescription({ ...ISSUE, body: undefined })).toBe(
      "GitHub issue #42: CSV export drops unicode",
    );
  });

  it("keeps the ledger header single-line no matter how long the body is", () => {
    // autopilot-ledger.mjs's HEADER regex is single-line. A multi-line header
    // strands the body as untimestamped lines that parseLedger silently drops.
    const header = ledgerTask(ISSUE);
    expect(header).toBe("GitHub issue #42: CSV export drops unicode");
    expect(header).not.toContain("\n");
    expect(taskDescription(ISSUE).startsWith(header)).toBe(true);
  });

  it("collapses whitespace inside a title so the header cannot break the regex", () => {
    expect(ledgerTask({ number: 9, title: "one\ntwo   three" })).toBe(
      "GitHub issue #9: one two three",
    );
  });
});

describe("resolveIssue", () => {
  it("wraps gh issue view and returns number, title, url, run, and task", () => {
    const gh = fakeGh(() => ok(JSON.stringify(ISSUE)));
    const resolved = resolveIssue("42", gh);
    expect(gh.calls[0]).toEqual([
      "issue", "view", "42", "--json", "number,title,body,url",
    ]);
    expect(resolved).toEqual({
      number: 42,
      title: "CSV export drops unicode",
      url: "https://github.com/BoTime/custom_toolkit/issues/42",
      run: "issue-42-csv-export-drops-unicode",
      task: "GitHub issue #42: CSV export drops unicode\n\nSteps:\n\n1. export\n2. open in Excel",
    });
  });

  it("passes a full issue URL through to gh unchanged", () => {
    // gh accepts both forms, so the argument needs no parsing on our side.
    const gh = fakeGh(() => ok(JSON.stringify(ISSUE)));
    resolveIssue(ISSUE.url, gh);
    expect(gh.calls[0][2]).toBe(ISSUE.url);
  });

  it("throws with gh's message when gh exits non-zero — never a silent success", () => {
    const gh = fakeGh(() => fail("gh: issue not found"));
    expect(() => resolveIssue("999", gh)).toThrow(/issue not found/);
  });
});

describe("preflightGithub", () => {
  it("reports ok for a complete github block", () => {
    const result = preflightGithub(CONFIG);
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.message).toBe("ok");
  });

  it("names exactly the missing keys", () => {
    const github = { ...CONFIG.github };
    delete github.project_number;
    const result = preflightGithub({ github });
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["project_number"]);
    expect(result.message).toContain("project_number");
    expect(result.message).toContain(".claude/autopilot.json");
  });
});

describe("main — resolve and preflight", () => {
  // main() sets process.exitCode only on failure, and Node leaves it undefined
  // until something sets it — so the success cases need it zeroed up front.
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

  it("resolve prints the JSON object", () => {
    const out = capture();
    const gh = fakeGh(() => ok(JSON.stringify(ISSUE)));
    main(["resolve", "--issue", "42"], gh, () => ({ config: CONFIG }));
    expect(process.exitCode).toBe(0);
    expect(JSON.parse(out.join("\n"))).toMatchObject({
      number: 42,
      run: "issue-42-csv-export-drops-unicode",
    });
  });

  it("preflight prints ok and exits 0 for a complete config", () => {
    const out = capture();
    main(["preflight"], fakeGh(() => ok()), () => ({ config: CONFIG }));
    expect(process.exitCode).toBe(0);
    expect(out.join("\n")).toContain("ok");
  });

  it("preflight exits non-zero naming the missing keys", () => {
    const out = capture();
    main(["preflight"], fakeGh(() => ok()), () => ({ config: { github: {} } }));
    expect(process.exitCode).toBe(1);
    expect(out.join("\n")).toContain("project_owner");
    expect(out.join("\n")).toContain("status_in_review");
  });

  it("prints usage and exits non-zero for an unknown command", () => {
    const out = capture();
    main(["frobnicate"], fakeGh(() => ok()), () => ({ config: CONFIG }));
    expect(process.exitCode).toBe(1);
    expect(out.join("\n")).toMatch(/usage:/);
  });
});
