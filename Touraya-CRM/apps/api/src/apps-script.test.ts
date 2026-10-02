import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * End-to-end test of the Google Apps Script: the exact code served to the user
 * runs in a sandbox with fake Google services, against the real server started
 * in its own process. (UrlFetchApp is synchronous in Apps Script, so requests go
 * through curl — which is why the server must live in another process.)
 */
const apiDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let server: ChildProcess;
let base: string;
let dataDir: string;
let cookie = '';
let code = '';
let spreadsheetId = '';
let sourceId = 0;

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });

const api = async <T = any>(url: string) => (await (await fetch(`${base}/api${url}`, { headers: { cookie } })).json()) as T;
const orderNames = async () => (await api<{ items: { customerName: string }[] }>('/orders?pageSize=100')).items.map((o) => o.customerName).sort();
const source = async () => (await api<{ id: number; lastSyncAt: string; lastSyncStats: { created: number } }[]>('/sources')).find((s) => s.id === sourceId)!;

const header = ['id', 'created_time', 'form_name', 'full_name', 'phone_number', 'رقمك_الخاص_للتواصل_معاك', 'الولاية', 'البلدية', 'المقاس', 'الألوان'];
const row = (id: string, date: string, phone: string) => [`l:${id}`, new Date(date), 'pants offer 3 - 4999', `GAS ${id}`, `p:+213${phone}`, `0${phone}`, 'وهران', 'بئر الجير', '42', 'أسود'];

