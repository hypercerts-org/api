const hiddenClients = [
  'c', 'clojure', 'csharp', 'dart', 'fsharp', 'http', 'java', 'js', 'julia', 'kotlin',
  'objc', 'ocaml', 'php', 'powershell', 'python', 'r', 'ruby', 'rust', 'swift',
  'node/axios', 'node/ofetch', 'node/undici', 'shell/httpie', 'shell/wget',
];

/** @returns {import('@scalar/api-reference-react').AnyApiReferenceConfiguration} */
export function createClientConfiguration() {
  return {
    hiddenClients: [...hiddenClients],
    defaultHttpClient: { targetKey: 'node', clientKey: 'fetch' },
  };
}
