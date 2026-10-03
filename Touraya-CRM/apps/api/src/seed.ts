import { count, eq } from 'drizzle-orm';
import { defaultCarrierConfig } from '@touraya/shared';
import type { Db } from './db/client';
import { carriers, offers, products, sources, users, variants } from './db/schema';
import { hashPassword, randomToken } from './lib/crypto';
import { syncVariants } from './modules/catalog/service';
import { backfillForms } from './modules/forms/service';
import { ingestRows } from './modules/ingest/service';
import { moveStock } from './modules/inventory/service';

export const DEFAULT_IMPORT_FROM = '2026-09-27';

/** Current catalog: products, and the offers sold on Facebook with their coded carrier names. */
const CATALOG = [
  {
    product: { name: 'Pants', sku: 'PANTS' },
    offers: [
      { name: 'pants 2pcs 3500', carrierName: 'p 2pcs 3500', units: 2, price: 3500, aliases: ['pants offer 2', 'pants 2pcs'] },
      { name: 'pants 3pcs 4999', carrierName: 'p 3pcs 4999', units: 3, price: 4999, aliases: ['pants offer 3', 'pants 3pcs'] },
    ],
  },
  {
    product: { name: 'Suit white', sku: 'SUIT-W' },
    offers: [{ name: 'suit white - 6500', carrierName: 's white - 6500', units: 1, price: 6500, aliases: ['suit white'] }],
  },
];

/** The five offer sheets in use (order as listed in the project brief — check the ids in Admin → Sources). */
const SOURCES = [
  { name: 'pants offer 2-3500 - DZ - More volume', spreadsheetId: '1XGaQQv1aSSQlypaw8qXGYUSg0lbGeYDiI9BGhfeNbBk', formType: 'new', offer: 'pants 2pcs 3500' },
  { name: 'pants offer 3 - 4999 - DZ - More volume', spreadsheetId: '1xqtV0XoRzd4aUfxki4ck3ccQilD_Yv_eQXYSJY01hyA', formType: 'new', offer: 'pants 3pcs 4999' },
  { name: 'suit white - 6500 - DZ - More volume', spreadsheetId: '1DjOF64z44rNrXw6m2895qQFBV19EEfnXd6QtP-s5Ihs', formType: 'new', offer: 'suit white - 6500' },
  { name: 'pants 2pcs 3500 (قديم)', spreadsheetId: '19UVzb17QrK62iA1LnugbQdQ_MseL6_SIFj7-VV-gEuU', formType: 'legacy', offer: 'pants 2pcs 3500' },
  { name: 'pants 3pcs 4999 (قديم)', spreadsheetId: '1a0LDp0LuDOru4cgvkrrDOWbBx3e79DZjkB5XAHUxlaA', formType: 'legacy', offer: 'pants 3pcs 4999' },
] as const;

const isEmpty = async (db: Db, table: typeof users | typeof products | typeof sources | typeof carriers) =>
  ((await db.select({ n: count() }).from(table))[0]?.n ?? 0) === 0;

/** Default Drive folder read by the single Apps Script. */
export const DRIVE_FOLDER = 'Touraya Leads';

