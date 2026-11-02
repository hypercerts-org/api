import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isValidLexiconDoc, Lexicons } from '@atproto/lexicon';
import { orderAssets } from '../../../tooling/installer.js';
import { readLexiconSource } from '../../../tooling/lexicon-source.js';
import { validatePackageLexicons } from '../../../tooling/validate-lexicons.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const badgeModulePath = 'modules/badge-definitions/manifest.json';
const sharedModulePath = 'modules/shared/manifest.json';

async function readJson(relativePath) {
  return JSON.parse(await readFile(`${root}/${relativePath}`, 'utf8'));
}

function checkRefs(value, lexicons) {
  if (Array.isArray(value)) {
    value.forEach((item) => checkRefs(item, lexicons));
  } else if (value && typeof value === 'object') {
    if (value.type === 'ref') lexicons.getDefOrThrow(value.ref);
    if (value.type === 'union') value.refs.forEach((ref) => lexicons.getDefOrThrow(ref));
    Object.values(value).forEach((item) => checkRefs(item, lexicons));
  }
}

test('badge-definition module closes package and view Lexicon refs against foundation schema assets', async () => {
  const [badgeModule, sharedModule, { documents: packageDocuments }] = await Promise.all([
    readJson(badgeModulePath),
    readJson(sharedModulePath),
    validatePackageLexicons(root),
  ]);
  const badgeAssets = badgeModule.assets;
  const sharedAssets = sharedModule.assets;
  const recordAsset = sharedAssets.find(({ id }) => id === 'app.certified.badge.definition');
  assert.ok(recordAsset, 'the package-backed badge schema is owned by the shared foundation');
  assert.equal(recordAsset.packagePath, 'lexicons/app/certified/badge/definition.json');
  assert.equal(sharedAssets.filter(({ id }) => id === 'app.certified.badge.definition').length, 1);
  assert.deepEqual(recordAsset.dependsOn, ['app.certified.defs', 'app.certified.signature.defs']);
  assert.equal(sharedAssets.filter(({ id }) => id === 'app.certified.signature.defs').length, 1);

  const selectedAssets = [...sharedAssets, ...badgeAssets];
  const orderedAssets = orderAssets(selectedAssets);
  const assetIndex = (id) => orderedAssets.findIndex((asset) => asset.id === id);
  assert.ok(assetIndex('app.certified.signature.defs') < assetIndex('app.certified.badge.definition'));
  assert.ok(assetIndex('app.certified.defs') < assetIndex('app.certified.badge.definition'));
  assert.equal(selectedAssets.filter(({ id }) => id === 'app.certified.badge.definition').length, 1);

  const badgeLexicons = await Promise.all(badgeAssets
    .filter(({ kind }) => kind === 'lexicon')
    .map((asset) => readLexiconSource(asset, `${root}/modules/badge-definitions`)));
  for (const document of badgeLexicons) {
    assert.ok(isValidLexiconDoc(document), `invalid Lexicon ${document.id}`);
  }
  const badgeIds = new Set(badgeLexicons.map(({ id }) => id));
  const lexicons = new Lexicons([...packageDocuments.filter(({ id }) => !badgeIds.has(id)), ...badgeLexicons]);
  for (const document of badgeLexicons) checkRefs(document, lexicons);

  const badgeDefinitionView = lexicons.getDefOrThrow('app.certified.badge.getBadgeDefinition#badgeDefinitionView');
  const listOutput = lexicons.getDefOrThrow('app.certified.badge.listBadgeDefinitions#output');
  assert.deepEqual(badgeDefinitionView.required, ['uri', 'cid', 'indexedAt', 'did', 'author', 'record']);
  assert.deepEqual(badgeDefinitionView.nullable, ['indexedAt']);
  assert.equal(badgeDefinitionView.properties.record.ref, 'lex:app.certified.badge.definition');
  assert.equal(listOutput.properties.badgeDefinitions.items.ref,
    'lex:app.certified.badge.getBadgeDefinition#badgeDefinitionView');
});
