import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  humanizeAnswer,
  normalizeText,
  parseLeadDate,
  parseLeadRow,
  QUEUE_STATUSES,
  resolveLocation,
  resolvePhone,
  type IngestPayload,
  type LeadValues,
  type Settings,
} from '@touraya/shared';
import { startOfDay } from '../../context';
import type { DbOrTx } from '../../db/client';
import { offers, orderItems, orders, sources, users, type SyncStats } from '../../db/schema';
import { sha1 } from '../../lib/crypto';
import { findRecentOpenOrder, upsertCustomer } from '../customers/service';
import { logEvents } from '../orders/events';
import { draftOfferItems, replaceItems } from '../orders/items';
import { getSettings } from '../settings/service';

type Source = typeof sources.$inferSelect;
type Offer = typeof offers.$inferSelect;

export type RowResult =
  | { row: number; result: 'created'; orderId: string; leadId: string }
  | { row: number; result: 'duplicate' | 'skipped'; leadId?: string; reason?: string }
  | { row: number; result: 'error'; message: string };

export interface IngestOptions {
  /** Overrides source.importFrom (legacy imports). */
  importFrom?: string;
  actorId?: number | null;
}

/**
 * Which offer a lead is for, in this order:
 * 1. the offer the customer picked in the form (an "offer" question), when it matches;
 * 2. the source's default offer — each sheet/form normally sells one offer;
 * 3. the form / campaign / ad names, only when the source has no default offer.
 * (Ad and campaign names are often reused or copied, so they must never override the source.)
 */
export function matchOffer(values: LeadValues, catalog: Offer[], fallbackId: number | null): Offer | null {
  const byText = (texts: (string | undefined)[]) => {
    const normalized = texts.map(normalizeText).filter(Boolean);
    let best: { offer: Offer; len: number } | null = null;
    for (const offer of catalog) {
      for (const key of [offer.name, offer.carrierName, ...offer.aliases].map(normalizeText)) {
        if (key.length < 4) continue;
        if (normalized.some((t) => t === key || t.includes(key)) && (!best || key.length > best.len)) best = { offer, len: key.length };
      }
    }
    return best?.offer ?? null;
  };
  return byText([values.offer]) ?? catalog.find((o) => o.id === fallbackId) ?? byText([values.formName, values.campaignName, values.adName]);
}

/** Stable identity for rows without a Facebook Lead ID — independent of the row number. */
function syntheticLeadId(source: Source, values: LeadValues): string {
  return `sheet:${sha1([source.spreadsheetId || source.id, values.createdAt, values.fullName, values.phoneCustomer, values.phoneFacebook].join('|')).slice(0, 20)}`;
}

/** "Balanced" assignment: each new order goes to the active agent with the fewest open orders. */
async function agentPicker(db: DbOrTx, settings: Settings) {
  if (settings.assignment !== 'balanced') return () => null;
  const load = await db
    .select({ id: users.id, open: sql<number>`(select count(*)::int from orders o where o.assigned_to_id = "users"."id" and o.deleted_at is null and o.status in (${sql.join(QUEUE_STATUSES.map((s) => sql`${s}`), sql`, `)}))` })
    .from(users)
    .where(and(eq(users.role, 'agent'), eq(users.active, true)));
  return () => {
    const next = load.sort((a, b) => a.open - b.open)[0];
    if (!next) return null;
    next.open++;
    return next.id;
  };
}

/**
 * Imports lead rows from the Google Apps Script, a webhook or a CSV import.
 * Idempotent: the Facebook Lead ID is unique, so re-sending rows, moving them
 * between tabs or running the script twice never duplicates an order.
 * One bad row never stops the batch.
 */
