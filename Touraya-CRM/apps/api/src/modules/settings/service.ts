import { eq } from 'drizzle-orm';
import { DEFAULT_EXPORT_COLUMNS, settingsSchema, type Settings } from '@touraya/shared';
import type { DbOrTx } from '../../db/client';
import { settings } from '../../db/schema';
import type { SecretBox } from '../../lib/crypto';

const KEY = 'app';

export const DEFAULT_QUICK_COMMENTS = [
  'غير اللون',
  'يريد ألوان أخرى',
  'غير المقاس',
  'يريد التفكير',
  'اتصل لاحقاً للتأكيد',
  'رقم غير صحيح',
  'يريد تأكيد مع شخص آخر',
  'الهاتف مغلق',
];

export const DEFAULT_SETTINGS: Settings = settingsSchema.parse({
  quickComments: DEFAULT_QUICK_COMMENTS,
  exportColumns: DEFAULT_EXPORT_COLUMNS,
  yalidine: {},
});

/** Settings with the Yalidine token decrypted — server-side use only. */
export async function getSettings(db: DbOrTx, box: SecretBox): Promise<Settings> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  const stored = settingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...(row?.value as object | undefined) });
  const value = stored.success ? stored.data : DEFAULT_SETTINGS;
  return { ...value, yalidine: { ...value.yalidine, apiToken: box.open(value.yalidine.apiToken) } };
}

/** Settings as shown to the browser: secrets are never sent back. */
export function toPublicSettings(s: Settings) {
  return {
    ...s,
    yalidine: { ...s.yalidine, apiToken: '', hasApiToken: Boolean(s.yalidine.apiToken) },
  };
}

export async function saveSettings(db: DbOrTx, box: SecretBox, input: Settings): Promise<Settings> {
  const current = await getSettings(db, box);
  // Empty token from the UI means "keep the current one".
  const token = input.yalidine.apiToken || current.yalidine.apiToken;
  const value = { ...input, yalidine: { ...input.yalidine, apiToken: box.seal(token) } };
  await db
    .insert(settings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
  return getSettings(db, box);
}
