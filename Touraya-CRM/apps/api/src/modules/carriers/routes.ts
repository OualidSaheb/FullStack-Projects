import type { FastifyPluginAsync } from 'fastify';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { carrierRatesSchema, carrierSchema } from '@touraya/shared';
import { carriers } from '../../db/schema';
import { notFound } from '../../lib/errors';
import { ADAPTERS } from './registry';
import { getCarrier, getRates, saveCarrier, saveRates, toCarrierDTO } from './service';
import { CarrierError } from './types';

const idParams = z.object({ id: z.coerce.number().int() });

export const carrierRoutes: FastifyPluginAsync = async (app) => {
  const manage = { preHandler: app.requirePermission('settings.manage') };

  app.get('/carriers', { preHandler: app.requireAuth }, async () =>
    (await app.db.select().from(carriers).orderBy(asc(carriers.id))).map((c) => toCarrierDTO(app.secrets, c)),
  );

  app.post('/carriers', manage, async (req) =>
    toCarrierDTO(app.secrets, await app.db.transaction((tx) => saveCarrier(tx, app.secrets, carrierSchema.parse(req.body)))),
  );

  app.put('/carriers/:id', manage, async (req) => {
    const { id } = idParams.parse(req.params);
    return toCarrierDTO(app.secrets, await app.db.transaction((tx) => saveCarrier(tx, app.secrets, carrierSchema.parse(req.body), id)));
  });

  app.get('/carriers/:id/rates', { preHandler: app.requireAuth }, async (req) => getRates(app.db, idParams.parse(req.params).id));

  app.put('/carriers/:id/rates', manage, async (req) => {
    const { id } = idParams.parse(req.params);
    const [exists] = await app.db.select({ id: carriers.id }).from(carriers).where(eq(carriers.id, id));
    if (!exists) throw notFound();
    await app.db.transaction((tx) => saveRates(tx, id, carrierRatesSchema.parse(req.body)));
    return getRates(app.db, id);
  });

  /** "Test connection" — reports the carrier's error in plain words (e.g. 403/1106). */
  app.post('/carriers/:id/test', manage, async (req) => {
    const carrier = await getCarrier(app.db, app.secrets, idParams.parse(req.params).id);
    const adapter = ADAPTERS[carrier.provider];
    if (!adapter) return { ok: false, message: 'هذه الشركة تعمل بالملف فقط (بدون API)' };
    try {
      await adapter.test(carrier);
      return { ok: true };
    } catch (err) {
      if (err instanceof CarrierError) return { ok: false, message: err.message, ...err.details };
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  });
};
