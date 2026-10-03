import { and, eq, isNull } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client';
import { sources, type MetaConfig } from '../../db/schema';
import { randomToken } from '../../lib/crypto';
import { HttpError } from '../../lib/errors';
import type { SecretBox } from '../../lib/crypto';

/**
 * Facebook Lead Ads, direct: Meta calls the platform for each new lead
 * (webhook), the platform fetches the full lead with the page token. A pull
 * every few minutes catches anything a webhook missed (platform asleep…).
 * Leads go through the same import as the sheets: same Lead ID, no duplicates.
 */
export const GRAPH_VERSION = 'v23.0';
const graphBase = () => (process.env.META_GRAPH_URL ?? `https://graph.facebook.com/${GRAPH_VERSION}`).replace(/\/$/, '');

/** Fields of a lead: answers + where it came from (form, ad, campaign). */
const LEAD_FIELDS = 'id,created_time,field_data,form_id,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,platform,is_organic';

export interface MetaLead {
  id: string;
  created_time: string;
  field_data?: { name: string; values: string[] }[];
  form_id?: string;
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  platform?: string;
  is_organic?: boolean;
}

/** Meta's error, explained in Arabic for the admin. */
export class MetaError extends HttpError {
  constructor(message: string, public readonly code?: number) {
    super(400, explainMetaError(message, code));
  }
}

function explainMetaError(message: string, code?: number) {
  if (code === 190) return `الـ Token غير صالح أو انتهت صلاحيته — أنشئ Token جديداً من System User. (${message})`;
  if (code === 10 || code === 200 || code === 283) return `صلاحية ناقصة — تأكد من leads_retrieval و pages_manage_metadata و pages_show_list و ads_read، ومن إضافة الصفحة للـ System User. (${message})`;
  if (/leads.*access|Lead Access/i.test(message)) return `اسمح للتطبيق في Leads Access Manager للصفحة. (${message})`;
  return `Facebook: ${message}`;
}

