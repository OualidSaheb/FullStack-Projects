import { useEffect, useMemo, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { OrderDetail, OrderItemInput } from '@touraya/shared';
import { useProducts, useUpdateOrder } from '@/lib/queries';
import { cn } from '@/lib/cn';
import { Button, IconButton, Select } from '@/components/ui';

const toInput = (o: OrderDetail): OrderItemInput[] => o.items.map((i) => ({ productId: i.productId, size: i.size, color: i.color, quantity: i.quantity }));

/**
 * One line per piece: pick size and color from the product options while on the
 * phone with the customer. Stock availability is shown per option.
 */
export function ItemsEditor({ order, onSaved }: { order: OrderDetail; onSaved?: () => void }) {
  const { data: products } = useProducts();
  const update = useUpdateOrder(order.id);
  const [items, setItems] = useState(() => toInput(order));
  useEffect(() => setItems(toInput(order)), [order]);
  const dirty = JSON.stringify(items) !== JSON.stringify(toInput(order));
  const locked = Boolean(order.deletedAt) || ['ready_for_carrier', 'sent_to_carrier', 'carrier_received', 'delivered', 'returned', 'return_received'].includes(order.status);

  const availability = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of products ?? []) for (const v of p.variants) map.set(`${p.id}|${v.size ?? ''}|${v.color ?? ''}`, v.available);
    return map;
  }, [products]);

  const set = (i: number, patch: Partial<OrderItemInput>) => setItems((list) => list.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  if (!items.length) return <p className="text-sm text-faint">لا توجد قطع — اختر العرض أولاً</p>;

  return (
    <div className="space-y-2">
      {items.map((item, i) => {
        const product = products?.find((p) => p.id === item.productId);
        const avail = availability.get(`${item.productId}|${item.size ?? ''}|${item.color ?? ''}`);
        const incomplete = (product?.sizes.length && !item.size) || (product?.colors.length && !item.color);
        return (
          <div key={i} className={cn('flex items-center gap-2 rounded-lg border p-2', incomplete ? 'border-warn/50 bg-warn/5' : 'border-line')}>
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-subtle text-xs font-semibold">{i + 1}</span>
            {product?.sizes.length ? (
              <Select disabled={locked} className="h-9 w-24 shrink-0" value={item.size ?? ''} onChange={(e) => set(i, { size: e.target.value || null })} aria-label="المقاس">
                <option value="">المقاس</option>
                {product.sizes.map((s) => <option key={s}>{s}</option>)}
              </Select>
            ) : null}
            {product?.colors.length ? (
              <Select disabled={locked} className="h-9 min-w-0 flex-1" value={item.color ?? ''} onChange={(e) => set(i, { color: e.target.value || null })} aria-label="اللون">
                <option value="">اللون</option>
                {product.colors.map((c) => {
                  const a = availability.get(`${item.productId}|${item.size ?? ''}|${c}`);
                  return <option key={c} value={c}>{c}{a !== undefined && item.size ? ` (${a})` : ''}</option>;
                })}
              </Select>
            ) : (
              <span className="flex-1 truncate text-sm">{product?.name}</span>
            )}
            {avail !== undefined && !incomplete && (
              <span className={cn('ltr shrink-0 text-xs font-medium', avail < 0 ? 'text-danger' : avail <= 2 ? 'text-warn' : 'text-ok')} title="المتوفر">
                {avail}
              </span>
            )}
            {!locked && items.length > 1 && <IconButton label="حذف القطعة" icon={<Minus className="size-4" />} onClick={() => setItems(items.filter((_, k) => k !== i))} />}
          </div>
        );
      })}
      {!locked && (
        <div className="flex items-center justify-between gap-2">
          <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setItems([...items, { ...items[items.length - 1]!, quantity: 1 }])}>
            قطعة
          </Button>
          {dirty && (
            <Button size="sm" variant="primary" loading={update.isPending} onClick={() => update.mutate({ items }, { onSuccess: onSaved })}>
              حفظ القطع
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
