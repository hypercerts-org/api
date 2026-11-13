import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Lexicons } from "@atproto/lexicon";
import { loadAssets } from "./installer.js";
import { discoverEntityFollow, SMOKE_CASES } from "./smoke-cases.js";
import {
  createHttpClient,
  findCoverageGaps,
  parseFlags,
  renderSummary,
  resolveBaseUrl,
  runPool,
  writeStepSummary,
} from "./smoke-core.js";
import { validatePackageLexicons } from "./validate-lexicons.js";

const CONCURRENCY = 4;
const SLOW_MS = 5_000;
const USAGE = `Usage: pnpm smoke [--base-url <url>] [--only <nsid-substring>]
Calls every installed query once (anonymous GET) and checks status, lexicon output schema
and basic invariants. API_BASE_URL is used when --base-url is not given.`;

const packageRoot = fileURLToPath(new URL("../", import.meta.url));

/** Installed query NSIDs, from the same bundle manifest the installer uploads. */
export async function installedQueryIds() {
  const { assets } = await loadAssets(path.join(packageRoot, "manifest.json"));
  return assets
    .filter((asset) => asset.kind === "script" && asset.id.startsWith("xrpc.query:"))
    .map((asset) => asset.id.slice("xrpc.query:".length))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Output views embed whole records by ref, which Lexicons.validate rejects ("Unexpected lexicon
 * type: record"). Validate the view shape and treat embedded records as opaque objects; the
 * records themselves are the indexer's responsibility, not this deploy's.
 * @param {any[]} documents @param {any} lexicons @returns {Lexicons}
 */
export function createViewValidator(documents, lexicons) {
  const isRecordRef = (/** @type {string} */ ref, /** @type {string} */ docId) =>
    lexicons.getDef(ref.startsWith("#") ? `${docId}${ref}` : ref)?.type === "record";
  const rewrite = (/** @type {any} */ node, /** @type {string} */ docId) => {
    if (Array.isArray(node)) return node.map((n) => rewrite(n, docId));
    if (!node || typeof node !== "object") return node;
    if (node.type === "ref" && isRecordRef(node.ref, docId)) return { type: "unknown" };
    if (node.type === "union" && node.refs.some((/** @type {string} */ r) => isRecordRef(r, docId)))
      return { type: "unknown" };
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, rewrite(v, docId)]));
  };
  const copy = documents.map((doc) => rewrite(doc, doc.id));
  return new Lexicons(copy);
}

/**
 * Cheap, data-independent invariants derived from the request and response.
 * @param {any} json @param {Record<string, any>} params @returns {string[]}
 */
export function genericInvariants(json, params) {
  return [
    ...limitErrors(json, params.limit),
    ...countErrors(json),
    ...subjectOrderErrors(json, params.subjects),
    ...uriEchoErrors(json, params.uri),
  ];
}

/** @param {any} json @param {unknown} limit @returns {string[]} */
function limitErrors(json, limit) {
  if (typeof limit !== "number") return [];
  return Object.entries(json ?? {})
    .filter(([, value]) => Array.isArray(value) && value.length > limit)
    .map(
      ([key, value]) =>
        `${key} has ${/** @type {any[]} */ (value).length} items, more than limit=${limit}`,
    );
}

/** @param {any} json @returns {string[]} */
function countErrors(json) {
  const longest = Math.max(
    0,
    ...Object.values(json ?? {})
      .filter(Array.isArray)
      .map((a) => a.length),
  );
  return ["totalCount", "likeCount", "repostCount"]
    .filter((key) => typeof json?.[key] === "number" && json[key] < longest)
    .map((key) => `${key} ${json[key]} is smaller than the ${longest} items returned`);
}

/** @param {any} json @param {unknown} subjects @returns {string[]} */
function subjectOrderErrors(json, subjects) {
  if (!Array.isArray(json?.counts) || !Array.isArray(subjects)) return [];
  const got = json.counts.map((/** @type {any} */ c) => c.subject);
  return JSON.stringify(got) === JSON.stringify(subjects)
    ? []
    : ["counts are not returned in request order (subject list differs)"];
}

/** @param {any} json @param {unknown} uri @returns {string[]} */
function uriEchoErrors(json, uri) {
  if (typeof uri !== "string") return [];
  const record = /** @type {any} */ (
    Object.values(json ?? {}).find((v) => v && typeof v === "object" && "uri" in v)
  );
  return record && record.uri !== uri
    ? [`returned uri ${record.uri} does not echo requested ${uri}`]
    : [];
}

/** @param {any} json @returns {string[]} URIs of the first array of records, for overlap checks */
function pageUris(json) {
  const items = Object.values(json ?? {}).find(Array.isArray) ?? [];
  return items.map((/** @type {any} */ i) => i?.uri).filter(Boolean);
}

