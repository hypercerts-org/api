import assert from "node:assert/strict";
import test from "node:test";
import {
  createApi,
  decideAlert,
  findPreviousResult,
  run,
  toResult,
} from "../../../../.github/actions/telegram-alert/status-change.mjs";

const REPO = "hypercerts-org/api";

const completed = (id, conclusion, extra = {}) => ({
  id,
  status: "completed",
  conclusion,
  display_title: "Smoke Production",
  head_branch: "main",
  html_url: `https://github.com/${REPO}/actions/runs/${id}`,
  ...extra,
});

/**
 * Fake GitHub API. `current` is the running workflow run, `runs` the completed list (newest
 * first) and `jobs` maps a run id to its jobs. Records every requested path.
 */
function fakeApi({
  current = { id: 100, display_title: "Smoke Production", head_branch: "main" },
  runs = [],
  jobs = {},
}) {
  const paths = [];
  const api = async (path) => {
    paths.push(path);
    if (path === `/repos/${REPO}/actions/runs/${current.id}`) return current;
    if (path.startsWith(`/repos/${REPO}/actions/workflows/`)) return { workflow_runs: runs };
    const jobsFor = path.match(/\/actions\/runs\/(\d+)\/jobs/);
    if (jobsFor) return { jobs: jobs[jobsFor[1]] ?? [] };
    throw new Error(`unexpected request ${path}`);
  };
  return { api, paths };
}

const lookup = (api, overrides = {}) =>
  findPreviousResult({
    api,
    repo: REPO,
    runId: "100",
    workflow: "smoke.yml",
    match: "title",
    ...overrides,
  });

test("alerts only when the result changes", () => {
  const table = [
    ["fail", "pass", "failed"],
    ["fail", undefined, "failed"],
    ["fail", "fail", "none"],
    ["pass", "fail", "recovered"],
    ["pass", "pass", "none"],
    ["pass", undefined, "none"],
    [undefined, "fail", "none"],
  ];
  for (const [current, previous, expected] of table)
    assert.equal(decideAlert(current, previous), expected, `${current} after ${previous}`);
});

test("only success and failure count as results", () => {
  assert.equal(toResult("success"), "pass");
  assert.equal(toResult("failure"), "fail");
  assert.equal(toResult("timed_out"), "fail");
  for (const other of ["cancelled", "skipped", "neutral", "", null, undefined])
    assert.equal(toResult(other), undefined, String(other));
});

test("previous result skips cancelled and skipped runs", async () => {
  const { api, paths } = fakeApi({
    runs: [
      completed(99, "cancelled"),
      completed(98, "skipped"),
      completed(96, "failure"),
      completed(95, "success"),
    ],
  });
  const previous = await lookup(api);
  assert.deepEqual(previous, { result: "fail", url: `https://github.com/${REPO}/actions/runs/96` });
  assert.ok(
    paths.some((p) => p.includes("/workflows/smoke.yml/runs?status=completed")),
    "reads completed runs of the named workflow file",
  );
});

test("previous result ignores the current run and other environments", async () => {
  const { api } = fakeApi({
    runs: [
      completed(100, "failure"),
      completed(99, "failure", { display_title: "Smoke Staging" }),
      completed(98, "success"),
    ],
  });
  assert.equal((await lookup(api))?.result, "pass");
});

test("branch matching compares only runs from the current run's branch", async () => {
  const { api, paths } = fakeApi({
    current: { id: 100, display_title: "Deploy production (push)", head_branch: "production" },
    runs: [
      completed(99, "failure", { head_branch: "main" }),
      completed(98, "success", { head_branch: "production" }),
    ],
  });
  const previous = await lookup(api, { workflow: "deploy.yml", match: "branch" });
  assert.equal(previous?.result, "pass");
  assert.ok(paths.some((p) => p.includes("branch=production")));
});

