import { Copy, Repeat, RotateCcw, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useCan } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import { useBulkAction, useOrder, useReorder } from '@/lib/queries';
import { StatusBadge } from '@/components/status';
import { Badge, Drawer, IconButton, PageLoader } from '@/components/ui';
import { OrderPanel } from './order-panel';
import { OutcomeBar } from './parts/outcome';

export function OrderDrawer({ orderId, onClose, onOpenOrder }: { orderId: string | null; onClose: () => void; onOpenOrder?: (id: string) => void }) {
  const { data: order, isLoading } = useOrder(orderId);
  const can = useCan();
  const bulk = useBulkAction();
  const reorder = useReorder(orderId ?? '');
  const canReorder = order && can('orders.status') && ['cancelled', 'delivered', 'returned', 'return_received'].includes(order.status);

  return (
    <Drawer open={Boolean(orderId)} onClose={onClose}>
      {isLoading || !order ? (
        <PageLoader />
      ) : (
        <>
          <header className="border-b border-line bg-surface px-4 py-3 sm:px-5 sm:py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="ltr text-lg font-bold">{order.reference}</h2>
                  <StatusBadge status={order.status} />
                  {order.deletedAt && <Badge tone="danger">محذوفة</Badge>}
                </div>
                <p className="mt-1 text-xs text-muted">
                  {fmtDateTime(order.createdAt)} · {order.sourceName ?? 'يدوي'}
                  {order.assignedToName && <> · {order.assignedToName}</>}
                  {order.nextCallAt && <> · الاتصال القادم {fmtDateTime(order.nextCallAt)}</>}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {canReorder && (
                  <IconButton
                    label="طلبية جديدة لنفس الزبون (مرتبطة)"
                    icon={<Repeat className="size-4" />}
                    loading={reorder.isPending}
                    onClick={() => reorder.mutate('new', { onSuccess: (o) => onOpenOrder?.(o.id) })}
                  />
                )}
                <IconButton label="نسخ رقم الطلبية" icon={<Copy className="size-4" />} onClick={() => navigator.clipboard.writeText(order.reference).then(() => toast.success('تم النسخ'))} />
                {can('orders.delete') &&
                  (order.deletedAt ? (
                    <IconButton label="استرجاع" icon={<RotateCcw className="size-4" />} onClick={() => bulk.mutate({ action: 'restore', ids: [order.id] })} />
                  ) : (
                    <IconButton
                      label="حذف"
                      className="hover:text-danger"
                      icon={<Trash2 className="size-4" />}
                      onClick={() => bulk.mutate({ action: 'delete', ids: [order.id] }, { onSuccess: () => { toast.success('نقلت إلى المحذوفات'); onClose(); } })}
                    />
                  ))}
                <IconButton label="إغلاق" icon={<X className="size-4" />} onClick={onClose} />
              </div>
            </div>
            <OutcomeBar order={order} className="mt-3" />
          </header>
          <div className="flex-1 overflow-y-auto p-4 scroll-thin sm:p-5">
            <OrderPanel order={order} onOpenOrder={onOpenOrder} />
          </div>
        </>
      )}
    </Drawer>
  );
}
