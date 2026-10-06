import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import test from 'node:test';
import { collectDocumentationSources } from '../scripts/refresh-sources.mjs';

const docsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiRoot = path.resolve(docsRoot, '..', 'api');

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function registeredQueries() {
  const manifest = await readJson(path.join(apiRoot, 'manifest.json'));
  const endpoints = new Map();

  for (const moduleRef of manifest.modules) {
    const moduleFile = path.resolve(apiRoot, moduleRef);
    const moduleManifest = await readJson(moduleFile);
    for (const asset of moduleManifest.assets ?? []) {
      if (asset.kind !== 'lexicon' || !asset.path) continue;
      const lexiconFile = path.resolve(path.dirname(moduleFile), asset.path);
      const lexicon = await readJson(lexiconFile);
      if (!['query', 'procedure'].includes(lexicon.defs?.main?.type)) continue;
      assert.equal(endpoints.has(lexicon.id), false, `duplicate registered endpoint ${lexicon.id}`);
      endpoints.set(lexicon.id, { lexicon, module: moduleRef });
    }
  }

  return endpoints;
}

test('source refresh includes registered operations and resolves the full local and pinned schema closure', async (t) => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'api-docs-source-test-'));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const fixtureApi = path.join(fixtureRoot, 'api');
  const fixtureDocs = path.join(fixtureRoot, 'docs');
  const moduleDirectory = path.join(fixtureApi, 'modules/feature');
  const unregisteredDirectory = path.join(fixtureApi, 'modules/unregistered');
  const packageRoot = path.join(fixtureRoot, 'pinned-lexicons');
  await Promise.all([
    mkdir(moduleDirectory, { recursive: true }),
    mkdir(unregisteredDirectory, { recursive: true }),
    mkdir(path.join(fixtureApi, 'lexicons'), { recursive: true }),
    mkdir(path.join(packageRoot, 'lexicons/demo'), { recursive: true }),
    mkdir(fixtureDocs, { recursive: true }),
  ]);

  const activeQuery = {
    lexicon: 1,
    id: 'demo.feature.search',
    defs: {
      main: {
        type: 'query',
        output: { encoding: 'application/json', schema: { type: 'ref', ref: '#output' } },
      },
      output: {
        type: 'object',
        properties: { result: { type: 'ref', ref: 'demo.schema.outer#view' } },
      },
    },
  };
  const outerSchema = {
    lexicon: 1,
    id: 'demo.schema.outer',
    defs: {
      main: { type: 'record', record: { type: 'ref', ref: '#view' } },
      view: {
        type: 'object',
        properties: {
          nested: { type: 'ref', ref: 'demo.schema.inner#item' },
          packageSchema: { type: 'ref', ref: 'demo.schema.package#item' },
        },
      },
    },
  };
  const innerSchema = {
    lexicon: 1,
    id: 'demo.schema.inner',
    defs: { main: { type: 'record', record: { type: 'ref', ref: '#item' } }, item: { type: 'object', properties: { name: { type: 'string' } } } },
  };
  const packageSchema = {
    lexicon: 1,
    id: 'demo.schema.package',
    defs: {
      main: { type: 'record', record: { type: 'ref', ref: '#item' } },
      item: { type: 'object', properties: { label: { type: 'string' } } },
    },
  };
  const unregisteredQuery = {
    lexicon: 1,
    id: 'demo.unregistered.query',
    defs: { main: { type: 'query' } },
  };
  const writeJson = async (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
  await writeJson(path.join(fixtureApi, 'package.json'), {
    dependencies: { '@hypercerts-org/lexicon': '1.4.0' },
  });
  await writeJson(path.join(fixtureApi, 'manifest.json'), {
    modules: ['modules/feature/manifest.json'],
    validationLexicons: [
      { id: outerSchema.id, path: 'lexicons/demo.schema.outer.json' },
      { id: innerSchema.id, path: 'lexicons/demo.schema.inner.json' },
      { id: packageSchema.id, packagePath: 'lexicons/demo/schema.json' },
    ],
  });
  await writeJson(path.join(moduleDirectory, 'manifest.json'), {
    assets: [{ kind: 'lexicon', id: activeQuery.id, path: '../../lexicons/demo.feature.search.json' }],
  });
  await writeJson(path.join(unregisteredDirectory, 'manifest.json'), {
    assets: [{ kind: 'lexicon', id: unregisteredQuery.id, path: '../../lexicons/demo.unregistered.query.json' }],
  });
  await Promise.all([
    writeJson(path.join(fixtureApi, 'lexicons/demo.feature.search.json'), activeQuery),
    writeJson(path.join(fixtureApi, 'lexicons/demo.schema.outer.json'), outerSchema),
    writeJson(path.join(fixtureApi, 'lexicons/demo.schema.inner.json'), innerSchema),
    writeJson(path.join(fixtureApi, 'lexicons/demo.unregistered.query.json'), unregisteredQuery),
    writeJson(path.join(packageRoot, 'package.json'), { name: '@hypercerts-org/lexicon', version: '1.4.0' }),
    writeJson(path.join(packageRoot, 'lexicons/demo/schema.json'), packageSchema),
  ]);

  const { index, snapshots } = await collectDocumentationSources({
    apiRoot: fixtureApi,
    docsRoot: fixtureDocs,
    lexiconPackageRoot: packageRoot,
  });
  assert.deepEqual(index.endpoints.map(({ id }) => id), ['demo.feature.search']);
  assert.deepEqual(index.lexicons.map(({ id }) => id), [
    'demo.feature.search',
    'demo.schema.inner',
    'demo.schema.outer',
    'demo.schema.package',
  ]);
  assert.equal(snapshots.some(({ file }) => file.endsWith('demo.unregistered.query.json')), false);
  assert.equal(index.runtimeValidation, 'not-assessed');
  assert.equal(index.deploymentValidation, 'not-assessed');

  outerSchema.defs.view.properties.nested.ref = 'demo.schema.missing#item';
  await writeJson(path.join(fixtureApi, 'lexicons/demo.schema.outer.json'), outerSchema);
  await assert.rejects(
    collectDocumentationSources({ apiRoot: fixtureApi, docsRoot: fixtureDocs, lexiconPackageRoot: packageRoot }),
    /Cannot resolve Lexicon reference "demo\.schema\.missing#item".*not declared/,
  );
});

