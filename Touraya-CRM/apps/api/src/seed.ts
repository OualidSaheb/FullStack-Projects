import { count, eq } from 'drizzle-orm';
import type { ProductInput } from '@touraya/shared';
import type { Db } from './db/client';
import { products, sources, users } from './db/schema';
import { hashPassword, randomToken } from './lib/crypto';
import { ingestRows } from './modules/ingest/service';

export const DEFAULT_IMPORT_FROM = '2026-09-27';

const PRODUCTS: ProductInput[] = [
  { name: 'pants 2pcs 3500', carrierName: 'p 2pcs 3500', price: 3500, aliases: ['pants offer 2', 'pants 2pcs'], sizes: [], colors: [], active: true },
  { name: 'pants 3pcs 4999', carrierName: 'p 3pcs 4999', price: 4999, aliases: ['pants offer 3', 'pants 3pcs'], sizes: [], colors: [], active: true },
  { name: 'suit white - 6500', carrierName: 's white - 6500', price: 6500, aliases: ['suit white'], sizes: [], colors: [], active: true },
];

/** The five offer sheets in use (order as listed in the project brief — check the ids in Admin → Sources). */
const SOURCES = [
  { name: 'pants offer 2-3500 - DZ - More volume', spreadsheetId: '1XGaQQv1aSSQlypaw8qXGYUSg0lbGeYDiI9BGhfeNbBk', formType: 'new', product: 'pants 2pcs 3500' },
  { name: 'pants offer 3 - 4999 - DZ - More volume', spreadsheetId: '1xqtV0XoRzd4aUfxki4ck3ccQilD_Yv_eQXYSJY01hyA', formType: 'new', product: 'pants 3pcs 4999' },
  { name: 'suit white - 6500 - DZ - More volume', spreadsheetId: '1DjOF64z44rNrXw6m2895qQFBV19EEfnXd6QtP-s5Ihs', formType: 'new', product: 'suit white - 6500' },
  { name: 'pants 2pcs 3500 (قديم)', spreadsheetId: '19UVzb17QrK62iA1LnugbQdQ_MseL6_SIFj7-VV-gEuU', formType: 'legacy', product: 'pants 2pcs 3500' },
  { name: 'pants 3pcs 4999 (قديم)', spreadsheetId: '1a0LDp0LuDOru4cgvkrrDOWbBx3e79DZjkB5XAHUxlaA', formType: 'legacy', product: 'pants 3pcs 4999' },
] as const;

/** Idempotent first-run setup: admin account, product list and sources. */
export async function ensureBootstrap(db: Db, log: (msg: string) => void = console.log) {
  const [{ n: userCount } = { n: 0 }] = await db.select({ n: count() }).from(users);
  if (userCount === 0) {
    const email = (process.env.ADMIN_EMAIL ?? 'admin@touraya.local').toLowerCase();
    const password = process.env.ADMIN_PASSWORD ?? 'touraya-admin';
    await db.insert(users).values({ name: 'Admin', email, role: 'admin', passwordHash: await hashPassword(password) });
    log(`Created admin account ${email}${process.env.ADMIN_PASSWORD ? '' : ` / ${password} — change it after first login`}`);
  }

  const [{ n: productCount } = { n: 0 }] = await db.select({ n: count() }).from(products);
  if (productCount === 0) await db.insert(products).values(PRODUCTS);

  const [{ n: sourceCount } = { n: 0 }] = await db.select({ n: count() }).from(sources);
  if (sourceCount === 0) {
    const catalog = await db.select().from(products);
    await db.insert(sources).values(
      SOURCES.map((s) => ({
        name: s.name,
        spreadsheetId: s.spreadsheetId,
        formType: s.formType,
        productId: catalog.find((p) => p.name === s.product)?.id ?? null,
        sheetNames: ['Sheet1', 'Sheet2'],
        importFrom: DEFAULT_IMPORT_FROM,
        token: randomToken(),
      })),
    );
  }
}

/** Fake leads to try the UI locally (npm run db:seed -- --demo). */
export async function seedDemo(db: Db) {
  const [source] = await db.select().from(sources).where(eq(sources.formType, 'new')).limit(1);
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
        'المقاس': ['M', 'L', 'XL', '42', '44'][i % 5],
        'الألوان_المطلوبة': ['أسود_رمادي', 'أزرق_بيج', 'أسود_أزرق_بني'][i % 3],
      },
    };
  });
  const result = await ingestRows(db, source, { sheetName: 'Sheet1', rows }, { importFrom: '2000-01-01' });
  console.log(`Demo: ${result.created} orders created, ${result.duplicates} duplicates`);
}
