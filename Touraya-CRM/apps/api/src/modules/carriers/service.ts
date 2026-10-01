import { and, asc, eq } from 'drizzle-orm';
import type { CarrierDTO, CarrierInput, CarrierRateDTO, DeliveryType } from '@touraya/shared';
import type { DbOrTx } from '../../db/client';
import { carrierRates, carriers } from '../../db/schema';
import type { SecretBox } from '../../lib/crypto';
import { badRequest, notFound } from '../../lib/errors';
import type { LoadedCarrier } from './types';

type CarrierRow = typeof carriers.$inferSelect;

function openCredentials(box: SecretBox, sealed: string): LoadedCarrier['credentials'] {
  try {
    return { apiId: '', apiToken: '', ...JSON.parse(box.open(sealed) || '{}') };
  } catch {
    return { apiId: '', apiToken: '' };
  }
}

export function loadCarrierRow(box: SecretBox, row: CarrierRow): LoadedCarrier {
  return { id: row.id, name: row.name, provider: row.provider, apiEnabled: row.apiEnabled, credentials: openCredentials(box, row.credentials), config: row.config };
}

/** The carrier by id, or the default one. */
export async function getCarrier(db: DbOrTx, box: SecretBox, id?: number | null): Promise<LoadedCarrier> {
  const [row] = id
    ? await db.select().from(carriers).where(eq(carriers.id, id))
    : await db.select().from(carriers).where(and(eq(carriers.active, true), eq(carriers.isDefault, true))).limit(1);
  const fallback = row ?? (id ? undefined : (await db.select().from(carriers).where(eq(carriers.active, true)).orderBy(asc(carriers.id)).limit(1))[0]);
  if (!fallback) throw id ? notFound('شركة التوصيل غير موجودة') : badRequest('أضف شركة توصيل في الإعدادات');
  return loadCarrierRow(box, fallback);
}

/** Secrets never leave the server: the token is blanked, only its presence is reported. */
export function toCarrierDTO(box: SecretBox, row: CarrierRow): CarrierDTO {
  const creds = openCredentials(box, row.credentials);
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    active: row.active,
    isDefault: row.isDefault,
    apiEnabled: row.apiEnabled,
    hasCredentials: Boolean(creds.apiId && creds.apiToken),
    credentials: { apiId: creds.apiId, apiToken: '' },
    config: row.config,
  };
}

export async function saveCarrier(db: DbOrTx, box: SecretBox, input: CarrierInput, id?: number) {
  const current = id ? (await db.select().from(carriers).where(eq(carriers.id, id)))[0] : undefined;
  if (id && !current) throw notFound();
  const old = current ? openCredentials(box, current.credentials) : { apiId: '', apiToken: '' };
  // Empty token from the UI keeps the stored one.
  const credentials = box.seal(JSON.stringify({ apiId: input.credentials.apiId || old.apiId, apiToken: input.credentials.apiToken || old.apiToken }));
  const values = { name: input.name, provider: input.provider, active: input.active, isDefault: input.isDefault, apiEnabled: input.apiEnabled, credentials, config: input.config };
  if (input.isDefault) await db.update(carriers).set({ isDefault: false });
  const [row] = id
    ? await db.update(carriers).set({ ...values, updatedAt: new Date() }).where(eq(carriers.id, id)).returning()
    : await db.insert(carriers).values(values).returning();
  return row!;
}

export async function getRates(db: DbOrTx, carrierId: number): Promise<CarrierRateDTO[]> {
  return db
    .select({ wilayaCode: carrierRates.wilayaCode, homeFee: carrierRates.homeFee, deskFee: carrierRates.deskFee })
    .from(carrierRates)
    .where(eq(carrierRates.carrierId, carrierId))
    .orderBy(carrierRates.wilayaCode);
}

export async function saveRates(db: DbOrTx, carrierId: number, rates: CarrierRateDTO[]) {
  await db.delete(carrierRates).where(eq(carrierRates.carrierId, carrierId));
  const rows = rates.filter((r) => r.homeFee !== null || r.deskFee !== null);
  if (rows.length) await db.insert(carrierRates).values(rows.map((r) => ({ ...r, carrierId })));
}

/** Delivery price the customer pays — the agent announces "price + delivery" during the call. */
export async function deliveryFee(db: DbOrTx, carrierId: number | null, wilayaCode: number | null, type: DeliveryType): Promise<number | null> {
  if (!wilayaCode) return null;
  const id = carrierId ?? (await db.select({ id: carriers.id }).from(carriers).where(eq(carriers.isDefault, true)).limit(1))[0]?.id;
  if (!id) return null;
  const [rate] = await db.select().from(carrierRates).where(and(eq(carrierRates.carrierId, id), eq(carrierRates.wilayaCode, wilayaCode)));
  return (type === 'stopdesk' ? rate?.deskFee : rate?.homeFee) ?? null;
}
