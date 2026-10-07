import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkLuaMaintainability, checkLuaParameterContracts } from '../../../tooling/lua-maintainability.js';

async function withPackage(run, { source, parameters, sharedSourcePaths = [] }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'hypercerts-lua-maintainability-'));
  try {
    await mkdir(path.join(root, 'modules', 'demo'), { recursive: true });
    await mkdir(path.join(root, 'lua', 'src'), { recursive: true });
    await mkdir(path.join(root, 'lexicons'), { recursive: true });
    await writeFile(path.join(root, 'manifest.json'), JSON.stringify({ modules: ['modules/demo/manifest.json'] }));
    await writeFile(path.join(root, 'modules/demo/manifest.json'), JSON.stringify({ assets: [
      { kind: 'lexicon', id: 'org.example.listThings', path: '../../lexicons/listThings.json' },
      {
        kind: 'script',
        id: 'xrpc.query:org.example.listThings',
        path: '../../lua/endpoints/listThings.lua',
        sourcePath: '../../lua/src/listThings.lua',
        sharedSourcePaths,
        config: { script_type: 'lua' },
      },
    ] }));
    await writeFile(path.join(root, 'lexicons/listThings.json'), JSON.stringify({
      lexicon: 1,
      id: 'org.example.listThings',
      defs: { main: { type: 'query', parameters: { type: 'params', properties: Object.fromEntries(parameters.map((name) => [name, { type: 'string' }])) } } },
    }));
    await writeFile(path.join(root, 'lua/src/listThings.lua'), source);
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('parameter contracts report both missing and extra literal allow-list keys', async () => {
  await withPackage(async (root) => {
    const diagnostics = await checkLuaParameterContracts({ root });
    const mismatch = diagnostics.find(({ code }) => code === 'parameter-contract-mismatch');

    assert.deepEqual(mismatch?.missing, ['cursor']);
    assert.deepEqual(mismatch?.extra, ['unexpected']);
  }, {
    parameters: ['authors', 'cursor'],
    source: 'function handle()\n  keys_only(params, { authors = true, unexpected = true })\nend\n',
  });
});

test('matching literal parameter names pass, and Lua comments or strings are not code', async () => {
  await withPackage(async (root) => {
    const diagnostics = await checkLuaParameterContracts({ root });
    assert.deepEqual(diagnostics, []);
  }, {
    parameters: ['authors', 'cursor'],
    source: '-- keys_only(params, { commented = true })\nfunction handle()\n  local note = "keys_only(params, { stringValue = true })"\n  keys_only(params, { authors = true, cursor = true })\nend\n',
  });
});

test('qualified custom keys_only methods are unverified, not parameter allow-lists', async () => {
  for (const source of [
    'function handle()\n  custom.keys_only(params, { authors = true })\nend\n',
    'function handle()\n  custom:keys_only(params, { authors = true })\nend\n',
  ]) {
    await withPackage(async (root) => {
      const diagnostics = await checkLuaParameterContracts({ root });
      assert.equal(diagnostics.length, 1);
      assert.equal(diagnostics[0].status, 'unverified');
      assert.equal(diagnostics[0].code, 'parameter-contract-unverified');
    }, { parameters: ['uri'], source });
  }
});

test('dynamic allow-lists are reported as unverified instead of blocking lint', async () => {
  await withPackage(async (root) => {
    const diagnostics = await checkLuaParameterContracts({ root });
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].status, 'unverified');
    assert.match(diagnostics[0].message, /dynamic or/);
  }, {
    parameters: ['authors'],
    source: 'function handle()\n  keys_only(params, make_allowed_keys())\nend\n',
  });
});

test('named local allow-lists are unverified unless visibility and immutability are clear', async () => {
  const unsupportedSources = [
    'local function unrelated()\n  local allowed = { authors = true }\nend\nfunction handle()\n  keys_only(params, allowed)\nend\n',
    'do\n  local allowed = { authors = true }\nend\nfunction handle()\n  keys_only(params, allowed)\nend\n',
    'function handle()\n  local allowed = { uri = true }\n  do\n    local allowed = { authors = true }\n    keys_only(params, allowed)\n  end\nend\n',
    'function handle()\n  local allowed = { uri = true }\n  allowed.uri = false\n  keys_only(params, allowed)\nend\n',
    'function handle()\n  local allowed = { uri = true }\n  local alias = allowed\n  alias.uri = false\n  keys_only(params, allowed)\nend\n',
  ];
  for (const source of unsupportedSources) {
    await withPackage(async (root) => {
      const diagnostics = await checkLuaParameterContracts({ root });
      assert.equal(diagnostics.length, 1);
      assert.equal(diagnostics[0].status, 'unverified');
      assert.equal(diagnostics[0].code, 'parameter-contract-unverified');
    }, { parameters: ['uri'], source });
  }
  await withPackage(async (root) => {
    assert.deepEqual(await checkLuaParameterContracts({ root }), []);
  }, {
    parameters: ['uri'],
    source: 'function handle()\n  local allowed = { uri = true }\n  keys_only(params, allowed)\nend\n',
  });
});

