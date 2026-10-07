import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';

export class Gap extends Error {}
export class Stopped extends Error {}
export class UnavailableEvidence extends Error {
  constructor(message, { sequence = null, status = null, replayEvaluation = null, cause } = {}) {
    super(message, { cause });
    this.name = 'UnavailableEvidence';
    this.sequence = sequence;
    this.status = status;
    this.replayEvaluation = replayEvaluation;
    if (Number.isSafeInteger(sequence)) this.requestEvidence = { sequence, status, replayEvaluation };
  }
}

/** Serialized read-only transport. Every started attempt, including failures, consumes budget. */
export function createTransport({ target, budget, interval = 1000, directory, fetch: fetcher = globalThis.fetch }) {
  const base = new URL(target);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || !['/', '/xrpc', '/xrpc/'].includes(base.pathname)) {
    throw new Error('Target must be an HTTP(S) API origin or /xrpc URL without credentials, query, or fragment.');
  }
  if (!Number.isInteger(budget) || budget < 1) throw new Error('Request budget must be a positive integer.');
  let attempts = 0;
  let lastStarted = 0;
  let stopped;
  let tail = Promise.resolve();
  async function send(nsid, params) {
    if (stopped) throw new Stopped(stopped);
    if (attempts >= budget) throw new Stopped(`Request budget ${budget} exhausted; increase it only after reviewing retained coverage.`);
    await setTimeout(Math.max(0, lastStarted + interval - Date.now()));
    const query = Object.entries(params).flatMap(([key, value]) => (Array.isArray(value) ? value : [value])
      .map(item => `${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`)).join('&');
    const url = `${base.origin}/xrpc/${encodeURIComponent(nsid)}${query ? `?${query}` : ''}`;
    const sequence = ++attempts;
    lastStarted = Date.now();
    const evidence = { sequence, url, method: 'GET', startedAt: new Date(lastStarted).toISOString(), status: null };
    const file = path.join(directory, `${String(sequence).padStart(6, '0')}.json`);
    await writeFile(file, JSON.stringify(evidence, null, 2), { flag: 'wx', mode: 0o600 });
    try {
      const response = await fetcher(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30000) });
      evidence.status = response.status;
      evidence.headers = Object.fromEntries(response.headers);
      evidence.body = await response.text();
      if (response.status === 429) {
        stopped = 'HTTP 429 received; run stopped without retries. Review request pacing before another run.';
        throw new Stopped(stopped);
      }
      const body = JSON.parse(evidence.body);
      return { status: response.status, body, sequence };
    } catch (error) {
      evidence.error = error.message;
      if (error && typeof error === 'object') {
        try { error.requestEvidence = { sequence, url, status: evidence.status }; } catch {}
      }
      throw error;
    } finally {
      evidence.completedAt = new Date().toISOString();
      await writeFile(file, JSON.stringify(evidence, null, 2), { mode: 0o600 });
    }
  }
  return {
    mode: 'live',
    target: base.origin,
    get attempts() { return attempts; },
    get replayEvaluations() { return 0; },
    request(nsid, params) {
      const next = tail.then(() => send(nsid, params));
      tail = next.catch(() => {});
      return next;
    },
  };
}

function queryGroupsFromParams(params) {
  const groups = new Map();
  for (const [key, value] of Object.entries(params)) {
    const values = Array.isArray(value) ? value : [value];
    groups.set(key, values.map(item => String(item)));
  }
  return groups;
}

function queryGroupsFromUrl(url) {
  const groups = new Map();
  for (const [key, value] of url.searchParams) {
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(value);
  }
  return groups;
}

function requestKey(method, nsid, groups) {
  return JSON.stringify([method, nsid, [...groups].sort(([left], [right]) => left.localeCompare(right))]);
}

