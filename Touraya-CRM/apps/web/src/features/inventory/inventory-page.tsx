import { useMemo, useState } from 'react';
import { History, PackagePlus } from 'lucide-react';
import { STOCK_MOVEMENT_LABELS, type ProductDTO, type VariantDTO } from '@touraya/shared';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { fmtDateTime } from '@/lib/format';
import { qk, useAdminMutation, useMovements, useProducts } from '@/lib/queries';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, PageHeader, PageLoader, Select } from '@/components/ui';

type MoveType = 'purchase' | 'adjust' | 'damaged';

function MoveModal({ products, initial, onClose }: { products: ProductDTO[]; initial: { productId: number; variantId?: number }; onClose: () => void }) {
  const [productId, setProductId] = useState(initial.productId);
  const [variantId, setVariantId] = useState(initial.variantId ?? 0);
  const [type, setType] = useState<MoveType>('purchase');
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const save = useAdminMutation(qk.products, (v: object) => api.post('/inventory/movements', v), 'تم تسجيل الحركة');
  const product = products.find((p) => p.id === productId);
  const active = product?.variants.filter((v) => v.active) ?? [];
  const label = (v: VariantDTO) => [v.size, v.color].filter(Boolean).join(' · ') || 'قطعة واحدة';

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="حركة مخزون"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button variant="primary" disabled={!variantId || !quantity} loading={save.isPending} onClick={() => save.mutate({ variantId, type, quantity, note: note || undefined }, { onSuccess: onClose })}>
            حفظ
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="المنتج">
          {(id) => (
            <Select id={id} value={productId} onChange={(e) => { setProductId(Number(e.target.value)); setVariantId(0); }}>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="المقاس / اللون">
          {(id) => (
            <Select id={id} value={variantId} onChange={(e) => setVariantId(Number(e.target.value))}>
              <option value={0}>— اختر —</option>
              {active.map((v) => <option key={v.id} value={v.id}>{label(v)} (في المخزن {v.stock})</option>)}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-3 gap-2">
          {(['purchase', 'adjust', 'damaged'] as MoveType[]).map((t) => (
            <button key={t} onClick={() => setType(t)} className={cn('rounded-lg border px-2 py-2 text-xs font-medium', type === t ? 'border-primary bg-primary-soft text-primary' : 'border-line text-muted')}>
              {STOCK_MOVEMENT_LABELS[t]}
            </button>
          ))}
        </div>
        <Field label={type === 'adjust' ? 'الفرق (+ أو −)' : 'الكمية'} hint={type === 'adjust' ? 'مثلاً −2 إذا وجدت قطعتين أقل في الجرد' : undefined}>
          {(id) => <Input id={id} type="number" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />}
        </Field>
        <Field label="ملاحظة">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً: سلعة المورد 12/10" />}</Field>
      </div>
    </Modal>
  );
}

/** Size × color grid: available pieces (on hand minus reserved by confirmed orders). */
function VariantGrid({ product, onPick }: { product: ProductDTO; onPick: (v: VariantDTO) => void }) {
  const active = product.variants.filter((v) => v.active);
  const sizes = product.sizes.length ? product.sizes : [null];
  const colors = product.colors.length ? product.colors : [null];
  const cell = (size: string | null, color: string | null) => active.find((v) => v.size === size && v.color === color);
  const tone = (v: VariantDTO) => (v.available <= 0 ? 'bg-danger/10 text-danger' : v.available <= product.lowStockAlert ? 'bg-warn/12 text-warn' : 'bg-ok/10 text-ok');

  return (
    <div className="overflow-x-auto scroll-thin">
      <table className="w-full text-sm">
        {product.colors.length > 0 && (
          <thead>
            <tr>
              <th />
              {colors.map((c) => <th key={c} className="px-1 pb-1.5 text-xs font-medium text-muted">{c}</th>)}
            </tr>
          </thead>
        )}
        <tbody>
          {sizes.map((s) => (
            <tr key={s ?? 'one'}>
              {product.sizes.length > 0 && <th className="pe-2 text-xs font-semibold text-muted">{s}</th>}
              {colors.map((c) => {
                const v = cell(s, c);
                return (
                  <td key={c ?? 'one'} className="p-0.5">
                    {v && (
                      <button onClick={() => onPick(v)} className={cn('w-full min-w-14 rounded-md px-2 py-1.5 text-center font-semibold', tone(v))} title={`في المخزن ${v.stock} · محجوز ${v.reserved}`}>
                        <span className="ltr">{v.available}</span>
                        {v.reserved > 0 && <span className="ltr block text-[10px] font-normal opacity-80">{v.stock} − {v.reserved}</span>}
                      </button>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function InventoryPage() {
  const { data: products, isLoading } = useProducts();
  const { data: movements } = useMovements();
  const can = useCan();
  const [move, setMove] = useState<{ productId: number; variantId?: number } | null>(null);
  const list = useMemo(() => (products ?? []).filter((p) => p.active), [products]);
  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-5">
      <PageHeader
        title="المخزون"
        subtitle="المتوفر = في المخزن − المحجوز للطلبيات المؤكدة. يخرج تلقائياً عند تجهيز ملف التوصيل ويرجع عند استلام المرتجع."
        actions={can('inventory.manage') && list[0] && <Button variant="primary" icon={<PackagePlus className="size-4" />} onClick={() => setMove({ productId: list[0]!.id })}>حركة مخزون</Button>}
      />
      {!list.length && <Card><EmptyState title="لا توجد منتجات">أضفها من الإدارة ← المنتجات والعروض</EmptyState></Card>}
      <div className="grid gap-4 xl:grid-cols-2">
        {list.map((p) => {
          const active = p.variants.filter((v) => v.active);
          const total = active.reduce((n, v) => n + v.stock, 0);
          const reserved = active.reduce((n, v) => n + v.reserved, 0);
          const low = active.filter((v) => v.available <= p.lowStockAlert).length;
          return (
            <Card key={p.id}>
              <CardHeader
                title={p.name}
                action={
                  <div className="flex items-center gap-1.5 text-xs">
                    <Badge>في المخزن <span className="ltr">{total}</span></Badge>
                    <Badge tone="primary">محجوز <span className="ltr">{reserved}</span></Badge>
                    {low > 0 && <Badge tone="warn">{low} ناقص</Badge>}
                  </div>
                }
              />
              <div className="p-3">
                <VariantGrid product={p} onPick={(v) => can('inventory.manage') && setMove({ productId: p.id, variantId: v.id })} />
              </div>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader title="آخر حركات المخزون" icon={<History className="size-4 text-muted" />} />
        <ul className="max-h-96 divide-y divide-line overflow-y-auto scroll-thin">
          {movements?.length === 0 && <li className="p-6 text-center text-sm text-faint">لا توجد حركات بعد</li>}
          {movements?.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="truncate">
                  <b>{STOCK_MOVEMENT_LABELS[m.type]}</b> · {m.productName} {[m.size, m.color].filter(Boolean).join(' ')}
                  {m.orderReference && <span className="ltr ms-1 text-xs text-muted">{m.orderReference}</span>}
                </p>
                <p className="text-xs text-faint">{fmtDateTime(m.createdAt)} · {m.actorName ?? 'النظام'}{m.note && !m.orderReference ? ` · ${m.note}` : ''}</p>
              </div>
              <span className={cn('ltr shrink-0 font-bold', m.quantity > 0 ? 'text-ok' : 'text-danger')}>{m.quantity > 0 ? `+${m.quantity}` : m.quantity}</span>
            </li>
          ))}
        </ul>
      </Card>
      {move && products && <MoveModal products={list} initial={move} onClose={() => setMove(null)} />}
    </div>
  );
}
