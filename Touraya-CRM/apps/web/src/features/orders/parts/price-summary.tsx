import { Pencil, RotateCcw } from 'lucide-react';
import type { OrderDetail } from '@touraya/shared';
import { fmtDA } from '@/lib/format';
import { InlineText } from '@/components/inline';

/**
 * What the agent tells the customer: price + delivery = total to pay at the door.
 * The price follows the number of pieces by itself; it can still be changed by
 * hand (a discount), with one tap to go back to the automatic price.
 */
export function PriceSummary({ order, onPrice }: { order: OrderDetail; onPrice?: (price: number) => void }) {
  const total = order.price + (order.deliveryFee ?? 0);
  const auto = order.suggestedPrice;
  const manual = auto && auto.price !== order.price;
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-3 divide-x divide-x-reverse divide-line rounded-xl border border-line bg-subtle text-center">
        <div className="p-2.5">
          <p className="text-[11px] text-muted">{manual ? 'السعر (يدوي)' : 'السعر'}{onPrice && <Pencil className="ms-1 inline size-2.5" />}</p>
          <InlineText
            disabled={!onPrice}
            dir="ltr"
            inputMode="numeric"
            noIcon
            className="justify-center"
            value={String(order.price)}
            display={<span className="ltr font-semibold">{fmtDA(order.price)}</span>}
            onSave={(v) => Number.isFinite(Number(v)) && v !== '' && onPrice?.(Math.max(0, Math.round(Number(v))))}
            aria-label="السعر"
          />
        </div>
        <div className="p-2.5">
          <p className="text-[11px] text-muted">{order.deliveryType === 'stopdesk' ? 'التوصيل (مكتب)' : 'التوصيل (منزل)'}</p>
          <p className="ltr font-semibold">{order.deliveryFee === null ? '—' : fmtDA(order.deliveryFee)}</p>
        </div>
        <div className="p-2.5">
          <p className="text-[11px] text-muted">المجموع للزبون</p>
          <p className="ltr text-lg font-bold text-ok">{order.deliveryFee === null ? fmtDA(order.price) : fmtDA(total)}</p>
        </div>
      </div>
      {manual && onPrice && (
        <button className="inline-flex items-center gap-1 text-xs text-primary hover:underline" onClick={() => onPrice(auto.price)}>
          <RotateCcw className="size-3" /> الرجوع للسعر حسب الكمية: <span className="ltr font-semibold">{fmtDA(auto.price)}</span>
        </button>
      )}
    </div>
  );
}
