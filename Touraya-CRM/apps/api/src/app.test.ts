import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { loadConfig } from './config';
import { openDatabase, type Database } from './db/client';
import { products, sources } from './db/schema';
import { buildApp } from './app';
import { ensureBootstrap } from './seed';

let app: FastifyInstance;
let database: Database;
let adminCookie: string;
let source: typeof sources.$inferSelect;

const lead = (id: string, extra: Record<string, unknown> = {}) => ({
  id: `l:${id}`,
  created_time: '2026-09-28T10:00:00+01:00',
  form_name: 'pants offer 3 - 4999 - DZ - More volume',
  full_name: `Client ${id}`,
  phone_number: 'p:+213556251779',
  'رقمك_الخاص_للتواصل_معاك': '0556 25 17 79',
  'الولاية': 'الجزائر',
  'البلدية': 'باب الزوار',
  'المقاس': '42',
  'الألوان': 'أسود_رمادي_بني',
  ...extra,
});

async function login(email: string, password: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  expect(res.statusCode).toBe(200);
  const cookie = res.cookies.find((c) => c.name === 'touraya_session')!;
  return `${cookie.name}=${cookie.value}`;
}

const api = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: unknown, cookie = adminCookie) =>
  app.inject({ method, url: `/api${url}`, payload: payload as object, headers: { cookie } });

const ingest = (sheetName: string, rows: Record<string, unknown>[], token = source.token) =>
  app.inject({
    method: 'POST',
    url: '/api/ingest/sheets',
    headers: { 'x-touraya-token': token },
    payload: { spreadsheetId: source.spreadsheetId, sheetName, rows: rows.map((values, i) => ({ rowNumber: i + 2, values })) },
  });

const find = async (q: string) => (await api('GET', `/orders?q=${encodeURIComponent(q)}`)).json().items[0];

beforeAll(async () => {
  process.env.ADMIN_EMAIL = 'admin@test.dz';
  process.env.ADMIN_PASSWORD = 'secret-pass';
  // Embedded PGlite by default; set TEST_DATABASE_URL to run against a real (empty) Postgres.
  database = await openDatabase({ url: process.env.TEST_DATABASE_URL, pgliteDir: 'memory' });
  await ensureBootstrap(database.db, () => {});
  app = await buildApp(loadConfig({ NODE_ENV: 'test', APP_SECRET: 'test-secret-1234567890' }), database.db);
  adminCookie = await login('admin@test.dz', 'secret-pass');
  const [row] = await database.db.select().from(sources).where(eq(sources.name, 'pants offer 3 - 4999 - DZ - More volume'));
  source = row!;

  // Catalog: pants come in sizes and colors; 5 pieces of each variant in stock.
  const [pants] = await database.db.select().from(products).where(eq(products.sku, 'PANTS'));
  await api('PUT', `/products/${pants!.id}`, { name: 'Pants', sku: 'PANTS', sizes: ['40', '42'], colors: ['أسود', 'رمادي', 'بني'], costPrice: 900 });
  const list = (await api('GET', '/products')).json();
  for (const v of list.find((p: { sku: string }) => p.sku === 'PANTS').variants.filter((x: { active: boolean }) => x.active))
    await api('POST', '/inventory/movements', { variantId: v.id, type: 'purchase', quantity: 5 });
});

afterAll(async () => {
  await app.close();
  await database.close();
});

describe('catalog', () => {
  it('creates one variant per size × color with stock', async () => {
    const pants = (await api('GET', '/products')).json().find((p: { sku: string }) => p.sku === 'PANTS');
    const active = pants.variants.filter((v: { active: boolean }) => v.active);
    expect(active).toHaveLength(6);
    expect(active[0]).toMatchObject({ stock: 5, reserved: 0, available: 5 });
    const offers = (await api('GET', '/offers')).json();
    expect(offers.find((o: { name: string }) => o.name === 'pants 3pcs 4999')).toMatchObject({ units: 3, price: 4999, productId: pants.id });
  });
});

