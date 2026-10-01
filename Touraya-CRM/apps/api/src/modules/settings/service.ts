import { eq } from 'drizzle-orm';
import { DEFAULT_CALL_POLICY, settingsSchema, type Settings } from '@touraya/shared';
import type { DbOrTx } from '../../db/client';
import { settings } from '../../db/schema';

const KEY = 'app';

export const DEFAULT_SETTINGS: Settings = {
  quickComments: [
    'غير اللون',
    'يريد ألوان أخرى',
    'غير المقاس',
    'يريد التفكير',
    'اتصل لاحقاً للتأكيد',
    'رقم غير صحيح',
    'يريد تأكيد مع شخص آخر',
    'الهاتف مغلق',
  ],
  cancelReasons: [
    'السعر غالي',
    'سعر التوصيل غالي',
    'طلب بالخطأ',
    'لم يطلب (طلب وهمي)',
    'طلب مكرر',
    'غير رأيه',
    'لا يرد بعد كل المحاولات',
    'المنطقة لا يصلها التوصيل',
  ],
  callPolicy: DEFAULT_CALL_POLICY,
  assignment: 'manual',
  duplicateWindowDays: 3,
};

export async function getSettings(db: DbOrTx): Promise<Settings> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  const parsed = settingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...(row?.value as object | undefined) });
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function saveSettings(db: DbOrTx, input: Settings): Promise<Settings> {
  await db
    .insert(settings)
    .values({ key: KEY, value: input })
    .onConflictDoUpdate({ target: settings.key, set: { value: input, updatedAt: new Date() } });
  return getSettings(db);
}
