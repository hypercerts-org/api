import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildDocumentationArtifacts } from './openapi-artifacts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function loadLexicons(sourceIndex) {
  const lexicons = [];
  const ids = new Set();
  for (const entry of sourceIndex.lexicons ?? sourceIndex.endpoints) {
    if (ids.has(entry.id)) throw new Error(`Duplicate source Lexicon in docs/sources/index.json: ${entry.id}`);
    ids.add(entry.id);
    const file = path.resolve(root, entry.file);
    if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
      throw new Error(`Source path escapes repository: ${entry.file}`);
    }
    const lexicon = await readJson(file);
    if (lexicon.id !== entry.id) {
      throw new Error(`Source metadata does not match Lexicon ${entry.id}`);
    }
    lexicons.push(lexicon);
  }
  return lexicons;
}

async function main() {
  const sourceIndex = await readJson(path.join(root, 'sources/index.json'));
  const lexicons = await loadLexicons(sourceIndex);
  const artifacts = buildDocumentationArtifacts(sourceIndex, lexicons);
  await writeFile(path.join(root, 'openapi.json'), `${JSON.stringify(artifacts.openapi, null, 2)}\n`);
  await writeFile(path.join(root, 'coverage.json'), `${JSON.stringify(artifacts.coverage, null, 2)}\n`);
  console.log(`Generated ${sourceIndex.endpoints.length} manifest-registered endpoints; no unresolved schema references remain.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
