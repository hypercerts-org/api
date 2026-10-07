import { access, readFile, readdir } from 'node:fs/promises';
import { X_OK } from 'node:constants';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkLuaMaintainability } from './lua-maintainability.js';

const defaultRoot = fileURLToPath(new URL('../', import.meta.url));

async function mapConcurrentInOrder(items, mapItem) {
  const results = await Promise.all(items.map(async (item) => {
    try {
      return { ok: true, value: await mapItem(item) };
    } catch (error) {
      return { ok: false, error };
    }
  }));
  const firstFailure = results.find(({ ok }) => !ok);
  if (firstFailure) throw firstFailure.error;
  return results.map(({ value }) => value);
}

function resolveInside(root, base, relativePath, description) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new Error(`${description} must be a nonempty path in the API manifests`);
  }
  const packageRoot = path.resolve(root);
  const resolved = path.resolve(base, relativePath);
  if (resolved === packageRoot) {
    throw new Error(`${description} must point to a file inside the API package, not its root: ${relativePath}`);
  }
  const relative = path.relative(packageRoot, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${description} resolves outside the API package: ${relativePath}; keep it inside the package.`);
  }
  return resolved;
}

async function luaFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await luaFiles(file));
    else if (entry.isFile() && entry.name.endsWith('.lua')) files.push(file);
  }
  return files;
}

async function declaredLuaOutputs(root) {
  const bundlePath = path.join(root, 'manifest.json');
  let bundle;
  try {
    bundle = JSON.parse(await readFile(bundlePath, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read API root manifest ${bundlePath}: ${error.message}`, { cause: error });
  }
  if (!Array.isArray(bundle.modules)) {
    throw new Error(`API root manifest ${bundlePath} must declare a modules array before Lua handlers can be linted`);
  }

  const outputs = [];
  for (const modulePath of bundle.modules) {
    const moduleFile = resolveInside(root, root, modulePath, 'Module manifest path');
    let module;
    try {
      module = JSON.parse(await readFile(moduleFile, 'utf8'));
    } catch (error) {
      throw new Error(`Cannot read Lua module manifest ${moduleFile}: ${error.message}`, { cause: error });
    }
    if (!Array.isArray(module.assets)) {
      throw new Error(`Lua module manifest ${moduleFile} must declare an assets array`);
    }
    for (const asset of module.assets) {
      if (asset.kind === 'script' && asset.config?.script_type === 'lua') {
        outputs.push(resolveInside(
          root,
          path.dirname(moduleFile),
          asset.path,
          `Lua handler ${asset.id ?? '(unnamed)'} output path`,
        ));
      }
    }
  }
  return outputs;
}

async function readSourceMapDeclaration(root, moduleFile, asset, declaration) {
  if (!declaration.path) throw new Error(`${asset.id ?? 'Lua handler'} has no authored ${declaration.kind} source for bundle diagnostics`);
  const sourceFile = resolveInside(root, path.dirname(moduleFile), declaration.path, `${asset.id ?? 'Lua handler'} ${declaration.kind} source`);
  try {
    const source = await readFile(sourceFile, 'utf8');
    return { sourceFile, source };
  } catch (error) {
    throw new Error(`${asset.id ?? 'Lua handler'}: cannot map generated bundle to ${path.relative(root, sourceFile)}: ${error.message}`, { cause: error });
  }
}

async function sourceMapForAsset(root, moduleFile, asset) {
  if (asset.kind !== 'script' || asset.config?.script_type !== 'lua') return null;
  const shared = asset.sharedSourcePaths
    ?? (asset.sharedSourcePath ? [asset.sharedSourcePath] : []);
  if (!Array.isArray(shared)) throw new Error(`${asset.id ?? 'Lua handler'} must declare sharedSourcePaths as an array`);
  const declarations = [
    ...shared.map((source) => ({ path: source, kind: 'shared' })),
    { path: asset.sourcePath, kind: 'handler' },
  ];
  const loadedSources = await mapConcurrentInOrder(declarations, (declaration) => (
    readSourceMapDeclaration(root, moduleFile, asset, declaration)
  ));
  const ranges = [];
  let nextLine = 1;
  for (const { sourceFile, source } of loadedSources) {
    const trimmed = source.trimEnd();
    const lineCount = trimmed.length === 0 ? 1 : (trimmed.match(/\n/g) ?? []).length + 1;
    ranges.push({
      startLine: nextLine,
      endLine: nextLine + lineCount - 1,
      sourceFile: path.relative(root, sourceFile),
    });
    nextLine += lineCount + 1;
  }
  const outputFile = resolveInside(root, path.dirname(moduleFile), asset.path, `Lua handler ${asset.id ?? '(unnamed)'} output path`);
  return [path.resolve(outputFile), { endpoint: asset.id ?? '(unnamed Lua handler)', ranges }];
}