describe('ingestion', () => {
  it('rejects bad tokens and foreign spreadsheets', async () => {
    expect((await ingest('Sheet1', [lead('1')], 'nope')).statusCode).toBe(401);
    const res = await app.inject({
      method: 'POST',
      url: '/api/ingest/sheets',
      headers: { 'x-touraya-token': source.token },
      payload: { spreadsheetId: 'another-sheet-id', sheetName: 'Sheet1', rows: [] },
    });
    expect(res.statusCode).toBe(409);
  });

  it('creates orders, skips old leads and never duplicates', async () => {
    const res = await ingest('Sheet1', [
      lead('100'),
      lead('101', { 'رقمك_الخاص_للتواصل_معاك': '055625177', phone_number: 'p:+213661000101', full_name: 'Client 101' }),
      lead('102', { created_time: '2026-09-20T10:00:00+01:00' }),
      lead('100'),
      {},
    ]);
    expect(res.json().errors).toEqual([]);
    expect(res.json()).toMatchObject({ created: 2, duplicates: 1, skipped: 2 });
    // Same lead moved to Sheet2, script re-run: still no duplicate.
    expect((await ingest('Sheet2', [lead('100'), lead('101')])).json()).toMatchObject({ created: 0, duplicates: 2 });
  });

  it('normalises phone, location, offer, price and drafts one piece per color', async () => {
    const a = await find('Client 100');
    expect(a).toMatchObject({ phone: '0556251779', wilayaCode: 16, communeName: 'Bab Ezzouar', offerName: 'pants 3pcs 4999', price: 4999, units: 3, itemsLabel: '42 أسود + 42 رمادي + 42 بني', flags: [] });
    const b = await find('Client 101');
    expect(b).toMatchObject({ phone: '0661000101', phoneIssue: 'customer_invalid_used_facebook', flags: ['phone'] });
  });

  it('flags a second open order of the same customer as a possible duplicate', async () => {
    await ingest('Sheet1', [lead('103', { full_name: 'Client 103 again' })]);
    const dup = await find('Client 103');
    expect(dup.flags).toContain('duplicate');
    const detail = (await api('GET', `/orders/${dup.id}`)).json();
    expect(detail.duplicateOf.reference).toBe((await find('Client 100')).reference);
    expect((await api('GET', '/orders?problem=duplicate')).json().total).toBe(1);
  });

  it('accepts any JSON through a webhook source (website, Make, Zapier)', async () => {
    const created = (await api('POST', '/sources', { name: 'Site', type: 'webhook', offerId: null, importFrom: '2026-01-01' })).json();
    const { url } = (await api('GET', `/sources/${created.id}/endpoint`)).json();
    const res = await app.inject({
      method: 'POST',
      url: new URL(url).pathname,
      payload: { id: 'site-1', name: 'Web Client', phone: '0770 33 10 38', wilaya: 'Oran', commune: 'Bir El Djir', offer: 'suit white - 6500' },
    });
    expect(res.json()).toMatchObject({ created: 1 });
    expect(await find('Web Client')).toMatchObject({ phone: '0770331038', wilayaCode: 31, offerName: 'suit white - 6500', price: 6500, units: 1 });
  });
});

