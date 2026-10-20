import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Lexicons } from '@atproto/lexicon';
import { readLexiconSource } from '../lexicon-source.js';

export const apiRoot = fileURLToPath(new URL('../../', import.meta.url));
const controls = new Set(['limit', 'cursor', 'sortDirection']);
const families = [
  ['app.certified.actor', 'Profile', 'Profiles'], ['app.certified.actor', 'Organization', 'Organizations'],
  ['org.hypercerts.claim', 'Activity', 'Activities'], ['org.hypercerts.collection', 'Collection', 'Collections'],
  ['org.hypercerts.claim', 'Contribution', 'Contributions'], ['org.hypercerts.claim', 'ContributorInformation', 'ContributorInformation'],
  ['org.hypercerts.claim', 'Rights', 'Rights'], ['org.hypercerts.context', 'Evaluation', 'Evaluations'],
  ['org.hypercerts.context', 'Attachment', 'Attachments'], ['org.hypercerts.context', 'Acknowledgement', 'Acknowledgements'],
  ['org.hypercerts.context', 'Measurement', 'Measurements'], ['org.hypercerts.funding', 'Receipt', 'Receipts'],
  ['app.certified.badge', 'BadgeDefinition', 'BadgeDefinitions'], ['app.certified.badge', 'BadgeAward', 'BadgeAwards'],
  ['app.certified.badge', 'BadgeResponse', 'BadgeResponses'], ['org.hypercerts.workscope', 'WorkscopeTag', 'WorkscopeTags'],
  ['org.hypercerts.vocab', 'VocabTag', 'VocabTags'], ['app.certified.location', 'Location', 'Locations'],
  ['org.hypercerts.entity', 'Feature', 'Features'], ['app.certified.link', 'EvmLink', 'EvmLinks'],
];

export async function loadCatalogue() {
  const manifest = JSON.parse(await readFile(path.join(apiRoot, 'manifest.json'), 'utf8'));
  const registered = new Set();
  for (const modulePath of manifest.modules) {
    const module = JSON.parse(await readFile(path.join(apiRoot, modulePath), 'utf8'));
    for (const asset of module.assets ?? []) if (asset.id.startsWith('xrpc.query:')) registered.add(asset.id.slice(11));
  }
  const documents = await Promise.all(manifest.validationLexicons.map(source => readLexiconSource(source, apiRoot)));
  // The SDK's XRPC ref validator accepts object definitions, not record wrappers.
  // Embedded record refs still validate the complete record schema, including its required fields.
  const validationDocuments = structuredClone(documents);
  for (const document of validationDocuments) for (const [name, definition] of Object.entries(document.defs)) {
    if (definition.type === 'record') document.defs[name] = definition.record;
  }
  const validator = new Lexicons(validationDocuments);
  const endpoints = documents.filter(document => document.defs.main?.type === 'query' && registered.has(document.id)).map(document => {
    const nsid = document.id;
    const name = nsid.split('.').at(-1);
    const family = families.find(([prefix, singular, plural]) => [ `${prefix}.get${singular}`, `${prefix}.get${plural}`, `${prefix}.list${plural}`, `${prefix}.search${plural}` ].includes(nsid));
    const output = document.defs.output;
    const reactionList = /^get(?:Actor)?(?:Likes|Reposts)$/.test(name) && nsid.startsWith('app.certified.feed.');
    const resultKey = reactionList ? (name.endsWith('Likes') ? 'likes' : 'reposts') : Object.keys(output.properties).find(key => !['cursor', 'totalCount'].includes(key));
    const params = document.defs.main.parameters;
    const filters = Object.keys(params.properties).filter(key => !controls.has(key) && (key === 'search' || !(params.required ?? []).includes(key)));
    const kind = reactionList || name.startsWith('list') || name.startsWith('search') ? 'feed' : 'lookup';
    let source = family ? `${family[0]}.list${family[2]}` : 'app.certified.graph.listRecentFollows';
    if (name === 'listCollectionItems') source = 'org.hypercerts.collection.listCollections';
    if (nsid.startsWith('app.certified.feed.')) source = name.includes('Actor') ? 'app.certified.actor.listProfiles' : 'org.hypercerts.claim.listActivities';
    return { nsid, kind, source, resultKey, resultSchema: output.properties[resultKey], params, filters, document,
      minimumRecords: /(?:list|search)(?:Activities|Profiles)$/.test(name) ? 2 : 1 };
  }).sort((a, b) => a.nsid.localeCompare(b.nsid));
  if (endpoints.length !== registered.size) throw new Error('Registered endpoint lacks a query contract; align manifest validationLexicons before running.');
  return { endpoints, validator };
}

