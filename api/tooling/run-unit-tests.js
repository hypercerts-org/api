import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const unitRoot = path.join(packageRoot, 'tests', 'unit');

async function findTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);

  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findTestFiles(entryPath));
    else if (entry.isFile() && entry.name.endsWith('.test.js')) files.push(entryPath);
  }
  return files;
}

try {
  const files = await findTestFiles(unitRoot);
  if (files.length === 0) {
    throw new Error('No unit test files found under tests/unit; add at least one *.test.js file.');
  }

  process.stdout.write(`Running ${files.length} unit test files under tests/unit\n`);
  const result = spawnSync(process.execPath, ['--test', ...files.map((file) => path.relative(packageRoot, file))], {
    cwd: packageRoot,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
