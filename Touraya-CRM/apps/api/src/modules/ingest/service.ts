import { eq, inArray } from 'drizzle-orm';
import {
  humanizeAnswer,
  matchCommune,
  matchWilaya,
  normalizeText,
  parseLeadDate,
  parseLeadRow,
  resolvePhone,
  type IngestPayload,
  type LeadValues,
} from '@touraya/shared';
import { startOfDay } from '../../context';
import type { DbOrTx } from '../../db/client';
import { orders, products, sources, type SyncStats } from '../../db/schema';
import { sha1 } from '../../lib/crypto';
import { logEvents } from '../orders/events';

type Source = typeof sources.$inferSelect;
type Product = typeof products.$inferSelect;

export type RowResult =
  | { row: number; result: 'created'; orderId: string; leadId: string }
  | { row: number; result: 'duplicate' | 'skipped'; leadId?: string; reason?: string }
  | { row: number; result: 'error'; message: string };

export interface IngestOptions {
  /** Overrides source.importFrom (legacy imports). */
  importFrom?: string;
  actorId?: number | null;
}

/** Picks the product whose name/alias best matches the offer text; falls back to the source's product. */
export function matchProduct(values: LeadValues, catalog: Product[], fallbackId: number | null): Product | null {
  const texts = [values.offer, values.formName, values.campaignName, values.adName].map(normalizeText).filter(Boolean);
  let best: { product: Product; len: number } | null = null;
  for (const product of catalog) {
    for (const key of [product.name, product.carrierName, ...product.aliases].map(normalizeText)) {
      if (key.length < 4) continue;
      if (texts.some((t) => t === key || t.includes(key)) && (!best || key.length > best.len)) best = { product, len: key.length };
    }
  }
  return best?.product ?? catalog.find((p) => p.id === fallbackId) ?? null;
}

/** Stable identity for rows without a Facebook Lead ID (manual rows) — independent of the row number. */
function syntheticLeadId(source: Source, values: LeadValues): string {
  return `sheet:${sha1([source.spreadsheetId, values.createdAt, values.fullName, values.phoneCustomer, values.phoneFacebook].join('|')).slice(0, 20)}`;
}

function buildOrder(source: Source, sheetName: string, rowNumber: number, raw: Record<string, unknown>, values: LeadValues, catalog: Product[]) {
  const phone = resolvePhone(values.phoneCustomer, values.phoneFacebook);
  const wilaya = matchWilaya(values.wilaya);
  // Legacy forms sometimes carry the commune alone: infer the wilaya from it.
  const commune = matchCommune(values.commune, wilaya?.value.code) ?? (wilaya ? null : matchCommune(values.commune));
  const product = matchProduct(values, catalog, source.productId);
  const quantity = Math.max(1, Number.parseInt(values.quantity ?? '', 10) || 1);

  return {
    phone,
    order: {
      leadId: values.leadId!,
      sourceId: source.id,
      sheetName,
      sheetRow: rowNumber,
      customerName: values.fullName ?? '',
      phone: phone.phone,
      phoneCustomer: phone.customer.raw || null,
      phoneFacebook: phone.facebook.raw || null,
      phoneIssue: phone.issue,
      wilayaCode: wilaya?.value.code ?? commune?.value.wilayaCode ?? null,
      wilayaRaw: values.wilaya ?? null,
      communeName: commune?.value.name ?? null,
      communeRaw: values.commune ?? null,
      address: values.address ?? null,
      productId: product?.id ?? null,
      offerRaw: values.offer ?? values.formName ?? null,
      quantity,
      price: (product?.price ?? 0) * quantity,
      size: humanizeAnswer(values.size) || null,
      colors: humanizeAnswer(values.colors) || null,
      raw: { ...raw, _sheet: sheetName, _row: rowNumber },
      createdAt: parseLeadDate(values.createdAt) ?? new Date(),
    } satisfies typeof orders.$inferInsert,
  };
}

/**
 * Imports lead rows sent by the Google Apps Script (or a legacy CSV import).
 * Idempotent: the Facebook Lead ID is unique, so re-sending rows, moving them
 * from Sheet1 to Sheet2 or running the script twice never duplicates an order.
 * One bad row never stops the batch.
 */
export async function ingestRows(db: DbOrTx, source: Source, payload: IngestPayload, opts: IngestOptions = {}) {
  const importFrom = startOfDay(opts.importFrom ?? source.importFrom);
  const catalog = await db.select().from(products);
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

      const { order, phone } = buildOrder(source, payload.sheetName, rowNumber, raw, values, catalog);
      const [created] = await db.insert(orders).values(order).onConflictDoNothing({ target: orders.leadId }).returning({ id: orders.id });
      existing.add(values.leadId);
      if (!created) {
        results.push({ row: rowNumber, result: 'duplicate', leadId: values.leadId });
        continue;
      }
      await logEvents(db, [
        { orderId: created.id, type: 'created', data: { source: source.name, sheet: payload.sheetName, row: rowNumber, actorId: opts.actorId ?? null } },
        ...(phone.issue ? [{ orderId: created.id, type: 'phone_issue' as const, data: { issue: phone.issue } }] : []),
      ]);
      results.push({ row: rowNumber, result: 'created', orderId: created.id, leadId: values.leadId });
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

  return { ...stats, results };
}
