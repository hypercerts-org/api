/**
 * Decides whether a finished run should send a Telegram message, by comparing its result with the
 * previous completed run of the same workflow and target (read from the GitHub API).
 *
 *   failing now, not failing before (or unknown)  -> "failed"
 *   passing now, failing before                   -> "recovered"
 *   anything else                                 -> "none"
 *
 * "Unknown previous" (first run, API error, nothing comparable) alerts on a failure and stays
 * silent on a pass, so a broken lookup can only produce an extra alert, never hide a failure.
 * Lookups never throw out of `run()`, so the alert step cannot change the job result.
 *
 * Lives in the action directory, not in happyview-modules/tooling, so deploy.yml can fetch it from
 * the workflow's own commit when it rolls back to an older commit that predates it.
 */
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Most recent completed runs read per lookup. */
const PAGE_SIZE = 50;
/** Comparable runs examined before giving up; bounds the per-run job lookups in step mode. */
const MAX_CANDIDATES = 10;
const API_TIMEOUT_MS = 15_000;
/** @type {Record<Result, string>} */
const STATE = { pass: "passing", fail: "failing" };

/** @typedef {"pass" | "fail"} Result */
/** @typedef {"failed" | "recovered" | "none"} Alert */
/** @typedef {(path: string) => Promise<any>} GithubApi */

/**
 * Maps a GitHub conclusion, or a job/step outcome, to a result. Cancelled, skipped and anything
 * else is not a result.
 * @param {string | null | undefined} conclusion
 * @returns {Result | undefined}
 */
export function toResult(conclusion) {
  if (conclusion === "success") return "pass";
  if (conclusion === "failure" || conclusion === "timed_out") return "fail";
  return undefined;
}

/**
 * @param {Result | undefined} current
 * @param {Result | undefined} previous
 * @returns {Alert}
 */
export function decideAlert(current, previous) {
  if (current === "fail") return previous === "fail" ? "none" : "failed";
  if (current === "pass") return previous === "fail" ? "recovered" : "none";
  return "none";
}

/**
 * Result of the step called `stepName` in `run`, or undefined when that step did not run or did not
 * finish (for example the deploy failed before the smoke test started).
 * @param {GithubApi} api @param {string} repo @param {{ id: number }} run @param {string} stepName
 * @returns {Promise<Result | undefined>}
 */
async function stepResult(api, repo, run, stepName) {
  const { jobs } = await api(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`);
  for (const job of jobs) {
    const step = (job.steps ?? []).find((/** @type {{ name: string }} */ s) => s.name === stepName);
    if (step) return toResult(step.conclusion);
  }
  return undefined;
}

/**
 * Latest completed run of `workflow`, before the current one, for the same target, that produced a
 * pass or a fail. "Same target" is the current run's `display_title` (match "title", used where
 * run-name carries the environment) or its branch (match "branch", used where the environment is
 * implied by the branch). With `step`, a run's result is that step's conclusion rather than the
 * run's, and runs where the step did not finish are skipped.
 * @param {{ api: GithubApi, repo: string, runId: string, workflow: string,
 *   match: string, step?: string }} options
 * @returns {Promise<{ result: Result, url: string } | undefined>}
 */
export async function findPreviousResult({ api, repo, runId, workflow, match, step }) {
  if (match !== "title" && match !== "branch")
    throw new Error(`previous-match must be "title" or "branch", got "${match}".`);
  const current = await api(`/repos/${repo}/actions/runs/${runId}`);
  const sameTarget =
    match === "branch"
      ? (/** @type {any} */ run) => run.head_branch === current.head_branch
      : (/** @type {any} */ run) => run.display_title === current.display_title;

  const query = new URLSearchParams({ status: "completed", per_page: String(PAGE_SIZE) });
  if (match === "branch") query.set("branch", current.head_branch);
  const { workflow_runs: runs } = await api(
    `/repos/${repo}/actions/workflows/${workflow}/runs?${query}`,
  );

  const candidates = runs
    .filter((/** @type {any} */ run) => String(run.id) !== String(runId) && sameTarget(run))
    .slice(0, MAX_CANDIDATES);
  for (const run of candidates) {
    const result = step ? await stepResult(api, repo, run, step) : toResult(run.conclusion);
    if (result) return { result, url: run.html_url };
  }
  return undefined;
}

/**
 * Reads its inputs from `env`, as the composite action passes them.
 * @param {Record<string, string | undefined>} env @param {GithubApi} api
 * @returns {Promise<{ send: Alert, notice: string, warning?: string }>}
 */
export async function run(env, api) {
  const current = toResult(env.RESULT);
  const workflow = env.PREVIOUS_WORKFLOW;
  /** @type {Awaited<ReturnType<typeof findPreviousResult>>} */
  let previous;
  let warning;
  if (current && workflow) {
    try {
      previous = await findPreviousResult({
        api,
        repo: env.GITHUB_REPOSITORY ?? "",
        runId: env.GITHUB_RUN_ID ?? "",
        workflow,
        match: env.PREVIOUS_MATCH || "title",
        step: env.PREVIOUS_STEP || undefined,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      warning = `Could not read previous ${workflow} runs (${reason}); treating the previous status as unknown.`;
    }
  }
  const send = decideAlert(current, previous?.result);
  const now = current ? STATE[current] : `"${env.RESULT}"`;
  const before = previous
    ? `${STATE[previous.result]} in the previous run (${previous.url})`
    : "of unknown status before";
  return { send, warning, notice: `Telegram alert: ${send}. Now ${now}, ${before}.` };
}

/**
 * @param {{ token?: string, baseUrl?: string, fetchImpl?: typeof fetch }} options
 * @returns {GithubApi}
 */
export function createApi({ token, baseUrl = "https://api.github.com", fetchImpl = fetch }) {
  return async (path) => {
    // The token only ever travels in this header: not in argv, the URL or any log line.
    const response = await fetchImpl(`${baseUrl}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`GET ${path} returned HTTP ${response.status}`);
    return response.json();
  };
}

async function main() {
  const env = process.env;
  const api = createApi({ token: env.GITHUB_TOKEN, baseUrl: env.GITHUB_API_URL || undefined });
  const { send, notice, warning } = await run(env, api);
  if (warning) process.stdout.write(`::warning::${warning}\n`);
  process.stdout.write(`::notice::${notice}\n`);
  const line = `send=${send}\n`;
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, line);
  else process.stdout.write(line);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
