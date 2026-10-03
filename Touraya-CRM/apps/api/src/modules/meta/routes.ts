import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { sources } from '../../db/schema';
import { HttpError } from '../../lib/errors';
import { ingestRows } from '../ingest/service';
import { publicUrl } from '../sources/routes';
import { connectPage, disconnectPage, facebookSource, listPages, metaReader, validSignature, type FacebookSource } from './service';

const PULL_EVERY_MS = 10 * 60_000;
/** Leads re-read on each pull before the last one (overlap: nothing slips between two pulls). */
const PULL_OVERLAP_MS = 60 * 60_000;
/** First pull after connecting: the last days (older leads came through the sheets). */
const FIRST_PULL_DAYS = 3;

const credentials = z.object({ appId: z.string().trim().regex(/^\d+$/, 'App ID أرقام فقط'), appSecret: z.string().trim().min(10), token: z.string().trim().min(20) });

/** Leads (as sheet rows) into the usual import: forms, offers, duplicates, live alerts. */
async function importRows(app: FastifyInstance, source: FacebookSource, rows: Record<string, unknown>[]) {
  let created = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200).map((values, k) => ({ rowNumber: i + k + 1, values }));
    const { createdIds } = await ingestRows(app.db, source, { sheetName: 'Facebook', rows: batch });
    if (createdIds.length) app.events.emit('order.created', createdIds.map((orderId) => ({ orderId, sourceId: source.id })));
    created += createdIds.length;
  }
  return created;
}

async function setStatus(app: FastifyInstance, source: FacebookSource, patch: Partial<FacebookSource['config']>) {
  const [fresh] = await app.db.select({ config: sources.config }).from(sources).where(eq(sources.id, source.id));
  await app.db.update(sources).set({ config: { ...(fresh?.config as FacebookSource['config']), ...patch }, lastSyncAt: new Date() }).where(eq(sources.id, source.id));
}

/** Every form's recent leads: the safety net behind the webhook. */
export async function pullLeads(app: FastifyInstance) {
  const source = await facebookSource(app.db);
  if (!source?.active || !source.config.connectedAt) return { created: 0 };
  const startedAt = new Date();
  const last = source.config.lastPollAt ? new Date(source.config.lastPollAt).getTime() - PULL_OVERLAP_MS : Date.now() - FIRST_PULL_DAYS * 86400_000;
  try {
    const rows = await metaReader(app.secrets, source).since(new Date(last));
    const created = await importRows(app, source, rows);
    await setStatus(app, source, { lastPollAt: startedAt.toISOString(), lastError: null });
    return { created, checked: rows.length };
  } catch (e) {
    await setStatus(app, source, { lastError: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}

/**
 * Facebook Lead Ads connected directly (no Google Sheet): Meta calls the
 * webhook for each new lead; a pull every 10 minutes catches anything missed.
 */
export const metaRoutes: FastifyPluginAsync = async (app) => {
  const manage = { preHandler: app.requirePermission('sources.manage') };
  const webhookUrl = (req: Parameters<typeof publicUrl>[1]) => `${publicUrl(app, req)}/api/meta/webhook`;

  // The webhook signature is computed on the exact bytes Meta sent.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as unknown as { rawBody: string }).rawBody = body as string;
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch (e) {
      done(e as Error, undefined);
    }
  });

  app.get('/meta', manage, async (req) => {
    const s = await facebookSource(app.db);
    return {
      webhookUrl: webhookUrl(req),
      connected: Boolean(s?.active && s.config.connectedAt),
      appId: s?.config.appId ?? null,
      pageId: s?.config.pageId ?? null,
      pageName: s?.config.pageName ?? null,
      connectedAt: s?.config.connectedAt ?? null,
      lastPollAt: s?.config.lastPollAt ?? null,
      lastError: s?.config.lastError ?? null,
      lastSyncAt: s?.lastSyncAt?.toISOString() ?? null,
    };
  });

  /** Step 1: check the app + token and list the pages it manages. */
  app.post('/meta/pages', manage, async (req) => {
    const input = credentials.parse(req.body);
    return (await listPages(input.token)).map((p) => ({ id: p.id, name: p.name }));
  });

  /** Step 2: connect the chosen page (webhook registered, page subscribed), then bring the last days' leads. */
  app.post('/meta/connect', manage, async (req) => {
    const input = credentials.extend({ pageId: z.string().trim().min(1) }).parse(req.body);
    const source = await connectPage(app.db, app.secrets, { ...input, webhookUrl: webhookUrl(req), importFrom: new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10) });
    const pulled = await pullLeads(app).catch(() => ({ created: 0 }));
    return { pageName: source.config.pageName, created: pulled.created };
  });

  app.post('/meta/pull', manage, async () => pullLeads(app));

  app.delete('/meta', manage, async () => {
    await disconnectPage(app.db, app.secrets);
    return { ok: true };
  });

  /** Meta checks the address once, when the webhook is registered. */
  app.get('/meta/webhook', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const source = await facebookSource(app.db);
    if (q['hub.mode'] !== 'subscribe' || !source || q['hub.verify_token'] !== source.config.verifyToken) throw new HttpError(403, 'forbidden');
    return reply.type('text/plain').send(q['hub.challenge'] ?? '');
  });

  /** A new lead: answered at once (Meta retries slow answers), then fetched and imported. */
  app.post('/meta/webhook', async (req, reply) => {
    const source = await facebookSource(app.db);
    const raw = (req as unknown as { rawBody?: string }).rawBody ?? '';
    if (!source?.active || !(await validSignature(app.secrets, source, raw, req.headers['x-hub-signature-256'] as string | undefined))) {
      throw new HttpError(403, 'bad signature');
    }
    const body = req.body as { entry?: { changes?: { field?: string; value?: { leadgen_id?: string; page_id?: string } }[] }[] };
    const leadIds = (body.entry ?? []).flatMap((e) =>
      (e.changes ?? []).flatMap((c) => (c.field === 'leadgen' && c.value?.leadgen_id && (!c.value.page_id || c.value.page_id === source.config.pageId) ? [c.value.leadgen_id] : [])),
    );
    reply.send({ ok: true });
    if (!leadIds.length) return reply;
    const reader = metaReader(app.secrets, source);
    void (async () => {
      const rows: Record<string, unknown>[] = [];
      for (const id of leadIds) rows.push(await reader.lead(id));
      await importRows(app, source, rows);
    })().catch(async (e) => {
      req.log.error({ err: e }, 'facebook lead fetch failed (the next pull will retry)');
      await setStatus(app, source, { lastError: e instanceof Error ? e.message : String(e) }).catch(() => {});
    });
    return reply;
  });

  // Safety net: pull every form's recent leads regularly (not in tests).
  if (app.config.NODE_ENV !== 'test') {
    const timer = setInterval(() => void pullLeads(app).catch((e) => app.log.warn({ err: e }, 'facebook pull failed')), PULL_EVERY_MS);
    app.addHook('onClose', async () => clearInterval(timer));
  }
};
