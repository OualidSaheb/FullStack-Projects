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
  agentsCanShip: true,
  alwaysOn: true,
  nightPause: { enabled: false, from: 22, to: 8 },
  calculator: { usdRate: 250, confirmFee: 0, confirmFeeOn: 'confirmed', sellerDeliveryFee: 0, returnFee: 0, packagingPerOrder: 0, codFeePct: 0, returnDamagePct: 0, targetMarginPct: 20 },
};

/** Last settings read: lets the night pause be checked without touching the database. */
let current: Settings | null = null;
export const cachedSettings = () => current;

/** Algeria (UTC+1, no DST) hour inside the night pause? */
export function inNightPause(s: Settings | null = current, now = new Date()): boolean {
  if (!s?.nightPause.enabled) return false;
  const { from, to } = s.nightPause;
  const hour = (now.getUTCHours() + 1) % 24;
  return from === to ? false : from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

export async function getSettings(db: DbOrTx): Promise<Settings> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  const parsed = settingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...(row?.value as object | undefined) });
  current = parsed.success ? parsed.data : DEFAULT_SETTINGS;
  return current;
}

export async function saveSettings(db: DbOrTx, input: Settings): Promise<Settings> {
  await db
    .insert(settings)
    .values({ key: KEY, value: input })
    .onConflictDoUpdate({ target: settings.key, set: { value: input, updatedAt: new Date() } });
  return getSettings(db);
}