/** Idempotent first-run setup: admin account, catalog, default carrier and sources. */
export async function ensureBootstrap(db: Db, log: (msg: string) => void = console.log) {
  if (await isEmpty(db, users)) {
    const email = (process.env.ADMIN_EMAIL ?? 'admin@touraya.local').toLowerCase();
    const password = process.env.ADMIN_PASSWORD ?? 'touraya-admin';
    await db.insert(users).values({ name: 'Admin', email, role: 'admin', passwordHash: await hashPassword(password) });
    log(`Created admin account ${email}${process.env.ADMIN_PASSWORD ? '' : ` / ${password} — change it after first login`}`);
  }

  if (await isEmpty(db, products)) {
    for (const entry of CATALOG) {
      const [p] = await db.insert(products).values(entry.product).returning();
      await syncVariants(db, p!);
      await db.insert(offers).values(entry.offers.map((o) => ({ ...o, productId: p!.id })));
    }
  }

  if (await isEmpty(db, carriers)) {
    await db.insert(carriers).values({ name: 'Yalidine', provider: 'yalidine', isDefault: true, config: defaultCarrierConfig('yalidine') });
  }

  if (await isEmpty(db, sources)) {
    const allOffers = await db.select().from(offers);
    await db.insert(sources).values(
      SOURCES.map((s) => ({
        name: s.name,
        type: 'google_sheet' as const,
        spreadsheetId: s.spreadsheetId,
        formType: s.formType,
        offerId: allOffers.find((o) => o.name === s.offer)?.id ?? null,
        importFrom: DEFAULT_IMPORT_FROM,
        token: randomToken(),
      })),
    );
  }

  // One Drive folder connection for every new form/sheet (added to existing installs too).
  const [drive] = await db.select({ id: sources.id }).from(sources).where(eq(sources.type, 'google_drive'));
  if (!drive) {
    await db.insert(sources).values({ name: 'Google Drive — Touraya Leads', type: 'google_drive', folderName: DRIVE_FOLDER, importFrom: DEFAULT_IMPORT_FROM, token: randomToken() });
  }

  // Orders imported before forms existed get their form (statistics per form cover the history).
  const linked = await backfillForms(db);
  if (linked) log(`Linked ${linked} existing orders to their Facebook forms`);
}

/** Fake options, stock and leads to try the UI locally (npm run db:seed -- --demo). */
export async function seedDemo(db: Db) {
  const [pants] = await db.select().from(products).where(eq(products.sku, 'PANTS'));
  if (pants) {
    const [p] = await db
      .update(products)
      .set({ sizes: ['38', '40', '42', '44', '46'], colors: ['أسود', 'رمادي', 'بني', 'أزرق', 'بيج'], costPrice: 900 })
      .where(eq(products.id, pants.id))
      .returning();
    await syncVariants(db, p!);
    const vs = await db.select().from(variants).where(eq(variants.productId, pants.id));
    await moveStock(db, vs.map((v, i) => ({ variantId: v.id, type: 'purchase' as const, quantity: 4 + (i % 5) * 3, note: 'مخزون تجريبي' })));
  }

  const [source] = await db.select().from(sources).where(eq(sources.name, SOURCES[1].name));
  if (!source) return;
  const names = ['Karim Benali', 'Sara Haddad', 'Yacine Mebarki', 'Amina Cherif', 'Walid Bouzid', 'Nadia Kaci', 'Riad Saadi', 'Lina Ferhat'];
  const places = [['الجزائر', 'باب الزوار'], ['وهران', 'بئر الجير'], ['سطيف', 'العلمة'], ['بجاية', 'أقبو'], ['قسنطينة', 'الخروب'], ['البليدة', 'بوفاريك'], ['تيزي وزو', 'عزازقة'], ['باتنة', 'بريكة']];
  const rows = Array.from({ length: 40 }, (_, i) => {
    const [wilaya, commune] = places[i % places.length]!;
    const phone = `05${String(50000000 + i * 1234567).slice(0, 8)}`;
    return {
      rowNumber: i + 2,
      values: {
        id: `l:demo${1000 + i}`,
        created_time: new Date(Date.now() - i * 3 * 3600 * 1000).toISOString(),
        form_name: source.name,
        full_name: names[i % names.length],
        phone_number: `p:+213${phone.slice(1)}`,
        'رقمك_الخاص_للتواصل_معاك': i % 7 === 3 ? phone.slice(0, 8) : phone,
        'الولاية': wilaya,
        'البلدية': i % 9 === 4 ? `${commune}x` : commune,
        'المقاس': ['40', '42', '44', '38', 'L'][i % 5],
        'الألوان_المطلوبة': ['أسود_رمادي_بني', 'أزرق_بيج_أسود', 'أسود_أحمر'][i % 3],
      },
    };
  });
  const result = await ingestRows(db, source, { sheetName: 'Sheet1', rows }, { importFrom: '2000-01-01' });
  console.log(`Demo: ${result.created} orders created, ${result.duplicates} duplicates`);
}
