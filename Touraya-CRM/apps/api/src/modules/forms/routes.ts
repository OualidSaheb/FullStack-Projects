import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { fieldMapSchema, formUpdateSchema, resolveHeaders, parseLeadRow } from '@touraya/shared';
import { forms, orders, sources } from '../../db/schema';
import { notFound } from '../../lib/errors';
import { reprocessOrders } from '../ingest/service';
import { formAds, listForms, mergedFieldMap, updateForm } from './service';

const idParams = z.object({ id: z.coerce.number().int() });

/**
 * Facebook forms found from the leads: link each one to its offer once,
 * correct how its questions are read, compare forms and ads.
 */
export const formRoutes: FastifyPluginAsync = async (app) => {
  const manage = { preHandler: app.requirePermission('sources.manage') };

  app.get('/forms', { preHandler: app.requireAuth }, async () => listForms(app.db));

  app.get('/forms/:id/ads', manage, async (req) => formAds(app.db, idParams.parse(req.params).id));

  app.put('/forms/:id', manage, async (req) => {
    const { id } = idParams.parse(req.params);
    const input = formUpdateSchema.parse(req.body);
    const { form, relinked } = await app.db.transaction((tx) => updateForm(tx, id, input, req.user.id));
    let refilled = 0;
    if (input.fieldMap) {
      // New question choices: fill the still-empty fields of this form's orders from their answers.
      const [source] = form.sourceId ? await app.db.select().from(sources).where(eq(sources.id, form.sourceId)) : [];
      const rows = await app.db.select().from(orders).where(and(eq(orders.formId, id), isNull(orders.deletedAt), eq(orders.stockOut, false)));
      refilled = (await reprocessOrders(app.db, rows, async () => mergedFieldMap(source, form), req.user.id)).updated;
    }
    return { relinked, refilled };
  });

  /** Archive: hidden from the list (comes back if it sends leads again). Its orders stay. */
  app.delete('/forms/:id', manage, async (req) => {
    const { id } = idParams.parse(req.params);
    const [f] = await app.db.update(forms).set({ archivedAt: new Date() }).where(eq(forms.id, id)).returning({ id: forms.id });
    if (!f) throw notFound();
    return { ok: true };
  });

  /** Which question feeds each field, with a real answer of this form as example. */
  app.post('/forms/:id/preview-mapping', manage, async (req) => {
    const { id } = idParams.parse(req.params);
    const body = z.object({ fieldMap: fieldMapSchema.optional() }).parse(req.body ?? {});
    const [form] = await app.db.select().from(forms).where(eq(forms.id, id));
    if (!form) throw notFound();
    const [source] = form.sourceId ? await app.db.select().from(sources).where(eq(sources.id, form.sourceId)) : [];
    const map = mergedFieldMap(source, { fieldMap: body.fieldMap ?? form.fieldMap });
    const [last] = await app.db.select({ raw: orders.raw }).from(orders).where(eq(orders.formId, id)).orderBy(desc(orders.createdAt)).limit(1);
    const sample = Object.fromEntries(Object.entries(last?.raw ?? {}).filter(([k]) => !k.startsWith('_')));
    const headers = form.lastHeaders.length ? form.lastHeaders : Object.keys(sample);
    if (!last) return { headers, mapping: resolveHeaders(headers, map), inferred: [], sample: {} };
    const parsed = parseLeadRow(sample, map);
    return { headers, mapping: parsed.matchedHeaders, inferred: parsed.inferred, sample };
  });
};
