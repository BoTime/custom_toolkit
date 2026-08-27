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
  ledgerHeaderLine,
  writeLedgerHeader,
  taskDescription,
  resolveIssue,
  preflightGithub,
  matchProjectItem,
  matchItemList,
  resolveItemId,
  resolveProjectId,
  findStatusField,
  findStatusOption,
  move,
  comment,
  screenshotComment,
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

/** Records mkdir/appendFile calls, so no test needs a real filesystem. */
function fakeFs() {
  const mkdirs = [];
  const appends = [];
  return {
    mkdirs,
    appends,
    ops: {
      mkdir: (d) => mkdirs.push(d),
      appendFile: (p, s) => appends.push([p, s]),
    },
  };
}

describe("ledgerHeaderLine and writeLedgerHeader", () => {
  it("builds the single-line, newline-terminated header autopilot-ledger expects", () => {
    expect(ledgerHeaderLine(ISSUE)).toBe(
      "# autopilot run — task: GitHub issue #42: CSV export drops unicode\n",
    );
  });

  it("creates the run directory and appends the header to run.md", () => {
    const fs = fakeFs();
    writeLedgerHeader(".superpowers/autopilot/issue-42-csv-export-drops-unicode", ISSUE, fs.ops);
    expect(fs.mkdirs).toEqual([".superpowers/autopilot/issue-42-csv-export-drops-unicode"]);
    expect(fs.appends).toEqual([
      [
        ".superpowers/autopilot/issue-42-csv-export-drops-unicode/run.md",
        "# autopilot run — task: GitHub issue #42: CSV export drops unicode\n",
      ],
    ]);
  });

  it("writes a title full of shell metacharacters through verbatim, unexecuted", () => {
    // The issue title is third-party text. The earlier design had the wrapper's
    // prose build this line with `printf` in a Bash call, where a quote breaks
    // the quoting and `$(...)` or a backtick is command execution in the user's
    // checkout. The header is written from code, so the title is only ever
    // string content — never a shell token.
    const hostile = 'Fix "quotes" and $(rm -rf /) and `backticks`';
    const fs = fakeFs();
    writeLedgerHeader("/runs/issue-9", { number: 9, title: hostile }, fs.ops);
    const [path, contents] = fs.appends[0];
    expect(path).toBe("/runs/issue-9/run.md");
    expect(contents).toBe(`# autopilot run — task: GitHub issue #9: ${hostile}\n`);
    expect(contents).toContain('"quotes"');
    expect(contents).toContain("$(rm -rf /)");
    expect(contents).toContain("`backticks`");
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

  it("resolve --write-ledger also writes the run's ledger header", () => {
    const out = capture();
    const fs = fakeFs();
    const gh = fakeGh(() => ok(JSON.stringify(ISSUE)));
    main(
      ["resolve", "--issue", "42", "--write-ledger", ".superpowers/autopilot"],
      gh,
      () => ({ config: CONFIG }),
      fs.ops,
    );
    expect(process.exitCode).toBe(0);
    expect(fs.mkdirs).toEqual([".superpowers/autopilot/issue-42-csv-export-drops-unicode"]);
    expect(fs.appends).toEqual([
      [
        ".superpowers/autopilot/issue-42-csv-export-drops-unicode/run.md",
        "# autopilot run — task: GitHub issue #42: CSV export drops unicode\n",
      ],
    ]);
    // The JSON object is still printed — --write-ledger adds a side effect, it
    // does not replace the output the wrapper reads.
    expect(JSON.parse(out.join("\n")).run).toBe("issue-42-csv-export-drops-unicode");
  });

  it("resolve without --write-ledger touches the filesystem not at all", () => {
    const out = capture();
    const fs = fakeFs();
    const gh = fakeGh(() => ok(JSON.stringify(ISSUE)));
    main(["resolve", "--issue", "42"], gh, () => ({ config: CONFIG }), fs.ops);
    expect(process.exitCode).toBe(0);
    expect(fs.mkdirs).toEqual([]);
    expect(fs.appends).toEqual([]);
    expect(JSON.parse(out.join("\n")).number).toBe(42);
  });

  it("preflight prints ok and exits 0 for a complete config", () => {
    const out = capture();
    main(["preflight"], fakeGh(() => ok()), () => ({ config: CONFIG }));
    expect(process.exitCode).toBe(0);
    expect(out.join("\n")).toContain("ok");
  });

  it("preflight prints the merged status names the wrapper needs for move --to", () => {
    // The wrapper cannot read the merged config itself, and the defaults shown
    // in SKILL.md's example JSON are wrong whenever a project overrides one.
    const out = capture();
    main(
      ["preflight"],
      fakeGh(() => ok()),
      () => ({
        config: { github: { ...CONFIG.github, status_in_progress: "Doing" } },
      }),
    );
    expect(process.exitCode).toBe(0);
    const printed = out.join("\n");
    expect(printed).toContain('ready="Ready"');
    expect(printed).toContain('in_progress="Doing"');
    expect(printed).toContain('in_review="In Review"');
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

// The Projects v2 side. Two resolution steps have to be right for a move to be
// possible at all — which board item corresponds to this issue, and which
// single-select option corresponds to this status name — and each has a named
// failure mode rather than a silent no-op.

const PROJECT_ITEMS_MATCH = {
  projectItems: [
    { id: "PVTI_other", project: { number: 3, owner: { login: "BoTime" } } },
    { id: "PVTI_right", project: { number: 7, owner: { login: "BoTime" } } },
  ],
};

const FIELD_LIST = {
  fields: [
    { id: "PVTF_title", name: "Title", type: "ProjectV2Field" },
    {
      id: "PVTSSF_status",
      name: "Status",
      type: "ProjectV2SingleSelectField",
      options: [
        { id: "opt_ready", name: "Ready" },
        { id: "opt_progress", name: "In Progress" },
        { id: "opt_review", name: "In Review" },
      ],
    },
  ],
};

/** Routes a fake gh by subcommand pair, so each test describes only what it needs. */
function ghRouter(routes) {
  return fakeGh((args) => {
    const key = args[0] === "project" ? `project ${args[1]}` : `${args[0]} ${args[1]}`;
    const handler = routes[key];
    if (!handler) throw new Error(`unexpected gh call: ${args.join(" ")}`);
    return typeof handler === "function" ? handler(args) : handler;
  });
}

describe("matchProjectItem", () => {
  it("returns the item id when the project number and owner both match", () => {
    expect(matchProjectItem(PROJECT_ITEMS_MATCH.projectItems, CONFIG.github))
      .toBe("PVTI_right");
  });

  it("skips an entry for a different project number", () => {
    const items = [{ id: "PVTI_x", project: { number: 3, owner: { login: "BoTime" } } }];
    expect(matchProjectItem(items, CONFIG.github)).toBeNull();
  });

  it("skips an entry whose owner differs", () => {
    const items = [{ id: "PVTI_x", project: { number: 7, owner: { login: "SomeoneElse" } } }];
    expect(matchProjectItem(items, CONFIG.github)).toBeNull();
  });

  it("accepts an entry that names no owner — a number match is enough", () => {
    // An item that carries no owner is not evidence of a DIFFERENT owner.
    const items = [{ id: "PVTI_x", projectV2: { number: 7 } }];
    expect(matchProjectItem(items, CONFIG.github)).toBe("PVTI_x");
  });

  it("returns null for a shape it does not recognize, so the fallback runs", () => {
    // gh's projectItems payload has varied across versions. An unrecognized
    // shape must fall through to item-list rather than guess.
    expect(matchProjectItem([{ id: "PVTI_x", title: "some board" }], CONFIG.github))
      .toBeNull();
  });

  it("returns null for a missing or empty list", () => {
    expect(matchProjectItem(undefined, CONFIG.github)).toBeNull();
    expect(matchProjectItem([], CONFIG.github)).toBeNull();
  });
});

describe("matchItemList", () => {
  it("returns the id of the item whose content number matches the issue", () => {
    const list = {
      items: [
        { id: "PVTI_a", content: { type: "Issue", number: 41 } },
        { id: "PVTI_b", content: { type: "Issue", number: 42 } },
      ],
    };
    expect(matchItemList(list, 42)).toBe("PVTI_b");
  });

  it("returns null when no item matches", () => {
    expect(matchItemList({ items: [] }, 42)).toBeNull();
  });
});

describe("resolveItemId", () => {
  it("uses the issue-scoped projectItems match and never calls item-list", () => {
    const gh = ghRouter({
      "issue view": ok(JSON.stringify(PROJECT_ITEMS_MATCH)),
    });
    expect(resolveItemId(42, CONFIG, gh)).toBe("PVTI_right");
    expect(gh.calls).toHaveLength(1);
    expect(gh.calls[0]).toEqual(["issue", "view", "42", "--json", "projectItems"]);
  });

  it("falls back to item-list when projectItems yields nothing usable", () => {
    const gh = ghRouter({
      "issue view": ok(JSON.stringify({ projectItems: [] })),
      "project item-list": ok(
        JSON.stringify({ items: [{ id: "PVTI_b", content: { number: 42 } }] }),
      ),
    });
    expect(resolveItemId(42, CONFIG, gh)).toBe("PVTI_b");
    expect(gh.calls[1]).toEqual([
      "project", "item-list", "7", "--owner", "BoTime", "--format", "json",
    ]);
  });

  it("errors naming the issue and the configured owner and number when neither path matches", () => {
    const gh = ghRouter({
      "issue view": ok(JSON.stringify({ projectItems: [] })),
      "project item-list": ok(JSON.stringify({ items: [] })),
    });
    expect(() => resolveItemId(42, CONFIG, gh)).toThrow(/#42/);
    expect(() => resolveItemId(42, CONFIG, gh)).toThrow(/BoTime\/7/);
  });
});

describe("resolveProjectId", () => {
  it("reads the project node id from gh project view", () => {
    const gh = ghRouter({ "project view": ok(JSON.stringify({ id: "PVT_kw", number: 7 })) });
    expect(resolveProjectId(CONFIG, gh)).toBe("PVT_kw");
    expect(gh.calls[0]).toEqual([
      "project", "view", "7", "--owner", "BoTime", "--format", "json",
    ]);
  });
});

describe("findStatusField and findStatusOption", () => {
  it("finds the configured single-select field by name", () => {
    expect(findStatusField(FIELD_LIST, "Status").id).toBe("PVTSSF_status");
  });

  it("errors listing the field names the project actually has", () => {
    expect(() => findStatusField(FIELD_LIST, "State")).toThrow(/Title, Status/);
  });

  it("finds the option named by the target status", () => {
    expect(findStatusOption(findStatusField(FIELD_LIST, "Status"), "In Review").id)
      .toBe("opt_review");
  });

  it("errors listing the options the field actually has", () => {
    const field = findStatusField(FIELD_LIST, "Status");
    expect(() => findStatusOption(field, "Done")).toThrow(
      /Ready, In Progress, In Review/,
    );
  });
});

describe("move", () => {
  const routes = {
    "issue view": ok(JSON.stringify(PROJECT_ITEMS_MATCH)),
    "project view": ok(JSON.stringify({ id: "PVT_kw" })),
    "project field-list": ok(JSON.stringify(FIELD_LIST)),
    "project item-edit": ok("edited"),
  };

  it("builds the expected gh project item-edit argument list", () => {
    const gh = ghRouter(routes);
    const result = move(42, "In Progress", CONFIG, gh);
    expect(gh.calls.at(-1)).toEqual([
      "project", "item-edit",
      "--id", "PVTI_right",
      "--project-id", "PVT_kw",
      "--field-id", "PVTSSF_status",
      "--single-select-option-id", "opt_progress",
    ]);
    expect(result.status).toBe("In Progress");
  });

  it("surfaces a non-zero item-edit exit as an error, never a silent success", () => {
    const gh = ghRouter({ ...routes, "project item-edit": fail("HTTP 403") });
    expect(() => move(42, "In Progress", CONFIG, gh)).toThrow(/403/);
  });
});

describe("comment", () => {
  it("posts the --body text", () => {
    const gh = ghRouter({ "issue comment": ok("https://example.com/issues/42#c1") });
    comment(42, { body: "run started" }, gh);
    expect(gh.calls[0]).toEqual(["issue", "comment", "42", "--body", "run started"]);
  });

  it("reads --body-file and posts its contents", () => {
    // Park reasons and PR announcements are multi-line; the pr stage already
    // establishes writing such a body to a file rather than shell-quoting it.
    const gh = ghRouter({ "issue comment": ok("") });
    comment(42, { bodyFile: "/run/comment.md" }, gh, () => "line one\nline two");
    expect(gh.calls[0][4]).toBe("line one\nline two");
  });

  it("errors when neither --body nor --body-file is supplied", () => {
    const gh = ghRouter({ "issue comment": ok("") });
    expect(() => comment(42, {}, gh)).toThrow(/--body/);
    expect(gh.calls).toHaveLength(0);
  });

  it("surfaces a non-zero gh exit", () => {
    const gh = ghRouter({ "issue comment": fail("HTTP 404") });
    expect(() => comment(42, { body: "x" }, gh)).toThrow(/404/);
  });
});

describe("main — move and comment", () => {
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

  it("move prints a confirmation and exits 0", () => {
    const out = capture();
    const gh = ghRouter({
      "issue view": ok(JSON.stringify(PROJECT_ITEMS_MATCH)),
      "project view": ok(JSON.stringify({ id: "PVT_kw" })),
      "project field-list": ok(JSON.stringify(FIELD_LIST)),
      "project item-edit": ok("edited"),
    });
    main(["move", "--issue", "42", "--to", "In Review"], gh, () => ({ config: CONFIG }));
    expect(process.exitCode).toBe(0);
    expect(out.join("\n")).toContain("In Review");
  });

  it("move exits non-zero naming the missing keys when the github block is incomplete", () => {
    // The wrapper's preflight and the script fail on the same check.
    const out = capture();
    main(
      ["move", "--issue", "42", "--to", "In Review"],
      ghRouter({}),
      () => ({ config: { github: { project_owner: "BoTime" } } }),
    );
    expect(process.exitCode).toBe(1);
    expect(out.join("\n")).toContain("project_number");
  });

  it("comment posts the body and exits 0", () => {
    const out = capture();
    const gh = ghRouter({ "issue comment": ok("posted") });
    main(
      ["comment", "--issue", "42", "--body", "run started"],
      gh,
      () => ({ config: CONFIG }),
    );
    expect(process.exitCode).toBe(0);
    expect(out.join("\n")).toContain("posted");
  });

  it("a failing gh call exits non-zero with the message", () => {
    const out = capture();
    const gh = ghRouter({ "issue comment": fail("HTTP 404") });
    main(["comment", "--issue", "42", "--body", "x"], gh, () => ({ config: CONFIG }));
    expect(process.exitCode).toBe(1);
    expect(out.join("\n")).toContain("404");
  });
});

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
