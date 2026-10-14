import { createHmac, timingSafeEqual } from 'node:crypto';
import { getWilaya, splitName, statusFromYalidine, type ExportableOrder } from '@touraya/shared';
import { CarrierError, type CarrierAdapter, type CarrierParcel, type LoadedCarrier, type ParcelResult, type WebhookUpdate } from '../types';

/**
 * Explains failures in plain words. "403 / error code 1106" comes from
 * Cloudflare: the request is blocked before reaching the API (API not enabled
 * for the account, or the server IP is not allowed). A relay with a fixed IP
 * can be configured as the API base URL.
 */
function describeFailure(status: number, body: string): string {
  if (status === 403 && /1106|cloudflare/i.test(body))
    return 'Yalidine رفض الطلب (403 / Cloudflare 1106): الـ API غير مفعل للحساب أو عنوان IP غير مسموح. راسل Yalidine أو استعمل Relay بعنوان IP ثابت.';
  if (status === 401) return 'API ID أو API TOKEN غير صحيح';
  if (status === 429) return 'تجاوزت حد الطلبات في Yalidine، أعد المحاولة بعد دقيقة';
  return `خطأ من Yalidine (HTTP ${status})`;
}

async function call(c: LoadedCarrier, path: string, init: RequestInit = {}) {
  if (!c.credentials.apiId || !c.credentials.apiToken) throw new CarrierError('أدخل API ID و API TOKEN في إعدادات شركة التوصيل');
  const res = await fetch(`${c.config.apiBaseUrl.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: { 'X-API-ID': c.credentials.apiId, 'X-API-TOKEN': c.credentials.apiToken, 'Content-Type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new CarrierError(describeFailure(res.status, text), { status: res.status, cfRay: res.headers.get('cf-ray'), body: text.slice(0, 500) });
  return text ? JSON.parse(text) : null;
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

  async fetchStatuses(c, trackings): Promise<WebhookUpdate[]> {
    const out: WebhookUpdate[] = [];
    for (let i = 0; i < trackings.length; i += 50) {
      const batch = trackings.slice(i, i + 50);
      const res = (await call(c, `/parcels/?tracking=${batch.map(encodeURIComponent).join(',')}&page_size=50`)) as {
        data?: { tracking: string; order_id?: string; last_status?: string }[];
      } | null;
      for (const p of res?.data ?? []) out.push({ event: 'sync', tracking: p.tracking, reference: p.order_id, carrierStatus: p.last_status });
    }
    // A failed attempt: fetch why (the agent calls the customer with that in hand).
    for (const u of out) {
      if (!u.tracking || statusFromYalidine(u.carrierStatus ?? '') !== 'delivery_failed') continue;
      const h = (await call(c, `/histories/${encodeURIComponent(u.tracking)}`).catch(() => null)) as { data?: { date_status?: string; reason?: string }[] } | null;
      const last = [...(h?.data ?? [])].sort((a, b) => String(b.date_status).localeCompare(String(a.date_status)))[0];
      if (last?.reason) u.reason = last.reason;
    }
    return out;
  },

  async listParcels(c, since): Promise<CarrierParcel[]> {
    type Row = { tracking: string; order_id?: string; firstname?: string; familyname?: string; contact_phone?: string; date_creation?: string; last_status?: string };
    const out: CarrierParcel[] = [];
    for (let page = 1; page <= 50; page++) {
      const res = (await call(c, `/parcels/?page=${page}&page_size=200`)) as { has_more?: boolean; data?: Row[] } | null;
      for (const p of res?.data ?? []) {
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
        });
      }
      if (!res?.has_more) break;
      await new Promise((r) => setTimeout(r, 300)); // Yalidine allows a few requests per second
    }
    return out;
  },

  mapStatus: statusFromYalidine,
};
