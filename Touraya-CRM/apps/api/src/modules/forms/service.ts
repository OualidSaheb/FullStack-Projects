import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import {
  formIdentity,
  funnelOf,
  normalizeText,
  parseLeadRow,
  QUEUE_STATUSES,
  type FieldMap,
  type FormDTO,
  type FormUpdate,
  type LeadValues,
  type OrderStatus,
} from '@touraya/shared';
import type { DbOrTx } from '../../db/client';
import { forms, offers, orders, sources } from '../../db/schema';
import { notFound } from '../../lib/errors';
import { logEvents } from '../orders/events';
import { draftOfferItems, replaceItems } from '../orders/items';

export type FormRow = typeof forms.$inferSelect;
type SourceRow = typeof sources.$inferSelect;
type OfferRow = typeof offers.$inferSelect;

/** Where a lead was read: the file and tab (Drive folder script) or the source itself. */
export interface LeadOrigin {
  spreadsheetId: string;
  spreadsheetName: string;
  sheetName: string;
}

/**
 * The offer whose name (or coded name, or one of its other names) appears in
 * one of the texts; the longest match wins ("skirt 2pcs 3600 - test B" → "skirt 2pcs 3600").
 */
export function offerByText(texts: (string | undefined)[], catalog: OfferRow[]): OfferRow | null {
  const normalized = texts.map(normalizeText).filter(Boolean);
  let best: { offer: OfferRow; len: number } | null = null;
  for (const offer of catalog) {
    for (const key of [offer.name, offer.carrierName, ...offer.aliases].map(normalizeText)) {
      if (key.length < 4) continue;
      if (normalized.some((t) => t === key || t.includes(key)) && (!best || key.length > best.len)) best = { offer, len: key.length };
    }
  }
  return best?.offer ?? null;
}

/** A form's own question choices on top of the source's (old per-sheet mapping). */
export const mergedFieldMap = (source: Pick<SourceRow, 'fieldMap'> | undefined, form: Pick<FormRow, 'fieldMap'> | undefined): FieldMap => ({
  ...(source?.fieldMap ?? {}),
  ...(form?.fieldMap ?? {}),
});

/**
 * Finds (or creates, the first time it sends a lead) the form of a lead. A new
 * form is linked at once when possible: to the old per-sheet source's offer,
 * else to the offer named in the form / file name. Otherwise it waits in
 * "forms to link" — its leads still come in, without an offer.
 */
export function formResolver(db: DbOrTx, source: SourceRow, catalog: OfferRow[]) {
  const cache = new Map<string, FormRow>();
  return async (values: LeadValues, origin: LeadOrigin): Promise<FormRow> => {
    const id = formIdentity(values, { ...origin, sourceId: source.id, sourceName: source.name });
    const cached = cache.get(id.key);
    if (cached) return cached;
    let [form] = await db.select().from(forms).where(eq(forms.key, id.key));
    if (!form) {
      const byName = source.offerId ? null : offerByText([id.name, origin.spreadsheetName], catalog);
      const offerId = source.offerId ?? byName?.id ?? null;
      [form] = await db
        .insert(forms)
        .values({
          key: id.key,
          name: id.name,
          sourceId: source.id,
          spreadsheetId: origin.spreadsheetId,
          spreadsheetName: origin.spreadsheetName,
          sheetName: origin.sheetName,
          offerId,
          linkedBy: source.offerId ? 'source' : byName ? 'auto' : null,
        })
        .onConflictDoNothing({ target: forms.key })
        .returning();
      form ??= (await db.select().from(forms).where(eq(forms.key, id.key)))[0]!;
    }
    cache.set(id.key, form);
    return form;
  };
}

/**
 * After linking a form to an offer (or changing it): its orders still being
 * called take the offer, its price and pieces. Confirmed / shipped orders and
 * orders an agent already moved to another offer are left as they are.
 */
export async function applyFormOffer(db: DbOrTx, form: FormRow, previousOfferId: number | null, actorId: number | null) {
  if (!form.offerId) return 0;
  const [offer] = await db.select().from(offers).where(eq(offers.id, form.offerId));
  if (!offer) return 0;
  const rows = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.formId, form.id),
        isNull(orders.deletedAt),
        eq(orders.stockOut, false),
        inArray(orders.status, QUEUE_STATUSES),
        previousOfferId ? or(isNull(orders.offerId), eq(orders.offerId, previousOfferId)) : isNull(orders.offerId),
      ),
    );
  let updated = 0;
  for (const order of rows) {
    if (order.offerId === offer.id) continue;
    await db.update(orders).set({ offerId: offer.id, price: offer.price, updatedAt: new Date() }).where(eq(orders.id, order.id));
    await replaceItems(db, order.id, await draftOfferItems(db, offer.id, order));
    await logEvents(db, {
      orderId: order.id,
      type: 'updated',
      actorId,
      data: { changes: { offerId: [order.offerId, offer.id], price: [order.price, offer.price] }, via: 'form_link' },
    });
    updated++;
  }
  return updated;
}

