import { useState } from 'react';
import { BadgeCheck, Ban, Clock, PhoneMissed } from 'lucide-react';
import { nextCallAttempt, ORDER_STATUSES, STATUS_META, type OrderDetail, type OrderStatus } from '@touraya/shared';
import { useCan } from '@/lib/auth';
import { useChangeStatus } from '@/lib/queries';
import { Button, Select } from '@/components/ui';

/** One-click outcomes of a call + a full status picker. */
export function StatusActions({ order }: { order: OrderDetail }) {
  const can = useCan();
  const mutation = useChangeStatus(order.id);
  const [pending, setPending] = useState<OrderStatus | null>(null);
  if (!can('orders.status') || order.deletedAt) return null;

  const set = (status: OrderStatus) => {
    setPending(status);
    mutation.mutate({ status }, { onSettled: () => setPending(null) });
  };
  const noAnswer = nextCallAttempt(order.status);
  const early = ['new', 'call_1', 'call_2', 'call_3', 'call_4', 'postponed'].includes(order.status);
  const options = ORDER_STATUSES.filter((s) => STATUS_META[s].manual || can('orders.status.any'));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {early && (
        <>
          <Button variant="success" icon={<BadgeCheck className="size-4" />} loading={pending === 'confirmed'} onClick={() => set('confirmed')}>
            تأكيد الطلبية
          </Button>
          <Button icon={<PhoneMissed className="size-4" style={{ color: STATUS_META[noAnswer].color }} />} loading={pending === noAnswer} onClick={() => set(noAnswer)}>
            لم يرد ({STATUS_META[noAnswer].short})
          </Button>
          <Button icon={<Clock className="size-4 text-muted" />} loading={pending === 'postponed'} onClick={() => set('postponed')}>
            مؤجلة
          </Button>
          <Button variant="ghost" className="text-danger" icon={<Ban className="size-4" />} loading={pending === 'cancelled'} onClick={() => set('cancelled')}>
            إلغاء
          </Button>
        </>
      )}
      <Select
        className="h-9 w-auto min-w-40 text-sm"
        value={order.status}
        onChange={(e) => set(e.target.value as OrderStatus)}
        aria-label="تغيير الحالة"
      >
        {options.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
      </Select>
    </div>
  );
}