/** Replays only retained GET responses; missing or incomplete evidence never falls through to fetch. */
export async function createReplayTransport({ evidenceDirectory, target }) {
  const expectedOrigin = target ? new URL(target).origin : null;
  const files = (await readdir(evidenceDirectory)).filter(name => /^\d+\.json$/.test(name)).sort((a, b) => Number(a.slice(0, -5)) - Number(b.slice(0, -5)));
  const captures = new Map();
  for (const file of files) {
    const capture = JSON.parse(await readFile(path.join(evidenceDirectory, file), 'utf8'));
    if (typeof capture.url !== 'string' || typeof capture.method !== 'string') continue;
    let url;
    try { url = new URL(capture.url); } catch { continue; }
    if (expectedOrigin && url.origin !== expectedOrigin) continue;
    const prefix = '/xrpc/';
    if (!url.pathname.startsWith(prefix)) continue;
    let nsid;
    try { nsid = decodeURIComponent(url.pathname.slice(prefix.length)); } catch { continue; }
    const key = requestKey(capture.method, nsid, queryGroupsFromUrl(url));
    if (!captures.has(key)) captures.set(key, []);
    captures.get(key).push({ ...capture, sequence: Number.isSafeInteger(capture.sequence) ? capture.sequence : Number(file.slice(0, -5)) });
  }

  const consumed = new Map();
  const used = new Set();
  let evaluations = 0;
  let reuseCount = 0;
  return {
    mode: 'replay',
    target: target ?? null,
    get attempts() { return 0; },
    get replayEvaluations() { return evaluations; },
    get evidenceSequences() { return [...used].sort((a, b) => a - b); },
    get reusedCaptureCount() { return reuseCount; },
    async request(nsid, params) {
      const replayEvaluation = ++evaluations;
      const key = requestKey('GET', nsid, queryGroupsFromParams(params));
      const matches = captures.get(key) ?? [];
      if (!matches.length) throw new UnavailableEvidence(`No captured GET evidence matches ${nsid} with ${JSON.stringify(params)}; replay did not make a network request.`, { replayEvaluation });
      const index = consumed.get(key) ?? 0;
      const reusedCapture = index >= matches.length;
      const capture = matches[Math.min(index, matches.length - 1)];
      if (reusedCapture) reuseCount++;
      else consumed.set(key, index + 1);
      if (Number.isSafeInteger(capture.sequence)) used.add(capture.sequence);
      if (!Number.isInteger(capture.status) || typeof capture.body !== 'string') {
        throw new UnavailableEvidence(`Captured request ${capture.sequence} for ${nsid} has no complete HTTP status/body; replay did not make a network request.`, { sequence: capture.sequence, status: capture.status ?? null, replayEvaluation });
      }
      let body;
      try { body = JSON.parse(capture.body); }
      catch (cause) {
        throw new UnavailableEvidence(`Captured request ${capture.sequence} for ${nsid} has a malformed JSON body (${cause.message}); replay did not make a network request.`, {
          sequence: capture.sequence, status: capture.status, replayEvaluation, cause,
        });
      }
      return {
        status: capture.status,
        body,
        sequence: capture.sequence,
        replayEvaluation,
        replayed: true,
        reusedCapture,
      };
    },
  };
}

/** A bounded scan cannot claim termination when a server cursor remains. */
export async function paginate(request, params, { pages, key }) {
  const rows = [];
  const seen = new Set();
  const cursors = new Set();
  let cursor;
  for (let page = 0; page < pages; page++) {
    const result = await request({ ...params, ...(cursor ? { cursor } : {}) });
    for (const row of result.rows) {
      const identity = key(row);
      assert.ok(identity, 'Missing pagination identity');
      assert.ok(!seen.has(identity), `Pagination duplicate: ${identity}`);
      seen.add(identity);
      rows.push(row);
    }
    cursor = result.cursor;
    if (!cursor) return { rows, complete: true, pages: page + 1 };
    assert.ok(!cursors.has(cursor), 'Server repeated a pagination cursor');
    cursors.add(cursor);
  }
  return { rows, complete: false, cursor, pages };
}

export async function executeCase(id, run) {
  try {
    return { id, status: 'passed', ...await run() };
  } catch (error) {
    return { id, status: error instanceof Gap ? 'insufficient-data' : error instanceof Stopped || error instanceof UnavailableEvidence ? 'not-run' : 'failed', reason: error.message };
  }
}
