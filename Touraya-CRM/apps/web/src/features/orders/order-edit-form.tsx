import { useEffect, useMemo, useState } from 'react';
import type { OrderDetail, OrderUpdate } from '@touraya/shared';
import { fmtDA } from '@/lib/format';
import { useProducts, useSettings, useUpdateOrder } from '@/lib/queries';
import { WilayaCommuneSelect } from '@/components/geo-select';
import { Button, Field, Input, Select } from '@/components/ui';

type Form = Required<Omit<OrderUpdate, 'reason'>> & { reason: string };

function toForm(o: OrderDetail): Form {
  return {
    customerName: o.customerName,
    phone: o.phone ?? '',
    phoneAlt: o.phoneAlt ?? '',
    wilayaCode: o.wilayaCode,
    communeName: o.communeName,
    address: o.address ?? '',
    productId: o.productId,
    quantity: o.quantity,
    price: o.price,
    size: o.size ?? '',
    colors: o.colors ?? '',
    reason: '',
  };
}

/** Edit customer, delivery and offer details. Only changed fields are sent; a reason becomes a comment. */
export function OrderEditForm({ order, onDone }: { order: OrderDetail; onDone: () => void }) {
  const [form, setForm] = useState(() => toForm(order));
  const { data: products } = useProducts();
  const { data: settings } = useSettings();
  const mutation = useUpdateOrder(order.id);
  useEffect(() => setForm(toForm(order)), [order]);

  const product = products?.find((p) => p.id === form.productId);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  // Changing the offer or quantity re-prices from the product list (the price stays editable).
  const changeOffer = (productId: number | null, quantity: number) => {
    const p = products?.find((x) => x.id === productId);
    setForm((f) => ({ ...f, productId, quantity, price: p ? p.price * quantity : f.price }));
  };

  const initial = useMemo(() => toForm(order), [order]);
  const changes = Object.fromEntries(
    (Object.keys(form) as (keyof Form)[])
      .filter((k) => k !== 'reason' && form[k] !== initial[k])
      .map((k) => [k, typeof form[k] === 'string' && k !== 'customerName' && k !== 'phone' ? (form[k] as string) || null : form[k]]),
  ) as OrderUpdate;
  const dirty = Object.keys(changes).length > 0;

  const save = () =>
    mutation.mutate({ ...changes, ...(form.reason.trim() ? { reason: form.reason.trim() } : {}) }, { onSuccess: onDone });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="اسم الزبون" className="col-span-2">{(id) => <Input id={id} value={form.customerName} onChange={(e) => set('customerName', e.target.value)} />}</Field>
        <Field label="الهاتف المعتمد">{(id) => <Input id={id} dir="ltr" value={form.phone} onChange={(e) => set('phone', e.target.value)} />}</Field>
        <Field label="هاتف احتياطي">{(id) => <Input id={id} dir="ltr" value={form.phoneAlt ?? ''} onChange={(e) => set('phoneAlt', e.target.value)} />}</Field>
      </div>

      <WilayaCommuneSelect
        wilayaCode={form.wilayaCode}
        communeName={form.communeName}
        communeRaw={order.communeRaw}
        onChange={(v) => setForm((f) => ({ ...f, ...v }))}
      />
      <Field label="العنوان (اختياري)" hint="إذا ترك فارغاً يستعمل اسم البلدية في ملف التوصيل">
        {(id) => <Input id={id} value={form.address ?? ''} onChange={(e) => set('address', e.target.value)} />}
      </Field>

      <div className="grid grid-cols-3 gap-3">
        <Field label="العرض" className="col-span-3">
          {(id) => (
            <Select id={id} value={form.productId ?? ''} onChange={(e) => changeOffer(e.target.value ? Number(e.target.value) : null, form.quantity)}>
              <option value="">— بدون —</option>
              {products?.filter((p) => p.active || p.id === form.productId).map((p) => (
                <option key={p.id} value={p.id}>{p.name} — {fmtDA(p.price)}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="الكمية" className="col-span-3 sm:col-span-1">{(id) => <Input id={id} type="number" min={1} max={50} value={form.quantity} onChange={(e) => changeOffer(form.productId, Math.max(1, Number(e.target.value)))} />}</Field>
        <Field label="السعر (دج)" className="col-span-3 sm:col-span-2" hint={product ? `سعر القائمة: ${fmtDA(product.price * form.quantity)}` : undefined}>
          {(id) => <Input id={id} type="number" min={0} value={form.price} onChange={(e) => set('price', Number(e.target.value))} />}
        </Field>
        <Field label="المقاس" className="col-span-3 sm:col-span-1">
          {(id) =>
            product?.sizes.length ? (
              <Select id={id} value={form.size ?? ''} onChange={(e) => set('size', e.target.value)}>
                <option value="">—</option>
                {[...new Set([...(form.size ? [form.size] : []), ...product.sizes])].map((s) => <option key={s}>{s}</option>)}
              </Select>
            ) : (
              <Input id={id} value={form.size ?? ''} onChange={(e) => set('size', e.target.value)} />
            )
          }
        </Field>
        <Field label="الألوان" className="col-span-3 sm:col-span-2" hint={product?.colors.length ? `المتوفر: ${product.colors.join('، ')}` : undefined}>
          {(id) => <Input id={id} value={form.colors ?? ''} onChange={(e) => set('colors', e.target.value)} />}
        </Field>
      </div>

      <Field label="سبب التعديل (يضاف كتعليق)">
        {(id) => (
          <div className="space-y-2">
            <Input id={id} value={form.reason} onChange={(e) => set('reason', e.target.value)} placeholder="مثلاً: غير اللون" />
            <div className="flex flex-wrap gap-1.5">
              {settings?.quickComments.map((c) => (
                <button key={c} type="button" onClick={() => set('reason', c)} className="rounded-full border border-line px-2.5 py-1 text-xs text-muted hover:border-primary hover:text-primary">
                  {c}
                </button>
              ))}
            </div>
          </div>
        )}
      </Field>

      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button variant="ghost" onClick={onDone}>إلغاء</Button>
        <Button variant="primary" disabled={!dirty} loading={mutation.isPending} onClick={save}>
          حفظ التعديلات
        </Button>
      </div>
    </div>
  );
}