describe('agent workflow', () => {
  let agentA: string;
  let agentB: string;

  it('hands each agent a different order (queue lock)', async () => {
    await api('POST', '/users', { name: 'Agent A', email: 'a@test.dz', password: 'agent-pass', role: 'agent' });
    await api('POST', '/users', { name: 'Agent B', email: 'b@test.dz', password: 'agent-pass', role: 'agent' });
    agentA = await login('a@test.dz', 'agent-pass');
    agentB = await login('b@test.dz', 'agent-pass');
    const first = (await api('POST', '/orders/queue/next', {}, agentA)).json().id;
    const second = (await api('POST', '/orders/queue/next', {}, agentB)).json().id;
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
    // Asking again returns the same locked order to its agent.
    expect((await api('POST', '/orders/queue/next', {}, agentA)).json().id).toBe(first);
  });

  it('schedules the retry after "no answer" and takes the order out of the queue', async () => {
    const id = (await api('POST', '/orders/queue/next', {}, agentA)).json().id;
    const res = (await api('POST', `/orders/${id}/status`, { status: 'call_1' }, agentA)).json();
    expect(res).toMatchObject({ status: 'call_1', callAttempts: 1, assignedToName: 'Agent A' });
    expect(new Date(res.nextCallAt).getTime()).toBeGreaterThan(Date.now() + 30 * 60_000);
    expect((await api('POST', '/orders/queue/next', {}, agentA)).json().id).not.toBe(id);
  });

  it('agents cannot set system statuses or export', async () => {
    const other = await find('Client 101');
    expect((await api('POST', `/orders/${other.id}/status`, { status: 'delivered' }, agentB)).statusCode).toBe(403);
    expect((await api('GET', '/shipping/exports', undefined, agentB)).statusCode).toBe(403);
  });

  it('confirms with comments, cancels with a reason', async () => {
    const order = await find('Client 100');
    await api('POST', `/orders/${order.id}/comments`, { body: 'يريد التفكير' });
    const detail = (await api('POST', `/orders/${order.id}/status`, { status: 'confirmed', comment: 'أكد لون مختلف' })).json();
    expect(detail).toMatchObject({ status: 'confirmed', commentCount: 2, lastComment: 'أكد لون مختلف' });
    // Confirmed pieces are reserved.
    const pants = (await api('GET', '/products')).json().find((p: { sku: string }) => p.sku === 'PANTS');
    expect(pants.variants.find((v: { size: string; color: string }) => v.size === '42' && v.color === 'أسود')).toMatchObject({ stock: 5, reserved: 1, available: 4 });

    const dup = await find('Client 103');
    expect((await api('POST', `/orders/${dup.id}/status`, { status: 'cancelled', cancelReason: 'طلب مكرر' })).json()).toMatchObject({ status: 'cancelled', cancelReason: 'طلب مكرر' });
  });

  it('edits pieces and offer, re-pricing from the offer list', async () => {
    const order = await find('Client 101');
    const offers = (await api('GET', '/offers')).json();
    const two = offers.find((o: { name: string }) => o.name === 'pants 2pcs 3500');
    const res = (await api('PATCH', `/orders/${order.id}`, { offerId: two.id, reason: 'غير العرض' })).json();
    expect(res).toMatchObject({ offerId: two.id, price: 3500, units: 2, commentCount: 1 });
    const pants = (await api('GET', '/products')).json().find((p: { sku: string }) => p.sku === 'PANTS');
    const items = [
      { productId: pants.id, size: '40', color: 'أسود', quantity: 1 },
      { productId: pants.id, size: '40', color: 'بني', quantity: 1 },
    ];
    expect((await api('PATCH', `/orders/${order.id}`, { items })).json()).toMatchObject({ itemsLabel: '40 أسود + 40 بني', flags: ['phone'] });
  });
});

