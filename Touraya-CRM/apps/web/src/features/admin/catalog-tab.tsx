import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { OfferDTO, OfferInput, ProductDTO, ProductInput } from '@touraya/shared';
import { api } from '@/lib/api';
import { fmtDA } from '@/lib/format';
import { qk, useAdminMutation, useOffers, useProducts } from '@/lib/queries';
import { Badge, Button, Card, CardHeader, ConfirmDelete, EmptyState, Field, IconButton, Input, Modal, PageLoader, Select, Switch, TagInput } from '@/components/ui';

type TierRow = { id?: number; units: number; price: number; name: string; carrierName: string; active?: boolean };
const EMPTY_PRODUCT: ProductInput = { name: '', sku: '', sizes: [], colors: [], costPrice: 0, lowStockAlert: 3, active: true };
const pcs = (n: number) => `${n}${n === 1 ? 'pc' : 'pcs'}`;
/** Same rule as the server: "p 2pcs 3500" (first letter of the reference or name). */
const autoCarrierName = (p: { name: string; sku: string }, t: TierRow) => `${(p.sku || p.name).trim().charAt(0).toLowerCase() || 'p'} ${pcs(t.units)} ${t.price}`;

/** Price by number of pieces: 1 = 2100, 2 = 3500, 3 = 4999… Any other count uses the cheapest mix. */
function TiersEditor({ rows, onChange, product }: { rows: TierRow[]; onChange: (rows: TierRow[]) => void; product: { name: string; sku: string; costPrice: number } }) {
  const set = (i: number, patch: Partial<TierRow>) => onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const duplicate = (u: number) => rows.filter((r) => r.units === u).length > 1;
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={r.id ?? `n${i}`} className={`grid grid-cols-[5rem_1fr_auto] items-end gap-2 rounded-xl border p-2 sm:grid-cols-[5rem_8rem_1fr_1fr_auto] ${duplicate(r.units) ? 'border-danger/60' : 'border-line'}`}>
          <Field label="القطع">{(id) => <Input id={id} type="number" min={1} max={50} value={r.units} onChange={(e) => set(i, { units: Number(e.target.value) })} />}</Field>
          <Field label="السعر (دج)">
            {(id) => <Input id={id} type="number" min={0} value={r.price || ''} onChange={(e) => set(i, { price: Number(e.target.value) })} placeholder="2100" />}
          </Field>
          <IconButton className="sm:order-1" label="حذف السطر" icon={<Trash2 className="size-4" />} disabled={rows.length === 1} onClick={() => onChange(rows.filter((_, k) => k !== i))} />
          <Field label="الاسم المشفر (للطرد)" className="col-span-2 sm:col-span-1">
            {(id) => <Input id={id} dir="ltr" value={r.carrierName} onChange={(e) => set(i, { carrierName: e.target.value })} placeholder={autoCarrierName(product, r)} />}
          </Field>
          <Field label="الاسم في الفورم" className="col-span-2 sm:col-span-1">
            {(id) => <Input id={id} dir="ltr" value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder={`${product.name || 'pants'} ${pcs(r.units)} ${r.price}`} />}
          </Field>
          {r.units > 0 && r.price > 0 && (
            <p className="col-span-full text-xs text-muted sm:order-2">
              <span className="ltr">{fmtDA(Math.round(r.price / r.units))}</span> للقطعة
              {product.costPrice > 0 && <> · ربح تقريبي <span className="ltr text-ok">{fmtDA(r.price - product.costPrice * r.units)}</span></>}
              {r.active === false && <span className="text-warn"> · هذا العرض متوقف (فعّله من قائمة العروض)</span>}
            </p>
          )}
        </div>
      ))}
      <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => {
        const last = rows[rows.length - 1];
        onChange([...rows, { units: (last?.units ?? 0) + 1, price: 0, name: '', carrierName: '' }]);
      }}>
        كمية أخرى
      </Button>
    </div>
  );
}

/**
 * Pieces received per size × color: typed once here (first stock or a new
 * delivery from the supplier) and added to the stock when the product is saved.
 */
