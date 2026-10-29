import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MANUAL_ORIGINS, type ManualOrder, type OrderDetail } from '@touraya/shared';
import { api } from '@/lib/api';
import { errorMessage, qk, useOffers, useProducts } from '@/lib/queries';
import { WilayaCommuneSelect } from '@/components/geo-select';
import { Button, Checkbox, Field, Input, Modal, Select, Textarea } from '@/components/ui';

const EMPTY = { customerName: '', phone: '', phoneAlt: '', address: '', note: '' };

/**
 * An order typed by hand (website, Instagram, a call…): the customer, where
 * to deliver, the offer with its size and one colour per piece. Saved like any
 * order (phone check, repeat customer), then opened to finish if needed.
 */
export function ManualOrderModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const { data: offers } = useOffers();
  const { data: products } = useProducts();
  const [form, setForm] = useState(EMPTY);
  const [place, setPlace] = useState<{ wilayaCode: number | null; communeName: string | null }>({ wilayaCode: null, communeName: null });
  const [deliveryType, setDeliveryType] = useState<'home' | 'stopdesk'>('home');
  const [offerId, setOfferId] = useState<number | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [size, setSize] = useState('');
  const [colors, setColors] = useState<string[]>([]);
  const [origin, setOrigin] = useState<string>(MANUAL_ORIGINS[0]);
  const [confirmed, setConfirmed] = useState(false);

  const offer = offers?.find((o) => o.id === offerId) ?? null;
  const product = useMemo(() => products?.find((p) => p.id === offer?.productId) ?? null, [products, offer]);
  const set = (k: keyof typeof EMPTY, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const create = useMutation({
    mutationFn: () =>
      api.post<OrderDetail>('/orders', {
        customerName: form.customerName,
        phone: form.phone,
        phoneAlt: form.phoneAlt || undefined,
        wilayaCode: place.wilayaCode,
        communeName: place.communeName,
        address: form.address || undefined,
        deliveryType,
        offerId,
        price: price ?? undefined,
        size: size || undefined,
        // One colour per piece, in order (" | " like Facebook's multiple choices).
        colors: colors.filter(Boolean).join(' | ') || undefined,
        origin,
        note: form.note || undefined,
        confirmed,
      } satisfies Partial<ManualOrder>),
    onSuccess: (order) => {
      toast.success(`تمت إضافة الطلبية ${order.reference}${order.duplicateOf ? ' — نفس الزبون طلب مؤخراً' : ''}`);
      qc.invalidateQueries({ queryKey: qk.orders });
      onCreated(order.id);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e), { duration: 8000 }),
  });

  const pickOffer = (id: number | null) => {
    setOfferId(id);
    const o = offers?.find((x) => x.id === id);
    setPrice(o ? o.price : null);
    setColors(o ? Array.from({ length: o.units }, () => '') : []);
    setSize('');
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="طلبية يدوية"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button variant="primary" loading={create.isPending} disabled={!form.customerName.trim() || !form.phone.trim()} onClick={() => create.mutate()}>
            إضافة الطلبية
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="اسم الزبون">{(id) => <Input id={id} value={form.customerName} onChange={(e) => set('customerName', e.target.value)} autoFocus />}</Field>
          <Field label="من أين جاءت الطلبية">
            {(id) => (
              <Select id={id} value={origin} onChange={(e) => setOrigin(e.target.value)}>
                {MANUAL_ORIGINS.map((o) => <option key={o} value={o}>{o}</option>)}
              </Select>
            )}
          </Field>
          <Field label="رقم الهاتف">{(id) => <Input id={id} dir="ltr" inputMode="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="05 / 06 / 07…" />}</Field>
          <Field label="رقم احتياطي (اختياري)">{(id) => <Input id={id} dir="ltr" inputMode="tel" value={form.phoneAlt} onChange={(e) => set('phoneAlt', e.target.value)} />}</Field>
        </div>

        <WilayaCommuneSelect wilayaCode={place.wilayaCode} communeName={place.communeName} onChange={setPlace} />
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <Field label="العنوان (اختياري)">{(id) => <Input id={id} value={form.address} onChange={(e) => set('address', e.target.value)} />}</Field>
          <Field label="التوصيل">
            {(id) => (
              <Select id={id} value={deliveryType} onChange={(e) => setDeliveryType(e.target.value as 'home' | 'stopdesk')}>
                <option value="home">للمنزل</option>
                <option value="stopdesk">للمكتب (Stop desk)</option>
              </Select>
            )}
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
          <Field label="العرض">
            {(id) => (
              <Select id={id} value={offerId ?? ''} onChange={(e) => pickOffer(e.target.value ? Number(e.target.value) : null)}>
                <option value="">— اختر العرض —</option>
                {offers?.filter((o) => o.active).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="السعر (دج)">
            {(id) => <Input id={id} type="number" inputMode="numeric" min={0} dir="ltr" value={price ?? ''} onChange={(e) => setPrice(e.target.value === '' ? null : Number(e.target.value))} />}
          </Field>
        </div>

        {offer && product && (
          <div className="space-y-3 rounded-lg border border-line p-3">
            {product.sizes.length > 0 && (
              <Field label="المقاس">
                {(id) => (
                  <Select id={id} value={size} onChange={(e) => setSize(e.target.value)}>
                    <option value="">— المقاس —</option>
                    {product.sizes.map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select>
                )}
              </Field>
            )}
            {product.colors.length > 0 && (
              <div className="grid gap-2 sm:grid-cols-3">
                {colors.map((c, i) => (
                  <Field key={i} label={`لون القطعة ${i + 1}`}>
                    {(id) => (
                      <Select id={id} value={c} onChange={(e) => setColors((cs) => cs.map((x, j) => (j === i ? e.target.value : x)))}>
                        <option value="">—</option>
                        {product.colors.map((col) => <option key={col} value={col}>{col}</option>)}
                      </Select>
                    )}
                  </Field>
                ))}
              </div>
            )}
            <p className="text-xs text-muted">يمكن تعديل القطع بعد الإضافة من نافذة الطلبية.</p>
          </div>
        )}

        <Field label="ملاحظة (اختياري)">{(id) => <Textarea id={id} value={form.note} onChange={(e) => set('note', e.target.value)} rows={2} />}</Field>
        <label className="flex items-center gap-2">
          <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          الزبون أكّد الطلبية (تُضاف «مؤكدة» مباشرة)
        </label>
      </div>
    </Modal>
  );
}
