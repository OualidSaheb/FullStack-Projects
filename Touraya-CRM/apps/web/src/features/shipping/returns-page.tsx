import { useState } from 'react';
import { PackageCheck, RotateCcw, Search, Undo2 } from 'lucide-react';
import { RETURN_CONDITIONS, type OrderListItem, type ReturnConditionKey } from '@touraya/shared';
import { fmtDA, timeAgo } from '@/lib/format';
import { useChangeStatus, useOrder, useOrders, useReceiveReturn, useReorder } from '@/lib/queries';
import { cn } from '@/lib/cn';
import { wilayaLabel } from '@/components/geo-select';
import { StatusBadge } from '@/components/status';
import { Alert, Button, Card, CardHeader, EmptyState, Field, Input, Modal, PageHeader, PageLoader } from '@/components/ui';
import { OrderDrawer } from '../orders/order-drawer';

const SHIPPED = ['ready_for_carrier', 'sent_to_carrier', 'carrier_received', 'delivered'] as const;

/** Check-in dialog: what came back, piece by piece; optionally re-sent to another order. */
function ReceiveModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const { data: order } = useOrder(orderId);
  const receive = useReceiveReturn(orderId);
  const [conditions, setConditions] = useState<Record<number, ReturnConditionKey>>({});
  const [link, setLink] = useState('');
  const [note, setNote] = useState('');
  if (!order) return null;
  const conditionOf = (id: number) => conditions[id] ?? 'restock';
  const setAll = (c: ReturnConditionKey) => setConditions(Object.fromEntries(order.items.map((i) => [i.id, c])));

  return (
    <Modal
      open
      onClose={onClose}
      title={`استلام المرتجع ${order.reference}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button
            variant="primary"
            loading={receive.isPending}
            onClick={() =>
              receive.mutate(
                { condition: 'restock', items: order.items.map((i) => ({ itemId: i.id, condition: conditionOf(i.id) })), linkOrderReference: link.trim() || undefined, note: note.trim() || undefined },
                { onSuccess: onClose },
              )
            }
          >
            تأكيد الاستلام
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="text-muted">الكل:</span>
          {(Object.keys(RETURN_CONDITIONS) as ReturnConditionKey[]).map((c) => (
            <button key={c} onClick={() => setAll(c)} className="rounded-full border border-line px-2.5 py-1 hover:border-primary hover:text-primary">{RETURN_CONDITIONS[c]}</button>
          ))}
        </div>
        <ul className="space-y-2">
          {order.items.map((item, i) => (
            <li key={item.id} className="rounded-lg border border-line p-2.5">
              <p className="mb-2 text-sm font-medium">
                {i + 1}. {item.productName} {[item.size, item.color].filter(Boolean).join(' ') || ''}
                {!item.variantId && <span className="ms-2 text-xs text-warn">(مقاس/لون غير محدد — لا يدخل المخزون)</span>}
              </p>
              <div className="grid grid-cols-3 gap-1.5">
                {(Object.keys(RETURN_CONDITIONS) as ReturnConditionKey[]).map((c) => (
                  <button
                    key={c}
                    onClick={() => setConditions((s) => ({ ...s, [item.id]: c }))}
                    className={cn(
                      'rounded-lg border px-2 py-2 text-xs font-medium',
                      conditionOf(item.id) === c ? (c === 'restock' ? 'border-ok bg-ok/10 text-ok' : c === 'damaged' ? 'border-danger bg-danger/10 text-danger' : 'border-warn bg-warn/10 text-warn') : 'border-line text-muted',
                    )}
                  >
                    {RETURN_CONDITIONS[c]}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
        <Field label="أُعيد إرسال القطع لطلبية أخرى؟ (اختياري)" hint="رقم الطلبية مثلاً TR-00123 — تُربط الطلبيتان في السجل">
          {(id) => <Input id={id} dir="ltr" value={link} onChange={(e) => setLink(e.target.value)} placeholder="TR-00123" />}
        </Field>
        <Field label="ملاحظة (اختياري)">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً: الزبون رفض بسبب المقاس" />}</Field>
      </div>
    </Modal>
  );
}

/** Register a return by hand: find a shipped order by reference, phone or tracking. */
function ManualReturn() {
  const [q, setQ] = useState('');
  const { data, isFetching } = useOrders({ q: q.trim() || undefined, status: [...SHIPPED], pageSize: 5 });
  const [picked, setPicked] = useState<OrderListItem | null>(null);
  const mark = useChangeStatus(picked?.id ?? '');
  return (
    <Card>
      <CardHeader title="تسجيل مرتجع يدوياً" icon={<Search className="size-4 text-muted" />} />
      <div className="space-y-3 p-4">
        <p className="text-sm text-muted">عندما لا يصل التحديث من شركة التوصيل: ابحث عن الطلبية (الرقم، الهاتف، رقم التتبع) وسجّلها «مرتجعة».</p>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="TR-00123 أو 0555… أو رقم التتبع" />
        {q.trim().length >= 3 && (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {isFetching && <li className="p-3 text-center text-sm text-faint">…</li>}
            {!isFetching && !data?.items.length && <li className="p-3 text-center text-sm text-faint">لا توجد طلبية مرسلة بهذا البحث</li>}
            {data?.items.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 p-2.5 text-sm">
                <span><b className="ltr me-2">{o.reference}</b>{o.customerName} · {o.itemsLabel}</span>
                <span className="flex items-center gap-2">
                  <StatusBadge status={o.status} short />
                  <Button size="sm" icon={<Undo2 className="size-3.5" />} onClick={() => setPicked(o)}>مرتجعة</Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Modal
        open={Boolean(picked)}
        onClose={() => setPicked(null)}
        size="sm"
        title="تسجيل مرتجع"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPicked(null)}>إلغاء</Button>
            <Button variant="primary" loading={mark.isPending} onClick={() => mark.mutate({ status: 'returned', comment: 'مرتجع مسجل يدوياً' }, { onSuccess: () => { setPicked(null); setQ(''); } })}>
              تسجيل
            </Button>
          </>
        }
      >
        <p className="text-sm">الطلبية <b className="ltr">{picked?.reference}</b> ({picked?.customerName}) ستصبح «مرتجعة (في الطريق)». عند وصول الطرد سجّل استلامه قطعة بقطعة.</p>
      </Modal>
    </Card>
  );
}

function ReturnRow({ order, onOpen, onReceive }: { order: OrderListItem; onOpen: () => void; onReceive: () => void }) {
  const reorder = useReorder(order.id);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <button className="min-w-0 text-start" onClick={onOpen}>
        <p className="font-medium"><span className="ltr me-2 text-primary">{order.reference}</span>{order.customerName}</p>
        <p className="text-xs text-muted">
          {order.offerName} · {order.itemsLabel || '—'} · {wilayaLabel(order.wilayaCode)} · <span className="ltr">{fmtDA(order.price)}</span> · {timeAgo(order.updatedAt)}
        </p>
      </button>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="success" icon={<PackageCheck className="size-4" />} onClick={onReceive}>استلام الطرد</Button>
        <Button size="sm" variant="ghost" icon={<RotateCcw className="size-4" />} loading={reorder.isPending} onClick={() => reorder.mutate('confirmed')} title="الزبون يريد الطلبية مرة أخرى: طلبية جديدة مؤكدة ومرتبطة">
          إعادة الإرسال للزبون
        </Button>
      </div>
    </li>
  );
}

/**
 * Returns: parcels coming back (from the carrier webhook or registered by hand),
 * checked in piece by piece so stock and statistics stay true.
 */
export function ReturnsPage() {
  const { data, isLoading } = useOrders({ status: ['returned'], pageSize: 200, sort: 'updatedAt', dir: 'asc' });
  const { data: received } = useOrders({ status: ['return_received'], pageSize: 20, sort: 'updatedAt', dir: 'desc' });
  const [openId, setOpenId] = useState<string | null>(null);
  const [receiveId, setReceiveId] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      <PageHeader title="المرتجعات" subtitle="الطرود التي رفضها الزبون: سجّل استلامها قطعة بقطعة ليبقى المخزون والإحصائيات صحيحين" />
      <Alert tone="primary" icon={<Undo2 className="mt-0.5 size-4 shrink-0" />}>
        تصبح الطلبية «مرتجعة» تلقائياً من Webhook شركة التوصيل، أو سجّلها يدوياً أدناه. عند وصول الطرد: افتحه، واختر لكل قطعة: سليمة (ترجع للمخزن)، تالفة (تُسجل كخسارة)، أو لم ترجع.
      </Alert>
      <Card>
        <CardHeader title={`في الطريق إلينا (${data?.total ?? 0})`} />
        {isLoading ? (
          <PageLoader />
        ) : !data?.items.length ? (
          <EmptyState icon={<PackageCheck className="size-6" />} title="لا توجد مرتجعات في الانتظار" />
        ) : (
          <ul className="divide-y divide-line">
            {data.items.map((o) => <ReturnRow key={o.id} order={o} onOpen={() => setOpenId(o.id)} onReceive={() => setReceiveId(o.id)} />)}
          </ul>
        )}
      </Card>
      <ManualReturn />
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
      {receiveId && <ReceiveModal orderId={receiveId} onClose={() => setReceiveId(null)} />}
      <OrderDrawer orderId={openId} onClose={() => setOpenId(null)} onOpenOrder={setOpenId} />
    </div>
  );
}
