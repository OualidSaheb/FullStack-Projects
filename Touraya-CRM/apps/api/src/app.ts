import path from 'node:path';
import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import type { Config } from './config';
import type { Db } from './db/client';
import { authPlugin } from './lib/auth';
import { createSecretBox } from './lib/crypto';
import { HttpError } from './lib/errors';
import { authRoutes } from './modules/auth/routes';
import { ingestRoutes } from './modules/ingest/routes';
import { orderRoutes } from './modules/orders/routes';
import { productRoutes } from './modules/products/routes';
import { settingsRoutes } from './modules/settings/routes';
import { shippingRoutes, yalidineWebhookRoutes } from './modules/shipping/routes';
import { sourceRoutes } from './modules/sources/routes';
import { statsRoutes } from './modules/stats/routes';
import { userRoutes } from './modules/users/routes';

export async function buildApp(config: Config, db: Db): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: config.NODE_ENV === 'production' ? 'info' : 'debug' },
    trustProxy: true,
  });

  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('secrets', createSecretBox(config.APP_SECRET));

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'بيانات غير صالحة', details: err.flatten() });
    }
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.message, details: err.details });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, 'unhandled error');
    return reply.code(status).send({ error: status >= 500 ? 'خطأ في الخادم' : (err as Error).message });
  });

  await app.register(rateLimit, { global: false });
  await app.register(authPlugin);

  await app.register(
    async (api) => {
      api.get('/health', async () => ({ ok: true }));
      await api.register(authRoutes);
      await api.register(orderRoutes);
      await api.register(productRoutes);
      await api.register(userRoutes);
      await api.register(sourceRoutes);
      await api.register(ingestRoutes);
      await api.register(shippingRoutes);
      await api.register(statsRoutes);
      await api.register(settingsRoutes);
      await api.register(yalidineWebhookRoutes);
    },
    { prefix: '/api' },
  );

  // Production: serve the built web app with SPA fallback.
  const webDist = path.resolve(config.WEB_DIST ?? path.join(process.cwd(), '../web/dist'));
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api') ? reply.code(404).send({ error: 'غير موجود' }) : reply.sendFile('index.html'),
    );
  }

  return app;
}
