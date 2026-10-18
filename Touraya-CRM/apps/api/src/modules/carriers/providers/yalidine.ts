import { createHmac, timingSafeEqual } from 'node:crypto';
import { getWilaya, splitName, statusFromYalidine, type ExportableOrder } from '@touraya/shared';
import { CarrierError, type CarrierAdapter, type CarrierParcel, type LoadedCarrier, type ParcelResult, type WebhookUpdate } from '../types';

/**
 * Explains failures in plain words. "403 / error code 1106" comes from
 * Cloudflare: the request is blocked before reaching the API (API not enabled
 * for the account, or the server IP is not allowed). A relay with a fixed IP
 * can be configured as the API base URL.
 */
function describeFailure(status: number, body: string, pausedUntil = 0): string {
  if (status === 403 && /1106|cloudflare/i.test(body))
    return 'Yalidine رفض الطلب (403 / Cloudflare 1106): الـ API غير مفعل للحساب أو عنوان IP غير مسموح. راسل Yalidine أو استعمل Relay بعنوان IP ثابت.';
  if (status === 401) return 'API ID أو API TOKEN غير صحيح';
  if (status === 429)
    return `Yalidine أوقف الاتصال مؤقتاً بسبب كثرة الطلبات (حظر مؤقت). المنصة متوقفة عن الاتصال به حتى ${timeDZ(pausedUntil)}، أعد المحاولة بعدها — الإعادة قبل ذلك تطيل الحظر. لم يُرسل شيء.`;
  return `خطأ من Yalidine (HTTP ${status})`;
}

/**
 * Yalidine counts every request (a few per second, ~50 per minute, an hourly
 * and a daily quota) and bans the account for a while when they are exceeded.
 * So, per account: one request at a time, spaced out; the quota it reports is
 * respected; and after a ban the platform stops asking for a while instead of
 * knocking again (which keeps the ban going).
 */
const MIN_GAP_MS = process.env.NODE_ENV === 'test' ? 0 : 1250;
const BAN_PAUSE_MS = 15 * 60_000;
const gates = new Map<string, { queue: Promise<unknown>; last: number; pausedUntil: number }>();

const timeDZ = (t: number) => new Date(t + 3600_000).toISOString().slice(11, 16);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Tests: forget pauses and spacing. */
export const resetYalidineGates = () => gates.clear();

/** The platform is not asking Yalidine right now (after a ban or an exhausted quota): when it will again. */
export function yalidinePausedUntil(c: LoadedCarrier): Date | null {
  const until = gates.get(c.credentials.apiId)?.pausedUntil ?? 0;
  return until > Date.now() ? new Date(until) : null;
}

async function call(c: LoadedCarrier, path: string, init: RequestInit = {}) {
  if (!c.credentials.apiId || !c.credentials.apiToken) throw new CarrierError('أدخل API ID و API TOKEN في إعدادات شركة التوصيل');
  const gate = gates.get(c.credentials.apiId) ?? { queue: Promise.resolve(), last: 0, pausedUntil: 0 };
  gates.set(c.credentials.apiId, gate);
  const run = gate.queue.then(async () => {
    if (gate.pausedUntil > Date.now())
      throw new CarrierError(`Yalidine أوقف الاتصال مؤقتاً بسبب كثرة الطلبات. المنصة لن تتصل به قبل ${timeDZ(gate.pausedUntil)} — أعد المحاولة بعدها. لم يُرسل شيء.`, { status: 429, paused: true });
    const wait = gate.last + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    gate.last = Date.now();
    const res = await fetch(`${c.config.apiBaseUrl.replace(/\/$/, '')}${path}`, {
      ...init,
      headers: { 'X-API-ID': c.credentials.apiId, 'X-API-TOKEN': c.credentials.apiToken, 'Content-Type': 'application/json', ...init.headers },
      signal: AbortSignal.timeout(30_000),
    });
    const quota = { minute: res.headers.get('x-minute-quota-left'), hour: res.headers.get('x-hour-quota-left'), day: res.headers.get('x-day-quota-left') };
    const now = Date.now();
    // Nearly out of quota: wait for it to come back rather than get banned.
    if (quota.day !== null && Number(quota.day) <= 3) gate.pausedUntil = Math.max(gate.pausedUntil, now + 6 * 3600_000);
    else if (quota.hour !== null && Number(quota.hour) <= 3) gate.pausedUntil = Math.max(gate.pausedUntil, now + 3600_000 - (now % 3600_000) + 5_000);
    else if (quota.minute !== null && Number(quota.minute) <= 2) gate.last = now + 60_000 - (now % 60_000);
    const text = await res.text();
    if (res.status === 429) gate.pausedUntil = Math.max(gate.pausedUntil, now + BAN_PAUSE_MS);
    if (!res.ok) throw new CarrierError(describeFailure(res.status, text, gate.pausedUntil), { status: res.status, cfRay: res.headers.get('cf-ray'), body: text.slice(0, 500), quota });
    return text ? JSON.parse(text) : null;
  });
  gate.queue = run.catch(() => undefined);
  return run;
}

function toParcel(o: ExportableOrder, c: LoadedCarrier) {
  const [firstname, familyname] = splitName(o.customerName);
  return {
    order_id: o.reference,
    from_wilaya_name: c.config.fromWilayaName,
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
    is_stopdesk: o.deliveryType === 'stopdesk',
    ...(o.deliveryType === 'stopdesk' && o.stopdeskId ? { stopdesk_id: o.stopdeskId } : {}),
    has_exchange: false,
    // Extra/override fields configured in the platform (e.g. can_open).
    ...c.config.parcelDefaults,
  };
}

