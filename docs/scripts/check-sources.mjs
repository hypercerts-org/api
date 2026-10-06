import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildDocumentationArtifacts } from './openapi-artifacts.mjs';
import { collectDocumentationSources } from './refresh-sources.mjs';

const docsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Read the canonical API sources and reject any stale committed docs artifact.
 * This check never writes files.
 * @param {{ apiRoot?: string; docsRoot?: string; lexiconPackageRoot?: string }} options
 */
export async function assertDocumentationFresh(options = {}) {
  const currentDocsRoot = path.resolve(options.docsRoot ?? docsRoot);
  const { index, snapshots } = await collectDocumentationSources(options);
  const lexicons = snapshots.map(({ content }) => JSON.parse(content));
  const artifacts = buildDocumentationArtifacts(index, lexicons);
  const staleFiles = [];

  async function compare(relativePath, expected) {
    try {
      const actual = await readFile(path.join(currentDocsRoot, relativePath), 'utf8');
      if (actual !== expected) staleFiles.push(relativePath);
    } catch (error) {
      if (error?.code === 'ENOENT') staleFiles.push(relativePath);
      else throw error;
    }
  }

  await compare('sources/index.json', jsonText(index));
  for (const [indexInList, snapshot] of snapshots.entries()) {
    await compare(index.lexicons[indexInList].file, snapshot.content);
  }
  await compare('openapi.json', jsonText(artifacts.openapi));
  await compare('coverage.json', jsonText(artifacts.coverage));

  if (staleFiles.length > 0) {
    const paths = [...new Set(staleFiles)].sort().map((file) => `  - ${file}`).join('\n');
    throw new Error(`Documentation artifacts are stale:\n${paths}\nRun pnpm docs:sync to refresh them.`);
  }

  return { endpoints: index.endpoints.length, snapshots: index.lexicons.length };
}

async function main() {
  const result = await assertDocumentationFresh();
  console.log(`Documentation is fresh: ${result.endpoints} endpoints, ${result.snapshots} Lexicon snapshots.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
