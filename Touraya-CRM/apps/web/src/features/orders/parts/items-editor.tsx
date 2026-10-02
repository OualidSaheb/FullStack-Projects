import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Minus, Plus, Sparkles, X } from 'lucide-react';
import { combinationLabel, combineOffers, unknownOptions, type OrderDetail, type OrderItemInput, type ProductDTO } from '@touraya/shared';
import { useCan } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { useAddProductOptions, useInlineUpdate, useOffers, usePreviewOrder, useProducts, useRedraft } from '@/lib/queries';
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

/** Price of N pieces from the product's offers, worked out in the browser so it shows before the server answers. */
export function useTierPrice(productId: number | undefined) {
  const { data: offers } = useOffers();
  return (units: number) => {
    const tiers = (offers ?? []).filter((o) => o.productId === productId && o.active);
    const combo = combineOffers(tiers, units);
    return combo && { price: combo.price, label: combinationLabel(combo), offerId: combo.exactOfferId ?? combo.mainOfferId };
  };
}

const SAVE_DELAY_MS = 450;

/**
 * The pieces of an order, edited directly: number of pieces (price follows the
 * product's prices by quantity), a size and a color per piece (2 black + 1 green),
 * stock shown for each choice, new sizes/colors added on the spot.
 * Changes show at once; quick successive taps are saved together.
 */
export function ItemsEditor({ order }: { order: OrderDetail }) {
  const can = useCan();
  const { data: products } = useProducts();
  const update = useInlineUpdate(order.id);
  const preview = usePreviewOrder(order.id);
  const redraft = useRedraft(order.id);
  const addOptions = useAddProductOptions();
  const [newOption, setNewOption] = useState<{ kind: 'size' | 'color'; index: number } | null>(null);
  const [state, setState] = useState<'idle' | 'waiting' | 'saved'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const items = toInput(order);
  const product = products?.find((p) => p.id === (items[0]?.productId ?? -1));
  const tierPrice = useTierPrice(product?.id);
  const locked = !can('orders.edit') || Boolean(order.deletedAt) || ['ready_for_carrier', 'sent_to_carrier', 'carrier_received', 'delivered', 'returned', 'return_received'].includes(order.status);
  // Closing the order before the delayed save fires still saves the last change.
  const pending = useRef<OrderItemInput[] | null>(null);
  const flushOnClose = useRef(() => {});
  flushOnClose.current = () => pending.current && update.mutate({ items: pending.current });
  useEffect(() => () => {
    clearTimeout(timer.current);
    flushOnClose.current();
  }, []);

  const available = useMemo(() => {
    const map = new Map<string, number>();
    for (const v of product?.variants ?? []) if (v.active) map.set(`${v.size ?? ''}|${v.color ?? ''}`, v.available);
    return map;
  }, [product]);
  const avail = (size: string | null, color: string | null) => available.get(`${size ?? ''}|${color ?? ''}`);

  const save = (next: OrderItemInput[]) => {
    const unitsBefore = items.reduce((n, i) => n + i.quantity, 0);
    const unitsAfter = next.reduce((n, i) => n + i.quantity, 0);
    const tier = unitsAfter !== unitsBefore ? tierPrice(unitsAfter) : null;
    preview((o) => ({
      ...o,
      units: unitsAfter,
      items: next.map((it, k) => ({ ...(o.items[k] ?? o.items[o.items.length - 1]!), id: o.items[k]?.id ?? -k, ...it, variantId: null, available: avail(it.size, it.color) ?? null, returnCondition: null })),
      ...(tier ? { price: tier.price, suggestedPrice: { price: tier.price, label: tier.label } } : {}),
    }));
    setState('waiting');
    clearTimeout(timer.current);
    pending.current = next;
    timer.current = setTimeout(() => {
      pending.current = null;
      update.mutate({ items: next }, { onSuccess: () => setState('saved'), onError: () => setState('idle') });
    }, SAVE_DELAY_MS);
  };
  const setPiece = (i: number, patch: Partial<OrderItemInput>) => save(items.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const missing = product ? unknownOptions(order, product) : { sizes: [], colors: [] };
  const hasMissing = missing.sizes.length + missing.colors.length > 0;
  const units = items.reduce((n, i) => n + i.quantity, 0);
  const saving = state === 'waiting' || update.isPending;

  if (!items.length || !product)
    return <p className="text-sm text-faint">لا توجد قطع — اختر المنتج أولاً</p>;

  const sizeOptions = (current: string | null) => [
    ...product.sizes.map((s) => ({ value: s, label: s })),
    ...(current && !product.sizes.includes(current) ? [{ value: current, label: current }] : []),
    ...(can('orders.edit') ? [{ value: NEW, label: '+ جديد…' }] : []),
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
        <div className="flex items-center rounded-xl border border-line bg-surface">
          <IconButton label="قطعة أقل" icon={<Minus className="size-4" />} disabled={locked || units <= 1} onClick={() => save(items.slice(0, -1))} />
          <span className="min-w-16 text-center text-sm font-semibold">
            <span className="ltr">{units}</span> {units === 1 ? 'قطعة' : 'قطع'}
          </span>
          <IconButton label="قطعة أخرى" icon={<Plus className="size-4" />} disabled={locked} onClick={() => save([...items, { ...items[items.length - 1]!, quantity: 1 }])} />
        </div>
        <span className="text-xs text-muted" aria-live="polite">
          {saving ? (
            <span className="inline-flex items-center gap-1"><Loader2 className="size-3.5 animate-spin" /> حفظ…</span>
          ) : state === 'saved' ? (
            <span className="inline-flex items-center gap-1 text-ok"><Check className="size-3.5" /> محفوظ</span>
          ) : null}
        </span>
      </div>

      <ol className="space-y-2">
        {items.map((item, i) => {
          const a = avail(item.size, item.color);
          const incomplete = (product.sizes.length && !item.size) || (product.colors.length && !item.color);
          const returned = order.items[i]?.returnCondition;
          return (
            <li key={i} className={cn('flex items-center gap-2 rounded-xl border p-2', incomplete ? 'border-warn/50 bg-warn/5' : 'border-line')}>
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-subtle text-xs font-semibold">{i + 1}</span>
              {product.sizes.length > 0 && (
                <InlineSelect
                  disabled={locked}
                  className="h-10 w-20 shrink-0 text-center"
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
                  className="h-10 min-w-0 flex-1"
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
              {!locked && items.length > 1 && <IconButton label="حذف القطعة" icon={<X className="size-4" />} onClick={() => save(items.filter((_, k) => k !== i))} />}
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
            save(items.map((it, k) => (k === newOption.index ? { ...it, ...patch } : it)));
          }}
        />
      )}
    </div>
  );
}
