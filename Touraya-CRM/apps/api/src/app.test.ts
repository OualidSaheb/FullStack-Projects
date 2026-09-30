import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { loadConfig } from './config';
import { openDatabase, type Database } from './db/client';
import { sources } from './db/schema';
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
  'المقاس': 'L',
  'الألوان': 'أسود_رمادي',
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

beforeAll(async () => {
  process.env.ADMIN_EMAIL = 'admin@test.dz';
  process.env.ADMIN_PASSWORD = 'secret-pass';
  database = await openDatabase({ pgliteDir: 'memory' });
  await ensureBootstrap(database.db, () => {});
  app = await buildApp(loadConfig({ NODE_ENV: 'test', APP_SECRET: 'test-secret-1234567890' }), database.db);
  adminCookie = await login('admin@test.dz', 'secret-pass');
  [source] = await database.db.select().from(sources).where(eq(sources.name, 'pants offer 3 - 4999 - DZ - More volume'));
});

afterAll(async () => {
  await app.close();
  await database.close();
});

describe('Google Sheets ingestion', () => {
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
      lead('101', { 'رقمك_الخاص_للتواصل_معاك': '055625177' }),
      lead('102', { created_time: '2026-09-20T10:00:00+01:00' }),
      lead('100'),
      {},
    ]);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ created: 2, duplicates: 1, skipped: 2, errors: [] });

    // Same lead moved to Sheet2, script re-run: still no duplicate.
    const again = await ingest('Sheet2', [lead('100'), lead('101')]);
    expect(again.json()).toMatchObject({ created: 0, duplicates: 2 });
  });

  it('normalises phone, wilaya, commune, product and price', async () => {
    const list = (await api('GET', '/orders?sort=customerName&dir=asc')).json();
    expect(list.total).toBe(2);
    const [a, b] = list.items;
    expect(a).toMatchObject({ customerName: 'Client 100', phone: '0556251779', phoneIssue: null, wilayaCode: 16, communeName: 'Bab Ezzouar', productName: 'pants 3pcs 4999', price: 4999, size: 'L', colors: 'أسود رمادي', status: 'new' });
    expect(b).toMatchObject({ phone: '0556251779', phoneIssue: 'customer_typo_used_facebook' });

    const issues = (await api('GET', '/orders?phoneIssue=true')).json();
    expect(issues.total).toBe(1);
    expect((await api('GET', '/orders/counts')).json()).toMatchObject({ total: 2, phoneIssues: 1, byStatus: { new: 2 } });
  });
});