function sandbox(sheets: Record<string, unknown[][]>, opts: { endpointOverride?: string; spreadsheetId?: string } = {}) {
  const props: Record<string, string> = {};
  const calls: string[] = [];
  const ctx = vm.createContext({
    SpreadsheetApp: {
      getActive: () => ({
        getId: () => opts.spreadsheetId ?? spreadsheetId,
        getSheetByName: (n: string) => sheets[n] && { getLastRow: () => sheets[n]!.length, getDataRange: () => ({ getValues: () => sheets[n] }) },
      }),
    },
    UrlFetchApp: {
      fetch: (url: string, o: { headers?: Record<string, string>; payload?: string } = {}) => {
        if (!o.payload) {
          calls.push(`GET ${new URL(url).pathname}`);
          const status = execFileSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', url]).toString();
          return { getResponseCode: () => Number(status), getContentText: () => '' };
        }
        calls.push(JSON.parse(o.payload).sheetName);
        const target = opts.endpointOverride ?? url;
        try {
          const out = execFileSync('curl', ['-s', '-w', '\n%{http_code}', '-H', 'content-type: application/json', '-H', `X-Touraya-Token: ${o.headers?.['X-Touraya-Token']}`, '--data-binary', '@-', target], { input: o.payload }).toString();
          const i = out.lastIndexOf('\n');
          return { getResponseCode: () => Number(out.slice(i + 1)), getContentText: () => out.slice(0, i) };
        } catch {
          throw new Error('Address unavailable'); // what UrlFetchApp throws when the host is down
        }
      },
    },
    PropertiesService: {
      getDocumentProperties: () => ({
        getProperties: () => ({ ...props }),
        getProperty: (k: string) => props[k] ?? null,
        setProperty: (k: string, v: string) => { props[k] = v; },
        setProperties: (p: Record<string, string>) => Object.assign(props, p),
        deleteProperty: (k: string) => { delete props[k]; },
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger: () => {}, newTrigger: () => ({ timeBased: () => ({ everyMinutes: () => ({ create: () => {} }) }) }) },
    Logger: { log: () => {} },
  });
  vm.runInContext(code, ctx);
  return { run: (fn: string) => vm.runInContext(`${fn}()`, ctx), props, calls };
}

beforeAll(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  dataDir = mkdtempSync(path.join(tmpdir(), 'touraya-gas-'));
  server = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: apiDir,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'test', PGLITE_DIR: dataDir, DATABASE_URL: process.env.TEST_DATABASE_URL ?? '', ADMIN_EMAIL: 'admin@test.dz', ADMIN_PASSWORD: 'secret-pass', APP_SECRET: 'test-secret-1234567890' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    if (await fetch(`${base}/api/health`).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@test.dz', password: 'secret-pass' }) });
  cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  const list = await api<{ id: number; name: string; spreadsheetId: string }[]>('/sources');
  const s = list.find((x) => x.name === 'pants offer 3 - 4999 - DZ - More volume')!;
  sourceId = s.id;
  spreadsheetId = s.spreadsheetId;
  // The exact script the admin copies from "إعداد الاستقبال".
  code = await (await fetch(`${base}/api/sources/${s.id}/apps-script`, { headers: { cookie } })).text();
}, 60_000);

afterAll(() => {
  server?.kill();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('Google Apps Script (end to end)', () => {
  const sheets = {
    Sheet1: [header, row('g1', '2026-09-29T10:00:00Z', '661000001'), row('g2', '2026-09-29T11:00:00Z', '661000002')],
    Sheet2: [header, row('g3', '2026-09-28T09:00:00Z', '661000003'), row('old', '2026-09-01T09:00:00Z', '661000004'), row('g1', '2026-09-29T10:00:00Z', '661000001')],
  };
  let gas: ReturnType<typeof sandbox>;

  it('the served script points to this platform and uses a 5-minute trigger', () => {
    expect(code).toContain(`${base}/api/ingest/sheets`);
    expect(code).toContain('"everyMinutes": 5');
    expect(code).toContain('"keepAwakeMinutes": 10');
  });

  it('setup sends existing leads from Sheet1 + Sheet2, skipping old ones and duplicates', async () => {
    gas = sandbox(sheets);
    expect(gas.run('setupTouraya')).toMatchObject({ ok: true, created: 3 });
    expect(await orderNames()).toEqual(['GAS g1', 'GAS g2', 'GAS g3']);
  });

  it('next runs send nothing while the sheets do not change (Google quota friendly)', () => {
    gas.calls.length = 0;
    expect(gas.run('syncTouraya')).toMatchObject({ sent: 0 });
    expect(gas.calls).toEqual([]);
  });

  it('keeps free hosting awake with a database-free health request every 10 minutes', () => {
    gas.props.touraya_wake_at = String(Date.now() - 11 * 60_000);
    gas.calls.length = 0;
    gas.run('syncTouraya');
    expect(gas.calls).toEqual(['GET /api/health']);
    gas.run('syncTouraya'); // just woke: nothing until the next 10 minutes
    expect(gas.calls).toEqual(['GET /api/health']);
  });

  it('a new Facebook lead is delivered on the next run', async () => {
    sheets.Sheet1.push(row('g4', '2026-09-30T08:00:00Z', '661000005'));
    expect(gas.run('syncTouraya')).toMatchObject({ created: 1, sent: 1 });
    expect(await orderNames()).toContain('GAS g4');
  });

  it('keeps leads while the platform is down and delivers them when it is back', async () => {
    const down = sandbox(sheets, { endpointOverride: 'http://127.0.0.1:9/api/ingest/sheets' });
    Object.assign(down.props, gas.props);
    sheets.Sheet2.push(row('g5', '2026-09-30T09:00:00Z', '661000006'));
    expect(down.run('syncTouraya')).toMatchObject({ ok: false });
    const up = sandbox(sheets);
    Object.assign(up.props, down.props);
    expect(up.run('syncTouraya')).toMatchObject({ ok: true, created: 1 });
    expect(await orderNames()).toContain('GAS g5');
    Object.assign(gas.props, up.props); // continue with the same script state
  });

  it('pings the platform on the periodic full scan, keeping the last batch stats', async () => {
    const before = (await source()).lastSyncAt;
    await new Promise((r) => setTimeout(r, 1100));
    gas.props.touraya_full_scan_at = '0';
    gas.calls.length = 0;
    gas.run('syncTouraya');
    expect(gas.calls).toContain('heartbeat');
    const after = await source();
    expect(new Date(after.lastSyncAt).getTime()).toBeGreaterThan(new Date(before).getTime());
    expect(after.lastSyncStats.created).toBeGreaterThan(0);
  });

  it('testTouraya creates a visible test order', async () => {
    expect(gas.run('testTouraya')).toContain('نجح');
    expect(await orderNames()).toContain('TEST Touraya');
  });

  it('refuses to run when pasted into another spreadsheet', () => {
    expect(() => sandbox(sheets, { spreadsheetId: 'someone-else' }).run('setupTouraya')).toThrow();
  });
});
