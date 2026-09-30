import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { exportRequestSchema } from '@touraya/shared';
import { exportBatches } from '../../db/schema';
import { notFound } from '../../lib/errors';
import { getSettings } from '../settings/service';
import { FILE_TYPES, renderFile } from './file';
import { createExportBatch, listBatches, previewExport } from './service';
import { applyYalidineEvents, sendToYalidine, testYalidine, verifyWebhookSignature } from './yalidine';

export const shippingRoutes: FastifyPluginAsync = async (app) => {
  const exporter = { preHandler: app.requirePermission('shipping.export') };

  app.post('/shipping/preview', exporter, async (req) => previewExport(app, exportRequestSchema.parse(req.body).ids));

  app.post('/shipping/exports', exporter, async (req) => createExportBatch(app, exportRequestSchema.parse(req.body).ids, req.user));

  app.get('/shipping/exports', exporter, async () => listBatches(app.db));

  app.get('/shipping/exports/:id/file', exporter, async (req, reply) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    const [batch] = await app.db.select().from(exportBatches).where(eq(exportBatches.id, id));
    if (!batch) throw notFound();
    const format = batch.fileName.endsWith('.csv') ? 'csv' : 'xlsx';
    const file = await renderFile(format, batch.headers, batch.rows);
    return reply
      .type(FILE_TYPES[format])
      .header('Content-Disposition', `attachment; filename="${batch.fileName}"`)
      .send(file);
  });

  app.post('/shipping/yalidine/send', exporter, async (req) => sendToYalidine(app, exportRequestSchema.parse(req.body).ids, req.user));

  app.post('/shipping/yalidine/test', { preHandler: app.requirePermission('settings.manage') }, async () => testYalidine(app));
};

/**
 * Yalidine webhook. Must answer 2xx quickly, otherwise Yalidine marks it "not2xx".
 * GET: validation handshake (echoes crc_token). POST: parcel events.
 */
export const yalidineWebhookRoutes: FastifyPluginAsync = async (app) => {
  // Keep the raw body to verify the HMAC signature.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  app.get('/webhooks/yalidine', async (req, reply) => {
    const { crc_token: crc } = req.query as { crc_token?: string };
    return reply.type('text/plain').send(crc ?? 'ok');
  });

  app.post('/webhooks/yalidine', async (req, reply) => {
    const raw = typeof req.body === 'string' ? req.body : '';
    const { yalidine } = await getSettings(app.db, app.secrets);
    const signature = req.headers['x-yalidine-signature'];
    if (!verifyWebhookSignature(raw, typeof signature === 'string' ? signature : undefined, yalidine.webhookSecret)) {
      req.log.warn('yalidine webhook: bad signature');
      return reply.code(200).send({ ok: false });
    }
    try {
      const applied = await applyYalidineEvents(app, JSON.parse(raw || '{}'));
      return { ok: true, applied };
    } catch (err) {
      req.log.error({ err }, 'yalidine webhook failed');
      return { ok: false };
    }
  });
};
