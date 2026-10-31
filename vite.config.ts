import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

// Prevent Rolldown from inlining backend TS files and decorator metadata during config bundling
const dynamicImport = new Function('specifier', 'return import(specifier)');

function apiBackendPlugin(): Plugin {
  return {
    name: 'face-vid-api-backend',
    async configureServer(server) {
      try {
        const expressModule = await dynamicImport('express');
        const express = expressModule.default || expressModule;

        const routerUrl = pathToFileURL(path.resolve(process.cwd(), 'apps/api/src/router.ts')).href;
        const dbUrl = pathToFileURL(
          path.resolve(process.cwd(), 'apps/api/src/database/database.service.ts')
        ).href;
        const redisUrl = pathToFileURL(
          path.resolve(process.cwd(), 'apps/api/src/redis/redis.service.ts')
        ).href;

        const { createApiV1Router } = await dynamicImport(routerUrl);
        const { databaseFoundationService } = await dynamicImport(dbUrl);
        const { redisFoundationService } = await dynamicImport(redisUrl);

        await Promise.all([
          databaseFoundationService.ensureListening(),
          redisFoundationService.ensureConnected(),
        ]).catch(() => {});

        const apiApp = express();
        apiApp.disable('x-powered-by');
        apiApp.use(express.json({ limit: '15mb' }));
        apiApp.use('/api/v1', createApiV1Router());

        server.middlewares.use((req: any, res: any, next: any) => {
          if (req.url && req.url.startsWith('/api/v1')) {
            apiApp(req, res, next);
          } else {
            next();
          }
        });
      } catch (err) {
        console.error('Failed to initialize API router inside Vite dev server:', err);
      }
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), apiBackendPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
