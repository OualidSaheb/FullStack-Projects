import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Coffee, PhoneCall, SkipForward } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDateTime, timeAgo } from '@/lib/format';
import { qk, useOrder, useOrderCounts } from '@/lib/queries';
import { StatusBadge } from '@/components/status';
import { Button, EmptyState, PageLoader } from '@/components/ui';
import { OrderDrawer } from '../orders/order-drawer';
import { OrderPanel } from '../orders/order-panel';
import { OutcomeBar } from '../orders/parts/outcome';

/**
 * Call mode — the agent's main screen, built for a phone held in one hand:
 * the platform picks the next order (locked for this agent), the agent calls,
 * taps an outcome, and the next order appears. No list to manage.
 */
export function WorkPage() {
  const qc = useQueryClient();
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const { data: order, isLoading } = useOrder(currentId);
  const { data: counts } = useOrderCounts({});

  const claim = useMutation({
    mutationFn: (exclude?: string) => api.post<{ id: string | null }>('/orders/queue/next', exclude ? { exclude } : {}),
    onSuccess: ({ id }) => {
      setCurrentId(id);
      qc.invalidateQueries({ queryKey: qk.orders });
    },
  });
  const next = useCallback((exclude?: string) => claim.mutate(exclude), [claim]);

  useEffect(() => {
    next();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (claim.isPending && !order) return <PageLoader />;

  if (!currentId)
    return (
      <EmptyState icon={<Coffee className="size-7" />} title="لا توجد مكالمات الآن">
        <p>كل الطلبيات الجديدة عولجت، والمكالمات المؤجلة لم يحن وقتها بعد.</p>
        <Button className="mt-4" variant="primary" icon={<PhoneCall className="size-4" />} loading={claim.isPending} onClick={() => next()}>
          تحقق مرة أخرى
        </Button>
      </EmptyState>
    );

  if (isLoading || !order) return <PageLoader />;

  return (
    <div className="mx-auto max-w-2xl pb-56 sm:pb-6">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="ltr text-lg font-bold">{order.reference}</h1>
            <StatusBadge status={order.status} short />
          </div>
          <p className="text-xs text-muted">
            {timeAgo(order.createdAt)} · {order.sourceName ?? 'يدوي'}
            {order.callAttempts > 0 && <> · محاولة {order.callAttempts + 1}</>}
            {order.nextCallAt && <> · كان مبرمجاً {fmtDateTime(order.nextCallAt)}</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-primary-soft px-2.5 py-1 text-xs font-semibold text-primary">
            <span className="ltr">{counts?.due ?? '…'}</span> في الانتظار
          </span>
          <Button size="sm" variant="ghost" icon={<SkipForward className="size-4" />} loading={claim.isPending} onClick={() => next(order.id)}>
            تخطي
          </Button>
        </div>
      </div>

      <OrderPanel order={order} onOpenOrder={setOpenId} />

      {/* Thumb zone: outcomes stay at the bottom of the screen on phones. */}
      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-surface/95 p-3 backdrop-blur sm:static sm:mt-4 sm:rounded-xl sm:border lg:bottom-0">
        <OutcomeBar order={order} showSelect={false} onDone={() => next()} />
      </div>
      <OrderDrawer orderId={openId} onClose={() => setOpenId(null)} onOpenOrder={setOpenId} />
    </div>
  );
}
