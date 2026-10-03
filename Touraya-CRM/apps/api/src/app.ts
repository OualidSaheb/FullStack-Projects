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
import { EventBus } from './lib/events';
import { HttpError } from './lib/errors';
import { authRoutes } from './modules/auth/routes';
import { ingestRoutes } from './modules/ingest/routes';
import { orderRoutes } from './modules/orders/routes';
import { catalogRoutes } from './modules/catalog/routes';
import { carrierRoutes } from './modules/carriers/routes';
import { customerRoutes } from './modules/customers/routes';
import { inventoryRoutes } from './modules/inventory/routes';
import { liveRoutes } from './modules/live/routes';
import { settingsRoutes } from './modules/settings/routes';
import { carrierWebhookRoutes, shippingRoutes } from './modules/shipping/routes';
import { sourceRoutes } from './modules/sources/routes';
import { formRoutes } from './modules/forms/routes';
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
  app.decorate('events', new EventBus((err, event) => app.log.error({ err, event }, 'event handler failed')));

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
      await api.register(catalogRoutes);
      await api.register(inventoryRoutes);
      await api.register(customerRoutes);
      await api.register(carrierRoutes);
      await api.register(userRoutes);
      await api.register(sourceRoutes);
      await api.register(formRoutes);
      await api.register(ingestRoutes);
      await api.register(shippingRoutes);
      await api.register(statsRoutes);
      await api.register(settingsRoutes);
      await api.register(carrierWebhookRoutes);
      await api.register(liveRoutes);
    },
    { prefix: '/api' },
  );

  // Production: serve the built web app with SPA fallback.
  const webDist = path.resolve(config.WEB_DIST ?? path.join(process.cwd(), '../web/dist'));
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, {
      root: webDist,
      cacheControl: false,
      // Built files carry a hash in their name: the browser keeps them for good and only
      // re-downloads index.html, so pages open instantly after the first visit.
      setHeaders: (res, file) =>
        res.setHeader('cache-control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache'),
    });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api') ? reply.code(404).send({ error: 'غير موجود' }) : reply.sendFile('index.html'),
    );
  }

  return app;
}
