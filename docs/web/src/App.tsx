import { useMemo, useState, type FormEvent, type ChangeEvent } from 'react';
import { Button, Input, Select } from '@hypercerts-org/ui-react';
import { ApiReferenceReact, type AnyApiReferenceConfiguration } from '@scalar/api-reference-react';
import generatedSpec from '../../openapi.json';
import { createClientConfiguration } from './client-configuration.mjs';
import {
  createPresentationSpec,
  LOCAL_SERVER_URL,
  normalizeBaseUrl,
  parseHappyviewServers,
} from './presentation.mjs';
import './styles.css';

const presentationSpec = createPresentationSpec(generatedSpec);
const configuredServers = parseHappyviewServers(import.meta.env.VITE_HAPPYVIEW_SERVERS);

export function App() {
  const [serverMode, setServerMode] = useState(configuredServers[0].url);
  const [activeServer, setActiveServer] = useState(configuredServers[0].url);
  const [customServer, setCustomServer] = useState('');
  const [customError, setCustomError] = useState('');

  const selectedServers = useMemo(
    () => [{ url: activeServer, description: 'Selected server' }],
    [activeServer],
  );
  const activeSpec = useMemo(
    () => ({ ...presentationSpec, servers: selectedServers }),
    [selectedServers],
  );
  const configuration = useMemo<AnyApiReferenceConfiguration>(
    () => ({
      content: activeSpec,
      ...createClientConfiguration(),
      agent: { disabled: true, hideAddApi: true },
      mcp: { disabled: true },
      hideClientButton: true,
      servers: selectedServers,
      baseServerURL: activeServer,
      theme: 'default',
      layout: 'modern',
      darkMode: false,
      forceDarkModeState: 'light',
      hideDarkModeToggle: true,
      hideSearch: false,
      hideModels: false,
      hideTestRequestButton: false,
      showOperationId: false,
      showSidebar: true,
      showDeveloperTools: 'never',
      customCss: String.raw`.introduction-section .section-content > .flex.gap-1\.5 { display: none; }`,
      defaultOpenFirstTag: true,
      defaultOpenAllTags: false,
      expandAllParameters: false,
      expandAllResponses: false,
      expandAllSchemaProperties: false,
      orderRequiredPropertiesFirst: true,
      documentDownloadType: 'none',
      telemetry: false,
      withDefaultFonts: false,
    }),
    [activeServer, activeSpec, selectedServers],
  );

  function handleServerModeChange(event: ChangeEvent<HTMLSelectElement>) {
    const nextMode = event.target.value;
    setServerMode(nextMode);
    setCustomError('');

    if (nextMode === 'local') setActiveServer(LOCAL_SERVER_URL);
    else if (nextMode !== 'custom') {
      const selected = configuredServers.find((server) => server.url === nextMode);
      if (selected) setActiveServer(selected.url);
    }
  }

  function applyCustomServer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setActiveServer(normalizeBaseUrl(customServer));
      setCustomError('');
    } catch (error) {
      setCustomError(error instanceof Error ? error.message : 'Enter a valid http(s) base URL.');
    }
  }

  return (
    <div className="app-frame">
      <header className="site-header">
        <a className="brand" href="/" aria-label="Hypercerts API reference home">
          <img className="brand-logo" src="/brand/logo-horizontal.svg" alt="" />
          <span className="brand-api"><span className="brand-divider" aria-hidden="true">/</span> API</span>
        </a>
        <div className="header-actions">
          <div className="server-control">
            <label htmlFor="server-mode">Request server</label>
            <Select id="server-mode" value={serverMode} onChange={handleServerModeChange}>
              {configuredServers.map((server, index) => (
                <option key={server.url} value={server.url}>
                  {server.label}{index === 0 ? ' · default' : ''}
                </option>
              ))}
              <option value="local">Local · 127.0.0.1:8080</option>
              <option value="custom">Custom base URL…</option>
            </Select>
          </div>
          {serverMode === 'custom' && (
            <form className="custom-server-form" onSubmit={applyCustomServer} noValidate>
              <label className="sr-only" htmlFor="custom-server">Custom base URL</label>
              <Input
                id="custom-server"
                type="url"
                value={customServer}
                onChange={(event) => setCustomServer(event.target.value)}
                placeholder="https://api.example.test"
                aria-invalid={Boolean(customError)}
                aria-describedby={customError ? 'server-error' : undefined}
                autoComplete="url"
              />
              <Button type="submit">Use URL</Button>
              {customError && <span id="server-error" className="server-error" role="alert">{customError}</span>}
            </form>
          )}
          <a className="download-link" href="/openapi.json" download="hypercerts-api-openapi.json">
            OpenAPI JSON <span aria-hidden="true">↓</span>
          </a>
        </div>
      </header>

      <main className="reference-main" aria-label="Hypercerts API endpoints">
        <ApiReferenceReact key={activeServer} configuration={configuration} />
      </main>
    </div>
  );
}
