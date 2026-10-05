import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createServer } from 'vite';
import viteConfig from '../vite.config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Vite rejects invalid HappyView server settings before serving the explorer', async () => {
  const previous = process.env.VITE_HAPPYVIEW_SERVERS;
  process.env.VITE_HAPPYVIEW_SERVERS = '[]';
  let server;
  try {
    await assert.rejects(async () => {
      server = await createServer({
        ...viteConfig,
        configFile: false,
        logLevel: 'silent',
        server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
      });
    }, /VITE_HAPPYVIEW_SERVERS/);
  } finally {
    await server?.close();
    if (previous === undefined) delete process.env.VITE_HAPPYVIEW_SERVERS;
    else process.env.VITE_HAPPYVIEW_SERVERS = previous;
  }
});

test('Vite serves the website favicon and fonts byte-for-byte', async () => {
  const assets = [
    { url: '/favicon.ico', sha256: '02ffb7267d768e745caadaaab70e448d6a1c7ff10a476bb46e0fafd88fea9c37' },
    { url: '/fonts/InstrumentSerif-Regular.woff2', sha256: '60c06664b5a95c7de6cc3e00d1f9034d78bd1e40b564016b241674449a067d4d' },
    { url: '/fonts/InstrumentSerif-Italic.woff2', sha256: '6ee678c33f388dd7ba59700ebea635deb98821baafd817b09891f7927177f702' },
    { url: '/fonts/Switzer-Variable.woff2', sha256: 'd1bf801ffb1a6096def70a7c532255722ad87d948b13a8a586e342f7091f8ee4' },
  ];
  const server = await createServer({
    ...viteConfig,
    configFile: false,
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
  });

  try {
    await server.listen();
    const address = server.httpServer.address();
    assert.ok(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;

    for (const asset of assets) {
      const response = await fetch(`${origin}${asset.url}`);
      assert.equal(response.status, 200, `${asset.url} should be served locally`);
      const body = Buffer.from(await response.arrayBuffer());
      assert.equal(
        createHash('sha256').update(body).digest('hex'),
        asset.sha256,
        `${asset.url} should match the website asset bytes`,
      );
    }
  } finally {
    await server.close();
  }
});

test('Vite transforms the local OpenAPI import and keeps the raw download byte-identical', async () => {
  const server = await createServer({
    ...viteConfig,
    configFile: false,
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
  });

  try {
    await server.listen();
    const address = server.httpServer.address();
    assert.ok(address && typeof address !== 'string');
    const origin = `http://127.0.0.1:${address.port}`;

    const moduleResponse = await fetch(`${origin}/openapi.json?import`);
    assert.equal(moduleResponse.status, 200);
    assert.match(moduleResponse.headers.get('content-type') ?? '', /javascript/);
    assert.match(await moduleResponse.text(), /export default/);

    const downloadResponse = await fetch(`${origin}/openapi.json`);
    assert.equal(downloadResponse.status, 200);
    assert.equal(
      downloadResponse.headers.get('content-disposition'),
      'attachment; filename="hypercerts-api-openapi.json"',
    );
    assert.equal(
      await downloadResponse.text(),
      await readFile(path.join(root, 'openapi.json'), 'utf8'),
    );
  } finally {
    await server.close();
  }
});
