import assert from 'node:assert/strict';
import test from 'node:test';
import { createClientConfiguration } from '../web/src/client-configuration.mjs';

test('client configuration suppresses unwanted choices and retains required choices', () => {
  const config = createClientConfiguration();

  assert.deepEqual(config.defaultHttpClient, { targetKey: 'node', clientKey: 'fetch' });

  for (const client of ['node/axios', 'node/ofetch', 'node/undici', 'shell/httpie', 'shell/wget']) {
    assert.ok(config.hiddenClients.includes(client), `${client} should be suppressed`);
  }

  for (const client of ['node/fetch', 'go/native', 'shell/curl']) {
    assert.ok(!config.hiddenClients.includes(client), `${client} should not be suppressed`);
  }
});