function StockGrid({ sizes, colors, product, value, onChange }: { sizes: string[]; colors: string[]; product: ProductDTO | null; value: Record<string, number>; onChange: (v: Record<string, number>) => void }) {
  const rows = sizes.length ? sizes : [''];
  const cols = colors.length ? colors : [''];
  const current = (s: string, c: string) => product?.variants.find((v) => (v.size ?? '') === s && (v.color ?? '') === c && v.active)?.stock;
  const key = (s: string, c: string) => `${s}\u0000${c}`;
  const total = Object.values(value).reduce((n, q) => n + (q || 0), 0);
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border border-line scroll-thin">
        <table className="w-full text-sm">
          <thead className="bg-subtle text-xs text-muted">
            <tr>
              <th className="px-2 py-1.5 text-start font-medium">{sizes.length ? 'المقاس' : ''}</th>
              {cols.map((c) => <th key={c} className="px-2 py-1.5 text-center font-medium">{c || 'الكمية'}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((s) => (
              <tr key={s}>
                <th className="ltr px-2 py-1.5 text-start font-semibold">{s || '—'}</th>
                {cols.map((c) => {
                  const now = current(s, c);
                  return (
                    <td key={c} className="px-1.5 py-1.5">
                      <Input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        className="h-9 min-w-16 text-center"
                        value={value[key(s, c)] || ''}
                        placeholder="+0"
                        onChange={(e) => onChange({ ...value, [key(s, c)]: Math.max(0, Number(e.target.value) || 0) })}
                        aria-label={`إضافة ${s} ${c}`}
                      />
                      {now !== undefined && <p className="mt-0.5 text-center text-[11px] text-muted">الآن {now}</p>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > 0 && <p className="text-xs text-ok">سيُضاف {total} قطعة للمخزون عند الحفظ (يُسجل في سجل المخزون كـ«دخول سلعة»).</p>}
    </div>
  );
}

function ProductForm({ product, offers, onClose }: { product: ProductDTO | null; offers: OfferDTO[]; onClose: () => void }) {
  const [form, setForm] = useState<ProductInput>(product ? { ...product } : EMPTY_PRODUCT);
  const [tiers, setTiers] = useState<TierRow[]>(() => {
    const own = offers.filter((o) => o.productId === product?.id).sort((a, b) => a.units - b.units);
    return own.length ? own.map(({ id, units, price, name, carrierName, active }) => ({ id, units, price, name, carrierName, active })) : [{ units: 1, price: 0, name: '', carrierName: '' }];
  });
  const [stockIn, setStockIn] = useState<Record<string, number>>({});
  const qc = useQueryClient();
  const save = useAdminMutation(qk.products, (v: ProductInput) => (product ? api.put(`/products/${product.id}`, v) : api.post('/products', v)));
  const remove = useAdminMutation(qk.products, () => api.delete(`/products/${product!.id}`), 'تم حذف المنتج');
  const set = <K extends keyof ProductInput>(k: K, v: ProductInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const valid = form.name.trim() && tiers.every((t) => t.units >= 1 && t.price > 0) && new Set(tiers.map((t) => t.units)).size === tiers.length;
  const done = () => {
    qc.invalidateQueries({ queryKey: qk.offers });
    qc.invalidateQueries({ queryKey: qk.movements });
    onClose();
  };
  const stockLines = Object.entries(stockIn)
    .filter(([, q]) => q > 0)
    .map(([k, quantity]) => {
      const [size, color] = k.split('\u0000');
      return { size: size ?? '', color: color ?? '', quantity };
    });
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={product ? `تعديل «${product.name}»` : 'منتج جديد'}
      footer={
        <>
          {product && (
            <span className="me-auto">
              <ConfirmDelete title={`حذف المنتج «${product.name}»`} loading={remove.isPending} onConfirm={() => remove.mutate(undefined, { onSuccess: done })}>
                <p>يختفي المنتج وكل أسعاره من القوائم ومن الطلبيات الجديدة.</p>
                <p>الطلبيات القديمة وسجل المخزون والإحصائيات تبقى كما هي.</p>
              </ConfirmDelete>
            </span>
          )}
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button variant="primary" loading={save.isPending} disabled={!valid} onClick={() => save.mutate({ ...form, tiers: tiers.map(({ active: _a, ...t }) => t), stockIn: stockLines }, { onSuccess: done })}>حفظ</Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="اسم المنتج">{(id) => <Input id={id} autoFocus={!product} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="مثلاً: سروال كارغو" />}</Field>
          <Field label="المرجع (SKU)" hint="حرفه الأول يُستعمل في الاسم المشفر">{(id) => <Input id={id} dir="ltr" value={form.sku} onChange={(e) => set('sku', e.target.value)} placeholder="PANTS" />}</Field>
          <Field label="المقاسات" hint="Enter بعد كل مقاس" className="sm:col-span-2">{() => <TagInput value={form.sizes} onChange={(v) => set('sizes', v)} placeholder="38, 40, 42 / M, L, XL" />}</Field>
          <Field label="الألوان" className="sm:col-span-2">{() => <TagInput value={form.colors} onChange={(v) => set('colors', v)} placeholder="أسود، رمادي…" />}</Field>
        </div>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">السعر حسب الكمية</h3>
          <p className="text-xs text-muted">في الطلبية يكفي تغيير عدد القطع: السعر والعرض يتغيران تلقائياً. كمية غير موجودة هنا تُحسب بأرخص مزيج (4 = 2 + 2). تغيير السعر يطبق على الطلبيات الجديدة فقط.</p>
          <TiersEditor rows={tiers} onChange={setTiers} product={{ name: form.name, sku: form.sku, costPrice: form.costPrice }} />
        </section>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{product ? 'دخول سلعة جديدة' : 'المخزون الأولي'}</h3>
          <StockGrid sizes={form.sizes} colors={form.colors} product={product} value={stockIn} onChange={setStockIn} />
        </section>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="سعر التكلفة للقطعة (دج)" hint="لحساب الربح">{(id) => <Input id={id} type="number" min={0} value={form.costPrice} onChange={(e) => set('costPrice', Number(e.target.value))} />}</Field>
          <Field label="تنبيه نقص المخزون عند">{(id) => <Input id={id} type="number" min={0} value={form.lowStockAlert} onChange={(e) => set('lowStockAlert', Number(e.target.value))} />}</Field>
          <Switch checked={form.active} onChange={(v) => set('active', v)} label="مفعل" />
        </div>
      </div>
    </Modal>
  );
}

function OfferForm({ offer, products, onClose }: { offer: OfferDTO | Partial<OfferInput>; products: ProductDTO[]; onClose: () => void }) {
  const id = 'id' in offer ? offer.id : undefined;
  const [form, setForm] = useState<OfferInput>({ productId: products[0]?.id ?? 0, name: '', carrierName: '', units: 1, price: 0, aliases: [], active: true, ...offer });
  const save = useAdminMutation(qk.offers, (v: OfferInput) => (id ? api.put(`/offers/${id}`, v) : api.post('/offers', v)));
  const remove = useAdminMutation(qk.offers, () => api.delete(`/offers/${id}`), 'تم حذف العرض');
  const set = <K extends keyof OfferInput>(k: K, v: OfferInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Modal
      open
      onClose={onClose}
      title={id ? 'تعديل العرض' : 'عرض جديد'}
      footer={
        <>
          {id && (
            <span className="me-auto">
              <ConfirmDelete title={`حذف العرض «${form.name}»`} loading={remove.isPending} onConfirm={() => remove.mutate(undefined, { onSuccess: onClose })}>
                <p>لن تدخل طلبيات جديدة بهذا العرض، ويختفي من القوائم.</p>
                <p>الطلبيات القديمة تحتفظ بالعرض وسعره. إذا كان مصدر يستعمله كعرض افتراضي، غيّره في «المصادر».</p>
              </ConfirmDelete>
            </span>
          )}
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(form, { onSuccess: onClose })}>حفظ</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="المنتج">
          {(fid) => (
            <Select id={fid} value={form.productId} onChange={(e) => set('productId', Number(e.target.value))}>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="اسم العرض (كما في Facebook)">{(fid) => <Input id={fid} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="pants 2pcs 3500" />}</Field>
        <Field label="عدد القطع">{(fid) => <Input id={fid} type="number" min={1} value={form.units} onChange={(e) => set('units', Number(e.target.value))} />}</Field>
        <Field label="السعر (دج)">{(fid) => <Input id={fid} type="number" min={0} value={form.price} onChange={(e) => set('price', Number(e.target.value))} />}</Field>
        <Field label="الاسم المشفر لشركة التوصيل" hint="ما يظهر في ملف التوصيل وعلى الطرد">{(fid) => <Input id={fid} dir="ltr" value={form.carrierName} onChange={(e) => set('carrierName', e.target.value)} placeholder="p 2pcs 3500" />}</Field>
        <Field label="أسماء أخرى للتعرف على العرض" hint="جزء من اسم الفورم/الحملة — Enter للإضافة">{() => <TagInput value={form.aliases} onChange={(v) => set('aliases', v)} />}</Field>
        <Switch checked={form.active} onChange={(v) => set('active', v)} label="مفعل" />
      </div>
    </Modal>
  );
}

/**
 * Products (what is in stock: sizes × colors) and offers (what is sold:
 * N pieces for a price). One product can have many offers: 1 = 2000, 2 = 3500…
 */
export function CatalogTab() {
  const { data: products, isLoading } = useProducts();
  const { data: offers } = useOffers();
  const [product, setProduct] = useState<ProductDTO | null | 'new'>(null);
  const [offer, setOffer] = useState<OfferDTO | Partial<OfferInput> | null>(null);
  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted">كل منتج بمقاساته وألوانه وسعره حسب الكمية (1 قطعة، 2 قطع…). في الطلبيات يتغير السعر تلقائياً مع عدد القطع.</p>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setProduct('new')}>منتج جديد</Button>
      </div>
      {!products?.length && <Card><EmptyState title="لا توجد منتجات" /></Card>}
      {products?.map((p) => {
        const list = (offers?.filter((o) => o.productId === p.id) ?? []).sort((a, b) => a.units - b.units);
        return (
          <Card key={p.id}>
            <CardHeader
              title={<>{p.name} {!p.active && <Badge tone="danger">متوقف</Badge>}</>}
              action={
                <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setProduct(p)}>تعديل المنتج والأسعار</Button>
              }
            />
            <div className="space-y-3 p-4">
              <p className="text-xs text-muted">
                المقاسات: <b className="text-fg">{p.sizes.join('، ') || '—'}</b> · الألوان: <b className="text-fg">{p.colors.join('، ') || '—'}</b> · التكلفة: <span className="ltr">{fmtDA(p.costPrice)}</span>
              </p>
              {list.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-muted">
                      <tr>{['القطع', 'السعر', 'سعر القطعة', 'الربح التقريبي', 'الاسم المشفر', 'اسم الفورم في Facebook', ''].map((h) => <th key={h} className="py-1.5 text-start font-medium">{h}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {list.map((o) => (
                        <tr key={o.id} className={o.active ? '' : 'opacity-50'}>
                          <td className="py-2 font-semibold">{o.units} {o.units === 1 ? 'قطعة' : 'قطع'}</td>
                          <td className="ltr py-2 text-right font-semibold">{fmtDA(o.price)}</td>
                          <td className="ltr py-2 text-right text-muted">{fmtDA(Math.round(o.price / o.units))}</td>
                          <td className="ltr py-2 text-right text-ok">{p.costPrice ? fmtDA(o.price - p.costPrice * o.units) : '—'}</td>
                          <td className="py-2"><code className="ltr rounded bg-subtle px-1.5 py-0.5 text-xs">{o.carrierName}</code></td>
                          <td className="py-2">
                            <button
                              className="ltr inline-flex items-center gap-1 rounded px-1 text-xs text-muted hover:bg-subtle hover:text-primary"
                              title="نسخ — سمِّ الفورم في Facebook بهذا الاسم (ثم ما تريد بعده) ليُربط تلقائياً"
                              onClick={() => navigator.clipboard.writeText(o.name).then(() => toast.success('تم نسخ اسم العرض'))}
                            >
                              {o.name} <Copy className="size-3" />
                            </button>
                          </td>
                          <td className="py-2 text-end"><Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setOffer(o)} aria-label="خيارات متقدمة (أسماء أخرى، إيقاف)" title="خيارات متقدمة" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-warn">لا توجد أسعار لهذا المنتج — أضفها من «تعديل المنتج والأسعار»</p>
              )}
            </div>
          </Card>
        );
      })}
      {product && <ProductForm product={product === 'new' ? null : product} offers={offers ?? []} onClose={() => setProduct(null)} />}
      {offer && products && <OfferForm offer={offer} products={products} onClose={() => setOffer(null)} />}
    </div>
  );
}
