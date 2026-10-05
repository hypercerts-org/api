import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadAssets, orderAssets } from '../../../tooling/installer.js';
import { validatePackageLexicons } from '../../../tooling/validate-lexicons.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const manifestPath = path.join(root, 'manifest.json');

async function loadBundle() {
  return (await loadAssets(manifestPath)).assets;
}

async function readModule(modulePath) {
  return JSON.parse(await readFile(path.resolve(root, modulePath), 'utf8'));
}

async function queryDeclarations(modulePath, module) {
  const moduleDirectory = path.dirname(path.resolve(root, modulePath));
  const queries = [];
  for (const declaration of module.assets) {
    if (declaration.kind !== 'lexicon' || typeof declaration.path !== 'string') continue;
    const source = JSON.parse(await readFile(path.resolve(moduleDirectory, declaration.path), 'utf8'));
    if (source.defs?.main?.type === 'query') queries.push(declaration);
  }
  return queries;
}

test('capability query Lexicons have handlers; shared view Lexicons remain schema-only', async () => {
  const bundle = JSON.parse(await readFile(manifestPath, 'utf8'));
  const assets = await loadBundle();
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const orderedIds = orderAssets(assets).map(({ id }) => id);
  const position = (id) => orderedIds.indexOf(id);

  for (const modulePath of bundle.modules) {
    const module = await readModule(modulePath);
    const queries = await queryDeclarations(modulePath, module);
    const handlers = module.assets.filter(({ kind, id }) => kind === 'script' && id.startsWith('xrpc.query:'));

    if (modulePath === 'modules/shared/manifest.json') {
      assert.ok(queries.length > 0, 'shared module must provide view Lexicons');
      assert.equal(handlers.length, 0, 'shared module must not register endpoint scripts');
      continue;
    }

    for (const declaration of queries) {
      const handlerId = `xrpc.query:${declaration.id}`;
      const handler = assetsById.get(handlerId);
      assert.ok(handler, `missing handler ${handlerId} for query ${declaration.id}`);
      assert.ok(handler.dependsOn?.includes(declaration.id), `${handlerId} must depend on ${declaration.id}`);
      assert.ok(position(declaration.id) < position(handlerId), `${declaration.id} must install before ${handlerId}`);
    }
  }
});

test('declared query schemas exist in the validation Lexicon set', async () => {
  const [assets, { lexicons, documents }] = await Promise.all([
    loadBundle(),
    validatePackageLexicons(),
  ]);
  const validatedDocuments = new Map(documents.map((document) => [document.id, document]));
  const queries = assets.filter(({ kind, lexicon_json }) => kind === 'lexicon' && lexicon_json.defs?.main?.type === 'query');

  for (const query of queries) {
    const document = validatedDocuments.get(query.id);
    assert.ok(document, `query schema ${query.id} is missing from validationLexicons`);
    assert.equal(document.id, query.id);
    assert.ok(lexicons.getDefOrThrow(query.id), `${query.id} must resolve in the validated Lexicon set`);
  }
});
