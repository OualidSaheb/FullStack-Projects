import { useState } from 'react';
import { BadgeCheck, Ban, Clock, PhoneMissed } from 'lucide-react';
import {
  DEFAULT_CALL_POLICY,
  nextCallAttempt,
  ORDER_STATUSES,
  postponePresets,
  QUEUE_STATUSES,
  STATUS_META,
  type OrderDetail,
  type OrderStatus,
  type StatusChange,
} from '@touraya/shared';
import { useCan } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import { useChangeStatus, useSettings } from '@/lib/queries';
import { cn } from '@/lib/cn';
import { Button, Input, Modal, Select } from '@/components/ui';

/**
 * Call outcomes as big buttons (thumb-friendly on phones):
 * confirm · no answer (next attempt, auto-scheduled) · later (time presets) · cancel (reason).
 */
export function OutcomeBar({ order, onDone, showSelect = true, className }: { order: OrderDetail; onDone?: (s: OrderStatus) => void; showSelect?: boolean; className?: string }) {
  const can = useCan();
  const mutation = useChangeStatus(order.id);
  const { data: settings } = useSettings();
  const [sheet, setSheet] = useState<'postpone' | 'cancel' | null>(null);
  const [pending, setPending] = useState<OrderStatus | null>(null);
  const [custom, setCustom] = useState('');
  if (!can('orders.status') || order.deletedAt) return null;

  const apply = (input: StatusChange) => {
    setPending(input.status);
    mutation.mutate(input, {
      onSuccess: () => {
        setSheet(null);
        onDone?.(input.status);
      },
      onSettled: () => setPending(null),
    });
  };
  const noAnswer = nextCallAttempt(order.status);
  const inQueue = QUEUE_STATUSES.includes(order.status);
  const options = ORDER_STATUSES.filter((s) => STATUS_META[s].manual || can('orders.status.any'));
  const presets = postponePresets(new Date(), settings?.callPolicy ?? DEFAULT_CALL_POLICY);
  const big = 'h-12 flex-1 text-base sm:h-10 sm:flex-none sm:text-sm';
  // Three side by side on a phone: one row instead of two.
  const small = 'h-11 min-w-0 flex-1 px-2 text-sm sm:h-10 sm:flex-none sm:px-4';

  return (
    <div className={cn('space-y-2', className)}>
      {inQueue && (
        <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
          <Button variant="success" className={cn(big, 'col-span-3')} icon={<BadgeCheck className="size-5" />} loading={pending === 'confirmed'} onClick={() => apply({ status: 'confirmed' })}>
            تأكيد الطلبية
          </Button>
          <Button className={small} icon={<PhoneMissed className="size-5" style={{ color: STATUS_META[noAnswer].color }} />} loading={pending === noAnswer} onClick={() => apply({ status: noAnswer })}>
            لم يرد
          </Button>
          <Button className={small} icon={<Clock className="size-5 text-muted" />} onClick={() => setSheet('postpone')}>
            لاحقاً
          </Button>
          <Button variant="ghost" className={cn(small, 'text-danger')} icon={<Ban className="size-5" />} onClick={() => setSheet('cancel')}>
            إلغاء
          </Button>
        </div>
      )}
      {showSelect && (
        <Select className="h-9 text-sm sm:w-auto sm:min-w-44" value={order.status} onChange={(e) => (e.target.value === 'cancelled' ? setSheet('cancel') : apply({ status: e.target.value as OrderStatus }))} aria-label="تغيير الحالة">
          {options.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </Select>
      )}

      <Modal open={sheet === 'postpone'} onClose={() => setSheet(null)} size="sm" title="متى نتصل مرة أخرى؟">
        <div className="grid grid-cols-2 gap-2">
          {presets.map((p) => (
            <Button key={p.key} className="h-auto flex-col py-3" loading={pending === 'postponed'} onClick={() => apply({ status: 'postponed', callAt: p.at.toISOString() })}>
              <span className="font-semibold">{p.label}</span>
              <span className="text-xs font-normal text-muted">{fmtDateTime(p.at.toISOString())}</span>
            </Button>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <Input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="وقت آخر" />
          <Button variant="primary" disabled={!custom} onClick={() => apply({ status: 'postponed', callAt: new Date(custom).toISOString() })}>
            حفظ
          </Button>
        </div>
      </Modal>

      <Modal open={sheet === 'cancel'} onClose={() => setSheet(null)} size="sm" title="سبب الإلغاء">
        <div className="grid gap-2">
          {(settings?.cancelReasons ?? []).map((r) => (
            <Button key={r} className="h-11 justify-start" onClick={() => apply({ status: 'cancelled', cancelReason: r })} loading={pending === 'cancelled'}>
              {r}
            </Button>
          ))}
          <Button variant="ghost" className="h-11 justify-start text-muted" onClick={() => apply({ status: 'cancelled' })}>بدون سبب</Button>
        </div>
      </Modal>
    </div>
  );
}
