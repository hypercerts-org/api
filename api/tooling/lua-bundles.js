import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function resolveInside(root, base, relativePath, description) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) {
    throw new Error(`${description} must be a nonempty path in the API manifests`);
  }
  const resolved = path.resolve(base, relativePath);
  const relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${description} resolves outside the API package: ${relativePath}`);
  }
  return resolved;
}

async function readJson(file, description) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read ${description} at ${file}: ${error.message}`, { cause: error });
  }
}

async function renderBundles(root) {
  const packageRoot = path.resolve(root);
  const manifestFile = path.join(packageRoot, 'manifest.json');
  const bundle = await readJson(manifestFile, 'root API manifest');
  if (!Array.isArray(bundle.modules)) {
    throw new Error(`Root API manifest ${manifestFile} must declare a modules array`);
  }

  const outputs = [];
  const outputPaths = new Set();
  for (const modulePath of bundle.modules) {
    const moduleFile = resolveInside(packageRoot, packageRoot, modulePath, 'Module manifest path');
    const module = await readJson(moduleFile, 'module manifest');
    if (!Array.isArray(module.assets)) {
      throw new Error(`Module manifest ${moduleFile} must declare an assets array`);
    }

    const moduleDirectory = path.dirname(moduleFile);
    for (const declaration of module.assets) {
      if (declaration.kind !== 'script' || declaration.config?.script_type !== 'lua') continue;
      const id = declaration.id ?? 'unnamed Lua handler';
      const shared = declaration.sharedSourcePaths
        ?? (declaration.sharedSourcePath ? [declaration.sharedSourcePath] : []);
      if (!Array.isArray(shared)) {
        throw new Error(`${id} must declare sharedSourcePaths as an array`);
      }
      const sourcePaths = [
        ...shared.map((source) => resolveInside(packageRoot, moduleDirectory, source, `${id} shared source`)),
        resolveInside(packageRoot, moduleDirectory, declaration.sourcePath, `${id} endpoint source`),
      ];
      const outputFile = resolveInside(packageRoot, moduleDirectory, declaration.path, `${id} output path`);
      const relativeOutput = path.relative(packageRoot, outputFile);
      if (outputPaths.has(relativeOutput)) {
        throw new Error(`Multiple Lua handlers generate ${relativeOutput}`);
      }
      outputPaths.add(relativeOutput);

      let contents;
      try {
        contents = await Promise.all(sourcePaths.map((source) => readFile(source, 'utf8')));
      } catch (error) {
        throw new Error(`Cannot read declared Lua source for ${id}: ${error.message}`, { cause: error });
      }
      outputs.push({
        path: relativeOutput,
        file: outputFile,
        content: `${contents.map((source) => source.trimEnd()).join('\n\n')}\n`,
      });
    }
  }
  return outputs;
}

export async function buildLuaBundles(root) {
  for (const output of await renderBundles(root)) {
    await writeFile(output.file, output.content);
  }
}

export async function checkLuaBundles(root) {
  const stale = [];
  for (const output of await renderBundles(root)) {
    let current;
    try {
      current = await readFile(output.file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        stale.push(output.path);
        continue;
      }
      throw error;
    }
    if (current !== output.content) stale.push(output.path);
  }
  return stale;
}
