import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq, or } from 'drizzle-orm';
import { getWilaya, splitName, statusFromYalidine, type Settings } from '@touraya/shared';
import { parseReference, type AppContext } from '../../context';
import { orders } from '../../db/schema';
import type { SessionUser } from '../../lib/auth';
import { badRequest, unprocessable } from '../../lib/errors';
import { logEvents } from '../orders/events';
import { getSettings } from '../settings/service';
import { carrierProblems, loadCarrierOrders, type CarrierOrder } from './service';

type YalidineConfig = Settings['yalidine'];

export class CarrierError extends Error {
  constructor(message: string, public details: Record<string, unknown>) {
    super(message);
  }
}

/**
 * Explains the error in plain words. Yalidine returned "403 / error code 1106" from
 * Cloudflare: the request is blocked before reaching the API (API not enabled for
 * the account or IP not allowed). A relay server with a fixed IP can be set as base URL.
 */
function describeFailure(status: number, body: string): string {
  if (status === 403 && /1106|cloudflare/i.test(body))
    return 'Yalidine رفض الطلب (403 / Cloudflare 1106): الـ API غير مفعل للحساب أو عنوان IP غير مسموح. راسل Yalidine أو استعمل Relay بعنوان IP ثابت.';
  if (status === 401) return 'API ID أو API TOKEN غير صحيح';
  if (status === 429) return 'تجاوزت حد الطلبات في Yalidine، أعد المحاولة بعد دقيقة';
  return `خطأ من Yalidine (HTTP ${status})`;
}

