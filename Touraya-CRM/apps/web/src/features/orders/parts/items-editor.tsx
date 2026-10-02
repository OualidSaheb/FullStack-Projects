import { useMemo, useState } from 'react';
import { Minus, Plus, Sparkles } from 'lucide-react';
import { unknownOptions, type OrderDetail, type OrderItemInput, type ProductDTO } from '@touraya/shared';
import { useCan } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { fmtDA } from '@/lib/format';
import { useAddProductOptions, useInlineUpdate, useProducts, useRedraft } from '@/lib/queries';
import { InlineSelect } from '@/components/inline';
import { Alert, Button, Field, IconButton, Input, Modal } from '@/components/ui';

const NEW = '__new__';
const toInput = (o: OrderDetail): OrderItemInput[] => o.items.map((i) => ({ productId: i.productId, size: i.size, color: i.color, quantity: i.quantity }));

/** Dialog to add a size or color the customer asked for, while on the phone. */
function NewOptionModal({ kind, product, onAdded, onClose }: { kind: 'size' | 'color'; product: ProductDTO; onAdded: (v: string) => void; onClose: () => void }) {
  const [value, setValue] = useState('');
  const add = useAddProductOptions();
  const submit = () =>
    value.trim() &&
    add.mutate({ productId: product.id, ...(kind === 'size' ? { sizes: [value.trim()] } : { colors: [value.trim()] }) }, { onSuccess: () => { onAdded(value.trim()); onClose(); } });
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={kind === 'size' ? 'مقاس جديد' : 'لون جديد'}
      footer={<><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button variant="primary" loading={add.isPending} disabled={!value.trim()} onClick={submit}>إضافة</Button></>}
    >
      <Field label={`يضاف إلى «${product.name}» (خانة مخزون جديدة بكمية 0)`}>
        {(id) => <Input id={id} autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder={kind === 'size' ? 'مثلاً 48' : 'مثلاً أخضر'} />}
      </Field>
    </Modal>
  );
}

/**
 * The pieces of an order, edited directly: number of pieces (price follows the
 * offers), one size for all or per piece, a color per piece (2 black + 1 green),
 * stock shown for each choice, new sizes/colors added on the spot.
 */
