import { useState } from 'react';
import { PackageCheck, PackageX, Undo2 } from 'lucide-react';
import type { OrderListItem } from '@touraya/shared';
import { fmtDA, timeAgo } from '@/lib/format';
import { useOrders, useReceiveReturn } from '@/lib/queries';
import { wilayaLabel } from '@/components/geo-select';
import { Alert, Button, Card, CardHeader, EmptyState, PageHeader, PageLoader } from '@/components/ui';
import { OrderDrawer } from '../orders/order-drawer';

function ReturnRow({ order, onOpen }: { order: OrderListItem; onOpen: () => void }) {
  const receive = useReceiveReturn(order.id);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <button className="min-w-0 text-start" onClick={onOpen}>
        <p className="font-medium">
          <span className="ltr me-2 text-primary">{order.reference}</span>
          {order.customerName}
        </p>
        <p className="text-xs text-muted">
          {order.offerName} · {order.itemsLabel || '—'} · {wilayaLabel(order.wilayaCode)} · <span className="ltr">{fmtDA(order.price)}</span> · {timeAgo(order.updatedAt)}
        </p>
      </button>
      <div className="flex gap-2">
        <Button size="sm" variant="success" icon={<PackageCheck className="size-4" />} loading={receive.isPending && receive.variables?.condition === 'restock'} onClick={() => receive.mutate({ condition: 'restock' })}>
          وصل سليم ← المخزن
        </Button>
        <Button size="sm" variant="ghost" className="text-danger" icon={<PackageX className="size-4" />} loading={receive.isPending && receive.variables?.condition === 'damaged'} onClick={() => receive.mutate({ condition: 'damaged' })}>
          تالف
        </Button>
      </div>
    </li>
  );
}

/** Returned parcels on their way back: check them in so stock stays true. */
export function ReturnsPage() {
  const { data, isLoading } = useOrders({ status: ['returned'], pageSize: 200, sort: 'updatedAt', dir: 'asc' });
  const { data: received } = useOrders({ status: ['return_received'], pageSize: 20, sort: 'updatedAt', dir: 'desc' });
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      <PageHeader title="المرتجعات" subtitle="الطرود التي رفضها الزبون: سجّل استلامها لترجع القطع إلى المخزون" />
      <Alert tone="primary" icon={<Undo2 className="mt-0.5 size-4 shrink-0" />}>
        تتحول الطلبية إلى «مرتجعة» تلقائياً من Webhook شركة التوصيل (أو يدوياً). عند وصول الطرد افتحه وتحقق من القطع ثم اختر: سليم أو تالف.
      </Alert>
      <Card>
        <CardHeader title={`في الطريق إلينا (${data?.total ?? 0})`} />
        {isLoading ? <PageLoader /> : !data?.items.length ? <EmptyState icon={<PackageCheck className="size-6" />} title="لا توجد مرتجعات في الانتظار" /> : (
          <ul className="divide-y divide-line">{data.items.map((o) => <ReturnRow key={o.id} order={o} onOpen={() => setOpenId(o.id)} />)}</ul>
        )}
      </Card>
      {received && received.items.length > 0 && (
        <Card>
          <CardHeader title="آخر المرتجعات المستلمة" />
          <ul className="divide-y divide-line text-sm">
            {received.items.map((o) => (
              <li key={o.id} className="flex justify-between gap-2 px-4 py-2.5">
                <button className="ltr text-primary" onClick={() => setOpenId(o.id)}>{o.reference}</button>
                <span className="truncate text-muted">{o.customerName} · {o.itemsLabel}</span>
                <span className="text-xs text-faint">{timeAgo(o.updatedAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <OrderDrawer orderId={openId} onClose={() => setOpenId(null)} onOpenOrder={setOpenId} />
    </div>
  );
}