async function sourceMapsForModule(root, modulePath) {
  const moduleFile = resolveInside(root, root, modulePath, 'Module manifest path');
  const module = JSON.parse(await readFile(moduleFile, 'utf8'));
  const maps = await mapConcurrentInOrder(module.assets, (asset) => sourceMapForAsset(root, moduleFile, asset));
  return maps.filter((sourceMap) => sourceMap !== null);
}

async function declaredLuaSourceMaps(root) {
  const rootManifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  const moduleMaps = await mapConcurrentInOrder(rootManifest.modules, (modulePath) => (
    sourceMapsForModule(root, modulePath)
  ));
  return new Map(moduleMaps.flat());
}

function mapLuacheckOutput(output, root, sourceMaps) {
  return output.replace(/^(.+):(\d+):(\d+): (.+)$/gm, (line, reportedPath, lineNumber, column, message) => {
    const outputFile = path.resolve(root, reportedPath);
    const sourceMap = sourceMaps.get(outputFile);
    if (!sourceMap) return line;
    const generatedLine = Number(lineNumber);
    const range = sourceMap.ranges.find(({ startLine, endLine }) => generatedLine >= startLine && generatedLine <= endLine);
    if (!range) return line;
    const sourceLine = generatedLine - range.startLine + 1;
    const generatedPath = path.relative(root, outputFile);
    return `${range.sourceFile}:${sourceLine}:${column}: ${message} (in ${sourceMap.endpoint} bundle at ${generatedPath}:${generatedLine})`;
  });
}

function emitLintOutput(output, log, stream) {
  if (!output) return;
  if (log === console.log) stream.write(output);
  else log(output);
}

async function declaredEndpointFiles(root, log) {
  const allFiles = await luaFiles(path.join(root, 'lua'));
  if (allFiles.length === 0) {
    log('No Lua files in this branch; skipping Luacheck.');
    return null;
  }
  const endpointFiles = await declaredLuaOutputs(root);
  if (endpointFiles.length === 0) {
    log('No Lua endpoint handlers declared in this branch; skipping Luacheck.');
    return null;
  }
  await mapConcurrentInOrder(endpointFiles, async (file) => {
    try {
      await access(file);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error('Lua sources exist, but declared generated handler bundles are missing; run `pnpm build:lua` first.', { cause: error });
      }
      throw error;
    }
  });
  return endpointFiles;
}

function logMaintainabilityDiagnostics(maintainability, log) {
  for (const diagnostic of maintainability.diagnostics) log(`[Lua ${diagnostic.status}] ${diagnostic.message}`);
  log(`Lua parameter contracts: ${maintainability.stats.parameterContractsVerified} verified, ${maintainability.stats.parameterContractsUnverified} unverified.`);
}

async function runLuacheck(args, options, home, spawn) {
  let result = spawn('luacheck', args, options);
  if (result.error?.code === 'ENOENT') {
    const localLuacheck = path.join(home, '.luarocks', 'bin', 'luacheck');
    try {
      await access(localLuacheck, X_OK);
      result = spawn(localLuacheck, args, options);
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'EACCES') throw error;
    }
  }
  if (result.error?.code === 'ENOENT') {
    throw new Error('Luacheck is missing. Install it with `luarocks --lua-version=5.4 --local install luacheck 1.2.0`.');
  }
  if (result.error) throw result.error;
  return result;
}

export async function lintLua({ root = defaultRoot, home = homedir(), spawn = spawnSync, log = console.log } = {}) {
  const endpointFiles = await declaredEndpointFiles(root, log);
  if (!endpointFiles) return { skipped: true };

  const maintainability = await checkLuaMaintainability({ root });
  logMaintainabilityDiagnostics(maintainability, log);
  const sourceMaps = await declaredLuaSourceMaps(root);
  const args = [
    '--config',
    '.luacheckrc',
    '--no-color',
    ...endpointFiles.map((file) => path.relative(root, file)),
  ];
  const options = { cwd: root, encoding: 'utf8', stdio: 'pipe' };
  const result = await runLuacheck(args, options, home, spawn);
  emitLintOutput(mapLuacheckOutput(String(result.stdout ?? ''), root, sourceMaps), log, process.stdout);
  emitLintOutput(mapLuacheckOutput(String(result.stderr ?? ''), root, sourceMaps), log, process.stderr);
  const maintainabilityFailed = maintainability.diagnostics.some(({ status }) => status === 'error');
  return { status: Math.max(result.status ?? 1, maintainabilityFailed ? 1 : 0) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = await lintLua();
    if (result.status !== undefined) process.exitCode = result.status;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
