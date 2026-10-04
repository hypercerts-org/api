import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import test from 'node:test';
import { createServer } from 'vite';
import viteConfig from '../vite.config.mjs';

async function withViteOrigin(run) {
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
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await server.close();
  }
}

function htmlTags(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map(([tag]) => tag);
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match?.slice(1).find((value) => value !== undefined);
}

function assertMeta(html, key, content, keyAttribute = 'property') {
  const tag = htmlTags(html, 'meta').find(
    (candidate) => attribute(candidate, keyAttribute) === key && attribute(candidate, 'content') === content,
  );
  assert.ok(tag, `served index.html should include ${key}=${JSON.stringify(content)}`);
}

test('Vite serves the copied Hypercerts lockup and theme-specific favicons byte-for-byte', async () => {
  const assets = [
    { url: '/brand/logo-horizontal.svg', sha256: '1558d1982035c2501a634cfc055d9bef3bf81e2d9720207b4cb8d371b5cbe7a5' },
    { url: '/brand/favicon/favicon-light.svg', sha256: 'f4c2830be94953e091a9eedb5b21c6c25dec4e3458a8e966c3662749b964c598' },
    { url: '/brand/favicon/favicon-dark.svg', sha256: '64a06c9d77d2403461d45c96f0dadffdbb546827b9a67c54be1dedaf0a5a5c64' },
  ];

  await withViteOrigin(async (origin) => {
    for (const asset of assets) {
      const response = await fetch(`${origin}${asset.url}`);
      assert.equal(response.status, 200, `${asset.url} should be served by Vite`);
      assert.match(
        response.headers.get('content-type') ?? '',
        /image\/svg\+xml/,
        `${asset.url} should be served as an SVG, not the SPA fallback`,
      );
      const body = Buffer.from(await response.arrayBuffer());
      assert.equal(createHash('sha256').update(body).digest('hex'), asset.sha256, `${asset.url} should match the website artwork`);
    }
  });
});

test('SSR-rendered API reference brand links to the app root', async () => {
  const server = await createServer({
    ...viteConfig,
    configFile: false,
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false },
  });

  try {
    const { App } = await server.ssrLoadModule('/web/src/App.tsx');
    const markup = renderToStaticMarkup(createElement(App));
    const brand = htmlTags(markup, 'a').find(
      (tag) => attribute(tag, 'aria-label') === 'Hypercerts API reference home',
    );

    assert.ok(brand, 'rendered API reference should include its brand link');
    assert.equal(attribute(brand, 'href'), '/', 'the brand link should return to the app root');
  } finally {
    await server.close();
  }
});

test('Vite serves API-reference social metadata and color-scheme favicon links', async () => {
  await withViteOrigin(async (origin) => {
    const response = await fetch(origin);
    assert.equal(response.status, 200);
    const html = await response.text();

    assert.match(html, /<title>Hypercerts API Reference<\/title>/i);
    assertMeta(html, 'description', 'Browse and try public Hypercerts XRPC API endpoints.', 'name');
    assertMeta(html, 'og:type', 'website');
    assertMeta(html, 'og:title', 'Hypercerts API Reference');
    assertMeta(html, 'og:description', 'Browse and try public Hypercerts XRPC API endpoints.');
    assertMeta(html, 'og:image', 'https://hypercerts.org/img/hypercerts_opengraph-v2.jpg');
    assertMeta(html, 'twitter:card', 'summary_large_image', 'name');
    assertMeta(html, 'twitter:title', 'Hypercerts API Reference', 'name');
    assertMeta(html, 'twitter:description', 'Browse and try public Hypercerts XRPC API endpoints.', 'name');
    assertMeta(html, 'twitter:image', 'https://hypercerts.org/img/hypercerts_opengraph-v2.jpg', 'name');

    const iconLinks = htmlTags(html, 'link').filter((tag) => attribute(tag, 'rel') === 'icon');
    assert.ok(iconLinks.some((tag) => attribute(tag, 'href') === '/favicon.ico'), 'the existing ICO fallback should remain linked');
    assert.ok(iconLinks.some((tag) => (
      attribute(tag, 'href') === '/brand/favicon/favicon-light.svg' &&
      attribute(tag, 'media') === '(prefers-color-scheme: light)'
    )), 'light mode should select its matching favicon');
    assert.ok(iconLinks.some((tag) => (
      attribute(tag, 'href') === '/brand/favicon/favicon-dark.svg' &&
      attribute(tag, 'media') === '(prefers-color-scheme: dark)'
    )), 'dark mode should select its matching favicon');

    const icoIndex = iconLinks.findIndex((tag) => attribute(tag, 'href') === '/favicon.ico');
    const lightSvgIndex = iconLinks.findIndex((tag) => attribute(tag, 'href') === '/brand/favicon/favicon-light.svg');
    const darkSvgIndex = iconLinks.findIndex((tag) => attribute(tag, 'href') === '/brand/favicon/favicon-dark.svg');
    assert.ok(
      icoIndex < lightSvgIndex && icoIndex < darkSvgIndex,
      'the existing ICO fallback should precede both theme-specific favicons',
    );
    assert.equal(
      htmlTags(html, 'link').filter((tag) => attribute(tag, 'rel') === 'canonical').length,
      0,
      'served HTML should not declare a canonical URL before the explorer deployment URL is known',
    );
  });
});