export function ItemsEditor({ order }: { order: OrderDetail }) {
  const can = useCan();
  const { data: products } = useProducts();
  const update = useInlineUpdate(order.id);
  const redraft = useRedraft(order.id);
  const addOptions = useAddProductOptions();
  const [newOption, setNewOption] = useState<{ kind: 'size' | 'color'; index: number | 'all' } | null>(null);
  const items = toInput(order);
  const product = products?.find((p) => p.id === (items[0]?.productId ?? -1));
  const locked = !can('orders.edit') || Boolean(order.deletedAt) || ['ready_for_carrier', 'sent_to_carrier', 'carrier_received', 'delivered', 'returned', 'return_received'].includes(order.status);

  const available = useMemo(() => {
    const map = new Map<string, number>();
    for (const v of product?.variants ?? []) if (v.active) map.set(`${v.size ?? ''}|${v.color ?? ''}`, v.available);
    return map;
  }, [product]);
  const avail = (size: string | null, color: string | null) => available.get(`${size ?? ''}|${color ?? ''}`);

  const save = (next: OrderItemInput[]) => update.mutate({ items: next });
  const setPiece = (i: number, patch: Partial<OrderItemInput>) => save(items.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const missing = product ? unknownOptions(order, product) : { sizes: [], colors: [] };
  const hasMissing = missing.sizes.length + missing.colors.length > 0;
  const units = items.reduce((n, i) => n + i.quantity, 0);
  const commonSize = items.every((i) => i.size === items[0]?.size) ? items[0]?.size ?? null : null;

  if (!items.length || !product)
    return <p className="text-sm text-faint">لا توجد قطع — اختر العرض أولاً</p>;

  const sizeOptions = (current: string | null) => [
    ...product.sizes.map((s) => ({ value: s, label: s })),
    ...(current && !product.sizes.includes(current) ? [{ value: current, label: current }] : []),
    ...(can('orders.edit') ? [{ value: NEW, label: '+ مقاس جديد…' }] : []),
  ];
  const colorOptions = (size: string | null, current: string | null) => [
    ...product.colors.map((c) => {
      const a = avail(size, c);
      return { value: c, label: a === undefined || (product.sizes.length && !size) ? c : a <= 0 ? `${c} — نفد` : `${c} (${a})` };
    }),
    ...(current && !product.colors.includes(current) ? [{ value: current, label: current }] : []),
    ...(can('orders.edit') ? [{ value: NEW, label: '+ لون جديد…' }] : []),
  ];

  return (
    <div className="space-y-3">
      {hasMissing && !locked && (
        <Alert tone="warn" icon={<Sparkles className="mt-0.5 size-4 shrink-0" />}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              الزبون طلب {[...missing.sizes.map((s) => `مقاس ${s}`), ...missing.colors].join('، ')} — غير موجودة في «{product.name}».
            </span>
            <Button
              size="sm"
              loading={addOptions.isPending || redraft.isPending}
              onClick={() => addOptions.mutate({ productId: product.id, sizes: missing.sizes, colors: missing.colors }, { onSuccess: () => redraft.mutate(undefined) })}
            >
              إضافتها وتعبئة القطع
            </Button>
          </div>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center rounded-lg border border-line">
          <IconButton label="قطعة أقل" icon={<Minus className="size-4" />} disabled={locked || units <= 1 || update.isPending} onClick={() => save(items.slice(0, -1))} />
          <span className="min-w-16 text-center text-sm font-semibold">
            <span className="ltr">{units}</span> {units === 1 ? 'قطعة' : 'قطع'}
          </span>
          <IconButton label="قطعة أخرى" icon={<Plus className="size-4" />} disabled={locked || update.isPending} onClick={() => save([...items, { ...items[items.length - 1]!, quantity: 1 }])} />
        </div>
        {product.sizes.length > 0 && items.length > 1 && (
          <label className="flex items-center gap-2 text-xs text-muted">
            المقاس للكل
            <InlineSelect
              disabled={locked}
              value={commonSize}
              placeholder="مختلف"
              options={sizeOptions(commonSize)}
              onSave={(v) => (v === NEW ? setNewOption({ kind: 'size', index: 'all' }) : save(items.map((it) => ({ ...it, size: v }))))}
              aria-label="المقاس للكل"
            />
          </label>
        )}
        {order.suggestedPrice && order.suggestedPrice.price !== order.price && !locked && (
          <Button size="sm" variant="ghost" onClick={() => update.mutate({ price: order.suggestedPrice!.price })} title={order.suggestedPrice.label}>
            السعر حسب العروض: <span className="ltr">{fmtDA(order.suggestedPrice.price)}</span>
          </Button>
        )}
      </div>

      <ol className="space-y-2">
        {items.map((item, i) => {
          const a = avail(item.size, item.color);
          const incomplete = (product.sizes.length && !item.size) || (product.colors.length && !item.color);
          const returned = order.items[i]?.returnCondition;
          return (
            <li key={i} className={cn('flex flex-wrap items-center gap-2 rounded-lg border p-2', incomplete ? 'border-warn/50 bg-warn/5' : 'border-line')}>
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-subtle text-xs font-semibold">{i + 1}</span>
              {product.sizes.length > 0 && (
                <InlineSelect
                  disabled={locked}
                  value={item.size}
                  placeholder="المقاس"
                  tone={!item.size ? 'warn' : undefined}
                  options={sizeOptions(item.size)}
                  onSave={(v) => (v === NEW ? setNewOption({ kind: 'size', index: i }) : setPiece(i, { size: v }))}
                  aria-label={`مقاس القطعة ${i + 1}`}
                />
              )}
              {product.colors.length > 0 ? (
                <InlineSelect
                  disabled={locked}
                  className="min-w-0 flex-1"
                  value={item.color}
                  placeholder="اللون"
                  tone={!item.color ? 'warn' : undefined}
                  options={colorOptions(item.size, item.color)}
                  onSave={(v) => (v === NEW ? setNewOption({ kind: 'color', index: i }) : setPiece(i, { color: v }))}
                  aria-label={`لون القطعة ${i + 1}`}
                />
              ) : (
                <span className="flex-1 truncate text-sm">
                  {product.name}
                  {!locked && can('orders.edit') && (
                    <button className="ms-2 text-xs text-primary underline" onClick={() => setNewOption({ kind: 'color', index: i })}>+ لون</button>
                  )}
                </span>
              )}
              {returned && <span className="text-xs text-muted">{returned === 'restock' ? 'رجعت للمخزن' : returned === 'damaged' ? 'تالفة' : 'لم ترجع'}</span>}
              {a !== undefined && !incomplete && !returned && (
                <span className={cn('ltr shrink-0 text-xs font-semibold', a < 0 ? 'text-danger' : a <= product.lowStockAlert ? 'text-warn' : 'text-ok')} title="المتوفر في المخزون">
                  {a < 0 ? 'نفد' : a}
                </span>
              )}
              {!locked && items.length > 1 && <IconButton label="حذف القطعة" icon={<Minus className="size-4" />} onClick={() => save(items.filter((_, k) => k !== i))} />}
            </li>
          );
        })}
      </ol>

      {newOption && (
        <NewOptionModal
          kind={newOption.kind}
          product={product}
          onClose={() => setNewOption(null)}
          onAdded={(v) => {
            const patch = newOption.kind === 'size' ? { size: v } : { color: v };
            save(items.map((it, k) => (newOption.index === 'all' || k === newOption.index ? { ...it, ...patch } : it)));
          }}
        />
      )}
    </div>
  );
}
