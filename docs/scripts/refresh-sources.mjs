import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const docsRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(docsRoot, '..');
const apiRoot = path.join(repositoryRoot, 'api');
const usage = 'Usage: pnpm docs:sync';

function isInside(parent, candidate) {
  return candidate === parent || candidate.startsWith(`${parent}${path.sep}`);
}

function resolveInside(parent, relativePath, description) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new Error(`${description} must be a non-empty relative path.`);
  }
  const resolved = path.resolve(parent, relativePath);
  if (!isInside(parent, resolved)) {
    throw new Error(`${description} escapes ${parent}: ${relativePath}`);
  }
  return resolved;
}

function resolveFromInside(boundary, baseDirectory, relativePath, description) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new Error(`${description} must be a non-empty relative path.`);
  }
  const resolved = path.resolve(baseDirectory, relativePath);
  if (!isInside(boundary, resolved)) {
    throw new Error(`${description} escapes ${boundary}: ${relativePath}`);
  }
  return resolved;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function pinnedLexiconPackageRoot(apiRoot, packageName) {
  try {
    const requireFromApi = createRequire(path.join(apiRoot, 'package.json'));
    return path.dirname(requireFromApi.resolve(`${packageName}/package.json`));
  } catch (error) {
    throw new Error(
      `Cannot resolve ${packageName} from api/package.json. Install the repository-pinned dependencies with ` +
        '`pnpm install --frozen-lockfile`, then rerun `pnpm check` or `pnpm docs:sync`.',
      { cause: error },
    );
  }
}

function referenceParts(reference, currentLexiconId) {
  if (typeof reference !== 'string' || reference.length === 0) {
    throw new Error(`Invalid Lexicon reference in ${currentLexiconId}: expected a non-empty string.`);
  }
  if (reference.startsWith('#')) {
    return { lexiconId: currentLexiconId, definitionName: reference.slice(1) || 'main' };
  }

  const [lexiconId, fragment] = reference.split('#', 2);
  return { lexiconId, definitionName: fragment || 'main' };
}

function snapshotFile(id) {
  if (!/^[a-z0-9]+(?:\.[A-Za-z0-9-]+)*$/.test(id)) {
    throw new Error(`Cannot use invalid Lexicon ID as a snapshot filename: ${id}`);
  }
  return `sources/lexicons/${id}.json`;
}

/**
 * Read active query Lexicons from the aggregate manifest and the reachable
 * schema Lexicons from its declared validation sources. No remote refs are fetched.
 * @param {{ apiRoot?: string; docsRoot?: string; lexiconPackageRoot?: string }} options
 */
