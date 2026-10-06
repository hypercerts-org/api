import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildDocumentationArtifacts } from '../scripts/openapi-artifacts.mjs';
import { assertDocumentationFresh } from '../scripts/check-sources.mjs';
import { collectDocumentationSources } from '../scripts/refresh-sources.mjs';

const docsRoot = path.resolve(import.meta.dirname, '..');

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function writeBaselineArtifacts(apiRoot, fixtureDocs, packageRoot) {
  await mkdir(path.join(fixtureDocs, 'sources/lexicons'), { recursive: true });
  const { index, snapshots } = await collectDocumentationSources({
    apiRoot,
    docsRoot: fixtureDocs,
    lexiconPackageRoot: packageRoot,
  });
  for (const snapshot of snapshots) await writeFile(snapshot.file, snapshot.content);
  const { openapi, coverage } = buildDocumentationArtifacts(
    index,
    snapshots.map(({ content }) => JSON.parse(content)),
  );
  await writeJson(path.join(fixtureDocs, 'sources/index.json'), index);
  await writeJson(path.join(fixtureDocs, 'openapi.json'), openapi);
  await writeJson(path.join(fixtureDocs, 'coverage.json'), coverage);
  return { index, openapi, coverage };
}

test('committed snapshots, index metadata, OpenAPI, and coverage match fresh manifest sources', async () => {
  await assertDocumentationFresh();
});

test('freshness gate rejects endpoint and pinned support-schema drift without writing artifacts', async (t) => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'api-docs-freshness-test-'));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const apiRoot = path.join(fixtureRoot, 'api');
  const fixtureDocs = path.join(fixtureRoot, 'docs');
  const packageRoot = path.join(fixtureRoot, 'pinned-lexicons');
  const moduleDirectory = path.join(apiRoot, 'modules/demo');
  const queryPath = path.join(apiRoot, 'lexicons/demo.search.json');
  const schemaPath = path.join(packageRoot, 'lexicons/demo/support.json');

  const query = {
    lexicon: 1,
    id: 'demo.search',
    defs: {
      main: {
        type: 'query',
        parameters: {
          type: 'params',
          properties: { term: { type: 'string', description: 'Original search term.' } },
        },
        output: { encoding: 'application/json', schema: { type: 'ref', ref: '#output' } },
      },
      output: {
        type: 'object',
        properties: { result: { type: 'ref', ref: 'demo.support#view' } },
      },
    },
  };
  const supportSchema = {
    lexicon: 1,
    id: 'demo.support',
    defs: {
      main: { type: 'record', record: { type: 'ref', ref: '#view' } },
      view: { type: 'object', properties: { value: { type: 'string', description: 'Original value.' } } },
    },
  };
  const writeFixture = async () => {
    await writeJson(path.join(apiRoot, 'package.json'), {
      dependencies: { '@hypercerts-org/lexicon': '1.4.0' },
    });
    await writeJson(path.join(apiRoot, 'manifest.json'), {
      modules: ['modules/demo/manifest.json'],
      validationLexicons: [{ id: supportSchema.id, packagePath: 'lexicons/demo/support.json' }],
    });
    await writeJson(path.join(moduleDirectory, 'manifest.json'), {
      assets: [{ kind: 'lexicon', id: query.id, path: '../../lexicons/demo.search.json' }],
    });
    await writeJson(queryPath, query);
    await writeJson(path.join(packageRoot, 'package.json'), {
      name: '@hypercerts-org/lexicon',
      version: '1.4.0',
    });
    await writeJson(schemaPath, supportSchema);
  };

  await mkdir(moduleDirectory, { recursive: true });
  await mkdir(path.join(apiRoot, 'lexicons'), { recursive: true });
  await mkdir(fixtureDocs, { recursive: true });
  await writeFixture();
  const baseline = await writeBaselineArtifacts(apiRoot, fixtureDocs, packageRoot);
  await assertDocumentationFresh({ apiRoot, docsRoot: fixtureDocs, lexiconPackageRoot: packageRoot });
  const baselineOpenApi = await readFile(path.join(fixtureDocs, 'openapi.json'), 'utf8');

  query.defs.main.parameters.properties.term.description = 'Changed canonical search term.';
  await writeJson(queryPath, query);
  await assert.rejects(
    assertDocumentationFresh({ apiRoot, docsRoot: fixtureDocs, lexiconPackageRoot: packageRoot }),
    (error) => {
      assert.match(error.message, /sources\/lexicons\/demo\.search\.json/);
      assert.match(error.message, /openapi\.json/);
      return true;
    },
  );
  assert.equal(await readFile(path.join(fixtureDocs, 'openapi.json'), 'utf8'), baselineOpenApi);
  query.defs.main.parameters.properties.term.description = 'Original search term.';
  await writeJson(queryPath, query);

  supportSchema.defs.view.properties.value.type = 'integer';
  await writeJson(schemaPath, supportSchema);
  await assert.rejects(
    assertDocumentationFresh({ apiRoot, docsRoot: fixtureDocs, lexiconPackageRoot: packageRoot }),
    (error) => {
      assert.match(error.message, /sources\/lexicons\/demo\.support\.json/);
      assert.match(error.message, /openapi\.json/);
      return true;
    },
  );
  assert.equal(await readFile(path.join(fixtureDocs, 'openapi.json'), 'utf8'), baselineOpenApi);

  const staleCoverage = structuredClone(baseline.coverage);
  staleCoverage.runtimeValidation = 'runtime-validated';
  await writeJson(path.join(fixtureDocs, 'coverage.json'), staleCoverage);
  await assert.rejects(
    assertDocumentationFresh({ apiRoot, docsRoot: fixtureDocs, lexiconPackageRoot: packageRoot }),
    /coverage\.json/,
  );

  const staleIndex = structuredClone(baseline.index);
  staleIndex.sourcePolicy = 'stale source metadata';
  await writeJson(path.join(fixtureDocs, 'sources/index.json'), staleIndex);
  await assert.rejects(
    assertDocumentationFresh({ apiRoot, docsRoot: fixtureDocs, lexiconPackageRoot: packageRoot }),
    /sources\/index\.json/,
  );
});
