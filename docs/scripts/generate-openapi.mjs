import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildOpenApi, DEFAULT_SERVER_URL } from './openapi.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceIndex = JSON.parse(await readFile(path.join(root, 'sources/index.json'), 'utf8'));
const lexicons = [];
const coverage = {};
const sources = {};

for (const endpoint of sourceIndex.endpoints) {
  const file = path.resolve(root, endpoint.file);
  if (!file.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Source path escapes repository: ${endpoint.file}`);
  }
  const lexicon = JSON.parse(await readFile(file, 'utf8'));
  if (lexicon.id !== endpoint.id || !['query', 'procedure'].includes(lexicon.defs?.main?.type)) {
    throw new Error(`Source metadata does not match query/procedure Lexicon ${endpoint.id}`);
  }
  lexicons.push(lexicon);
  coverage[endpoint.id] = endpoint.coverage;
  sources[endpoint.id] = {
    worktree: endpoint.source.worktree,
    branch: endpoint.source.branch,
    commit: endpoint.source.commit,
    path: endpoint.source.path,
    activeModule: endpoint.source.activeModule,
  };
}

const document = buildOpenApi(lexicons, {
  coverage,
  sources,
  serverUrl: DEFAULT_SERVER_URL,
  version: `snapshot-${sourceIndex.primaryCommit.slice(0, 12)}`,
  source: `${sourceIndex.primaryBranch}@${sourceIndex.primaryCommit}`,
});
const methods = lexicons.reduce((result, lexicon) => {
  const method = lexicon.defs.main.type === 'query' ? 'GET' : 'POST';
  result[method] = (result[method] ?? 0) + 1;
  return result;
}, {});
const summary = Object.fromEntries(
  ['primary', 'branch-only', 'unmanifested-unsupported'].map((status) => [
    status,
    sourceIndex.endpoints.filter((endpoint) => endpoint.coverage === status).length,
  ]),
);
const coverageReport = {
  primarySource: {
    worktree: sourceIndex.primaryWorktree,
    branch: sourceIndex.primaryBranch,
    commit: sourceIndex.primaryCommit,
    manifestPath: 'hypercerts-api/manifest.json',
  },
  endpointCount: lexicons.length,
  methods,
  coverage: summary,
  unresolvedReferences: document['x-hypercerts-unresolved-references'],
  endpoints: sourceIndex.endpoints.map((endpoint) => ({
    id: endpoint.id,
    method: endpoint.type === 'query' ? 'GET' : 'POST',
    coverage: endpoint.coverage,
    source: endpoint.source,
  })),
};

await writeFile(path.join(root, 'openapi.json'), `${JSON.stringify(document, null, 2)}\n`);
await writeFile(path.join(root, 'coverage.json'), `${JSON.stringify(coverageReport, null, 2)}\n`);
console.log(`Generated ${lexicons.length} endpoints; ${coverageReport.unresolvedReferences.length} external schema references remain explicit.`);
