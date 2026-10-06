import { buildOpenApi, DEFAULT_SERVER_URL } from './openapi.mjs';

export function buildDocumentationArtifacts(sourceIndex, lexicons) {
  const lexiconsById = new Map();
  for (const lexicon of lexicons) {
    if (lexiconsById.has(lexicon.id)) {
      throw new Error(`Duplicate source Lexicon in docs/sources/index.json: ${lexicon.id}`);
    }
    lexiconsById.set(lexicon.id, lexicon);
  }

  const listedLexicons = sourceIndex.lexicons ?? sourceIndex.endpoints;
  const listedIds = listedLexicons.map(({ id }) => id).sort();
  const sourceIds = [...lexiconsById.keys()].sort();
  if (JSON.stringify(sourceIds) !== JSON.stringify(listedIds)) {
    throw new Error('Loaded Lexicon snapshots do not exactly match docs/sources/index.json.');
  }

  const coverage = {};
  const sources = {};
  for (const endpoint of sourceIndex.endpoints) {
    const lexicon = lexiconsById.get(endpoint.id);
    if (!lexicon || !['query', 'procedure'].includes(lexicon.defs?.main?.type)) {
      throw new Error(`Manifest endpoint ${endpoint.id} is not a query/procedure Lexicon snapshot.`);
    }
    if (lexicon.defs.main.type !== endpoint.type) {
      throw new Error(`Endpoint type drift for ${endpoint.id}: index says ${endpoint.type}, snapshot says ${lexicon.defs.main.type}`);
    }
    coverage[endpoint.id] = 'manifest-registered';
    sources[endpoint.id] = { module: endpoint.module };
  }

  const expectedEndpointIds = sourceIndex.endpoints.map(({ id }) => id).sort();
  const operationIds = lexicons
    .filter((lexicon) => ['query', 'procedure'].includes(lexicon.defs?.main?.type))
    .map(({ id }) => id)
    .sort();
  if (JSON.stringify(operationIds) !== JSON.stringify(expectedEndpointIds)) {
    throw new Error('Operation snapshots do not exactly match the manifest-registered endpoints.');
  }

  const document = buildOpenApi(lexicons, {
    coverage,
    sources,
    serverUrl: DEFAULT_SERVER_URL,
    version: 'manifest-snapshot',
    source: `${sourceIndex.apiManifest}; @hypercerts-org/lexicon@${sourceIndex.pinnedLexiconPackage}`,
  });
  if (document['x-hypercerts-unresolved-references'].length > 0) {
    const references = document['x-hypercerts-unresolved-references']
      .map(({ component, reference }) => `${component} -> ${reference}`)
      .join('\n');
    throw new Error(`OpenAPI generation found unresolved Lexicon references:\n${references}`);
  }

  const methods = lexicons
    .filter(({ id }) => Object.hasOwn(coverage, id))
    .reduce((result, lexicon) => {
      const method = lexicon.defs.main.type === 'query' ? 'GET' : 'POST';
      result[method] = (result[method] ?? 0) + 1;
      return result;
    }, {});
  const coverageReport = {
    source: {
      apiManifest: sourceIndex.apiManifest,
      pinnedLexiconPackage: sourceIndex.pinnedLexiconPackage,
    },
    runtimeValidation: sourceIndex.runtimeValidation,
    deploymentValidation: sourceIndex.deploymentValidation,
    endpointCount: sourceIndex.endpoints.length,
    methods,
    inclusion: { 'manifest-registered': sourceIndex.endpoints.length },
    unresolvedReferences: document['x-hypercerts-unresolved-references'],
    endpoints: sourceIndex.endpoints.map((endpoint) => ({
      id: endpoint.id,
      method: endpoint.type === 'query' ? 'GET' : 'POST',
      inclusion: 'manifest-registered',
      module: endpoint.module,
    })),
  };

  return { openapi: document, coverage: coverageReport };
}
