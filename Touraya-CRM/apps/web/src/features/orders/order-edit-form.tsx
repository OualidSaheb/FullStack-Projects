import { useEffect, useMemo, useState } from 'react';
import { DELIVERY_TYPES, type DeliveryType, type OrderDetail, type OrderUpdate } from '@touraya/shared';
import { fmtDA } from '@/lib/format';
import { useCarriers, useOffers, useSettings, useUpdateOrder } from '@/lib/queries';
import { WilayaCommuneSelect } from '@/components/geo-select';
import { Button, Field, Input, Select } from '@/components/ui';

type Form = {
  customerName: string;
  phone: string;
  phoneAlt: string;
  wilayaCode: number | null;
  communeName: string | null;
  address: string;
  offerId: number | null;
  price: number;
  deliveryType: DeliveryType;
  stopdeskId: string;
  carrierId: number | null;
  reason: string;
};

const toForm = (o: OrderDetail): Form => ({
  customerName: o.customerName,
  phone: o.phone ?? '',
  phoneAlt: o.phoneAlt ?? '',
  wilayaCode: o.wilayaCode,
  communeName: o.communeName,
  address: o.address ?? '',
  offerId: o.offerId,
  price: o.price,
  deliveryType: o.deliveryType,
  stopdeskId: o.stopdeskId ?? '',
  carrierId: o.carrierId,
  reason: '',
});

const NULLABLE_TEXT = new Set<keyof Form>(['phoneAlt', 'address', 'stopdeskId']);

/** Edit customer, delivery and offer. Only changed fields are sent; a reason becomes a comment. Pieces are edited in ItemsEditor. */
export function OrderEditForm({ order, onDone }: { order: OrderDetail; onDone: () => void }) {
  const [form, setForm] = useState(() => toForm(order));
  const { data: offers } = useOffers();
  const { data: carriers } = useCarriers();
  const { data: settings } = useSettings();
  const mutation = useUpdateOrder(order.id);
  useEffect(() => setForm(toForm(order)), [order]);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  const initial = useMemo(() => toForm(order), [order]);
  const changes = Object.fromEntries(
    (Object.keys(form) as (keyof Form)[])
      .filter((k) => k !== 'reason' && form[k] !== initial[k])
      .map((k) => [k, NULLABLE_TEXT.has(k) ? (form[k] as string) || null : form[k]]),
  ) as OrderUpdate;
  const dirty = Object.keys(changes).length > 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="اسم الزبون" className="sm:col-span-2">{(id) => <Input id={id} value={form.customerName} onChange={(e) => set('customerName', e.target.value)} />}</Field>
        <Field label="الهاتف المعتمد">{(id) => <Input id={id} dir="ltr" inputMode="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} />}</Field>
        <Field label="هاتف احتياطي">{(id) => <Input id={id} dir="ltr" inputMode="tel" value={form.phoneAlt} onChange={(e) => set('phoneAlt', e.target.value)} />}</Field>
      </div>

      <WilayaCommuneSelect wilayaCode={form.wilayaCode} communeName={form.communeName} communeRaw={order.communeRaw} onChange={(v) => setForm((f) => ({ ...f, ...v }))} />
      <Field label="العنوان (اختياري)" hint="إذا ترك فارغاً يستعمل اسم البلدية في ملف التوصيل">
        {(id) => <Input id={id} value={form.address} onChange={(e) => set('address', e.target.value)} />}
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="نوع التوصيل">
          {(id) => (
            <Select id={id} value={form.deliveryType} onChange={(e) => set('deliveryType', e.target.value as DeliveryType)}>
              {Object.entries(DELIVERY_TYPES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </Select>
          )}
        </Field>
        {form.deliveryType === 'stopdesk' ? (
          <Field label="رقم المكتب (Stop desk ID)">{(id) => <Input id={id} dir="ltr" value={form.stopdeskId} onChange={(e) => set('stopdeskId', e.target.value)} />}</Field>
        ) : (
          <Field label="شركة التوصيل">
            {(id) => (
              <Select id={id} value={form.carrierId ?? ''} onChange={(e) => set('carrierId', e.target.value ? Number(e.target.value) : null)}>
                <option value="">الافتراضية</option>
                {carriers?.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            )}
          </Field>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="العرض" className="sm:col-span-2" hint="تغيير العرض يعيد حساب السعر والقطع">
          {(id) => (
            <Select
              id={id}
              value={form.offerId ?? ''}
              onChange={(e) => {
                const offer = offers?.find((o) => o.id === Number(e.target.value));
                setForm((f) => ({ ...f, offerId: offer?.id ?? null, price: offer?.price ?? f.price }));
              }}
            >
              <option value="">— بدون —</option>
              {offers?.filter((o) => o.active || o.id === form.offerId).map((o) => (
                <option key={o.id} value={o.id}>{o.name} — {o.units} قطع — {fmtDA(o.price)}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="السعر (دج)">{(id) => <Input id={id} type="number" inputMode="numeric" min={0} value={form.price} onChange={(e) => set('price', Number(e.target.value))} />}</Field>
      </div>

      <Field label="سبب التعديل (يضاف كتعليق)">
        {(id) => (
          <div className="space-y-2">
            <Input id={id} value={form.reason} onChange={(e) => set('reason', e.target.value)} placeholder="مثلاً: غير العرض" />
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
        <Button variant="primary" disabled={!dirty} loading={mutation.isPending} onClick={() => mutation.mutate({ ...changes, ...(form.reason.trim() ? { reason: form.reason.trim() } : {}) }, { onSuccess: onDone })}>
          حفظ التعديلات
        </Button>
      </div>
    </div>
  );
}