export async function listForms(db: DbOrTx): Promise<FormDTO[]> {
  const [rows, counts] = await Promise.all([
    db.select().from(forms).where(isNull(forms.archivedAt)).orderBy(sql`${forms.lastLeadAt} desc nulls last`, forms.id),
    db
      .select({ formId: orders.formId, status: orders.status, n: sql<number>`count(*)::int` })
      .from(orders)
      .where(and(isNull(orders.deletedAt), isNotNull(orders.formId)))
      .groupBy(orders.formId, orders.status),
  ]);
  const byForm = new Map<number, Partial<Record<OrderStatus, number>>>();
  for (const c of counts) {
    const m = byForm.get(c.formId!) ?? {};
    m[c.status] = c.n;
    byForm.set(c.formId!, m);
  }
  return rows.map((f) => toFormDTO(f, byForm.get(f.id) ?? {}));
}

export function toFormDTO(f: FormRow, counts: Partial<Record<OrderStatus, number>>): FormDTO {
  return {
    id: f.id,
    name: f.name,
    sourceId: f.sourceId,
    spreadsheetId: f.spreadsheetId,
    spreadsheetName: f.spreadsheetName,
    sheetName: f.sheetName,
    offerId: f.offerId,
    linkedBy: f.linkedBy,
    fieldMap: f.fieldMap,
    lastHeaders: f.lastHeaders,
    lastLeadAt: f.lastLeadAt?.toISOString() ?? null,
    stats: funnelOf(counts),
  };
}

/** Same funnel for each ad that sent leads to this form — which creative brings real customers. */
export async function formAds(db: DbOrTx, formId: number) {
  const counts = await db
    .select({ ad: orders.adName, status: orders.status, n: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(eq(orders.formId, formId), isNull(orders.deletedAt)))
    .groupBy(orders.adName, orders.status);
  const byAd = new Map<string, Partial<Record<OrderStatus, number>>>();
  for (const c of counts) {
    const key = c.ad ?? '';
    const m = byAd.get(key) ?? {};
    m[c.status] = c.n;
    byAd.set(key, m);
  }
  return [...byAd.entries()].map(([ad, m]) => ({ ad: ad || null, stats: funnelOf(m) })).sort((a, b) => b.stats.leads - a.stats.leads);
}

export async function updateForm(db: DbOrTx, id: number, input: FormUpdate, actorId: number) {
  const [form] = await db.select().from(forms).where(eq(forms.id, id));
  if (!form) throw notFound('الفورم غير موجود');
  const offerChanged = input.offerId !== undefined && input.offerId !== form.offerId;
  const [next] = await db
    .update(forms)
    .set({
      ...(offerChanged ? { offerId: input.offerId, linkedBy: input.offerId ? ('manual' as const) : null } : {}),
      ...(input.fieldMap ? { fieldMap: input.fieldMap } : {}),
      updatedAt: new Date(),
    })
    .where(eq(forms.id, id))
    .returning();
  const relinked = offerChanged ? await applyFormOffer(db, next!, form.offerId, actorId) : 0;
  return { form: next!, relinked };
}

/**
 * Orders imported before forms existed get their form (and ad name) once,
 * at start-up: statistics per form then cover the whole history. Idempotent.
 */
export async function backfillForms(db: DbOrTx) {
  const allSources = await db.select().from(sources);
  const catalog = await db.select().from(offers).where(eq(offers.active, true));
  const resolvers = new Map(allSources.map((s) => [s.id, formResolver(db, s, catalog)]));
  let done = 0;
  for (;;) {
    const rows = await db
      .select({ id: orders.id, raw: orders.raw, sourceId: orders.sourceId, sheetName: orders.sheetName })
      .from(orders)
      .where(and(isNull(orders.formId), isNotNull(orders.sourceId)))
      .limit(500);
    if (!rows.length) break;
    for (const row of rows) {
      const source = allSources.find((s) => s.id === row.sourceId)!;
      const { values } = parseLeadRow(row.raw, source.fieldMap);
      const origin = {
        spreadsheetId: String(row.raw._file ?? source.spreadsheetId ?? ''),
        spreadsheetName: String(row.raw._fileName ?? (source.type === 'google_sheet' ? source.name : '')),
        sheetName: row.sheetName ?? '',
      };
      const form = await resolvers.get(source.id)!(values, origin);
      await db.update(orders).set({ formId: form.id, adName: values.adName ?? null }).where(eq(orders.id, row.id));
      done++;
    }
  }
  // Last lead time of each form, for the "forms" screen.
  if (done) await db.execute(sql`update forms set last_lead_at = (select max(created_at) from orders where orders.form_id = forms.id) where last_lead_at is null`);
  return done;
}
