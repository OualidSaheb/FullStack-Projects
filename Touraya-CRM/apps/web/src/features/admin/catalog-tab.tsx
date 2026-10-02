import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import type { OfferDTO, OfferInput, ProductDTO, ProductInput } from '@touraya/shared';
import { api } from '@/lib/api';
import { fmtDA } from '@/lib/format';
import { qk, useAdminMutation, useOffers, useProducts } from '@/lib/queries';
import { Badge, Button, Card, CardHeader, ConfirmDelete, EmptyState, Field, Input, Modal, PageLoader, Select, Switch, TagInput } from '@/components/ui';

const EMPTY_PRODUCT: ProductInput = { name: '', sku: '', sizes: [], colors: [], costPrice: 0, lowStockAlert: 3, active: true };

function ProductForm({ product, onClose }: { product: ProductDTO | null; onClose: () => void }) {
  const [form, setForm] = useState<ProductInput>(product ?? EMPTY_PRODUCT);
  const save = useAdminMutation(qk.products, (v: ProductInput) => (product ? api.put(`/products/${product.id}`, v) : api.post('/products', v)));
  const qc = useQueryClient();
  const remove = useAdminMutation(qk.products, () => api.delete(`/products/${product!.id}`), 'تم حذف المنتج');
  const set = <K extends keyof ProductInput>(k: K, v: ProductInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Modal
      open
      onClose={onClose}
      title={product ? 'تعديل المنتج' : 'منتج جديد'}
      footer={
        <>
          {product && (
            <span className="me-auto">
              <ConfirmDelete title={`حذف المنتج «${product.name}»`} loading={remove.isPending} onConfirm={() => remove.mutate(undefined, { onSuccess: () => { qc.invalidateQueries({ queryKey: qk.offers }); onClose(); } })}>
                <p>يختفي المنتج وكل عروضه من القوائم ومن الطلبيات الجديدة.</p>
                <p>الطلبيات القديمة وسجل المخزون والإحصائيات تبقى كما هي.</p>
              </ConfirmDelete>
            </span>
          )}
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(form, { onSuccess: onClose })}>حفظ</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="اسم المنتج">{(id) => <Input id={id} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="مثلاً: سروال كارغو" />}</Field>
        <Field label="المرجع (SKU)">{(id) => <Input id={id} dir="ltr" value={form.sku} onChange={(e) => set('sku', e.target.value)} />}</Field>
        <Field label="المقاسات" hint="Enter بعد كل مقاس — تُنشأ خانة مخزون لكل مقاس × لون" className="sm:col-span-2">{() => <TagInput value={form.sizes} onChange={(v) => set('sizes', v)} placeholder="38, 40, 42 / M, L, XL" />}</Field>
        <Field label="الألوان" className="sm:col-span-2">{() => <TagInput value={form.colors} onChange={(v) => set('colors', v)} placeholder="أسود، رمادي…" />}</Field>
        <Field label="سعر التكلفة للقطعة (دج)" hint="لحساب الربح">{(id) => <Input id={id} type="number" min={0} value={form.costPrice} onChange={(e) => set('costPrice', Number(e.target.value))} />}</Field>
        <Field label="تنبيه نقص المخزون عند">{(id) => <Input id={id} type="number" min={0} value={form.lowStockAlert} onChange={(e) => set('lowStockAlert', Number(e.target.value))} />}</Field>
        <Switch checked={form.active} onChange={(v) => set('active', v)} label="مفعل" />
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
        <p className="text-sm text-muted">المنتج = السلعة في المخزن (المقاسات والألوان). العرض = ما يُباع في الإعلان (عدد القطع والسعر). منتج واحد يمكن أن يكون له عدة عروض.</p>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setProduct('new')}>منتج جديد</Button>
      </div>
      {!products?.length && <Card><EmptyState title="لا توجد منتجات" /></Card>}
      {products?.map((p) => {
        const list = offers?.filter((o) => o.productId === p.id) ?? [];
        return (
          <Card key={p.id}>
            <CardHeader
              title={<>{p.name} {!p.active && <Badge tone="danger">متوقف</Badge>}</>}
              action={
                <div className="flex gap-1">
                  <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setProduct(p)}>تعديل</Button>
                  <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setOffer({ productId: p.id })}>عرض</Button>
                </div>
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
                      <tr>{['العرض', 'القطع', 'السعر', 'سعر القطعة', 'الربح التقريبي', 'الاسم المشفر', ''].map((h) => <th key={h} className="py-1.5 text-start font-medium">{h}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {list.map((o) => (
                        <tr key={o.id} className={o.active ? '' : 'opacity-50'}>
                          <td className="py-2 font-medium">{o.name}</td>
                          <td className="ltr py-2 text-right">{o.units}</td>
                          <td className="ltr py-2 text-right">{fmtDA(o.price)}</td>
                          <td className="ltr py-2 text-right text-muted">{fmtDA(Math.round(o.price / o.units))}</td>
                          <td className="ltr py-2 text-right text-ok">{p.costPrice ? fmtDA(o.price - p.costPrice * o.units) : '—'}</td>
                          <td className="py-2"><code className="ltr rounded bg-subtle px-1.5 py-0.5 text-xs">{o.carrierName}</code></td>
                          <td className="py-2 text-end"><Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setOffer(o)} aria-label="تعديل" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-faint">لا توجد عروض لهذا المنتج</p>
              )}
            </div>
          </Card>
        );
      })}
      {product && <ProductForm product={product === 'new' ? null : product} onClose={() => setProduct(null)} />}
      {offer && products && <OfferForm offer={offer} products={products} onClose={() => setOffer(null)} />}
    </div>
  );
}
