/**
 * Shared building blocks for the read-only post-deploy checks (`smoke.js`, `e2e.js`).
 * Everything here is anonymous and GET-only by construction: the HTTP client has no way to
 * send another method, a body, or credentials.
 */

/** @typedef {Record<string, string | number | boolean | Array<string | number | boolean>>} QueryParams */
/**
 * @typedef {object} HttpResult
 * @property {string} url
 * @property {number} status 0 when no HTTP response arrived (timeout or network failure).
 * @property {number} ms Wall time of the final attempt.
 * @property {number} attempts
 * @property {any} json Parsed JSON body, or undefined when the body was not JSON.
 * @property {string} [error] Transport failure description when status is 0.
 */

export const DEFAULT_TIMEOUT_MS = 15_000;

/** @param {string} raw @returns {string} origin-and-path base without a trailing slash */
export function normalizeBaseUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `Invalid API base URL "${raw}"; pass --base-url or set API_BASE_URL to an https:// origin such as https://test.api.hypercerts.dev`,
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error(`API base URL must be http(s), got "${raw}"`);
  if (url.username || url.password)
    throw new Error("API base URL must not contain credentials; these checks are anonymous");
  let end = url.pathname.length;
  while (end > 0 && url.pathname[end - 1] === "/") end -= 1;
  return `${url.origin}${url.pathname.slice(0, end)}`;
}

/**
 * Hard guard: only anonymous GET requests to /xrpc/ query endpoints may leave this process.
 * @param {string} method @param {string} url
 */
export function assertReadOnlyRequest(method, url) {
  if (method !== "GET")
    throw new Error(`Refusing ${method} ${url}: post-deploy checks only send GET requests`);
  if (!new URL(url).pathname.includes("/xrpc/"))
    throw new Error(`Refusing ${url}: post-deploy checks only call /xrpc/ query endpoints`);
}

/** @param {QueryParams} params */
function toSearch(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : [value]) search.append(key, String(item));
  }
  return search.toString();
}

/** @param {number} status */
// Only timeouts and network errors (status 0) are retried. A real HTTP error, 4xx or 5xx, is
// returned at once so a broken endpoint fails fast.
const isRetryableStatus = (status) => status === 0;
const RETRY_BASE_MS = 1000;

/**
 * @param {object} options
 * @param {string} options.baseUrl
 * @param {number} [options.timeoutMs]
 * @param {number} [options.retries] Extra attempts after a timeout or network error, with 1s, 2s, 4s… backoff.
 * @param {number} [options.paceMs] Minimum gap between the start of consecutive requests.
 * @param {typeof fetch} [options.fetchImpl]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 */