/**
 * @param {string} nsid
 * @param {import("./smoke-cases.js").SmokeCase} smokeCase
 * @param {Record<string, any>} seeds
 * @param {{ get: ReturnType<typeof createHttpClient>["get"]; lexicons: any }} deps
 * @returns {Promise<import("./smoke-core.js").CheckResult>}
 */
async function runCase(nsid, smokeCase, seeds, { get, lexicons }) {
  const params = smokeCase.params(seeds);
  if (!params)
    return { name: nsid, status: "skip", ms: 0, detail: "no seed record in this environment" };

  const res = await get(nsid, params);
  /** @type {string[]} */
  const errors = [];
  if (res.status !== 200) {
    const why =
      res.status === 0 ? res.error : `${res.json?.error ?? ""} ${res.json?.message ?? ""}`.trim();
    errors.push(`HTTP ${res.status} after ${res.attempts} attempt(s): ${why}`);
  } else if (res.json === undefined) {
    errors.push("response body is not JSON");
  } else {
    try {
      lexicons.assertValidXrpcOutput(nsid, res.json);
    } catch (error) {
      errors.push(`output does not match lexicon: ${/** @type {Error} */ (error).message}`);
    }
    errors.push(
      ...genericInvariants(res.json, params),
      ...(smokeCase.check?.(res.json, params) ?? []),
    );
    if (smokeCase.phase === 1 && !errors.length)
      errors.push(...(await checkSecondPage(nsid, params, res.json, get)));
    Object.assign(seeds, smokeCase.collect?.(res.json));
  }
  const slow = res.ms > SLOW_MS ? ` (slow: ${res.ms}ms)` : "";
  return errors.length
    ? { name: nsid, status: "fail", ms: res.ms, detail: errors.join("; ") }
    : { name: nsid, status: "pass", ms: res.ms, detail: `ok${slow}` };
}

/** Page 2 must not repeat page 1. @returns {Promise<string[]>} */
async function checkSecondPage(nsid, params, first, get) {
  if (typeof first.cursor !== "string") return [];
  const second = await get(nsid, { ...params, cursor: first.cursor });
  if (second.status !== 200) return [`page 2 returned HTTP ${second.status}`];
  const seen = new Set(pageUris(first));
  const repeated = pageUris(second.json).filter((uri) => seen.has(uri));
  return repeated.length ? [`page 2 repeats ${repeated.length} item(s) from page 1`] : [];
}

/** @param {string[]} argv */
export async function main(argv) {
  if (argv.includes("--help")) {
    console.log(USAGE);
    return 0;
  }
  const flags = parseFlags(argv, ["base-url", "only"]);
  const baseUrl = resolveBaseUrl(flags);
  const started = Date.now();

  const installed = await installedQueryIds();
  const gaps = findCoverageGaps(installed, Object.keys(SMOKE_CASES));
  if (gaps.missing.length || gaps.stale.length) {
    const lines = [
      ...gaps.missing.map((n) => `  installed query has no smoke case: ${n}`),
      ...gaps.stale.map((n) => `  smoke case for a query that is not installed: ${n}`),
    ];
    throw new Error(
      `Smoke coverage is out of sync with happyview-modules/manifest.json:\n${lines.join("\n")}\nAdd or remove the case in tooling/smoke-cases.js.`,
    );
  }

  const { lexicons: full, documents } = await validatePackageLexicons(packageRoot);
  const lexicons = createViewValidator(documents, full);
  const client = createHttpClient({ baseUrl });
  const deps = { get: client.get, lexicons };
  const only = flags.only;
  /** @type {Record<string, any>} */
  const seeds = {};
  const select = (/** @type {number} */ phase) =>
    installed.filter(
      (nsid) => SMOKE_CASES[nsid]?.phase === phase && (!only || nsid.includes(only)),
    );
  const tasks = (/** @type {string[]} */ ids) =>
    ids.map((nsid) => () => runCase(nsid, /** @type {any} */ (SMOKE_CASES[nsid]), seeds, deps));

  const results = await runPool(tasks(select(1)), CONCURRENCY);
  Object.assign(seeds, await discoverEntityFollow(client.get));
  results.push(...(await runPool(tasks(select(2)), CONCURRENCY)));

  const markdown = renderSummary("Post-deploy smoke", results, {
    baseUrl,
    requests: client.requestCount,
    seconds: (Date.now() - started) / 1000,
  });
  for (const r of results) {
    if (r.status !== "pass")
      console.log(`${r.status.toUpperCase().padEnd(4)} ${r.name}: ${r.detail}`);
  }
  console.log(markdown.split("\n")[2]);
  await writeStepSummary(markdown);
  return results.some((r) => r.status === "fail") ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(/** @type {Error} */ (error).message);
    process.exitCode = 1;
  }
}