async function call(cfg: YalidineConfig, path: string, init: RequestInit = {}) {
  if (!cfg.apiId || !cfg.apiToken) throw badRequest('أدخل API ID و API TOKEN في إعدادات Yalidine');
  const res = await fetch(`${cfg.apiBaseUrl.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: { 'X-API-ID': cfg.apiId, 'X-API-TOKEN': cfg.apiToken, 'Content-Type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new CarrierError(describeFailure(res.status, text), {
      status: res.status,
      cfRay: res.headers.get('cf-ray'),
      body: text.slice(0, 500),
    });
  }
  return text ? JSON.parse(text) : null;
}

/** Diagnostic used by the settings page ("اختبار الاتصال"). */
export async function testYalidine(ctx: AppContext) {
  const { yalidine } = await getSettings(ctx.db, ctx.secrets);
  try {
    await call(yalidine, '/wilayas/?page_size=1');
    return { ok: true as const };
  } catch (err) {
    if (err instanceof CarrierError) return { ok: false as const, message: err.message, ...err.details };
    return { ok: false as const, message: err instanceof Error ? err.message : String(err) };
  }
}

function toParcel(o: CarrierOrder, cfg: YalidineConfig) {
  const [firstname, familyname] = splitName(o.customerName);
  return {
    order_id: o.reference,
    from_wilaya_name: cfg.fromWilayaName,
    firstname,
    familyname,
    contact_phone: [o.phone, o.phoneAlt].filter(Boolean).join(','),
    address: o.address || o.communeName,
    to_commune_name: o.communeName,
    to_wilaya_name: getWilaya(o.wilayaCode)?.name,
    product_list: o.productCarrierName,
    price: o.price,
    do_insurance: false,
    declared_value: o.price,
    length: 0,
    width: 0,
    height: 0,
    weight: 0,
    freeshipping: false,
    is_stopdesk: false,
    has_exchange: false,
  };
}

/** Creates parcels through the API. Every attempt (success or error) lands in the order activity log. */
export async function sendToYalidine(ctx: AppContext, ids: string[], user: SessionUser) {
  const { yalidine } = await getSettings(ctx.db, ctx.secrets);
  if (!yalidine.enabled) throw badRequest('الإرسال عبر API غير مفعل — استعمل ملف التوصيل');

  const list = await loadCarrierOrders(ctx.db, ids, ctx.config.ORDER_PREFIX);
  const invalid = list.map((o) => ({ id: o.id, reference: o.reference, errors: carrierProblems(o) })).filter((o) => o.errors.length);
  if (invalid.length) throw unprocessable('بعض الطلبيات غير جاهزة للتوصيل', { invalid });

  let response: Record<string, { success?: boolean; tracking?: string; message?: string }>;
  try {
    response = await call(yalidine, '/parcels/', { method: 'POST', body: JSON.stringify(list.map((o) => toParcel(o, yalidine))) });
  } catch (err) {
    const details = err instanceof CarrierError ? { message: err.message, ...err.details } : { message: String(err) };
    await logEvents(ctx.db, list.map((o) => ({ orderId: o.id, type: 'carrier_error' as const, actorId: user.id, data: details })));
    throw unprocessable(details.message as string, details);
  }

  const results = [];
  for (const o of list) {
    const r = response?.[o.reference];
    if (r?.success && r.tracking) {
      await ctx.db.update(orders).set({ status: 'sent_to_carrier', carrierTracking: r.tracking, updatedAt: new Date() }).where(eq(orders.id, o.id));
      await logEvents(ctx.db, [
        { orderId: o.id, type: 'carrier_sent', actorId: user.id, data: { tracking: r.tracking } },
        { orderId: o.id, type: 'status_changed', actorId: user.id, data: { from: o.status, to: 'sent_to_carrier' } },
      ]);
      results.push({ id: o.id, reference: o.reference, ok: true, tracking: r.tracking });
    } else {
      const message = r?.message ?? 'لم يتم إنشاء الطرد';
      await logEvents(ctx.db, { orderId: o.id, type: 'carrier_error', actorId: user.id, data: { message } });
      results.push({ id: o.id, reference: o.reference, ok: false, message });
    }
  }
  return { results };
}

export function verifyWebhookSignature(rawBody: string, signature: string | undefined, secret: string): boolean {
  if (!secret) return true; // not configured yet: accept (still logged)
  if (!signature) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

interface WebhookParcelData {
  tracking?: string;
  order_id?: string;
  status?: string;
  last_status?: string;
}

/** Applies parcel_status_updated events to orders (matched by tracking, then by our reference). */
export async function applyYalidineEvents(ctx: AppContext, payload: unknown) {
  const body = payload as { type?: string; events?: { event_type?: string; data?: WebhookParcelData }[]; data?: WebhookParcelData };
  const events = body.events ?? (body.data ? [{ event_type: body.type, data: body.data }] : []);
  let applied = 0;

  for (const e of events) {
    const type = e.event_type ?? body.type;
    const data = e.data ?? {};
    const carrierStatus = data.status ?? data.last_status;
    const number = data.order_id ? parseReference(data.order_id) : null;
    const conds = [data.tracking ? eq(orders.carrierTracking, data.tracking) : undefined, number ? eq(orders.number, number) : undefined].filter(Boolean);
    if (!conds.length) continue;
    const matches = await ctx.db.select({ id: orders.id, status: orders.status }).from(orders).where(or(...conds));
    for (const order of matches) {
      const mapped = type === 'parcel_status_updated' && carrierStatus ? statusFromYalidine(carrierStatus) : null;
      await ctx.db
        .update(orders)
        .set({
          ...(carrierStatus ? { carrierStatus } : {}),
          ...(data.tracking ? { carrierTracking: data.tracking } : {}),
          ...(mapped ? { status: mapped } : {}),
          updatedAt: new Date(),
        })
        .where(eq(orders.id, order.id));
      await logEvents(ctx.db, [
        { orderId: order.id, type: 'carrier_update', data: { event: type, carrierStatus, tracking: data.tracking } },
        ...(mapped && mapped !== order.status ? [{ orderId: order.id, type: 'status_changed' as const, data: { from: order.status, to: mapped, via: 'yalidine' } }] : []),
      ]);
      applied++;
    }
  }
  return applied;
}
