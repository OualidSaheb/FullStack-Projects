import type { FastifyPluginAsync } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { adSpendSchema, type AdSpendDTO } from '@touraya/shared';
import type { DbOrTx } from '../../db/client';
import { adSpend, offers, users } from '../../db/schema';
import { notFound } from '../../lib/errors';

const idParams = z.object({ id: z.coerce.number().int() });

export async function listAdSpend(db: DbOrTx): Promise<AdSpendDTO[]> {
  const rows = await db
    .select({
      id: adSpend.id,
      day: adSpend.day,
      amountUsd: adSpend.amountUsd,
      usdRate: adSpend.usdRate,
      offerId: adSpend.offerId,
      offerName: offers.name,
      note: adSpend.note,
      createdByName: users.name,
    })
    .from(adSpend)
    .leftJoin(offers, eq(offers.id, adSpend.offerId))
    .leftJoin(users, eq(users.id, adSpend.createdById))
    .orderBy(desc(adSpend.day), desc(adSpend.id));
  return rows;
}

/** Ad spend typed by hand, a day at a time (seen with the delivery company's statistics). */
export const adRoutes: FastifyPluginAsync = async (app) => {
  const manage = { preHandler: app.requirePermission('ads.manage') };

  app.get('/ads', { preHandler: app.requirePermission('stats.carrier') }, async () => listAdSpend(app.db));

  app.post('/ads', manage, async (req) => {
    const input = adSpendSchema.parse(req.body);
    const [row] = await app.db.insert(adSpend).values({ ...input, offerId: input.offerId ?? null, note: input.note || null, createdById: req.user.id }).returning();
    return row;
  });

  app.put('/ads/:id', manage, async (req) => {
    const { id } = idParams.parse(req.params);
    const input = adSpendSchema.parse(req.body);
    const [row] = await app.db.update(adSpend).set({ ...input, offerId: input.offerId ?? null, note: input.note || null }).where(eq(adSpend.id, id)).returning();
    if (!row) throw notFound();
    return row;
  });

  app.delete('/ads/:id', manage, async (req) => {
    const { id } = idParams.parse(req.params);
    await app.db.delete(adSpend).where(eq(adSpend.id, id));
    return { ok: true };
  });
};
