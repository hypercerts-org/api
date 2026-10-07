import assert from 'node:assert/strict';
import { appendFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { jsonToLex } from '@atproto/lexicon';
import { casesFor } from './catalogue.mjs';
import { filterValues, identity, matches, view } from './predicates.mjs';
import { executeCase, Gap, paginate, Stopped, UnavailableEvidence } from './runtime.mjs';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const object = value => isObject(value) ? value : {};
function positive(condition, message) { if (!condition) throw new Gap(message); }
function placeholder(schema) {
  if (schema.type === 'string') return schema.enum?.[0] ?? (schema.format === 'did' ? 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa' : schema.format === 'at-uri' ? 'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/app.certified.actor.profile/self' : '');
  if (schema.type === 'array') return (schema.minLength ?? 0) > 0 ? [placeholder(schema.items)] : [];
  if (schema.type === 'boolean') return false;
  if (schema.type === 'integer') return schema.minimum ?? 1;
  if (schema.type === 'number') return schema.minimum ?? 1;
  return undefined;
}
function acceptsParameter(endpoint, key, value, validator) {
  const params = {};
  for (const required of endpoint.params.required ?? []) params[required] = required === key ? value : placeholder(endpoint.params.properties[required]);
  if (!Object.hasOwn(params, key)) params[key] = value;
  try { validator.assertValidXrpcParams(endpoint.nsid, params); return true; } catch { return false; }
}
function seedParams(endpoint, seeds, validator) {
  const params = {};
  const required = endpoint.params.required ?? [];
  if (required.includes('search')) params.search = '';
  if (endpoint.nsid.startsWith('app.certified.graph.')) {
    const entity = /Entity/.test(endpoint.nsid);
    const type = `app.certified.graph.${entity ? 'entityFollow' : 'follow'}`;
    for (const anchor of seeds) {
      const record = object(anchor?.record);
      if (record.$type !== type) continue;
      const subject = record.subject;
      const candidate = {};
      for (const key of required.filter(key => key !== 'search')) {
        if (key === 'actor') candidate.actor = endpoint.nsid.endsWith('listActorFollowers') ? subject : anchor?.did;
        if (key === 'subject') candidate.subject = subject;
        if (key === 'entity') candidate.entity = typeof subject === 'string' ? undefined : object(subject).uri;
      }
      Object.assign(candidate, params);
      if ((required.filter(key => key !== 'search')).every(key => candidate[key] !== undefined) && acceptsParameter(endpoint, required.find(key => key !== 'search'), candidate[required.find(key => key !== 'search')], validator)) {
        try { validator.assertValidXrpcParams(endpoint.nsid, candidate); return candidate; } catch {}
      }
    }
  }
  for (const key of required.filter(key => key !== 'search')) {
    let candidates = [];
    if (key === 'uri') candidates = seeds.map(row => view(row).uri);
    if (key === 'actors') {
      const actors = seeds.map(row => object(row).did).filter(value => typeof value === 'string' && acceptsParameter(endpoint, key, [value], validator));
      candidates = actors.length ? [[...actors.slice(0, 2), actors[0]]] : [];
    }
    if (key === 'collection') candidates = seeds.filter(row => Array.isArray(object(object(row).record).items) && object(row).uri).map(row => row.uri);
    if (key === 'actor' && endpoint.nsid.startsWith('app.certified.actor.')) candidates = seeds.map(row => object(row).did);
    const value = candidates.find(candidate => candidate !== undefined && acceptsParameter(endpoint, key, candidate, validator));
    positive(value !== undefined, `No usable, schema-valid discovery anchor for required ${key}; inspect source observations or expand discovery.`);
    params[key] = value;
  }
  try { validator.assertValidXrpcParams(endpoint.nsid, params); }
  catch (error) { positive(false, `Discovered values cannot form legal parameters for ${endpoint.nsid}: ${error.message}`); }
  return params;
}

function sampleValue(row, filter) {
  const values = filterValues(row, filter);
  if (filter === 'before') {
    if (typeof values[0] !== 'string') return undefined;
    const timestamp = Date.parse(values[0]);
    return Number.isFinite(timestamp) ? new Date(timestamp + 1).toISOString() : undefined;
  }
  return values[0];
}

function checkOrder(rows, direction) {
  const keys = rows.map(row => {
    const source = view(row);
    const created = object(source.record).createdAt;
    const time = typeof created === 'string' ? Date.parse(created) : NaN;
    const fallback = typeof source.indexedAt === 'string' ? Date.parse(source.indexedAt) : NaN;
    positive(Number.isFinite(time) || Number.isFinite(fallback), 'Ordering key unavailable in response; cannot infer hidden database fallback time.');
    positive(typeof source.uri === 'string', 'URI ordering key is unavailable or malformed in response.');
    return [Number.isFinite(time) ? time : fallback, source.uri];
  });
  for (let index = 1; index < keys.length; index++) {
    const previous = keys[index - 1];
    const current = keys[index];
    const comparison = previous[0] - current[0] || (previous[1] < current[1] ? -1 : previous[1] > current[1] ? 1 : 0);
    assert.ok(direction === 'asc' ? comparison <= 0 : comparison >= 0, `Incorrect ${direction} timestamp/URI ordering`);
  }
}

function minimumResponseError(endpoint, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return `HTTP 200 body for ${endpoint.nsid} is not a JSON object.`;
  if (Object.hasOwn(body, 'cursor') && typeof body.cursor !== 'string') return `HTTP 200 response from ${endpoint.nsid} has a non-string cursor.`;
  if (!(endpoint.document.defs.output.required ?? []).includes(endpoint.resultKey) && !Object.hasOwn(body, endpoint.resultKey)) return null;
  if (!Object.hasOwn(body, endpoint.resultKey)) return `HTTP 200 response from ${endpoint.nsid} is missing required ${endpoint.resultKey}.`;
  const schema = endpoint.resultSchema;
  const value = body[endpoint.resultKey];
  if (value === null && schema.nullable) return null;
  if (schema.type === 'array' && !Array.isArray(value)) return `HTTP 200 response from ${endpoint.nsid} has non-array ${endpoint.resultKey}.`;
  if (['object', 'ref', 'union'].includes(schema.type) && (!value || typeof value !== 'object' || Array.isArray(value))) return `HTTP 200 response from ${endpoint.nsid} has non-object ${endpoint.resultKey}.`;
  if (schema.type === 'string' && typeof value !== 'string') return `HTTP 200 response from ${endpoint.nsid} has non-string ${endpoint.resultKey}.`;
  if (schema.type === 'boolean' && typeof value !== 'boolean') return `HTTP 200 response from ${endpoint.nsid} has non-boolean ${endpoint.resultKey}.`;
  if (schema.type === 'integer' && !Number.isSafeInteger(value)) return `HTTP 200 response from ${endpoint.nsid} has non-integer ${endpoint.resultKey}.`;
  if (schema.type === 'number' && typeof value !== 'number') return `HTTP 200 response from ${endpoint.nsid} has non-numeric ${endpoint.resultKey}.`;
  return null;
}

/** Runs explicit catalogue cases; data gaps never become positive coverage. */
export async function runSuite({ catalogue, selected, transport, directory, discoveryPages = 2, full = false, maxPages = 100 }) {
  const sources = new Map();
  const results = [];
  const sourceObservations = [];
  const schemaFindings = [];
  const schemaFindingByEvidence = new Map();
  let activeCase;

  async function request(endpoint, params, attribution = {}) {
    const observation = attribution.observation;
    const role = observation ? 'shared-source-observation' : attribution.role ?? 'selected-endpoint';
    try {
      const result = await transport.request(endpoint.nsid, params);
      const evidence = {
        endpoint: endpoint.nsid, role, sequence: result.sequence ?? null, status: result.status,
        params: structuredClone(params), mode: transport.mode ?? 'live',
        ...(result.replayEvaluation === undefined ? {} : { replayEvaluation: result.replayEvaluation }),
        ...(result.replayed ? { replayed: true, reusedCapture: result.reusedCapture } : {}),
      };
      if (observation) observation.requestEvidence.push(evidence);
      else activeCase?.requestEvidence.push(evidence);
      return { result, evidence };
    } catch (error) {
      const evidence = {
        endpoint: endpoint.nsid, role,
        sequence: Number.isSafeInteger(error.requestEvidence?.sequence) ? error.requestEvidence.sequence : null,
        status: error.requestEvidence?.status ?? null, params: structuredClone(params), mode: transport.mode ?? 'live', unavailableEvidence: error instanceof UnavailableEvidence,
        ...(error.replayEvaluation === undefined ? {} : { replayEvaluation: error.replayEvaluation }),
        ...(transport.mode === 'replay' ? { replayed: true, reusedCapture: false } : {}),
      };
      if (observation) observation.requestEvidence.push(evidence);
      else activeCase?.requestEvidence.push(evidence);
      throw error;
    }
  }

  async function call(endpoint, params, attribution = {}) {
    const observation = attribution.observation;
    const { result, evidence } = await request(endpoint, params, attribution);
    assert.equal(result.status, 200, `HTTP ${result.status} on responding endpoint ${endpoint.nsid}; inspect request evidence ${result.sequence}`);
    try { catalogue.validator.assertValidXrpcOutput(endpoint.nsid, jsonToLex(result.body)); }
    catch (error) {
      const key = evidence.sequence === null ? null : `${endpoint.nsid}:${evidence.sequence}`;
      let finding = key === null ? undefined : schemaFindingByEvidence.get(key);
      if (!finding) {
        finding = { id: `schema-${String(schemaFindings.length + 1).padStart(4, '0')}`, status: 'failed', endpoint: endpoint.nsid, requestEvidence: evidence, reason: error.message,
          ...(evidence.replayEvaluation === undefined ? {} : { replayEvaluations: [evidence.replayEvaluation] }) };
        schemaFindings.push(finding);
        if (key !== null) schemaFindingByEvidence.set(key, finding);
      } else if (evidence.replayEvaluation !== undefined && !finding.replayEvaluations.includes(evidence.replayEvaluation)) {
        finding.replayEvaluations.push(evidence.replayEvaluation);
      }
      if (observation && !observation.schemaFindingIds.includes(finding.id)) observation.schemaFindingIds.push(finding.id);
      else if (!observation && activeCase && !activeCase.schemaFindingIds.includes(finding.id)) activeCase.schemaFindingIds.push(finding.id);
    }
    const structuralError = minimumResponseError(endpoint, result.body);
    if (structuralError) throw new Error(`${structuralError} Full schema findings, if any, are reported separately.`);
    return result.body;
  }

  async function discover(nsid) {
    if (!sources.has(nsid)) {
      const observation = { id: `source-${String(sourceObservations.length + 1).padStart(4, '0')}`, endpoint: nsid, status: 'running', complete: false, records: 0, pagesObserved: 0, requestEvidence: [], schemaFindingIds: [] };
      sourceObservations.push(observation);
      const endpoint = catalogue.endpoints.find(item => item.nsid === nsid);
      const promise = (async () => {
        const rows = [];
        let cursor;
        let complete = false;
        try {
          assert.ok(endpoint, `Discovery source ${nsid} is not registered`);
          for (let page = 0; page < discoveryPages; page++) {
            const body = await call(endpoint, { limit: 100, ...(cursor ? { cursor } : {}) }, { observation });
            observation.pagesObserved++;
            rows.push(...body[endpoint.resultKey]);
            if (!body.cursor) { complete = true; break; }
            assert.notEqual(body.cursor, cursor, 'Discovery cursor did not advance');
            cursor = body.cursor;
          }
          observation.records = rows.length;
          observation.complete = complete;
          if (complete) {
            observation.status = 'available';
            return rows;
          }
          observation.status = 'partial';
          observation.reason = `Discovery reached its ${discoveryPages}-page bound with a continuation cursor; anchors may be incomplete.`;
          observation.incompleteCause = { type: 'page-bound', requestEvidence: observation.requestEvidence.at(-1) ?? null };
          return rows;
        } catch (error) {
          const unavailable = error instanceof UnavailableEvidence;
          const stopped = error instanceof Stopped;
          const causeStatus = unavailable || stopped ? 'not-run' : 'failed';
          const causeType = unavailable ? 'unavailable-evidence' : stopped ? 'stopped' : 'response-or-runner-error';
          observation.records = rows.length;
          observation.complete = false;
          observation.reason = error.message;
          observation.incompleteCause = { type: causeType, status: causeStatus, name: error.name, reason: error.message, requestEvidence: observation.requestEvidence.at(-1) ?? null };
          if (rows.some(isObject)) {
            observation.status = 'partial';
            return rows;
          }
          observation.status = causeStatus;
          throw new Stopped(`Shared discovery source ${nsid} ${observation.status} (${observation.id}): ${error.message}`);
        }
      })();
      sources.set(nsid, { observation, promise });
    }
    const source = sources.get(nsid);
    if (activeCase && !activeCase.sourceObservationIds.includes(source.observation.id)) activeCase.sourceObservationIds.push(source.observation.id);
    return source.promise;
  }

  function noAnchorFromDiscovery(nsid, reason) {
    const observation = sources.get(nsid)?.observation;
    if (observation && !observation.complete) throw new Stopped(`Discovery source ${nsid} is incomplete (${observation.id}); ${reason}`);
    throw new Gap(reason);
  }

  for (const endpoint of selected) {
    let seeds;
    let params;
    let baseline;
    const plans = casesFor(endpoint, { full });
    const getSeeds = async () => seeds ??= await discover(endpoint.source);
    const getParams = async (forceSeeds = false) => {
      if (!params) {
        const requiredAnchor = (endpoint.params.required ?? []).some(key => key !== 'search');
        try { params = seedParams(endpoint, (forceSeeds || requiredAnchor) ? await getSeeds() : [], catalogue.validator); }
        catch (error) {
          if (error instanceof Gap && sources.get(endpoint.source)?.observation.complete === false) noAnchorFromDiscovery(endpoint.source, error.message);
          throw error;
        }
      }
      return params;
    };
    for (const plan of plans) {
      const context = { requestEvidence: [], sourceObservationIds: [], schemaFindingIds: [] };
      activeCase = context;
      const result = await executeCase(`${endpoint.nsid}/${plan.id}`, async () => {
        if (plan.id === 'baseline') {
          const query = await getParams();
          baseline = await call(endpoint, query);
          const rows = endpoint.kind === 'feed' ? baseline[endpoint.resultKey] : [baseline[endpoint.resultKey]];
          const count = rows.filter(row => row !== undefined && row !== null).length;
          positive(count >= endpoint.minimumRecords, `Need ${endpoint.minimumRecords} record(s); observed ${count}. Sparse datasets are not failures.`);
          return { records: rows.length };
        }
        if (plan.id === 'roundtrip') {
          seeds = await getSeeds();
          const query = await getParams(true);
          const response = baseline ?? await call(endpoint, query);
          const returned = response[endpoint.resultKey];
          if (params.actors) {
            assert.ok(Array.isArray(returned), 'Batch lookup result is not an array');
            assert.deepEqual(returned.map(row => object(row).actor), params.actors, 'Batch must preserve requested actor occurrence order');
            for (const row of returned) {
              const item = object(row);
              const actual = item.profile ?? item.organization;
              const expected = seeds.find(seed => object(seed).did === item.actor);
              positive(actual && expected, 'Batch anchor has no resolved record');
              positive(typeof view(actual).cid === 'string' && typeof view(expected).cid === 'string' && isObject(view(actual).record) && isObject(view(expected).record), 'Batch anchor lacks a usable CID or raw record for exact comparison.');
              assert.equal(view(actual).cid, view(expected).cid);
              assert.deepEqual(view(actual).record, view(expected).record);
            }
          } else if (endpoint.nsid.startsWith('app.certified.graph.')) {
            const item = object(returned);
            const record = object(item.record);
            const subject = typeof record.subject === 'string' ? record.subject : object(record.subject).uri;
            positive(returned && typeof item.did === 'string' && typeof subject === 'string', 'Known relationship lookup lacks a usable actor/subject identity.');
            assert.equal(item.did, query.actor);
            assert.equal(subject, query.subject ?? query.entity);
          } else {
            const expected = seeds.find(seed => query.actor ? object(seed).did === query.actor : view(seed).uri === query.uri);
            const actual = view(returned);
            positive(expected && typeof view(expected).uri === 'string' && typeof view(expected).cid === 'string' && isObject(view(expected).record), 'Discovered lookup anchor lacks a usable URI, CID, or raw record.');
            positive(typeof actual.uri === 'string' && typeof actual.cid === 'string' && isObject(actual.record), 'Lookup response lacks a usable URI, CID, or raw record.');
            assert.equal(actual.uri, view(expected).uri);
            assert.equal(actual.cid, view(expected).cid);
            assert.deepEqual(actual.record, view(expected).record);
          }
          return;
        }
        if (plan.id === 'relationship/recipient-response') {
          seeds = await getSeeds();
          const responseEndpoint = catalogue.endpoints.find(item => item.nsid === 'app.certified.badge.listBadgeResponses');
          positive(responseEndpoint, 'Recipient-response endpoint is not registered.');
          const responses = await discover(responseEndpoint.nsid);
          const anchor = seeds.find(award => responses.some(response => {
            const responseRecord = object(object(response).record);
            const awardRef = responseRecord.badgeAward;
            const ref = object(awardRef);
            return ref.uri === view(award).uri && ref.cid === view(award).cid && filterValues(award, 'subjects').includes(object(response).did);
          }));
          const responseAnchorReason = 'No award with a usable, schema-valid exact-version recipient response anchor in the bounded discovery sample.';
          if (!anchor) {
            const incompleteSource = [endpoint.source, responseEndpoint.nsid].find(nsid => sources.get(nsid)?.observation.complete === false);
            if (incompleteSource) noAnchorFromDiscovery(incompleteSource, responseAnchorReason);
          }
          positive(anchor && typeof view(anchor).uri === 'string' && typeof view(anchor).cid === 'string' && acceptsParameter(responseEndpoint, 'badgeAward', view(anchor).uri, catalogue.validator), responseAnchorReason);
          const scan = await paginate(async query => {
            const body = await call(responseEndpoint, query, { role: 'related-endpoint' });
            return { rows: body.badgeResponses, cursor: body.cursor };
          }, { badgeAward: view(anchor).uri, limit: 100 }, { pages: discoveryPages, key: identity });
          positive(scan.complete, 'Response history is truncated; latest eligible response cannot be established.');
          const eligible = scan.rows.filter(response => {
            const responseRecord = object(object(response).record);
            const awardRef = object(responseRecord.badgeAward);
            return awardRef.cid === view(anchor).cid && filterValues(anchor, 'subjects').includes(object(response).did);
          });
          eligible.sort((a, b) => (Date.parse(object(a).indexedAt) || 0) - (Date.parse(object(b).indexedAt) || 0) || (identity(a) < identity(b) ? -1 : identity(a) > identity(b) ? 1 : 0));
          eligible.reverse();
          positive(eligible.length, 'No eligible recipient response after exact CID and author matching.');
          assert.equal(object(anchor).responseStatus, object(object(eligible[0]).record).response, 'Award computed status disagrees with independently listed recipient response');
          assert.equal(object(object(anchor).recipientResponse).uri, identity(eligible[0]));
          assert.equal(object(object(anchor).recipientResponse).cid, object(eligible[0]).cid);
          return { records: eligible.length };
        }
        if (plan.filters || plan.filter || plan.id === 'search/positive') {
          seeds = await getSeeds();
          const queryParams = await getParams(true);
          const rows = seeds;
          const filters = plan.filters ?? [plan.filter ?? 'search'];
          const filterParams = {};
          let anchor;
          const parameterValue = (filter, value) => endpoint.params.properties[filter].type === 'array' ? [value] : value;
          if (plan.id.startsWith('multi/')) {
            const distinct = [...new Set(rows.flatMap(row => filterValues(row, plan.filter)))].filter(value =>
              acceptsParameter(endpoint, plan.filter, parameterValue(plan.filter, value), catalogue.validator));
            if (distinct.length < 2) noAnchorFromDiscovery(endpoint.source, `Need two schema-valid distinct ${plan.filter} values in discovered records.`);
            filterParams[plan.filter] = distinct.slice(0, 2);
            if (endpoint.params.properties[plan.filter].type !== 'array') filterParams[plan.filter] = distinct[0];
            anchor = rows.find(row => matches(row, plan.filter, filterParams[plan.filter]));
          } else {
            anchor = rows.find(row => filters.every(filter => {
              const value = plan.value ?? sampleValue(row, filter);
              return value !== undefined && matches(row, filter, value) && acceptsParameter(endpoint, filter, parameterValue(filter, value), catalogue.validator);
            }));
            if (anchor) for (const filter of filters) {
              const value = plan.value ?? sampleValue(anchor, filter);
              filterParams[filter] = parameterValue(filter, value);
            }
          }
          if (!anchor) noAnchorFromDiscovery(endpoint.source, `No known-positive record with usable parameters for ${filters.join('+')}; empty queries cannot prove filter correctness.`);
          try { catalogue.validator.assertValidXrpcParams(endpoint.nsid, { ...queryParams, ...filterParams, limit: 100 }); }
          catch (error) { throw new Error(`Runner constructed invalid ${endpoint.nsid} filter parameters: ${error.message}`); }
          const expected = rows.filter(row => filters.every(filter => matches(row, filter, filterParams[filter])));
          if (plan.id.startsWith('multi/') && plan.filter !== 'tagUris') for (const value of filterParams[plan.filter]) {
            positive(expected.some(row => matches(row, plan.filter, [value])), `No positive match for multi-value ${plan.filter}=${value}`);
          }
          const scan = await paginate(async query => {
            const body = await call(endpoint, query);
            const returned = body[endpoint.resultKey];
            for (const row of returned) for (const filter of filters) assert.ok(matches(row, filter, filterParams[filter]), `Returned ${identity(row) ?? '<missing identity>'} violates ${filter}`);
            return { rows: returned, cursor: body.cursor };
          }, { ...queryParams, ...filterParams, limit: 100 }, { pages: discoveryPages, key: identity });
          const found = new Set(scan.rows.map(identity));
          const missing = expected.filter(row => !found.has(identity(row)));
          if (missing.length && !scan.complete) throw new Gap(`Positive anchors not reached in bounded scan (${missing.length}); no omission verdict possible.`);
          assert.equal(missing.length, 0, `Filter omitted ${missing.map(row => identity(row) ?? '<missing identity>').join(', ')}`);
          positive(scan.rows.length, 'No positive matches returned');
          return { records: scan.rows.length, complete: scan.complete };
        }
        if (plan.id.startsWith('limit/')) {
          const queryParams = await getParams();
          const body = await call(endpoint, { ...queryParams, ...(plan.limit === 'default' ? {} : { limit: plan.limit }) });
          assert.ok(body[endpoint.resultKey].length <= (plan.limit === 'default' ? 25 : plan.limit), 'Page exceeds requested/default limit');
          return { records: body[endpoint.resultKey].length };
        }
        if (plan.id.startsWith('invalid/')) {
          const queryParams = await getParams();
          const invalid = plan.id.endsWith('limit') ? { limit: 101 } : { cursor: 'not-a-valid-cursor' };
          const { result: response } = await request(endpoint, { ...queryParams, ...invalid });
          assert.ok(response.status >= 400 && response.status < 500, `Expected client 4xx, observed ${response.status}; a runtime 500 is not successful rejection`);
          assert.equal(response.body.error, 'InvalidRequest');
          assert.ok(!/stack traceback|\.lua:\d/.test(JSON.stringify(response.body)), 'Client error leaked Lua traceback');
          return;
        }
        if (plan.id.startsWith('pagination/')) {
          const queryParams = await getParams(true);
          if (endpoint.nsid.endsWith('listCollectionItems')) seeds = await getSeeds();
          const query = { ...queryParams, ...(endpoint.params.properties.sortDirection ? { sortDirection: plan.direction } : {}) };
          const first = await call(endpoint, { ...query, limit: 2 });
          positive(first.cursor, 'No continuation cursor; need more records to check pagination.');
          const nextQuery = { ...query, limit: 2, cursor: first.cursor };
          const second = await call(endpoint, nextQuery);
          const replay = await call(endpoint, nextQuery);
          assert.deepEqual(replay, second, 'Cursor replay changed results; inspect concurrent indexing before classifying a defect');
          const larger = await call(endpoint, { ...query, limit: 4 });
          const combined = [...first[endpoint.resultKey], ...second[endpoint.resultKey]];
          assert.deepEqual(combined, larger[endpoint.resultKey], 'Small pages differ from larger bounded slice; inspect concurrent indexing');
          if (!endpoint.nsid.endsWith('listCollectionItems')) {
            assert.equal(new Set(combined.map(identity)).size, combined.length, 'Pagination duplicated a record');
            checkOrder(combined, plan.direction);
          } else {
            const collection = seeds.find(row => object(row).uri === queryParams.collection);
            positive(collection && Array.isArray(object(object(collection).record).items), 'Collection pagination source lacks its embedded item list.');
            assert.deepEqual(combined.map(row => object(row).itemIdentifier), object(object(collection).record).items.slice(0, 4).map(item => object(item).itemIdentifier), 'Embedded items lost source order');
            for (const row of combined) if (object(row).record) {
              assert.equal(object(row).record.uri, object(row).itemIdentifier?.uri);
              assert.equal(object(row).record.cid, object(row).itemIdentifier?.cid);
            }
          }
          return { records: combined.length };
        }
        if (plan.id === 'traversal') {
          const queryParams = await getParams(true);
          if (endpoint.nsid.endsWith('listCollectionItems')) {
            seeds = await getSeeds();
            const items = [];
            const cursors = new Set();
            let cursor;
            let complete = false;
            for (let page = 0; page < maxPages; page++) {
              const body = await call(endpoint, { ...queryParams, limit: 100, ...(cursor ? { cursor } : {}) });
              items.push(...body.items);
              cursor = body.cursor;
              if (!cursor) { complete = true; break; }
              assert.ok(!cursors.has(cursor), 'Embedded-item cursor repeated');
              cursors.add(cursor);
            }
            positive(complete, `Embedded-item traversal reached ${maxPages} pages without termination.`);
            const collection = seeds.find(row => object(row).uri === queryParams.collection);
            positive(collection && Array.isArray(object(object(collection).record).items), 'Collection traversal source lacks its embedded item list.');
            assert.deepEqual(items.map(item => object(item).itemIdentifier), object(object(collection).record).items.map(item => object(item).itemIdentifier), 'Full embedded-item traversal differs from source order/multiplicity; inspect concurrent collection updates');
            return { records: items.length, complete: true };
          }
          const scan = await paginate(async query => {
            const body = await call(endpoint, query);
            return { rows: body[endpoint.resultKey], cursor: body.cursor };
          }, { ...queryParams, limit: 100 }, { pages: maxPages, key: identity });
          if (!scan.complete) throw new Gap(`Traversal stopped at ${maxPages} pages with a remaining server cursor; termination unproven.`);
          return { records: scan.rows.length, pages: scan.pages, complete: true };
        }
        throw new Error(`Unimplemented case ${plan.id}`);
      });
      activeCase = null;
      result.endpoint = endpoint.nsid;
      result.requestEvidence = context.requestEvidence;
      result.sourceObservationIds = context.sourceObservationIds;
      result.schemaFindingIds = context.schemaFindingIds;
      results.push(result);
      await appendFile(path.join(directory, 'cases.jsonl'), `${JSON.stringify(result)}\n`, { mode: 0o600 });
      process.stdout.write(`${result.status.padEnd(18)} ${result.id}${result.reason ? ` — ${result.reason}` : ''}\n`);
    }
  }
  const counts = {};
  for (const result of results) counts[result.status] = (counts[result.status] ?? 0) + 1;
  const isFailedSource = observation => observation.status === 'failed' || observation.incompleteCause?.status === 'failed';
  const sourceFailures = sourceObservations.filter(isFailedSource).length;
  const partialSources = sourceObservations.filter(observation => observation.status === 'partial').length;
  const notRunSources = sourceObservations.filter(observation => observation.status === 'not-run').length;
  const report = {
    mode: transport.mode ?? 'live', target: transport.target,
    attempts: transport.mode === 'replay' ? 0 : transport.attempts,
    replayEvaluations: transport.replayEvaluations ?? 0,
    evidenceSequencesUsed: transport.evidenceSequences ?? [],
    reusedCaptureCount: transport.reusedCaptureCount ?? 0,
    counts, sourceFailures, schemaFindings, sourceObservations, results,
    limitations: ['Live reads are not snapshot-isolated.', 'Discovery and filter scans are bounded; absence of anchors is not proof of absence.', 'Offline replay evaluates only exact retained requests; missing captures are not-run and no network fallback occurs.', 'Hyperindex comparison is not implemented in this initial runner.'],
  };
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 });
  const detailLines = [
    ...results.filter(result => result.status !== 'passed').map(result => `- **${result.status}** \`${result.id}\`: ${result.reason}`),
    ...schemaFindings.map(finding => `- **schema failure** \`${finding.endpoint}\` request ${finding.requestEvidence.sequence ?? 'unavailable'}: ${finding.reason}`),
    ...sourceObservations.filter(observation => observation.status !== 'available').map(observation => `- **source ${isFailedSource(observation) ? (observation.status === 'partial' ? 'failed (partial)' : 'failed') : observation.status}** \`${observation.endpoint}\` (${observation.id}): ${observation.reason}`),
  ];
  await writeFile(path.join(directory, 'report.md'), `# Live API E2E\n\nMode: ${report.mode}\n\nLive requests: ${report.attempts}\n\nReplay evaluations: ${report.replayEvaluations}\n\nCase outcomes:\n${Object.entries(counts).map(([status, count]) => `- ${status}: ${count}`).join('\n')}\n\nSchema failures: ${schemaFindings.length}\n\nFailed shared sources: ${sourceFailures}\n\nPartial shared sources: ${partialSources}\n\nUnavailable shared sources: ${notRunSources}\n\n${detailLines.join('\n')}\n`, { flag: 'wx', mode: 0o600 });
  return report;
}