test('committed explorer operations and endpoint snapshots match the registered Lexicons', async () => {
  const activeQueries = await registeredQueries();
  const activeIds = [...activeQueries.keys()].sort();
  const sourceIndex = await readJson(path.join(docsRoot, 'sources/index.json'));
  const openapi = await readJson(path.join(docsRoot, 'openapi.json'));
  const coverage = await readJson(path.join(docsRoot, 'coverage.json'));
  const operationIds = Object.keys(openapi.paths)
    .map((operationPath) => operationPath.replace(/^\/xrpc\//, ''))
    .sort();

  assert.deepEqual(sourceIndex.endpoints.map(({ id }) => id).sort(), activeIds);
  assert.deepEqual(operationIds, activeIds);
  assert.equal(coverage.endpointCount, activeIds.length);
  assert.equal(coverage.inclusion['manifest-registered'], activeIds.length);
  assert.deepEqual(coverage.unresolvedReferences, []);
  assert.equal(sourceIndex.runtimeValidation, 'not-assessed');
  assert.equal(sourceIndex.deploymentValidation, 'not-assessed');

  for (const [id, { lexicon, module }] of activeQueries) {
    const endpoint = sourceIndex.endpoints.find((entry) => entry.id === id);
    const snapshot = await readJson(path.join(docsRoot, endpoint.file));
    const operation = openapi.paths[`/xrpc/${id}`][lexicon.defs.main.type === 'query' ? 'get' : 'post'];
    assert.deepEqual(snapshot, lexicon, `${id} snapshot must match its canonical module asset`);
    assert.equal(endpoint.module, module);
    assert.equal(operation['x-hypercerts-coverage'], 'manifest-registered');
    assert.deepEqual(operation['x-lexicon-errors'] ?? [], lexicon.defs.main.errors ?? []);
  }

  for (const id of [
    'app.certified.actor.getOrganization',
    'app.certified.actor.getOrganizations',
    'app.certified.actor.listOrganizations',
    'app.certified.actor.searchOrganizations',
  ]) {
    const errors = openapi.paths[`/xrpc/${id}`].get['x-lexicon-errors'];
    assert.ok(errors.some(({ name }) => name === 'OrganizationQueryFailed'), `${id} documents its operational error`);
  }

  for (const [id, definition] of [
    ['app.certified.badge.getBadgeDefinition', 'badgeDefinitionView'],
    ['org.hypercerts.claim.getContribution', 'contributionView'],
    ['org.hypercerts.funding.getReceipt', 'receiptView'],
  ]) {
    const lexicon = activeQueries.get(id).lexicon;
    assert.ok(lexicon.defs[definition].nullable?.includes('indexedAt'));
    const indexedAt = openapi.components.schemas[`${id}.${definition}`].properties.indexedAt;
    assert.ok(indexedAt.anyOf?.some((variant) => variant.type === 'null'), `${id}#${definition}.indexedAt is nullable in OpenAPI`);
  }
});
