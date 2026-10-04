import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { parseHappyviewServers } from './web/src/presentation.mjs';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const openApiPath = path.join(projectRoot, 'openapi.json');

function openApiArtifact() {
  return {
    name: 'authoritative-openapi-artifact',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (
          request.url !== '/openapi.json' ||
          !['GET', 'HEAD'].includes(request.method ?? '')
        ) return next();

        try {
          const document = await readFile(openApiPath);
          response.statusCode = 200;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.setHeader('Content-Disposition', 'attachment; filename="hypercerts-api-openapi.json"');
          if (request.method === 'HEAD') return response.end();
          return response.end(document);
        } catch (error) {
          return next(error);
        }
      });
    },
    async generateBundle() {
      const document = await readFile(openApiPath);
      this.emitFile({ type: 'asset', fileName: 'openapi.json', source: document });
    },
  };
}

function validateHappyviewServers() {
  return {
    name: 'validate-happyview-servers',
    config(_config, { mode }) {
      parseHappyviewServers(loadEnv(mode, projectRoot, 'VITE_HAPPYVIEW_SERVERS').VITE_HAPPYVIEW_SERVERS);
    },
  };
}

export default defineConfig({
  root: projectRoot,
  plugins: [react(), openApiArtifact(), validateHappyviewServers()],
  publicDir: path.join(projectRoot, 'public'),
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    strictPort: true,
  },
});
