import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { lintLua } from './lint-lua.js';

async function withTempRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hypercerts-api-lint-lua-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function declareLuaHandler(root) {
  const modulePath = path.join(root, 'modules', 'demo', 'manifest.json');
  await mkdir(path.dirname(modulePath), { recursive: true });
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ modules: ['modules/demo/manifest.json'] }));
  await writeFile(modulePath, JSON.stringify({ assets: [{
    kind: 'script',
    id: 'xrpc.query:org.example.getExample',
    path: '../../lua/endpoints/getExample.lua',
    sourcePath: '../../lua/src/getExample.lua',
    config: { script_type: 'lua' },
  }] }));
}

test('skips Lua lint when the package has no Lua files', async () => {
  await withTempRoot(async (root) => {
    const result = await lintLua({ root, log: () => {} });
    assert.deepEqual(result, { skipped: true });
  });
});

test('skips shared Lua support when the branch declares no endpoint handlers', async () => {
  await withTempRoot(async (root) => {
    await mkdir(path.join(root, 'lua', 'shared'), { recursive: true });
    await writeFile(path.join(root, 'lua', 'shared', 'query.lua'), 'local function query() end\n');
    await mkdir(path.join(root, 'modules', 'shared'), { recursive: true });
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ modules: ['modules/shared/manifest.json'] }));
    await writeFile(path.join(root, 'modules', 'shared', 'manifest.json'), JSON.stringify({ assets: [] }));
    let invoked = false;

    const result = await lintLua({ root, log: () => {}, spawn: () => { invoked = true; return { status: 0 }; } });

    assert.deepEqual(result, { skipped: true });
    assert.equal(invoked, false);
  });
});

test('requires generated endpoint bundles when Lua handlers are declared', async () => {
  await withTempRoot(async (root) => {
    await mkdir(path.join(root, 'lua', 'src'), { recursive: true });
    await writeFile(path.join(root, 'lua', 'src', 'getExample.lua'), 'function handle() end\n');
    await declareLuaHandler(root);

    await assert.rejects(
      lintLua({ root, log: () => {} }),
      /declared generated handler bundles are missing.*pnpm build:lua/,
    );
  });
});

test('runs Luacheck only against generated handlers declared by the module manifests', async () => {
  await withTempRoot(async (root) => {
    const endpoint = path.join(root, 'lua', 'endpoints', 'getExample.lua');
    await mkdir(path.dirname(endpoint), { recursive: true });
    await writeFile(endpoint, 'function handle() end\n');
    await declareLuaHandler(root);
    let command;
    let args;
    let options;

    const result = await lintLua({
      root,
      log: () => {},
      spawn: (nextCommand, nextArgs, nextOptions) => {
        command = nextCommand;
        args = nextArgs;
        options = nextOptions;
        return { status: 0 };
      },
    });

    assert.deepEqual(result, { status: 0 });
    assert.equal(command, 'luacheck');
    assert.deepEqual(args, ['--config', '.luacheckrc', 'lua/endpoints/getExample.lua']);
    assert.equal(options.cwd, root);
    assert.equal(options.stdio, 'inherit');
  });
});

test('uses the default user-local LuaRocks binary when it is not on PATH', async () => {
  await withTempRoot(async (root) => {
    const home = path.join(root, 'home');
    const endpoint = path.join(root, 'lua', 'endpoints', 'getExample.lua');
    const localLuacheck = path.join(home, '.luarocks', 'bin', 'luacheck');
    await mkdir(path.dirname(endpoint), { recursive: true });
    await mkdir(path.dirname(localLuacheck), { recursive: true });
    await writeFile(endpoint, 'function handle() end\n');
    await writeFile(localLuacheck, '#!/bin/sh\n', { mode: 0o755 });
    await declareLuaHandler(root);
    const commands = [];

    const result = await lintLua({
      root,
      home,
      log: () => {},
      spawn: (command, args) => {
        commands.push({ command, args });
        if (command === 'luacheck') return { error: Object.assign(new Error('not found'), { code: 'ENOENT' }) };
        return { status: 0 };
      },
    });

    assert.deepEqual(result, { status: 0 });
    assert.deepEqual(commands.map(({ command }) => command), ['luacheck', localLuacheck]);
    assert.deepEqual(commands[1].args, ['--config', '.luacheckrc', 'lua/endpoints/getExample.lua']);
  });
});

test('explains how to install Luacheck when it is missing', async () => {
  await withTempRoot(async (root) => {
    const endpoint = path.join(root, 'lua', 'endpoints', 'getExample.lua');
    await mkdir(path.dirname(endpoint), { recursive: true });
    await writeFile(endpoint, 'function handle() end\n');
    await declareLuaHandler(root);

    await assert.rejects(
      lintLua({
        root,
        log: () => {},
        spawn: () => ({ error: Object.assign(new Error('not found'), { code: 'ENOENT' }) }),
      }),
      /Luacheck is missing.*luarocks --lua-version=5\.4 --local install luacheck 1\.2\.0/,
    );
  });
});