export async function graph<T>(path: string, params: Record<string, string>, method: 'GET' | 'POST' | 'DELETE' = 'GET'): Promise<T> {
  const url = new URL(`${graphBase()}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url, { method });
  } catch (e) {
    throw new MetaError(`تعذر الاتصال بـ Facebook (${e instanceof Error ? e.message : e})`);
  }
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number } } & T;
  if (!res.ok || body.error) throw new MetaError(body.error?.message ?? `HTTP ${res.status}`, body.error?.code);
  return body;
}

/** Follows Graph API paging ("next" links) up to a limit. */
async function graphAll<T>(path: string, params: Record<string, string>, max = 2000): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined;
  let page = await graph<{ data: T[]; paging?: { next?: string } }>(path, params);
  for (;;) {
    out.push(...page.data);
    next = page.paging?.next;
    if (!next || out.length >= max) return out;
    const res = await fetch(next);
    page = (await res.json()) as { data: T[]; paging?: { next?: string } };
    if (!res.ok || !Array.isArray(page.data)) return out;
  }
}

/** The pages the token can manage (the admin picks one). */
export async function listPages(token: string) {
  const pages = await graphAll<{ id: string; name: string; access_token?: string }>('/me/accounts', { fields: 'id,name,access_token', limit: '100', access_token: token });
  return pages;
}

/** A lead as a sheet row: same column names as Facebook's Google Sheet, so mapping and forms work the same. */
export function leadToRow(lead: MetaLead, formName?: string): Record<string, unknown> {
  const answers = Object.fromEntries((lead.field_data ?? []).map((f) => [f.name, (f.values ?? []).join(' | ')]));
  return {
    id: `l:${lead.id}`,
    created_time: lead.created_time.replace(/\+0000$/, 'Z'),
    ad_id: lead.ad_id ?? '',
    ad_name: lead.ad_name ?? '',
    adset_id: lead.adset_id ?? '',
    adset_name: lead.adset_name ?? '',
    campaign_id: lead.campaign_id ?? '',
    campaign_name: lead.campaign_name ?? '',
    form_id: lead.form_id ? `f:${lead.form_id}` : '',
    form_name: formName ?? '',
    is_organic: lead.is_organic ? 'true' : 'false',
    platform: lead.platform ?? '',
    ...answers,
  };
}

export type FacebookSource = typeof sources.$inferSelect & { config: MetaConfig };

export async function facebookSource(db: DbOrTx): Promise<FacebookSource | null> {
  const [s] = await db.select().from(sources).where(and(eq(sources.type, 'facebook'), isNull(sources.deletedAt)));
  return s && 'appId' in s.config ? (s as FacebookSource) : null;
}

/**
 * Connects a page: keeps the app + page token (sealed), registers the
 * platform's webhook address on the app, subscribes the page to new leads.
 */
export async function connectPage(
  db: DbOrTx,
  secrets: SecretBox,
  input: { appId: string; appSecret: string; token: string; pageId: string; webhookUrl: string; importFrom: string },
) {
  const pages = await listPages(input.token);
  const page = pages.find((p) => p.id === input.pageId);
  if (!page) throw new HttpError(400, 'هذا الـ Token لا يملك الصفحة المختارة');
  if (!page.access_token) throw new HttpError(400, 'لم يُرجع Facebook مفتاح الصفحة — تأكد من صلاحية pages_show_list و pages_manage_metadata');

  const existing = await facebookSource(db);
  const config: MetaConfig = {
    appId: input.appId,
    appSecret: secrets.seal(input.appSecret),
    pageId: page.id,
    pageName: page.name,
    pageToken: secrets.seal(page.access_token),
    verifyToken: existing?.config.verifyToken ?? randomToken(18),
    connectedAt: null,
    lastPollAt: existing?.config.lastPollAt ?? null,
    lastError: null,
  };
  // Saved first: Meta checks the webhook address (verify token) while we register it.
  const [source] = existing
    ? await db.update(sources).set({ config, name: `Facebook — ${page.name}`, active: true, updatedAt: new Date() }).where(eq(sources.id, existing.id)).returning()
    : await db.insert(sources).values({ name: `Facebook — ${page.name}`, type: 'facebook', importFrom: input.importFrom, token: randomToken(), config }).returning();

  await graph(`/${input.appId}/subscriptions`, {
    object: 'page',
    callback_url: input.webhookUrl,
    fields: 'leadgen',
    verify_token: config.verifyToken,
    include_values: 'true',
    access_token: `${input.appId}|${input.appSecret}`,
  }, 'POST');
  await graph(`/${page.id}/subscribed_apps`, { subscribed_fields: 'leadgen', access_token: page.access_token }, 'POST');

  const connected = { ...config, connectedAt: new Date().toISOString() };
  await db.update(sources).set({ config: connected }).where(eq(sources.id, source!.id));
  return { ...source!, config: connected } as FacebookSource;
}

export async function disconnectPage(db: DbOrTx, secrets: SecretBox) {
  const source = await facebookSource(db);
  if (!source) return;
  try {
    await graph(`/${source.config.pageId}/subscribed_apps`, { access_token: secrets.open(source.config.pageToken) }, 'DELETE');
  } catch {
    /* already removed on Facebook's side: still disconnect here */
  }
  await db.update(sources).set({ active: false, config: { ...source.config, connectedAt: null }, updatedAt: new Date() }).where(eq(sources.id, source.id));
}

/** Reads leads: one (from a webhook) or every form's leads since a date (periodic pull). */
export function metaReader(secrets: SecretBox, source: FacebookSource) {
  const token = secrets.open(source.config.pageToken);
  const formNames = new Map<string, string>();
  const formName = async (formId?: string) => {
    if (!formId) return undefined;
    if (!formNames.has(formId)) {
      const form = await graph<{ name?: string }>(`/${formId}`, { fields: 'name', access_token: token }).catch(() => ({ name: undefined }));
      formNames.set(formId, form.name ?? '');
    }
    return formNames.get(formId) || undefined;
  };
  return {
    async lead(leadId: string) {
      const lead = await graph<MetaLead>(`/${leadId}`, { fields: LEAD_FIELDS, access_token: token });
      return leadToRow(lead, await formName(lead.form_id));
    },
    async since(since: Date) {
      const forms = await graphAll<{ id: string; name: string }>(`/${source.config.pageId}/leadgen_forms`, { fields: 'id,name', limit: '100', access_token: token });
      const rows: Record<string, unknown>[] = [];
      for (const form of forms) {
        formNames.set(form.id, form.name);
        const leads = await graphAll<MetaLead>(`/${form.id}/leads`, {
          fields: LEAD_FIELDS,
          limit: '100',
          filtering: JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: Math.floor(since.getTime() / 1000) }]),
          access_token: token,
        });
        rows.push(...leads.map((l) => leadToRow({ ...l, form_id: l.form_id ?? form.id }, form.name)));
      }
      return rows;
    },
  };
}

/** The webhook signature: HMAC-SHA256 of the raw body with the app secret. */
export async function validSignature(secrets: SecretBox, source: FacebookSource, rawBody: string, header: string | undefined) {
  if (!header?.startsWith('sha256=')) return false;
  const { createHmac, timingSafeEqual } = await import('node:crypto');
  const expected = createHmac('sha256', secrets.open(source.config.appSecret)).update(rawBody).digest();
  const given = Buffer.from(header.slice(7), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}
