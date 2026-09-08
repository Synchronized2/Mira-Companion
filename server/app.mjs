import express from 'express';
import { resolve } from 'node:path';
import { createApiRouter } from './api.mjs';

export function localOnly(port) {
  const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) return res.status(403).json({ error: '仅允许本机应用访问。' });
    if (!['127.0.0.1', 'localhost'].includes(req.hostname)) return res.sendStatus(403);
    next();
  };
}

function normalizePort(value = 5180) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('createApp port must be an integer from 1 to 65535.');
  }
  return port;
}

export async function createApp({ root, port: portValue, mode = 'development', apiOptions } = {}) {
  if (!root) throw new Error('createApp requires the project root.');
  const port = normalizePort(portValue);
  const app = express();
  app.use(localOnly(port));
  app.use('/api', createApiRouter(apiOptions));

  if (mode === 'api-only') {
    app.use((_req, res) => res.sendStatus(404));
  } else if (mode === 'production') {
    app.use(express.static(resolve(root, 'dist')));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve(root, 'dist/index.html')));
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({ root, server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }
  app.use((error, _req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(400).json({ error: error.type === 'entity.too.large' ? '请求过大。' : '请求无效。' });
  });
  return app;
}