describe('order workflow', () => {
  let orderId: string;

  it('changes status, comments and keeps an activity log', async () => {
    orderId = (await api('GET', '/orders?q=Client 100')).json().items[0].id;
    expect((await api('POST', `/orders/${orderId}/status`, { status: 'call_1' })).json()).toMatchObject({ status: 'call_1', callAttempts: 1 });
    await api('POST', `/orders/${orderId}/comments`, { body: 'يريد التفكير' });
    await api('POST', `/orders/${orderId}/comments`, { body: 'اتصل لاحقاً للتأكيد' });
    const detail = await api('POST', `/orders/${orderId}/status`, { status: 'confirmed', comment: 'أكد لون مختلف' });
    expect(detail.json()).toMatchObject({ status: 'confirmed', commentCount: 3, lastComment: 'أكد لون مختلف' });

    const timeline = (await api('GET', `/orders/${orderId}/timeline`)).json();
    expect(timeline.comments).toHaveLength(3);
    expect(timeline.events.map((e: { type: string }) => e.type)).toEqual(
      expect.arrayContaining(['created', 'status_changed', 'commented']),
    );
  });

  it('re-prices when the offer changes and logs the diff', async () => {
    const products = (await api('GET', '/products')).json();
    const suit = products.find((p: { name: string }) => p.name.startsWith('suit'));
    const res = await api('PATCH', `/orders/${orderId}`, { productId: suit.id, colors: 'أبيض', reason: 'غير العرض' });
    expect(res.json()).toMatchObject({ productId: suit.id, price: 6500, colors: 'أبيض', commentCount: 4 });
    const qty = await api('PATCH', `/orders/${orderId}`, { quantity: 2 });
    expect(qty.json().price).toBe(13000);
    await api('PATCH', `/orders/${orderId}`, { quantity: 1 });
  });

  it('agents cannot set system statuses', async () => {
    await api('POST', '/users', { name: 'Agent', email: 'agent@test.dz', password: 'agent-pass', role: 'agent' });
    const agent = await login('agent@test.dz', 'agent-pass');
    const other = (await api('GET', '/orders?q=Client 101')).json().items[0].id;
    expect((await api('POST', `/orders/${other}/status`, { status: 'delivered' }, agent)).statusCode).toBe(403);
    const ok = await api('POST', `/orders/${other}/status`, { status: 'call_1' }, agent);
    expect(ok.json().assignedToName).toBe('Agent');
    expect((await api('GET', '/shipping/exports', undefined, agent)).statusCode).toBe(403);
  });

  it('exports confirmed orders to the carrier file after review', async () => {
    const other = (await api('GET', '/orders?q=Client 101')).json().items[0].id;
    const preview = (await api('POST', '/shipping/preview', { ids: [orderId, other] })).json();
    expect(preview.headers[0]).toBe('Wilaya de départ');
    expect(preview.rows.find((r: { id: string }) => r.id === orderId).errors).toEqual([]);
    expect(preview.rows.find((r: { id: string }) => r.id === other).errors.length).toBeGreaterThan(0);

    expect((await api('POST', '/shipping/exports', { ids: [orderId, other] })).statusCode).toBe(422);
    const batch = (await api('POST', '/shipping/exports', { ids: [orderId] })).json();
    expect((await api('GET', `/orders/${orderId}`)).json().status).toBe('ready_for_carrier');

    const file = await api('GET', `/shipping/exports/${batch.id}/file`);
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toContain('spreadsheetml');
    expect((await api('GET', '/shipping/exports')).json()[0]).toMatchObject({ orderCount: 1, totalAmount: 6500 });
  });

  it('applies Yalidine webhook status updates', async () => {
    const handshake = await app.inject({ method: 'GET', url: '/api/webhooks/yalidine?subscribe=parcel_status_updated&crc_token=abc123' });
    expect(handshake.body).toBe('abc123');
    const detail = (await api('GET', `/orders/${orderId}`)).json();
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/yalidine',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ type: 'parcel_status_updated', events: [{ data: { order_id: detail.reference, tracking: 'yal-123ABC', status: 'Livré' } }] }),
    });
    expect(res.json()).toMatchObject({ ok: true, applied: 1 });
    expect((await api('GET', `/orders/${orderId}`)).json()).toMatchObject({ status: 'delivered', carrierTracking: 'yal-123ABC', carrierStatus: 'Livré' });
  });

  it('soft-deletes, restores and deletes by filter', async () => {
    const all = (await api('GET', '/orders')).json().items.map((o: { id: string }) => o.id);
    expect((await api('POST', '/orders/bulk', { action: 'delete', ids: [all[0]] })).json().affected).toBe(1);
    expect((await api('GET', '/orders')).json().total).toBe(1);
    expect((await api('GET', '/orders?deleted=true')).json().total).toBe(1);
    await api('POST', '/orders/bulk', { action: 'restore', ids: [all[0]] });

    expect((await api('POST', '/orders/delete-by-filter', { filter: { q: 'Client' }, confirmCount: 5 })).statusCode).toBe(409);
    expect((await api('POST', '/orders/delete-by-filter', { filter: { q: 'Client' }, confirmCount: 2 })).json().affected).toBe(2);
    expect((await api('GET', '/orders')).json().total).toBe(0);
    // Deleted orders still block re-import of the same lead.
    expect((await ingest('Sheet1', [lead('100')])).json().created).toBe(0);
  });

  it('computes stats', async () => {
    await api('POST', '/orders/bulk', { action: 'restore', ids: (await api('GET', '/orders?deleted=true')).json().items.map((o: { id: string }) => o.id) });
    const stats = (await api('GET', '/stats')).json();
    expect(stats.totals).toMatchObject({ all: 2, delivered: 1 });
    expect(stats.byWilaya[0]).toMatchObject({ wilayaCode: 16, count: 2 });
    expect(stats.daily[0].day).toBe('2026-09-28');
  });
});

describe('sources', () => {
  it('renders the Apps Script with the source token', async () => {
    const res = await api('GET', `/sources/${source.id}/apps-script`);
    expect(res.body).toContain('function setupTouraya');
    expect(res.body).toContain(source.token);
    expect(res.body).toContain('"Sheet2"');
    expect(res.body).toContain('2026-09-27');
  });
});
