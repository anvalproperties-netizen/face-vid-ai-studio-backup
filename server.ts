/**
 * FACE VID — Unified Full-Stack Runtime Server (Port 3000)
 *
 * Mounts the central @face-vid/api v1 router (/api/v1/*) alongside the Vite
 * frontend middleware in development (or static dist in production) so that
 * Web, Admin, and Backend API health/security endpoints are runnable on port 3000.
 */

import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { createApiV1Router } from './apps/api/src/router.ts';
import { apiLogger } from './apps/api/src/common/logger.ts';
import { databaseFoundationService } from './apps/api/src/database/database.service.ts';
import { redisFoundationService } from './apps/api/src/redis/redis.service.ts';
import { realtimeService } from './apps/api/src/modules/realtime.service.ts';

function parsePort(): number {
  const args = process.argv;
  const portFlagIndex = args.findIndex((arg) => arg === '--port' || arg === '-p');
  if (portFlagIndex !== -1 && args[portFlagIndex + 1]) {
    const val = parseInt(args[portFlagIndex + 1], 10);
    if (!isNaN(val) && val > 0) return val;
  }
  const portArg = args.find((arg) => arg.startsWith('--port='));
  if (portArg) {
    const val = parseInt(portArg.split('=')[1], 10);
    if (!isNaN(val) && val > 0) return val;
  }
  if (process.env.DEFAULT_APP_PORT) {
    const val = parseInt(process.env.DEFAULT_APP_PORT, 10);
    if (!isNaN(val) && val > 0) return val;
  }
  if (process.env.PORT) {
    const val = parseInt(process.env.PORT, 10);
    if (!isNaN(val) && val > 0 && val !== 8080 && val !== Number(process.env.NGINX_PORT)) {
      return val;
    }
  }
  return 3000;
}

function parseHost(): string {
  const args = process.argv;
  const hostFlagIndex = args.findIndex((arg) => arg === '--host' || arg === '-h');
  if (hostFlagIndex !== -1 && args[hostFlagIndex + 1]) {
    return args[hostFlagIndex + 1];
  }
  const hostArg = args.find((arg) => arg.startsWith('--host='));
  if (hostArg) {
    return hostArg.split('=')[1];
  }
  return process.env.HOST || '0.0.0.0';
}

async function startServer() {
  const app = express();
  const PORT = parsePort();
  const HOST = parseHost();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '15mb' }));
  app.use('/assets', express.static(path.join(process.cwd(), 'public', 'assets')));

  try {
    await Promise.all([
      databaseFoundationService.ensureListening(),
      redisFoundationService.ensureConnected(),
    ]);
  } catch (err) {
    apiLogger.warn('Non-fatal foundation listener startup notice', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Mount @face-vid/api versioned router at /api/v1
  app.use('/api/v1', createApiV1Router());

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const httpServer = http.createServer(app);

  // Authenticated native RFC 6455 WebSocket Upgrade handler on /api/v1/ws
  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url && req.url.startsWith('/api/v1/ws')) {
      realtimeService.handleUpgrade(req, socket as any, head);
    }
  });

  httpServer.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[CRITICAL] Port ${PORT} on ${HOST} is already in use.`);
    } else {
      console.error('[CRITICAL] Server startup error:', err);
    }
  });

  const shutdown = () => {
    httpServer.close(() => {
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  httpServer.listen(PORT, HOST, () => {
    console.log(`\n  FACE VID Development Server`);
    console.log(`  ➜  Local:   http://localhost:${PORT}/`);
    console.log(`  ➜  Network: http://${HOST}:${PORT}/`);
    console.log(`  ➜  API:     http://localhost:${PORT}/api/v1`);
    console.log(`  ➜  WS:      ws://localhost:${PORT}/api/v1/ws\n`);
    apiLogger.info(`FACE VID Phase 1A Runtime listening on http://${HOST}:${PORT}`, {
      apiMountedAt: '/api/v1',
      healthEndpoint: '/api/v1/health',
      readinessEndpoint: '/api/v1/health/ready',
      websocketEndpoint: '/api/v1/ws',
    });
  });
}

startServer();
