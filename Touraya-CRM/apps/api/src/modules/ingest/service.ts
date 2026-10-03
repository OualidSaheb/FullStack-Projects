import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  humanizeAnswer,
  parseLeadDate,
  parseLeadRow,
  QUEUE_STATUSES,
  resolveLocation,
  resolvePhone,
  type FieldMap,
  type IngestPayload,
  type LeadValues,
  type Settings,
} from '@touraya/shared';
import { startOfDay } from '../../context';
import type { DbOrTx } from '../../db/client';
import { forms, offers, orderItems, orders, sources, users, type SyncStats } from '../../db/schema';
import { sha1 } from '../../lib/crypto';
import { findRecentOpenOrder, upsertCustomer } from '../customers/service';
import { logEvents } from '../orders/events';
import { draftOfferItems, replaceItems } from '../orders/items';
import { getSettings } from '../settings/service';
import { formResolver, mergedFieldMap, offerByText, type FormRow, type LeadOrigin } from '../forms/service';

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
 * 2. the offer the form is linked to (each Facebook form sells one offer);
 * 3. the form / campaign / ad names, only while the form is not linked.
 * (Ad and campaign names are often reused or copied, so they must never override the link.)
 */
export function matchOffer(values: LeadValues, catalog: Offer[], fallbackId: number | null): Offer | null {
  return offerByText([values.offer], catalog) ?? catalog.find((o) => o.id === fallbackId) ?? offerByText([values.formName, values.campaignName, values.adName], catalog);
}

/** Stable identity for rows without a Facebook Lead ID — independent of the row number. */
function syntheticLeadId(source: Source, origin: LeadOrigin, values: LeadValues): string {
  return `sheet:${sha1([origin.spreadsheetId || source.spreadsheetId || source.id, values.createdAt, values.fullName, values.phoneCustomer, values.phoneFacebook].join('|')).slice(0, 20)}`;
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
export async function ingestRows(db: DbOrTx, source: Source, payload: IngestPayload & { spreadsheetId?: string }, opts: IngestOptions = {}) {
  const importFrom = startOfDay(opts.importFrom ?? source.importFrom);
  const [catalog, settings] = await Promise.all([db.select().from(offers).where(eq(offers.active, true)), getSettings(db)]);
  const nextAgent = await agentPicker(db, settings);
  const origin: LeadOrigin = {
    spreadsheetId: source.type === 'google_drive' ? payload.spreadsheetId ?? '' : source.spreadsheetId,
    spreadsheetName: source.type === 'google_drive' ? payload.spreadsheetName ?? '' : source.type === 'google_sheet' ? source.name : '',
    sheetName: payload.sheetName,
  };
  const formOf = formResolver(db, source, catalog);
  const parsed = [];
  for (const r of payload.rows) {
    let { values } = parseLeadRow(r.values, source.fieldMap);
    // Rows that are not leads (notes, empty lines, other tabs of the file) never create a form.
    if (!values.leadId && !values.phoneCustomer && !values.phoneFacebook) {
      parsed.push({ rowNumber: r.rowNumber, raw: r.values, values, form: null });
      continue;
    }
    const form = await formOf(values, origin);
    // The form's own question choices (set in "forms") refine the reading.
    if (Object.keys(form.fieldMap).length) values = parseLeadRow(r.values, mergedFieldMap(source, form)).values;
    if (!values.leadId && (values.phoneCustomer || values.phoneFacebook)) values.leadId = syntheticLeadId(source, origin, values);
    parsed.push({ rowNumber: r.rowNumber, raw: r.values, values, form });
  }

  const leadIds = parsed.map((p) => p.values.leadId).filter((id): id is string => Boolean(id));
  const existing = new Set(
    leadIds.length ? (await db.select({ leadId: orders.leadId }).from(orders).where(inArray(orders.leadId, leadIds))).map((r) => r.leadId) : [],
  );

  const results: RowResult[] = [];
  const touched = new Map<number, Date>();
  for (const { rowNumber, raw, values, form } of parsed) {
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

      if (!form) throw new Error('form');
      const created = await createOrderFromLead(db, { source, form, origin, rowNumber, raw, values, catalog, settings, assignTo: nextAgent });
      if (!created) {
        results.push({ row: rowNumber, result: 'duplicate', leadId: values.leadId });
        continue;
      }
      const at = parseLeadDate(values.createdAt) ?? new Date();
      if (at > (touched.get(form.id) ?? new Date(0))) touched.set(form.id, at);
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
  // Forms that sent new leads: last lead time and question titles; an archived form comes back.
  for (const [formId, at] of touched) {
    const row = parsed.find((p) => p.form?.id === formId)!;
    const form = row.form!;
    await db
      .update(forms)
      .set({ lastLeadAt: form.lastLeadAt && form.lastLeadAt > at ? form.lastLeadAt : at, lastHeaders: Object.keys(row.raw), archivedAt: null })
      .where(eq(forms.id, formId));
  }
  await db
    .update(sources)
    .set({ lastSyncAt: new Date(), lastSyncStats: stats, ...(headers.length ? { lastHeaders: headers } : {}) })
    .where(eq(sources.id, source.id));

  return { ...stats, results, createdIds: results.flatMap((r) => (r.result === 'created' ? [r.orderId] : [])) };
}

async function createOrderFromLead(
  db: DbOrTx,
  input: { source: Source; form: FormRow; origin: LeadOrigin; rowNumber: number; raw: Record<string, unknown>; values: LeadValues; catalog: Offer[]; settings: Settings; assignTo: () => number | null },
): Promise<string | null> {
  const { source, form, origin, values, settings } = input;
  const sheetName = origin.sheetName;
  const phone = resolvePhone(values.phoneCustomer, values.phoneFacebook);
  // Own answers first, then the address (legacy forms often have one free-text location field).
  const location = resolveLocation(values);
  const offer = matchOffer(values, input.catalog, form.offerId ?? source.offerId);
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
      formId: form.id,
      adName: values.adName ?? null,
      sheetName,
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
      raw: {
        ...input.raw,
        _sheet: sheetName,
        _row: input.rowNumber,
        ...(source.type === 'google_drive' ? { _file: origin.spreadsheetId, _fileName: origin.spreadsheetName } : {}),
      },
      createdAt,
    })
    .onConflictDoNothing({ target: orders.leadId })
    .returning({ id: orders.id });
  if (!created) return null;

  await replaceItems(db, created.id, await draftOfferItems(db, offer?.id ?? null, { size, colors }));
  await logEvents(db, [
    { orderId: created.id, type: 'created', data: { source: origin.spreadsheetName || source.name, sheet: sheetName, row: input.rowNumber, form: form.name } },
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
  return reprocessOrders(db, rows, async (order) => {
    if (!order.formId) return source.fieldMap;
    const [form] = await db.select({ fieldMap: forms.fieldMap }).from(forms).where(eq(forms.id, order.formId));
    return mergedFieldMap(source, form);
  }, actorId);
}

/** Re-reads the form answers of these orders and fills their empty fields (see reprocessSource). */
export async function reprocessOrders(db: DbOrTx, rows: (typeof orders.$inferSelect)[], fieldMapFor: (order: typeof orders.$inferSelect) => Promise<FieldMap>, actorId: number) {
  let updated = 0;
  for (const order of rows) {
    const { values } = parseLeadRow(order.raw, await fieldMapFor(order));
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