export async function ingestRows(db: DbOrTx, source: Source, payload: IngestPayload, opts: IngestOptions = {}) {
  const importFrom = startOfDay(opts.importFrom ?? source.importFrom);
  const [catalog, settings] = await Promise.all([db.select().from(offers).where(eq(offers.active, true)), getSettings(db)]);
  const nextAgent = await agentPicker(db, settings);
  const parsed = payload.rows.map((r) => {
    const { values } = parseLeadRow(r.values, source.fieldMap);
    if (!values.leadId && (values.phoneCustomer || values.phoneFacebook)) values.leadId = syntheticLeadId(source, values);
    return { rowNumber: r.rowNumber, raw: r.values, values };
  });

  const leadIds = parsed.map((p) => p.values.leadId).filter((id): id is string => Boolean(id));
  const existing = new Set(
    leadIds.length ? (await db.select({ leadId: orders.leadId }).from(orders).where(inArray(orders.leadId, leadIds))).map((r) => r.leadId) : [],
  );

  const results: RowResult[] = [];
  for (const { rowNumber, raw, values } of parsed) {
    try {
      if (!values.leadId) {
        results.push({ row: rowNumber, result: 'skipped', reason: 'empty_row' });
        continue;
      }
      if (existing.has(values.leadId)) {
        results.push({ row: rowNumber, result: 'duplicate', leadId: values.leadId });
        continue;
      }
      const leadDate = parseLeadDate(values.createdAt);
      if (leadDate && leadDate < importFrom) {
        results.push({ row: rowNumber, result: 'skipped', leadId: values.leadId, reason: 'before_import_date' });
        continue;
      }
      existing.add(values.leadId);

      const created = await createOrderFromLead(db, { source, sheetName: payload.sheetName, rowNumber, raw, values, catalog, settings, assignTo: nextAgent });
      if (!created) {
        results.push({ row: rowNumber, result: 'duplicate', leadId: values.leadId });
        continue;
      }
      results.push({ row: rowNumber, result: 'created', orderId: created, leadId: values.leadId });
    } catch (err) {
      results.push({ row: rowNumber, result: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  const stats: SyncStats = {
    at: new Date().toISOString(),
    received: payload.rows.length,
    created: results.filter((r) => r.result === 'created').length,
    duplicates: results.filter((r) => r.result === 'duplicate').length,
    skipped: results.filter((r) => r.result === 'skipped').length,
    errors: results.flatMap((r) => (r.result === 'error' ? [{ row: r.row, sheet: payload.sheetName, message: r.message }] : [])),
  };
  const headers = Object.keys(payload.rows[0]?.values ?? {});
  await db
    .update(sources)
    .set({ lastSyncAt: new Date(), lastSyncStats: stats, ...(headers.length ? { lastHeaders: headers } : {}) })
    .where(eq(sources.id, source.id));

  return { ...stats, results, createdIds: results.flatMap((r) => (r.result === 'created' ? [r.orderId] : [])) };
}

async function createOrderFromLead(
  db: DbOrTx,
  input: { source: Source; sheetName: string; rowNumber: number; raw: Record<string, unknown>; values: LeadValues; catalog: Offer[]; settings: Settings; assignTo: () => number | null },
): Promise<string | null> {
  const { source, values, settings } = input;
  const phone = resolvePhone(values.phoneCustomer, values.phoneFacebook);
  // Own answers first, then the address (legacy forms often have one free-text location field).
  const location = resolveLocation(values);
  const offer = matchOffer(values, input.catalog, source.offerId);
  const customerName = values.fullName ?? '';
  const size = humanizeAnswer(values.size) || null;
  const colors = humanizeAnswer(values.colors) || null;
  const createdAt = parseLeadDate(values.createdAt) ?? new Date();

  const customerId = await upsertCustomer(db, phone.phone, customerName);
  const duplicateOfId =
    customerId && settings.duplicateWindowDays > 0
      ? await findRecentOpenOrder(db, customerId, new Date(createdAt.getTime() - settings.duplicateWindowDays * 86400_000))
      : null;

  const [created] = await db
    .insert(orders)
    .values({
      leadId: values.leadId!,
      sourceId: source.id,
      sheetName: input.sheetName,
      sheetRow: input.rowNumber,
      customerId,
      customerName,
      phone: phone.phone,
      phoneCustomer: phone.customer.raw || null,
      phoneFacebook: phone.facebook.raw || null,
      phoneIssue: phone.issue,
      duplicateOfId,
      wilayaCode: location.wilayaCode,
      wilayaRaw: values.wilaya ?? null,
      communeName: location.communeName,
      communeRaw: values.commune ?? null,
      address: values.address ?? null,
      offerId: offer?.id ?? null,
      offerRaw: values.offer ?? values.formName ?? null,
      price: offer?.price ?? 0,
      size,
      colors,
      assignedToId: input.assignTo(),
      raw: { ...input.raw, _sheet: input.sheetName, _row: input.rowNumber },
      createdAt,
    })
    .onConflictDoNothing({ target: orders.leadId })
    .returning({ id: orders.id });
  if (!created) return null;

  await replaceItems(db, created.id, await draftOfferItems(db, offer?.id ?? null, { size, colors }));
  await logEvents(db, [
    { orderId: created.id, type: 'created', data: { source: source.name, sheet: input.sheetName, row: input.rowNumber } },
    ...(phone.issue ? [{ orderId: created.id, type: 'phone_issue' as const, data: { issue: phone.issue } }] : []),
  ]);
  return created.id;
}


/**
 * Re-reads the original form answers of a source's orders with the current
 * column mapping (after fixing "أسئلة الفورم") and fills ONLY the fields that
 * are still empty — anything an agent set or corrected is never overwritten.
 * Orders whose goods already left the warehouse are skipped.
 */
export async function reprocessSource(db: DbOrTx, source: Source, actorId: number) {
  const rows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.sourceId, source.id), isNull(orders.deletedAt), eq(orders.stockOut, false)));
  let updated = 0;
  for (const order of rows) {
    const { values } = parseLeadRow(order.raw, source.fieldMap);
    const location = resolveLocation(values);
    const size = humanizeAnswer(values.size) || null;
    const colors = humanizeAnswer(values.colors) || null;
    const candidate: Partial<typeof orders.$inferInsert> = {
      customerName: order.customerName || values.fullName || '',
      wilayaCode: order.wilayaCode ?? location.wilayaCode,
      communeName: order.communeName ?? (order.wilayaCode && location.wilayaCode !== order.wilayaCode ? null : location.communeName),
      wilayaRaw: order.wilayaRaw ?? values.wilaya ?? null,
      communeRaw: order.communeRaw ?? values.commune ?? null,
      address: order.address ?? values.address ?? null,
      size: order.size ?? size,
      colors: order.colors ?? colors,
    };
    const changes = Object.fromEntries(
      Object.entries(candidate).filter(([k, v]) => v !== (order as Record<string, unknown>)[k]).map(([k, v]) => [k, [(order as Record<string, unknown>)[k], v]]),
    );
    if (!Object.keys(changes).length) continue;
    await db.update(orders).set({ ...candidate, updatedAt: new Date() }).where(eq(orders.id, order.id));
    // New size/color answers: re-draft pieces that were not identified yet.
    if ((changes.size || changes.colors) && order.offerId) {
      const items = await db.select({ variantId: orderItems.variantId }).from(orderItems).where(eq(orderItems.orderId, order.id));
      if (items.every((i) => i.variantId === null)) await replaceItems(db, order.id, await draftOfferItems(db, order.offerId, { size: candidate.size, colors: candidate.colors }));
    }
    await logEvents(db, { orderId: order.id, type: 'updated', actorId, data: { changes, via: 'reprocess' } });
    updated++;
  }
  return { checked: rows.length, updated };
}