test('bundle diagnostics identify a missing shared helper but accept an included one', async () => {
  for (const sharedSourcePaths of [[], ['../../lua/shared/helper.lua']]) {
    await withPackage(async (root) => {
      const helperPath = path.join(root, 'lua/shared/helper.lua');
      await mkdir(path.dirname(helperPath), { recursive: true });
      await writeFile(helperPath, 'local function helper() return true end\n');
      const modulePath = path.join(root, 'modules/demo/manifest.json');
      const module = JSON.parse(await readFile(modulePath, 'utf8'));
      module.assets.push({
        kind: 'script',
        id: 'xrpc.query:org.example.helperCatalog',
        path: '../../lua/endpoints/helperCatalog.lua',
        sourcePath: '../../lua/src/helperCatalog.lua',
        sharedSourcePaths: ['../../lua/shared/helper.lua'],
        config: { script_type: 'lua' },
      });
      await writeFile(modulePath, JSON.stringify(module));
      await writeFile(path.join(root, 'lua/src/listThings.lua'), 'function handle() return helper() end\n');
      await writeFile(path.join(root, 'lua/src/helperCatalog.lua'), 'function handle() return true end\n');
      const diagnostics = await checkLuaMaintainability({ root });
      const helperFindings = diagnostics.diagnostics.filter(({ code, endpoint }) => (code.startsWith('helper-') || code === 'missing-helper-dependency') && endpoint === 'xrpc.query:org.example.listThings');
      const misses = helperFindings.filter(({ code }) => code === 'missing-helper-dependency');
      assert.equal(misses.length, sharedSourcePaths.length === 0 ? 1 : 0, JSON.stringify(diagnostics.diagnostics));
      if (misses.length) assert.match(misses[0].message, /lua\/shared\/helper.lua/);
      if (sharedSourcePaths.length > 0) assert.deepEqual(helperFindings, []);
    }, {
      parameters: ['authors'],
      source: 'function handle() return helper() end\n',
      sharedSourcePaths,
    });
  }
});

test('helper candidates are not resolved when later in the bundle or block-local', async () => {
  await withPackage(async (root) => {
    const earlyPath = path.join(root, 'lua/shared/early.lua');
    const latePath = path.join(root, 'lua/shared/later.lua');
    await mkdir(path.dirname(earlyPath), { recursive: true });
    await writeFile(earlyPath, 'local function use_helper() return helper() end\n');
    await writeFile(latePath, 'local function helper() return true end\n');
    await writeFile(path.join(root, 'lua/src/listThings.lua'), 'function handle() return use_helper() end\n');
    const { diagnostics } = await checkLuaMaintainability({ root });
    const findings = diagnostics.filter(({ endpoint, code }) => endpoint === 'xrpc.query:org.example.listThings' && (code.startsWith('helper-') || code === 'missing-helper-dependency'));
    assert.equal(findings.length, 1);
    assert.equal(findings[0].code, 'helper-availability-unverified');
    assert.equal(findings[0].status, 'unverified');
  }, {
    parameters: ['authors'],
    source: 'function handle() return use_helper() end\n',
    sharedSourcePaths: ['../../lua/shared/early.lua', '../../lua/shared/later.lua'],
  });

  await withPackage(async (root) => {
    const hiddenPath = path.join(root, 'lua/shared/hidden.lua');
    await mkdir(path.dirname(hiddenPath), { recursive: true });
    await writeFile(hiddenPath, 'if true then\n  local label = "end"\n  local function helper() return true end\nend\n');
    const modulePath = path.join(root, 'modules/demo/manifest.json');
    const module = JSON.parse(await readFile(modulePath, 'utf8'));
    module.assets.push({
      kind: 'script',
      id: 'xrpc.query:org.example.helperCatalog',
      path: '../../lua/endpoints/helperCatalog.lua',
      sourcePath: '../../lua/src/helperCatalog.lua',
      sharedSourcePaths: ['../../lua/shared/hidden.lua'],
      config: { script_type: 'lua' },
    });
    await writeFile(modulePath, JSON.stringify(module));
    await writeFile(path.join(root, 'lua/src/helperCatalog.lua'), 'function handle() return true end\n');
    await writeFile(path.join(root, 'lua/src/listThings.lua'), 'function handle() return helper() end\n');
    const { diagnostics } = await checkLuaMaintainability({ root });
    const findings = diagnostics.filter(({ endpoint, code }) => endpoint === 'xrpc.query:org.example.listThings' && (code.startsWith('helper-') || code === 'missing-helper-dependency'));
    assert.equal(findings.length, 1);
    assert.equal(findings[0].code, 'helper-availability-unverified');
    assert.equal(findings[0].status, 'unverified');
  }, {
    parameters: ['authors'],
    source: 'function handle() return helper() end\n',
  });
});

test('SQL interpolation warnings catch direct request values but ignore bound SQL, structure, comments, and strings', async () => {
  await withPackage(async (root) => {
    const { diagnostics } = await checkLuaMaintainability({ root });
    const warnings = diagnostics.filter(({ code }) => code === 'possible-sql-interpolation');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0].message, /directly references params, cursor/);
  }, {
    parameters: ['authors'],
    source: [
      '-- db.raw("SELECT " .. params.comment)',
      'local note = "db.raw SQL text mentions params.cursor"',
      'function handle()',
      '  db.raw("SELECT * FROM records WHERE uri = $1", { params.uri })',
      '  db.raw("SELECT * FROM " .. table_name, values)',
      '  db.raw("SELECT * FROM records WHERE uri = " .. params.uri .. cursor, {})',
      'end',
    ].join('\n'),
  });
});