export const yalidine: CarrierAdapter = {
  async test(c) {
    await call(c, '/wilayas/?page_size=1');
  },

  async createParcels(c, list): Promise<ParcelResult[]> {
    const response = (await call(c, '/parcels/', { method: 'POST', body: JSON.stringify(list.map((o) => toParcel(o, c))) })) as Record<
      string,
      { success?: boolean; tracking?: string; message?: string }
    >;
    return list.map((o) => {
      const r = response?.[o.reference];
      return r?.success && r.tracking ? { reference: o.reference, ok: true, tracking: r.tracking } : { reference: o.reference, ok: false, message: r?.message ?? 'لم يتم إنشاء الطرد' };
    });
  },

  handshake: (query) => query.crc_token ?? null,

  verifyWebhook(c, rawBody, headers) {
    const secret = c.config.webhookSecret;
    if (!secret) return true; // not configured yet: accept (still logged)
    const signature = headers['x-yalidine-signature'];
    if (typeof signature !== 'string') return false;
    const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  },

  parseWebhook(payload): WebhookUpdate[] {
    type Data = { tracking?: string; order_id?: string; status?: string; last_status?: string; reason?: string; payment_status?: string };
    const body = payload as { type?: string; events?: { event_type?: string; data?: Data }[]; data?: Data };
    const events = body.events ?? (body.data ? [{ event_type: body.type, data: body.data }] : []);
    return events.map((e) => ({
      event: e.event_type ?? body.type ?? 'unknown',
      tracking: e.data?.tracking,
      reference: e.data?.order_id,
      // parcel_payment_updated carries the money's state only, not a delivery status.
      carrierStatus: (e.event_type ?? body.type) === 'parcel_payment_updated' ? undefined : (e.data?.status ?? e.data?.last_status),
      reason: e.data?.reason || undefined,
      payment: (e.event_type ?? body.type) === 'parcel_payment_updated' ? e.data?.payment_status || undefined : undefined,
    }));
  },

  async fetchStatuses(c, trackings, known): Promise<WebhookUpdate[]> {
    const out: WebhookUpdate[] = [];
    for (let i = 0; i < trackings.length; i += 50) {
      const batch = trackings.slice(i, i + 50);
      const res = (await call(c, `/parcels/?tracking=${batch.map(encodeURIComponent).join(',')}&page_size=50`)) as {
        data?: { tracking: string; order_id?: string; last_status?: string }[];
      } | null;
      for (const p of res?.data ?? []) out.push({ event: 'sync', tracking: p.tracking, reference: p.order_id, carrierStatus: p.last_status });
    }
    // A new failed attempt: fetch why (the agent calls the customer with that in hand).
    // Already known (same status as last time): no extra request.
    for (const u of out) {
      if (!u.tracking || statusFromYalidine(u.carrierStatus ?? '') !== 'delivery_failed') continue;
      if (u.carrierStatus && known?.get(u.tracking)?.startsWith(u.carrierStatus)) continue;
      const h = (await call(c, `/histories/${encodeURIComponent(u.tracking)}`).catch(() => null)) as { data?: { date_status?: string; reason?: string }[] } | null;
      const last = [...(h?.data ?? [])].sort((a, b) => String(b.date_status).localeCompare(String(a.date_status)))[0];
      if (last?.reason) u.reason = last.reason;
    }
    return out;
  },

  async listParcels(c, since): Promise<CarrierParcel[]> {
    type Row = { tracking: string; order_id?: string; firstname?: string; familyname?: string; contact_phone?: string; date_creation?: string; last_status?: string; to_wilaya_id?: number | string; to_commune_name?: string; price?: number | string };
    const out: CarrierParcel[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= 50; page++) {
      const res = (await call(c, `/parcels/?page=${page}&page_size=200`)) as { has_more?: boolean; data?: Row[] } | null;
      const before = seen.size;
      for (const p of res?.data ?? []) {
        if (!p.tracking || seen.has(p.tracking)) continue;
        seen.add(p.tracking);
        // Yalidine dates are Algeria local time ("2026-09-26 10:12:45").
        const createdAt = p.date_creation ? new Date(`${p.date_creation.trim().replace(' ', 'T')}+01:00`) : null;
        if (createdAt && !Number.isNaN(createdAt.getTime()) && createdAt < since) continue;
        out.push({
          tracking: p.tracking,
          reference: p.order_id || undefined,
          name: [p.firstname, p.familyname].filter((v) => v && v !== '/').join(' '),
          phones: String(p.contact_phone ?? '').split(/[,;/|]+/).map((v) => v.trim()).filter(Boolean),
          createdAt: createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : null,
          status: p.last_status,
          wilayaCode: Number(p.to_wilaya_id) || undefined,
          commune: p.to_commune_name || undefined,
          price: p.price !== undefined && p.price !== null && p.price !== '' ? Number(p.price) : undefined,
        });
      }
      // Stop on an empty page, an explicit "no more", or a page with nothing new (page ignored).
      if (!res?.data?.length || res.has_more === false || seen.size === before) break;
    }
    return out;
  },

  mapStatus: statusFromYalidine,
};
