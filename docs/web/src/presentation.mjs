export const DEFAULT_SERVER_URL = 'https://api.test.hypercerts.dev';
export const LOCAL_SERVER_URL = 'http://127.0.0.1:8080';

const PRESENTATION_DESCRIPTION =
  'Explore public Hypercerts XRPC queries. Browse endpoints, inspect parameters, and try requests against your selected server.';

/**
 * Validate and normalize a server base URL for the request client.
 * @param {string} input
 */
export function normalizeBaseUrl(input) {
  let url;
  const candidate = input.trim();
  try {
    url = new URL(candidate);
  } catch {
    throw new TypeError('Enter a complete http(s) base URL, such as https://api.example.test.');
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    candidate.includes('?') ||
    candidate.includes('#')
  ) {
    throw new TypeError(
      'Use an http(s) base URL without credentials, a query, or a fragment.',
    );
  }

  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/**
 * Parse build-time server choices. The first configured server is the default;
 * omitting the variable keeps the bundled API test URL.
 * @param {string | undefined} input
 */
export function parseHappyviewServers(input) {
  if (input === undefined) {
    return [{ label: 'API test', url: DEFAULT_SERVER_URL }];
  }

  let configured;
  try {
    configured = JSON.parse(input);
  } catch {
    throw new TypeError(
      'VITE_HAPPYVIEW_SERVERS must be a JSON array of {"label","url"} entries. Set valid JSON or unset it to use the API test URL.',
    );
  }
  if (!Array.isArray(configured) || configured.length === 0) {
    throw new TypeError(
      'VITE_HAPPYVIEW_SERVERS must contain at least one {"label","url"} entry. Add a server or unset it to use the API test URL.',
    );
  }

  const seenUrls = new Set();
  return configured.map((server, index) => {
    const entry = `VITE_HAPPYVIEW_SERVERS entry ${index + 1}`;
    if (
      !server ||
      typeof server !== 'object' ||
      Array.isArray(server) ||
      typeof server.label !== 'string' ||
      !server.label.trim() ||
      typeof server.url !== 'string'
    ) {
      throw new TypeError(`${entry} needs a non-empty label and an http(s) URL. Fix the entry or remove it.`);
    }

    let url;
    try {
      url = normalizeBaseUrl(server.url);
    } catch (error) {
      throw new TypeError(`${entry} has an invalid URL: ${error.message}`);
    }
    if (seenUrls.has(url)) {
      throw new TypeError(`${entry} repeats ${url}. Remove the duplicate URL or choose a different server.`);
    }
    seenUrls.add(url);
    return { label: server.label.trim(), url };
  });
}

/**
 * Make an in-memory presentation copy without changing generated artifacts.
 * @param {Record<string, any>} source
 */
export function createPresentationSpec(source) {
  const spec = structuredClone(source);
  spec.info = {
    ...spec.info,
    version: 'local',
    description: PRESENTATION_DESCRIPTION,
  };
  spec.servers = [
    { url: DEFAULT_SERVER_URL, description: 'API test (default)' },
    { url: LOCAL_SERVER_URL, description: 'Local (127.0.0.1:8080)' },
  ];

  for (const schema of Object.values(spec.components?.schemas ?? {})) {
    if (Object.hasOwn(schema, 'x-lexicon-ref')) {
      delete schema.description;
    }
  }

  stripPresentationExtensions(spec);
  return spec;
}

/**
 * @param {unknown} value
 */
function stripPresentationExtensions(value) {
  if (Array.isArray(value)) {
    for (const item of value) stripPresentationExtensions(item);
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value)) {
    if (key.startsWith('x-') && key !== 'x-lexicon-maxGraphemes') {
      delete value[key];
    } else {
      stripPresentationExtensions(child);
    }
  }
}
