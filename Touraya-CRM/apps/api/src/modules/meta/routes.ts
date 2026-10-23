import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { sources } from '../../db/schema';
import { HttpError } from '../../lib/errors';
import { ingestRows } from '../ingest/service';
import { scheduleJob } from '../../lib/schedule';
import { cachedSettings, inNightPause } from '../settings/service';
import { publicUrl } from '../sources/routes';
import { connectPage, disconnectPage, facebookSources, listPages, metaReader, validSignature, type FacebookSource } from './service';

/**
 * The webhook brings leads within seconds; the pull is the safety net (and the
 * only way in when Meta sends no webhook). Platform always on: every 5 minutes
 * (the database is awake anyway). Otherwise hourly, like the carrier check, so
 * the database can sleep between runs.
 */
const pullEvery = () => (cachedSettings()?.alwaysOn ?? true ? 5 * 60_000 : 60 * 60_000);
/** Leads re-read on each pull before the last one (overlap: nothing slips between two pulls). */
const PULL_OVERLAP_MS = 60 * 60_000;
/** First pull after connecting a page: the last days (leads already in through a sheet are not doubled). */
const FIRST_PULL_DAYS = 7;

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

/** Every connected page's recent leads: the safety net behind the webhook. */
export async function pullLeads(app: FastifyInstance) {
  let created = 0;
  let checked = 0;
  const errors: string[] = [];
  for (const source of await facebookSources(app.db)) {
    if (!source.active || !source.config.connectedAt) continue;
    try {
      const r = await pullPage(app, source);
      created += r.created;
      checked += r.checked;
    } catch (e) {
      errors.push(`${source.config.pageName}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (errors.length && !created && !checked) throw new Error(errors.join(' · '));
  return { created, checked };
}

async function pullPage(app: FastifyInstance, source: FacebookSource) {
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
 * webhook for each new lead; an hourly pull catches anything missed.
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
    const pages = (await facebookSources(app.db))
      .filter((s) => s.active && s.config.connectedAt)
      .map((s) => ({
        id: s.id,
        appId: s.config.appId,
        pageId: s.config.pageId,
        pageName: s.config.pageName,
        connectedAt: s.config.connectedAt,
        lastPollAt: s.config.lastPollAt ?? null,
        lastError: s.config.lastError ?? null,
        lastWebhookAt: s.config.lastWebhookAt ?? null,
        lastSyncAt: s.lastSyncAt?.toISOString() ?? null,
      }));
    return { webhookUrl: webhookUrl(req), connected: pages.length > 0, pages };
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

  app.delete('/meta/:id', manage, async (req) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    await disconnectPage(app.db, app.secrets, id);
    return { ok: true };
  });

  /** Meta checks the address once, when the webhook is registered. */
  app.get('/meta/webhook', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const known = (await facebookSources(app.db)).some((s) => s.config.verifyToken === q['hub.verify_token']);
    if (q['hub.mode'] !== 'subscribe' || !known) throw new HttpError(403, 'forbidden');
    return reply.type('text/plain').send(q['hub.challenge'] ?? '');
  });

  /** A new lead: answered at once (Meta retries slow answers), then fetched and imported into its page's source. */
  app.post('/meta/webhook', async (req, reply) => {
    // Night pause: the database sleeps; the morning pull brings this lead (Facebook keeps them 90 days).
    if (inNightPause()) return reply.send({ ok: true, deferred: true });
    const raw = (req as unknown as { rawBody?: string }).rawBody ?? '';
    const all = (await facebookSources(app.db)).filter((s) => s.active);
    if (!all.length) throw new HttpError(403, 'not connected');
    const now = new Date().toISOString();
    // Pages of the same app share its secret; another app's pages have their own.
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const signed: FacebookSource[] = [];
    for (const s of all) if (await validSignature(app.secrets, s, raw, signature)) signed.push(s);
    if (!signed.length) {
      for (const s of all)
        await setStatus(app, s, {
          lastWebhookAt: now,
          lastError: 'وصل إشعار من Facebook لكن توقيعه غير صحيح: الـ App Secret الملصق في المنصة ليس سر تطبيق Touraya CRM. اضغط «تغيير» وأعد الربط بالـ App Secret الصحيح.',
        }).catch(() => {});
      throw new HttpError(403, 'bad signature');
    }
    const body = req.body as { entry?: { id?: string; changes?: { field?: string; value?: { leadgen_id?: string; page_id?: string } }[] }[] };
    const byPage = new Map<FacebookSource, string[]>();
    for (const e of body.entry ?? []) {
      for (const c of e.changes ?? []) {
        if (c.field !== 'leadgen' || !c.value?.leadgen_id) continue;
        const pageId = c.value.page_id ?? e.id;
        const source = signed.find((s) => s.config.pageId === pageId);
        if (source) byPage.set(source, [...(byPage.get(source) ?? []), c.value.leadgen_id]);
      }
    }
    for (const s of byPage.size ? byPage.keys() : signed) await setStatus(app, s, { lastWebhookAt: now, lastError: null }).catch(() => {});
    reply.send({ ok: true });
    for (const [source, leadIds] of byPage) {
      const reader = metaReader(app.secrets, source);
      void (async () => {
        const rows: Record<string, unknown>[] = [];
        for (const id of leadIds) rows.push(await reader.lead(id));
        await importRows(app, source, rows);
      })().catch(async (e) => {
        req.log.error({ err: e }, 'facebook lead fetch failed (the next pull will retry)');
        await setStatus(app, source, { lastError: e instanceof Error ? e.message : String(e) }).catch(() => {});
      });
    }
    return reply;
  });

  // Safety net: pull every form's recent leads regularly; after the night pause, the whole night's.
  scheduleJob(app, 'facebook pull', pullEvery, () => pullLeads(app));
};
