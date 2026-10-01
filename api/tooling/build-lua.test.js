import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildLuaBundles, checkLuaBundles } from './lua-bundles.js';

async function withManifestLuaRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hypercerts-api-manifest-build-'));
  try {
    const shared = path.join(root, 'lua/shared/view.lua');
    const source = path.join(root, 'lua/src/lookup.lua');
    await mkdir(path.dirname(shared), { recursive: true });
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(shared, 'local function shared_view() return "view" end\n');
    await writeFile(source, 'function handle() return shared_view() end\n');
    await writeFile(path.join(root, 'lua/src/unregistered.lua'), 'function handle() return "not bundled" end\n');
    await mkdir(path.join(root, 'modules/demo'), { recursive: true });
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ modules: ['modules/demo/manifest.json'] }));
    await writeFile(path.join(root, 'modules/demo/manifest.json'), JSON.stringify({ assets: [{
      kind: 'script',
      id: 'xrpc.query:org.example.lookup',
      path: '../../lua/endpoints/lookup.lua',
      sourcePath: '../../lua/src/lookup.lua',
      sharedSourcePaths: ['../../lua/shared/view.lua'],
      config: { script_type: 'lua' },
    }] }));
    await mkdir(path.join(root, 'lua/endpoints'));
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('builds only declared Lua handlers in manifest source order and detects stale output', async () => {
  await withManifestLuaRoot(async (root) => {
    assert.deepEqual(await checkLuaBundles(root), ['lua/endpoints/lookup.lua']);
    await buildLuaBundles(root);
    const outputPath = path.join(root, 'lua/endpoints/lookup.lua');
    assert.equal(
      await readFile(outputPath, 'utf8'),
      'local function shared_view() return "view" end\n\nfunction handle() return shared_view() end\n',
    );
    assert.deepEqual(await checkLuaBundles(root), []);
    await writeFile(outputPath, 'stale handler\n');
    assert.deepEqual(await checkLuaBundles(root), ['lua/endpoints/lookup.lua']);
    assert.equal(await readFile(outputPath, 'utf8'), 'stale handler\n');
    await assert.rejects(readFile(path.join(root, 'lua/endpoints/unregistered.lua')), { code: 'ENOENT' });
  });
});
