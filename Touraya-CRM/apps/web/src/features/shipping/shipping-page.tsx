import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, History, PackageCheck, RefreshCw, Send, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { IN_TRANSIT_STATUSES, STATUS_META, type OrderListItem, type OrderStatus } from '@touraya/shared';
import { api, download } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { fmtDA, fmtDateTime, timeAgo } from '@/lib/format';
import { errorMessage, qk, useBatches, useOrders } from '@/lib/queries';
import { communeLabel, wilayaLabel } from '@/components/geo-select';
import { CallButton } from '@/components/phone';
import { StatusBadge } from '@/components/status';
import { Alert, Button, Card, CardHeader, Checkbox, EmptyState, PageHeader, PageLoader } from '@/components/ui';
import { OrderDrawer } from '../orders/order-drawer';
import { ExportReviewModal } from './export-review-modal';

type Tab = 'ready' | 'transit' | 'files';

/** Confirmed orders waiting to be sent: pick, review, send (API) or prepare the carrier file. */
function ReadyTab({ onOpen }: { onOpen: (id: string) => void }) {
  const can = useCan();
  const { data: confirmed, isLoading } = useOrders({ status: ['confirmed'], pageSize: 200, sort: 'createdAt', dir: 'asc' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reviewIds, setReviewIds] = useState<string[] | null>(null);
  const items = confirmed?.items ?? [];
  const allSelected = items.length > 0 && items.every((o) => selected.has(o.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={`طلبيات مؤكدة في الانتظار (${items.length})`}
        icon={<PackageCheck className="size-4 text-muted" />}
        action={
          <Button size="sm" variant="primary" icon={<Send className="size-3.5" />} disabled={!selected.size} onClick={() => setReviewIds([...selected])}>
            {can('shipping.export') ? 'مراجعة وإرسال' : 'إرسال لشركة التوصيل'} ({selected.size})
          </Button>
        }
      />
      {isLoading ? (
        <PageLoader />
      ) : !items.length ? (
        <EmptyState icon={<PackageCheck className="size-6" />} title="لا توجد طلبيات مؤكدة في الانتظار" />
      ) : (
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-subtle text-xs text-muted">
              <tr>
                <th className="w-10 px-3 py-2.5 text-start">
                  <Checkbox checked={allSelected} indeterminate={selected.size > 0 && !allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((o) => o.id)))} aria-label="تحديد الكل" />
                </th>
                {['الطلبية', 'الزبون', 'الولاية / البلدية', 'العرض', 'السعر', 'أكدت'].map((h) => <th key={h} className="px-3 py-2.5 text-start font-semibold">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {items.map((o) => (
                <tr key={o.id} className="cursor-pointer hover:bg-subtle/70" onClick={() => onOpen(o.id)}>
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={selected.has(o.id)} onChange={() => toggle(o.id)} aria-label="تحديد" />
                  </td>
                  <td className="ltr px-3 py-2.5 text-right font-semibold">{o.reference}</td>
                  <td className="px-3 py-2.5">{o.customerName}<div className="ltr text-right text-xs text-muted">{o.phone}</div></td>
                  <td className="px-3 py-2.5">
                    {wilayaLabel(o.wilayaCode)}
                    <div className={o.communeName ? 'text-xs text-muted' : 'text-xs text-warn'}>{communeLabel(o.communeName, o.wilayaCode) ?? `${o.communeRaw ?? ''} ⚠`}</div>
                  </td>
                  <td className="px-3 py-2.5">{o.offerName ?? <span className="text-warn">—</span>}<div className="text-xs text-muted">{o.itemsLabel}</div></td>
                  <td className="ltr px-3 py-2.5 text-right">{fmtDA(o.price)}</td>
                  <td className="px-3 py-2.5 text-xs text-muted">{timeAgo(o.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {reviewIds && <ExportReviewModal ids={reviewIds} onClose={() => { setReviewIds(null); setSelected(new Set()); }} onOpenOrder={onOpen} />}
    </Card>
  );
}

function ParcelRow({ o, onOpen }: { o: OrderListItem; onOpen: (id: string) => void }) {
  return (
    <li className={cn('grid cursor-pointer items-center gap-x-4 gap-y-1 px-4 py-3 text-sm hover:bg-subtle/60 sm:grid-cols-[7rem_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.6fr)_auto]', o.status === 'delivery_failed' && 'bg-danger/5')} onClick={() => onOpen(o.id)}>
      <span className="ltr font-semibold sm:text-right">{o.reference}</span>
      <span className="min-w-0">
        <span className="block truncate">{o.customerName}</span>
        <span className="text-xs text-muted">{wilayaLabel(o.wilayaCode)} · <span className="ltr">{fmtDA(o.price)}</span></span>
      </span>
      <span><StatusBadge status={o.status} short /></span>
      <span className="min-w-0 text-xs text-muted">
        {o.carrierStatus && <span className="block truncate" title={o.carrierStatus}>{o.carrierStatus}</span>}
        <span className="ltr">{o.carrierTracking}</span> · {timeAgo(o.updatedAt)}
      </span>
      <span onClick={(e) => e.stopPropagation()}>{o.status === 'delivery_failed' && <CallButton phone={o.phone} label="اتصال" compact />}</span>
    </li>
  );
}

/**
 * Parcels with the delivery company, kept up to date by the carrier webhook
 * and an hourly check. Failed delivery attempts come first: calling the
 * customer the same day saves most of them from coming back.
 */
function TransitTab({ onOpen }: { onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useOrders({ status: IN_TRANSIT_STATUSES, pageSize: 200, sort: 'updatedAt', dir: 'desc' });
  const [filter, setFilter] = useState<OrderStatus | null>(null);
  const sync = useMutation({
    mutationFn: () => api.post<{ checked: number; applied: number }>('/shipping/sync'),
    onSuccess: (r) => {
      toast.success(r.applied ? `تم تحديث ${r.applied} طرد` : `لا جديد (${r.checked} طرد تم فحصه)`);
      qc.invalidateQueries({ queryKey: qk.orders });
    },
    onError: (e) => toast.error(errorMessage(e), { duration: 10_000 }),
  });
  const items = data?.items ?? [];
  const count = (s: OrderStatus) => items.filter((o) => o.status === s).length;
  const failed = items.filter((o) => o.status === 'delivery_failed');
  const shown = (filter ? items.filter((o) => o.status === filter) : items).sort((a, b) => Number(b.status === 'delivery_failed') - Number(a.status === 'delivery_failed'));

  return (
    <div className="space-y-3">
      {failed.length > 0 && (
        <Alert tone="danger" icon={<AlertTriangle className="mt-0.5 size-4 shrink-0" />}>
          <b>{failed.length}</b> طرد فشل توصيله — اتصل بالزبون اليوم (السبب مكتوب تحت الحالة) قبل أن يرجع.
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setFilter(null)} className={cn('rounded-full border px-3 py-1 text-xs font-medium', !filter ? 'border-primary bg-primary/10 text-primary' : 'border-line text-muted')}>
          الكل ({items.length})
        </button>
        {IN_TRANSIT_STATUSES.map((s) => (
          <button key={s} onClick={() => setFilter(filter === s ? null : s)} className={cn('rounded-full border px-3 py-1 text-xs font-medium', filter === s ? 'border-primary bg-primary/10 text-primary' : 'border-line text-muted')}>
            {STATUS_META[s].short} ({count(s)})
          </button>
        ))}
        <Button size="sm" variant="ghost" className="ms-auto" icon={<RefreshCw className="size-3.5" />} loading={sync.isPending} onClick={() => sync.mutate()}>
          تحديث من شركة التوصيل
        </Button>
      </div>
      <Card className="overflow-hidden">
        {isLoading ? <PageLoader /> : !shown.length ? <EmptyState icon={<Truck className="size-6" />} title="لا توجد طرود في الطريق" /> : <ul className="divide-y divide-line">{shown.map((o) => <ParcelRow key={o.id} o={o} onOpen={onOpen} />)}</ul>}
      </Card>
      <p className="text-xs text-muted">الحالات تتحدث وحدها من شركة التوصيل (Webhook فوري + فحص كل ساعة).</p>
    </div>
  );
}

function FilesTab() {
  const { data: batches } = useBatches();
  return (
    <Card>
      <CardHeader title="سجل ملفات التوصيل" icon={<History className="size-4 text-muted" />} />
      {!batches?.length ? (
        <EmptyState title="لم يتم تحميل أي ملف بعد" />
      ) : (
        <ul className="divide-y divide-line">
          {batches.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <p className="font-medium">ملف #{b.id} {b.carrierName && `· ${b.carrierName}`} — {b.orderCount} طلبية · <span className="ltr">{fmtDA(b.totalAmount)}</span></p>
                <p className="text-xs text-muted">{fmtDateTime(b.createdAt)} · {b.createdByName ?? '—'}</p>
              </div>
              <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => download(`/shipping/exports/${b.id}/file`)}>
                تحميل مرة أخرى
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function ShippingPage() {
  const can = useCan();
  const [tab, setTab] = useState<Tab>('ready');
  const [openId, setOpenId] = useState<string | null>(null);
  const tabs: [Tab, string][] = [
    ['ready', 'جاهزة للإرسال'],
    ['transit', 'في الطريق'],
    ...(can('shipping.export') ? ([['files', 'ملفات التوصيل']] as [Tab, string][]) : []),
  ];
  return (
    <div className="space-y-5">
      <PageHeader title="التوصيل" subtitle="إرسال الطلبيات المؤكدة لشركة التوصيل ومتابعة الطرود حتى التسليم" />
      <nav className="flex gap-1 overflow-x-auto border-b border-line scroll-thin">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn('-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition', tab === key ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-fg')}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === 'ready' && <ReadyTab onOpen={setOpenId} />}
      {tab === 'transit' && <TransitTab onOpen={setOpenId} />}
      {tab === 'files' && <FilesTab />}
      <OrderDrawer orderId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