describe('carriers, shipping and stock', () => {
  let orderId: string;

  it('shows the delivery price for the customer wilaya', async () => {
    const [carrier] = (await api('GET', '/carriers')).json();
    await api('PUT', `/carriers/${carrier.id}/rates`, [{ wilayaCode: 16, homeFee: 400, deskFee: 250 }]);
    orderId = (await find('Client 100')).id;
    expect((await api('GET', `/orders/${orderId}`)).json().deliveryFee).toBe(400);
    expect((await api('PATCH', `/orders/${orderId}`, { deliveryType: 'stopdesk', stopdeskId: '163001' })).json().deliveryFee).toBe(250);
    await api('PATCH', `/orders/${orderId}`, { deliveryType: 'home', stopdeskId: null });
  });

  it('exports after review and takes the pieces out of stock', async () => {
    const other = (await find('Client 101')).id;
    const preview = (await api('POST', '/shipping/preview', { ids: [orderId, other] })).json();
    expect(preview.headers[0]).toBe('Wilaya de départ');
    expect(preview.rows.find((r: { id: string }) => r.id === orderId).errors).toEqual([]);
    expect(preview.rows.find((r: { id: string }) => r.id === other).errors.length).toBeGreaterThan(0);
    expect((await api('POST', '/shipping/exports', { ids: [orderId, other] })).statusCode).toBe(422);

    const batch = (await api('POST', '/shipping/exports', { ids: [orderId] })).json();
    expect((await api('GET', `/orders/${orderId}`)).json().status).toBe('ready_for_carrier');
    const file = await api('GET', `/shipping/exports/${batch.id}/file`);
    expect(file.headers['content-type']).toContain('spreadsheetml');

    const pants = (await api('GET', '/products')).json().find((p: { sku: string }) => p.sku === 'PANTS');
    expect(pants.variants.find((v: { size: string; color: string }) => v.size === '42' && v.color === 'أسود')).toMatchObject({ stock: 4, reserved: 0 });
    const moves = (await api('GET', '/inventory/movements')).json();
    expect(moves.filter((m: { type: string }) => m.type === 'ship')).toHaveLength(3);
  });

  it('carrier webhook marks the parcel returned, then the return is restocked', async () => {
    const reference = (await api('GET', `/orders/${orderId}`)).json().reference;
    expect((await app.inject({ method: 'GET', url: '/api/webhooks/yalidine?crc_token=abc123' })).body).toBe('abc123');
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/yalidine',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ type: 'parcel_status_updated', events: [{ data: { order_id: reference, tracking: 'yal-1', status: 'Retourné au vendeur' } }] }),
    });
    expect(res.json()).toMatchObject({ ok: true, applied: 1 });
    expect((await api('GET', `/orders/${orderId}`)).json()).toMatchObject({ status: 'returned', carrierTracking: 'yal-1' });

    expect((await api('POST', `/orders/${orderId}/return-received`, { condition: 'restock' })).json().status).toBe('return_received');
    const pants = (await api('GET', '/products')).json().find((p: { sku: string }) => p.sku === 'PANTS');
    expect(pants.variants.find((v: { size: string; color: string }) => v.size === '42' && v.color === 'أسود').stock).toBe(5);
  });

  it('the customer history now warns about the return', async () => {
    await ingest('Sheet1', [lead('104', { full_name: 'Client 104 returns' })]);
    const next = await find('Client 104');
    expect(next.risk).toBe('watch');
  });

  it('sends parcels through the API with configurable extra fields (can_open)', async () => {
    const [carrier] = (await api('GET', '/carriers')).json();
    await api('PUT', `/carriers/${carrier.id}`, { ...carrier, apiEnabled: true, credentials: { apiId: 'id', apiToken: 'token' } });
    const order = await find('Client 104');
    await api('PATCH', `/orders/${order.id}`, {}); // no-op
    await api('POST', `/orders/${order.id}/status`, { status: 'confirmed' });

    let sent: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ [String(sent[0]!.order_id)]: { success: true, tracking: 'yal-API1' } }), { status: 200 });
    }));
    const res = (await api('POST', '/shipping/send', { ids: [order.id] })).json();
    vi.unstubAllGlobals();
    expect(res.results[0]).toMatchObject({ ok: true, tracking: 'yal-API1' });
    expect(sent[0]).toMatchObject({ can_open: false, is_stopdesk: false, product_list: 'p 3pcs 4999', to_wilaya_name: 'Alger' });
    expect((await api('GET', `/orders/${order.id}`)).json().status).toBe('sent_to_carrier');
  });

  it('explains the Cloudflare 403 / 1106 error', async () => {
    const [carrier] = (await api('GET', '/carriers')).json();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('error code: 1106', { status: 403, headers: { 'cf-ray': 'a420504a18840f8d-EWR' } })));
    const res = (await api('POST', `/carriers/${carrier.id}/test`)).json();
    vi.unstubAllGlobals();
    expect(res).toMatchObject({ ok: false, status: 403, cfRay: 'a420504a18840f8d-EWR' });
    expect(res.message).toContain('1106');
  });
});