export function casesFor(endpoint, { full = false } = {}) {
  const cases = [{ id: 'baseline', description: 'Successful response has the minimum structure; full Lexicon validation is reported separately. Record-count assumption is explicit.' }];
  if (endpoint.kind === 'lookup') {
    cases.push({ id: 'roundtrip', description: 'Lookup preserves discovered URI/CID/raw record, or batch occurrence order.' });
    if (endpoint.params.required?.includes('uri')) cases.push({ id: 'invalid/uri', description: 'Malformed record URI returns the pinned named InvalidRequest runtime rejection, even without positive discovery anchors.' });
    if (['getFollows', 'getEntityFollows', 'getActorReactions', 'getReactionCounts'].includes(endpoint.nsid.split('.').at(-1))) {
      for (const probe of ['empty', 'entry', 'overflow']) cases.push({ id: `invalid/batch-${probe}`, description: 'Missing/empty targets, malformed entries, and more than 100 occurrences must return the pinned named InvalidRequest runtime rejection.' });
    }
    return cases;
  }
  if (endpoint.nsid.endsWith('listEntityFollowers')) cases.push({ id: 'count/consistency', description: 'Distinct follower total agrees with a complete bounded scan and remains unchanged across limits and cursors; truncated scans are gaps.' });
  if (endpoint.nsid.endsWith('listBadgeAwards')) cases.push({ id: 'relationship/recipient-response', description: 'Exact award-version responses by the recipient determine computed status; newest response wins.' });
  for (let mask = 1; mask < 2 ** endpoint.filters.length; mask++) {
    const filters = endpoint.filters.filter((_, index) => mask & (2 ** index));
    cases.push({ id: `filters/${filters.join('+')}`, filters, description: 'All emitted rows satisfy every selected predicate; a discovered positive anchor is retained.' });
  }
  for (const filter of endpoint.filters) {
    const schema = endpoint.params.properties[filter];
    if (schema.type === 'array') cases.push({ id: `multi/${filter}`, filter, description: filter === 'tagUris' ? 'Every supplied tag is required (AND).' : 'Two distinct discovered values use OR; known matches for both are retained.' });
    for (const value of schema.type === 'boolean' ? [true, false] : schema.enum ?? schema.items?.enum ?? []) cases.push({ id: `value/${filter}/${value}`, filter, value, description: 'Representative enum/boolean value has positive evidence, or is a data gap.' });
  }
  for (const limit of [1, 2, 'default', 100]) cases.push({ id: `limit/${limit}`, limit, description: 'Page respects requested/default bound; not an assertion of total dataset size.' });
  for (const direction of endpoint.params.properties.sortDirection ? ['asc', 'desc'] : ['desc']) cases.push({ id: `pagination/${direction}`, direction, description: 'Two small pages agree with a larger bounded slice; continuation/replay and order are checked.' });
  cases.push({ id: 'invalid/limit', description: 'limit=101 returns the pinned HTTP 500 script_error/runtime envelope with the endpoint method and named InvalidRequest.' });
  if (endpoint.params.properties.cursor) cases.push({ id: 'invalid/cursor', description: 'Malformed cursor returns the pinned HTTP 500 script_error/runtime envelope with the endpoint method and named InvalidRequest.' });
  if (full) cases.push({ id: 'traversal', description: 'Opt-in traversal reaches termination without duplicate identities within the approved page/request budget.' });
  return cases;
}