export function createHttpClient({
  baseUrl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = 3,
  paceMs = 0,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const base = normalizeBaseUrl(baseUrl);
  let requests = 0;
  let lastStart = 0;

  /** @param {string} url @returns {Promise<Omit<HttpResult, "attempts" | "url">>} */
  async function attempt(url) {
    if (paceMs > 0) {
      const wait = lastStart + paceMs - Date.now();
      lastStart = Date.now() + Math.max(wait, 0);
      if (wait > 0) await sleep(wait);
    }
    const started = Date.now();
    requests += 1;
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: { accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await response.text();
      /** @type {any} */
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      return { status: response.status, ms: Date.now() - started, json };
    } catch (cause) {
      const name = cause instanceof Error ? cause.name : "";
      const reason = name === "TimeoutError" ? `timed out after ${timeoutMs}ms` : String(cause);
      return { status: 0, ms: Date.now() - started, json: undefined, error: reason };
    }
  }

  return {
    get requestCount() {
      return requests;
    },
    /**
     * One GET, retried with exponential backoff on timeout/network error only. HTTP errors are not retried.
     * @param {string} nsid @param {QueryParams} [params] @returns {Promise<HttpResult>}
     */
    async get(nsid, params = {}) {
      const search = toSearch(params);
      const query = search ? `?${search}` : "";
      const url = `${base}/xrpc/${nsid}${query}`;
      assertReadOnlyRequest("GET", url);
      let result = await attempt(url);
      let attempts = 1;
      while (isRetryableStatus(result.status) && attempts <= retries) {
        await sleep(RETRY_BASE_MS * 2 ** (attempts - 1));
        result = await attempt(url);
        attempts += 1;
      }
      return { url, attempts, ...result };
    },
  };
}

/**
 * Coverage guard. Installed queries without a case would ship unchecked; cases for queries
 * that are not installed are stale.
 * @param {string[]} installed @param {string[]} cased
 */
export function findCoverageGaps(installed, cased) {
  const have = new Set(cased);
  const want = new Set(installed);
  return {
    missing: installed.filter((nsid) => !have.has(nsid)).sort((a, b) => a.localeCompare(b)),
    stale: cased.filter((nsid) => !want.has(nsid)).sort((a, b) => a.localeCompare(b)),
  };
}

/**
 * Runs async tasks with bounded concurrency; results keep input order.
 * @template T @param {Array<() => Promise<T>>} tasks @param {number} limit @returns {Promise<T[]>}
 */
export async function runPool(tasks, limit) {
  /** @type {T[]} */
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const index = next++;
      const task = tasks[index];
      if (task) results[index] = await task();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

/** @typedef {{ name: string; status: "pass" | "fail" | "skip" | "info"; ms: number; detail: string }} CheckResult */

/** @param {string} text */
const cell = (text) => text.replaceAll("|", String.raw`\|`).replace(/\s+/g, " ").slice(0, 300);

/** @param {string} title @param {CheckResult[]} results @param {{ baseUrl: string; requests: number; seconds: number }} meta */
export function renderSummary(title, results, meta) {
  const count = (/** @type {string} */ status) => results.filter((r) => r.status === status).length;
  const lines = [
    `## ${title}`,
    "",
    `Target: \`${meta.baseUrl}\` · ${meta.requests} requests · ${meta.seconds.toFixed(1)}s · ` +
      `${count("pass")} passed, ${count("fail")} failed, ${count("skip")} skipped`,
    "",
    "| Check | Result | ms | Detail |",
    "| --- | --- | ---: | --- |",
  ];
  const icon = { pass: "pass", fail: "**FAIL**", skip: "skip", info: "info" };
  // Failures first so they are visible without scrolling.
  const ordered = [...results].sort(
    (a, b) => Number(b.status === "fail") - Number(a.status === "fail"),
  );
  for (const r of ordered)
    lines.push(`| ${cell(r.name)} | ${icon[r.status]} | ${r.ms} | ${cell(r.detail)} |`);
  return `${lines.join("\n")}\n`;
}

/** @param {string} markdown */
export async function writeStepSummary(markdown) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const { appendFile } = await import("node:fs/promises");
  await appendFile(file, `${markdown}\n`);
}

/** @param {string[]} argv @param {string[]} flagsWithValue @returns {Record<string, string>} */
export function parseFlags(argv, flagsWithValue) {
  /** @type {Record<string, string>} */
  const flags = {};
  const supported = flagsWithValue.map((f) => `--${f} <value>`).join(", ");
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    const name = arg.replace(/^--/, "");
    if (!arg.startsWith("--") || !flagsWithValue.includes(name))
      throw new Error(`Unknown option ${arg}; supported: ${supported}`);
    const value = argv[++i];
    if (value === undefined) throw new Error(`Option ${arg} needs a value`);
    flags[name] = value;
  }
  return flags;
}

/** @param {Record<string, string>} flags */
export function resolveBaseUrl(flags) {
  const raw = flags["base-url"] ?? process.env.API_BASE_URL;
  if (!raw)
    throw new Error(
      "No API base URL: set API_BASE_URL or pass --base-url (for example https://test.api.hypercerts.dev)",
    );
  return normalizeBaseUrl(raw);
}