describe('admin', () => {
  it('soft-deletes, restores and deletes by filter', async () => {
    const before = (await api('GET', '/orders')).json().total;
    const one = (await find('Web Client')).id;
    expect((await api('POST', '/orders/bulk', { action: 'delete', ids: [one] })).json().affected).toBe(1);
    expect((await api('GET', '/orders')).json().total).toBe(before - 1);
    await api('POST', '/orders/bulk', { action: 'restore', ids: [one] });
    expect((await api('POST', '/orders/delete-by-filter', { filter: { q: 'Web Client' }, confirmCount: 5 })).statusCode).toBe(409);
    expect((await api('POST', '/orders/delete-by-filter', { filter: { q: 'Web Client' }, confirmCount: 1 })).json().affected).toBe(1);
  });

  it('filters by date (Algeria days)', async () => {
    expect((await api('GET', '/orders?from=2026-09-28&to=2026-09-28')).json().total).toBe(4);
    expect((await api('GET', '/orders?from=2026-09-29')).json().total).toBe(0);
  });

  it('computes stats with return rate and cancel reasons', async () => {
    const stats = (await api('GET', '/stats')).json();
    expect(stats.totals).toMatchObject({ returned: 1, cancelled: 1 });
    expect(stats.cancelReasons).toEqual([{ reason: 'طلب مكرر', count: 1 }]);
    expect(stats.byWilaya[0]).toMatchObject({ wilayaCode: 16, returned: 1 });
  });

  it('lists sources and renders the Apps Script', async () => {
    const list = (await api('GET', '/sources')).json();
    expect(list.find((s: { id: number }) => s.id === source.id)).toMatchObject({ orderCount: 4 });
    expect(list[0].token).toBeUndefined();
    const script = (await api('GET', `/sources/${source.id}/apps-script`)).body;
    expect(script).toContain('function setupTouraya');
    expect(script).toContain(source.token);
  });

  it('blacklists a customer', async () => {
    const order = (await api('GET', `/orders/${(await find('Client 104')).id}`)).json();
    await api('PUT', `/customers/${order.customer.id}/blacklist`, { blacklisted: true, reason: 'يرفض الاستلام' });
    expect((await find('Client 104')).flags).toContain('blacklisted');
  });
});

