import { readFile, writeFile, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const usage = 'Usage: node scripts/refresh-sources.mjs <happyview-worktrees-root>';

function isInside(parent, candidate) {
  return candidate === parent || candidate.startsWith(`${parent}${path.sep}`);
}

function gitValue(worktree, ...args) {
  return execFileSync('git', ['-C', worktree, ...args], { encoding: 'utf8' }).trim();
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function activeApiLexicons(apiRoot, rootManifest) {
  const active = new Map();
  for (const moduleRef of rootManifest.modules ?? []) {
    const moduleFile = path.resolve(apiRoot, moduleRef);
    if (!isInside(apiRoot, moduleFile)) throw new Error(`Module manifest escapes hypercerts-api: ${moduleRef}`);
    const moduleManifest = await readJson(moduleFile);
    for (const asset of moduleManifest.assets ?? []) {
      if (asset.kind !== 'lexicon' || !asset.path) continue;
      const lexiconFile = path.resolve(path.dirname(moduleFile), asset.path);
      if (!isInside(apiRoot, lexiconFile)) throw new Error(`Lexicon path escapes hypercerts-api: ${asset.path}`);
      const lexicon = await readJson(lexiconFile);
      const type = lexicon.defs?.main?.type;
      if (['query', 'procedure'].includes(type)) active.set(lexicon.id, moduleRef);
    }
  }
  return active;
}

async function main() {
  const sourceRootArg = process.argv[2];
  if (sourceRootArg === '--help' || sourceRootArg === '-h') {
    console.log(`${usage}\nReads the recorded worktree paths and refreshes only this repository's source snapshots and generated artifacts.`);
    return;
  }
  if (!sourceRootArg) {
    console.error(usage);
    process.exitCode = 2;
    return;
  }

  const sourceRoot = path.resolve(sourceRootArg);
  if (!(await stat(sourceRoot)).isDirectory()) throw new Error(`Source root is not a directory: ${sourceRoot}`);
  const indexFile = path.join(root, 'sources/index.json');
  const index = await readJson(indexFile);
  const refreshed = [];

  for (const endpoint of index.endpoints) {
    const worktree = path.resolve(sourceRoot, endpoint.source.worktree);
    if (!isInside(sourceRoot, worktree)) throw new Error(`Worktree path escapes source root: ${endpoint.source.worktree}`);
    const sourceFile = path.resolve(worktree, endpoint.source.path);
    if (!isInside(worktree, sourceFile)) throw new Error(`Source file escapes worktree: ${endpoint.source.path}`);
    const bytes = await readFile(sourceFile);
    const lexicon = JSON.parse(bytes.toString('utf8'));
    const type = lexicon.defs?.main?.type;
    if (lexicon.id !== endpoint.id || !['query', 'procedure'].includes(type)) {
      throw new Error(`Expected ${endpoint.id} to be a query/procedure Lexicon at ${sourceFile}`);
    }
    const apiRoot = path.join(worktree, 'hypercerts-api');
    const rootManifest = await readJson(path.join(apiRoot, 'manifest.json'));
    const active = await activeApiLexicons(apiRoot, rootManifest);
    const activeModule = active.get(endpoint.id) ?? null;
    endpoint.file = `sources/lexicons/${endpoint.id}.json`;
    endpoint.type = type;
    endpoint.coverage = activeModule
      ? (endpoint.source.worktree === index.primaryWorktree ? 'primary' : 'branch-only')
      : 'unmanifested-unsupported';
    endpoint.source.branch = gitValue(worktree, 'branch', '--show-current');
    endpoint.source.commit = gitValue(worktree, 'rev-parse', 'HEAD');
    endpoint.source.activeModule = activeModule;
    refreshed.push({ file: path.join(root, endpoint.file), bytes });

    index.sourceRoots[endpoint.source.worktree] = {
      branch: endpoint.source.branch,
      commit: endpoint.source.commit,
      manifestPath: 'hypercerts-api/manifest.json',
      targetHappyViewRevision: rootManifest.targetHappyViewRevision,
    };
  }

  const primaryApi = path.join(sourceRoot, index.primaryWorktree, 'hypercerts-api');
  const packageManifest = await readJson(path.join(primaryApi, 'package.json'));
  index.primaryBranch = index.sourceRoots[index.primaryWorktree].branch;
  index.primaryCommit = index.sourceRoots[index.primaryWorktree].commit;
  index.pinnedLexiconPackage = packageManifest.dependencies?.['@hypercerts-org/lexicon'] ?? null;
  for (const snapshot of refreshed) await writeFile(snapshot.file, snapshot.bytes);
  await writeFile(indexFile, `${JSON.stringify(index, null, 2)}\n`);
  execFileSync(process.execPath, [path.join(root, 'scripts/generate-openapi.mjs')], { cwd: root, stdio: 'inherit' });
  console.log(`Refreshed ${refreshed.length} Lexicon snapshots from ${sourceRoot}.`);
}

main().catch((error) => {
  console.error(`${error.message}\n${usage}`);
  process.exitCode = 1;
});