test("step matching uses the step's result and skips runs where it did not finish", async () => {
  const smoke = (conclusion) => [
    { name: "Install", steps: [{ name: "Smoke test", conclusion }] },
    { name: "Resolve", steps: [{ name: "Set up job", conclusion: "success" }] },
  ];
  const { api } = fakeApi({
    current: { id: 100, display_title: "Deploy main (push)", head_branch: "main" },
    runs: [
      // Deploy failed before the smoke test started: the run failed, but there is no smoke result.
      completed(99, "failure", { head_branch: "main" }),
      // Smoke passed; a later step failed the run.
      completed(98, "failure", { head_branch: "main" }),
      completed(97, "success", { head_branch: "main" }),
    ],
    jobs: { 99: smoke("skipped"), 98: smoke("success"), 97: smoke("failure") },
  });
  const previous = await lookup(api, {
    match: "branch",
    workflow: "deploy.yml",
    step: "Smoke test",
  });
  assert.equal(previous?.result, "pass");
  assert.ok(previous?.url.endsWith("/98"));
});

test("previous result is unknown when no comparable run exists", async () => {
  const { api } = fakeApi({ runs: [completed(99, "cancelled")] });
  assert.equal(await lookup(api), undefined);
});

const env = (overrides) => ({
  RESULT: "failure",
  PREVIOUS_WORKFLOW: "smoke.yml",
  GITHUB_REPOSITORY: REPO,
  GITHUB_RUN_ID: "100",
  ...overrides,
});

test("run: first failure alerts, repeat failure is silent, recovery alerts once", async () => {
  const failing = fakeApi({ runs: [completed(99, "success")] });
  assert.equal((await run(env(), failing.api)).send, "failed");

  const stillFailing = fakeApi({ runs: [completed(99, "failure"), completed(98, "success")] });
  assert.equal((await run(env(), stillFailing.api)).send, "none");

  const recovered = fakeApi({ runs: [completed(99, "failure")] });
  assert.equal((await run(env({ RESULT: "success" }), recovered.api)).send, "recovered");

  const stillPassing = fakeApi({ runs: [completed(99, "success")] });
  assert.equal((await run(env({ RESULT: "success" }), stillPassing.api)).send, "none");
});

test("run: a cancelled job sends nothing and reads nothing", async () => {
  const { api, paths } = fakeApi({ runs: [completed(99, "failure")] });
  assert.equal((await run(env({ RESULT: "cancelled" }), api)).send, "none");
  assert.deepEqual(paths, []);
});

test("run: without a workflow to compare with, a failure alerts and a pass is silent", async () => {
  const { api, paths } = fakeApi({});
  assert.equal((await run(env({ PREVIOUS_WORKFLOW: "" }), api)).send, "failed");
  assert.equal((await run(env({ PREVIOUS_WORKFLOW: "", RESULT: "success" }), api)).send, "none");
  assert.deepEqual(paths, []);
});

test("run: a failed lookup warns, alerts on failure and stays silent on a pass", async () => {
  const broken = async (path) => {
    throw new Error(`GET ${path} returned HTTP 403`);
  };
  const failed = await run(env(), broken);
  assert.equal(failed.send, "failed");
  assert.match(failed.warning, /treating the previous status as unknown/);
  assert.equal((await run(env({ RESULT: "success" }), broken)).send, "none");
});

test("run: a bad previous-match fails safe with a message that names the fix", async () => {
  const { api } = fakeApi({});
  const outcome = await run(env({ PREVIOUS_MATCH: "env" }), api);
  assert.equal(outcome.send, "failed");
  assert.match(outcome.warning, /previous-match must be "title" or "branch"/);
});

test("the GitHub token is sent as a bearer header and never put in the URL", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, headers: init.headers });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const api = createApi({ token: "ghs_secret", baseUrl: "https://api.example", fetchImpl });
  await api("/repos/a/b/actions/runs/1");
  assert.equal(seen[0].url, "https://api.example/repos/a/b/actions/runs/1");
  assert.equal(seen[0].headers.Authorization, "Bearer ghs_secret");
  assert.ok(!seen[0].url.includes("ghs_secret"));
});