describe('fixes from the first real use', () => {
  it('the source offer wins over ad / campaign names (the 2pcs vs 3pcs bug)', async () => {
    // Legacy-form source configured for "pants 3pcs 4999", but the ad is named after the 2pcs offer.
    const res = await ingest('Sheet1', [lead('200', { full_name: 'Client 200', form_name: 'old form', campaign_name: 'pants offer 2 - 3500', ad_name: 'pants 2pcs' })]);
    expect(res.json().created).toBe(1);
    expect(await find('Client 200')).toMatchObject({ offerName: 'pants 3pcs 4999', price: 4999 });
  });

  it('an offer chosen by the customer in the form still wins', async () => {
    await ingest('Sheet1', [lead('201', { full_name: 'Client 201', 'العرض': 'suit white - 6500' })]);
    expect(await find('Client 201')).toMatchObject({ offerName: 'suit white - 6500', price: 6500 });
  });

  it('finds wilaya and commune inside a free-text address (legacy forms)', async () => {
    const { 'الولاية': _w, 'البلدية': _c, ...rest } = lead('202', { full_name: 'Client 202' });
    await ingest('Sheet1', [{ ...rest, 'العنوان': 'حي 20 أوت بوفاريك البليدة' }]);
    expect(await find('Client 202')).toMatchObject({ wilayaCode: 9, communeName: 'Boufarik' });
  });

  it('bulk "change offer" fixes orders that came in with the wrong offer', async () => {
    const offers = (await api('GET', '/offers')).json();
    const two = offers.find((o: { name: string }) => o.name === 'pants 2pcs 3500');
    const order = await find('Client 200');
    expect((await api('POST', '/orders/bulk', { action: 'offer', ids: [order.id], offerId: two.id })).json().affected).toBe(1);
    expect(await find('Client 200')).toMatchObject({ offerName: 'pants 2pcs 3500', price: 3500, units: 2 });
  });

  it('reprocess fills empty fields after fixing the column mapping, never overwriting edits', async () => {
    const { 'الولاية': _w, 'البلدية': _c, ...rest } = lead('203', { full_name: 'Client 203' });
    await ingest('Sheet1', [{ ...rest, 'مكان التوصيل': 'Bab Ezzouar, Alger' }]);
    expect(await find('Client 203')).toMatchObject({ wilayaCode: null, communeName: null });
    // Admin maps the unknown column to "address", then reprocesses.
    await api('PUT', `/sources/${source.id}`, { ...source, fieldMap: { address: ['مكان التوصيل'] } });
    const res = (await api('POST', `/sources/${source.id}/reprocess`)).json();
    expect(res.updated).toBeGreaterThanOrEqual(1);
    expect(await find('Client 203')).toMatchObject({ wilayaCode: 16, communeName: 'Bab Ezzouar' });
  });

  it('removes a source: stops receiving, keeps its orders', async () => {
    const created = (await api('POST', '/sources', { name: 'To remove', type: 'webhook', offerId: null, importFrom: '2026-01-01' })).json();
    const { url } = (await api('GET', `/sources/${created.id}/endpoint`)).json();
    await app.inject({ method: 'POST', url: new URL(url).pathname, payload: { id: 'rm-1', name: 'Removed source client', phone: '0770111222' } });
    expect((await app.inject({ method: 'DELETE', url: `/api/sources/${created.id}`, headers: { cookie: adminCookie } })).json()).toEqual({ ok: true });
    expect((await api('GET', '/sources')).json().some((s: { id: number }) => s.id === created.id)).toBe(false);
    // The old link no longer accepts orders, the existing order stays.
    expect((await app.inject({ method: 'POST', url: new URL(url).pathname, payload: { id: 'rm-2', name: 'x', phone: '0770111223' } })).statusCode).toBe(401);
    expect((await find('Removed source client')).sourceName).toBe('To remove');
  });

  it('removes offers, products and employees without losing history', async () => {
    const del = (url: string) => app.inject({ method: 'DELETE', url: `/api${url}`, headers: { cookie: adminCookie } });
    const offers = (await api('GET', '/offers')).json();
    const suit = offers.find((o: { name: string }) => o.name === 'suit white - 6500');
    expect((await del(`/offers/${suit.id}`)).statusCode).toBe(200);
    expect((await api('GET', '/offers')).json().some((o: { id: number }) => o.id === suit.id)).toBe(false);
    expect((await find('Client 201')).offerName).toBe('suit white - 6500'); // past order keeps its offer

    const product = (await api('GET', '/products')).json().find((p: { sku: string }) => p.sku === 'SUIT-W');
    expect((await del(`/products/${product.id}`)).statusCode).toBe(200);
    expect((await api('GET', '/products')).json().some((p: { id: number }) => p.id === product.id)).toBe(false);

    const agent = (await api('GET', '/users')).json().find((u: { email: string }) => u.email === 'b@test.dz');
    expect((await del(`/users/${agent.id}`)).statusCode).toBe(200);
    expect((await api('GET', '/users')).json().some((u: { id: number }) => u.id === agent.id)).toBe(false);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'b@test.dz', password: 'agent-pass' } })).statusCode).toBe(401);
    // The same e-mail can be used again for a new account.
    expect((await api('POST', '/users', { name: 'Agent B2', email: 'b@test.dz', password: 'agent-pass', role: 'agent' })).statusCode).toBe(200);
    // An admin cannot remove themself.
    const me = (await api('GET', '/auth/me')).json();
    expect((await del(`/users/${me.id}`)).statusCode).toBe(400);
  });
});