export async function collectDocumentationSources(options = {}) {
  const currentApiRoot = path.resolve(options.apiRoot ?? apiRoot);
  const currentDocsRoot = path.resolve(options.docsRoot ?? docsRoot);
  const rootManifestFile = path.join(currentApiRoot, 'manifest.json');
  const manifest = await readJson(rootManifestFile);
  const apiPackage = await readJson(path.join(currentApiRoot, 'package.json'));
  const packageName = '@hypercerts-org/lexicon';
  const packageVersion = apiPackage.dependencies?.[packageName];
  const validationSources = new Map();

  for (const source of manifest.validationLexicons ?? []) {
    if (!source.id || validationSources.has(source.id)) {
      throw new Error(`api/manifest.json has a missing or duplicate validation Lexicon ID: ${source.id ?? '(missing)'}`);
    }
    if (!source.path && !source.packagePath) {
      throw new Error(`api/manifest.json has no source path for validation Lexicon ${source.id}`);
    }
    validationSources.set(source.id, source);
  }

  let packageRoot;
  async function getPackageRoot() {
    if (packageRoot) return packageRoot;
    packageRoot = options.lexiconPackageRoot
      ? path.resolve(options.lexiconPackageRoot)
      : pinnedLexiconPackageRoot(currentApiRoot, packageName);
    const resolvedPackage = await readJson(path.join(packageRoot, 'package.json'));
    if (resolvedPackage.name !== packageName || resolvedPackage.version !== packageVersion) {
      throw new Error(`Expected ${packageName}@${packageVersion}, resolved ${resolvedPackage.name ?? '(unnamed)'}@${resolvedPackage.version ?? '(unknown)'}.`);
    }
    return packageRoot;
  }

  async function readSource(source, baseDirectory, label) {
    if (source.path) {
      const file = resolveFromInside(currentApiRoot, baseDirectory, source.path, `${label} path`);
      return readJson(file);
    }
    if (source.packagePath) {
      if (!packageVersion) {
        throw new Error(`api/package.json does not pin ${packageName}, required by ${label}.`);
      }
      const resolvedPackageRoot = await getPackageRoot();
      const file = resolveFromInside(resolvedPackageRoot, resolvedPackageRoot, source.packagePath, `${label} packagePath`);
      return readJson(file);
    }
    throw new Error(`${label} has neither path nor packagePath.`);
  }

  const activeEndpoints = new Map();
  for (const moduleRef of manifest.modules ?? []) {
    const moduleFile = resolveInside(currentApiRoot, moduleRef, 'Module manifest path');
    const moduleManifest = await readJson(moduleFile);
    for (const asset of moduleManifest.assets ?? []) {
      if (asset.kind !== 'lexicon') continue;
      const lexicon = await readSource(asset, path.dirname(moduleFile), `Lexicon asset ${asset.id ?? '(missing ID)'}`);
      if (!asset.id || lexicon.id !== asset.id) {
        throw new Error(`Lexicon asset ID mismatch in ${moduleRef}: expected ${asset.id ?? '(missing ID)'}, got ${lexicon.id ?? '(missing ID)'}`);
      }
      const type = lexicon.defs?.main?.type;
      if (!['query', 'procedure'].includes(type)) continue;
      if (activeEndpoints.has(lexicon.id)) {
        throw new Error(`Duplicate registered query/procedure Lexicon: ${lexicon.id}`);
      }
      activeEndpoints.set(lexicon.id, {
        id: lexicon.id,
        type,
        module: moduleRef,
        sourcePath: asset.path ?? asset.packagePath,
        lexicon,
      });
    }
  }

  const sourceDocuments = new Map();
  for (const [id, endpoint] of activeEndpoints) {
    sourceDocuments.set(id, { lexicon: endpoint.lexicon, source: { module: endpoint.module, path: endpoint.sourcePath } });
  }
  const visitedDefinitions = new Set();

  async function loadLexicon(id, reference) {
    const existing = sourceDocuments.get(id);
    if (existing) return existing.lexicon;
    const source = validationSources.get(id);
    if (!source) {
      throw new Error(`Cannot resolve Lexicon reference ${JSON.stringify(reference)}: ${id} is not declared in api/manifest.json validationLexicons.`);
    }
    const lexicon = await readSource(source, currentApiRoot, `Validation Lexicon ${id}`);
    if (lexicon.id !== id) {
      throw new Error(`Validation Lexicon ID mismatch: manifest declares ${id}, source contains ${lexicon.id ?? '(missing ID)'}`);
    }
    const record = {
      lexicon,
      source: source.path ? { path: source.path } : { packagePath: source.packagePath },
    };
    sourceDocuments.set(id, record);
    return lexicon;
  }

  async function visitReference(reference, currentLexiconId) {
    const { lexiconId, definitionName } = referenceParts(reference, currentLexiconId);
    const key = `${lexiconId}#${definitionName}`;
    if (visitedDefinitions.has(key)) return;
    visitedDefinitions.add(key);
    const targetLexicon = await loadLexicon(lexiconId, reference);
    const targetDefinition = targetLexicon.defs?.[definitionName];
    if (!targetDefinition) {
      throw new Error(`Cannot resolve Lexicon reference ${JSON.stringify(reference)}: ${lexiconId} has no definition ${definitionName}.`);
    }
    await visitReferences(targetDefinition, lexiconId);
  }

  async function visitReferences(value, currentLexiconId) {
    if (Array.isArray(value)) {
      for (const item of value) await visitReferences(item, currentLexiconId);
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (value.type === 'ref') {
      await visitReference(value.ref, currentLexiconId);
      return;
    }
    if (value.type === 'union' && Array.isArray(value.refs)) {
      for (const reference of value.refs) await visitReference(reference, currentLexiconId);
      return;
    }
    for (const child of Object.values(value)) await visitReferences(child, currentLexiconId);
  }

  for (const endpoint of activeEndpoints.values()) {
    await visitReferences(endpoint.lexicon.defs.main, endpoint.id);
  }

  const lexicons = [...sourceDocuments]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, entry]) => ({
      id,
      file: snapshotFile(id),
      kind: activeEndpoints.has(id) ? 'endpoint' : 'schema',
      source: entry.source,
    }));
  const endpoints = [...activeEndpoints.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(({ id, type, module, sourcePath }) => ({
      id,
      type,
      module,
      file: snapshotFile(id),
      source: { path: sourcePath },
    }));
  const index = {
    apiManifest: 'api/manifest.json',
    pinnedLexiconPackage: packageVersion ?? null,
    sourcePolicy: 'Explorer operations are the query/procedure Lexicons declared by modules in api/manifest.json. Referenced schemas are resolved from that manifest and its pinned Lexicon package; no remote refs are fetched.',
    runtimeValidation: 'not-assessed',
    deploymentValidation: 'not-assessed',
    endpoints,
    lexicons,
  };
  const snapshots = lexicons.map(({ id, file }) => ({
    file: resolveInside(currentDocsRoot, file, `Snapshot for ${id}`),
    content: `${JSON.stringify(sourceDocuments.get(id).lexicon, null, 2)}\n`,
  }));

  return { index, snapshots };
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`${usage}\nRefreshes docs/sources/index.json, committed Lexicon snapshots, OpenAPI, and coverage from api/manifest.json.`);
    return;
  }
  if (process.argv.length > 2) {
    console.error(usage);
    process.exitCode = 2;
    return;
  }

  const { index, snapshots } = await collectDocumentationSources();
  for (const snapshot of snapshots) await writeFile(snapshot.file, snapshot.content);
  await writeFile(path.join(docsRoot, 'sources/index.json'), `${JSON.stringify(index, null, 2)}\n`);
  execFileSync(process.execPath, [path.join(docsRoot, 'scripts/generate-openapi.mjs')], {
    cwd: docsRoot,
    stdio: 'inherit',
  });
  console.log(`Refreshed ${index.endpoints.length} manifest-registered endpoints and ${index.lexicons.length - index.endpoints.length} referenced schema snapshots.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`${error.message}\n${usage}`);
    process.exitCode = 1;
  });
}
