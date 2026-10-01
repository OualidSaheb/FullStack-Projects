import type { OrderDetail } from '@touraya/shared';
import { fmtDA } from '@/lib/format';

/** What the agent tells the customer: offer price + delivery = total to pay at the door. */
export function PriceSummary({ order }: { order: OrderDetail }) {
  const total = order.price + (order.deliveryFee ?? 0);
  return (
    <div className="grid grid-cols-3 divide-x divide-x-reverse divide-line rounded-xl border border-line bg-subtle text-center">
      <div className="p-2.5">
        <p className="text-[11px] text-muted">سعر العرض</p>
        <p className="ltr font-semibold">{fmtDA(order.price)}</p>
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
  );
}
