import { useState } from 'react';
import { Download, FileSpreadsheet, History, PackageCheck } from 'lucide-react';
import { download } from '@/lib/api';
import { fmtDA, fmtDateTime, timeAgo } from '@/lib/format';
import { useBatches, useOrders } from '@/lib/queries';
import { communeLabel, wilayaLabel } from '@/components/geo-select';
import { Alert, Button, Card, CardHeader, Checkbox, EmptyState, PageHeader, PageLoader } from '@/components/ui';
import { OrderDrawer } from '../orders/order-drawer';
import { ExportReviewModal } from './export-review-modal';

export function ShippingPage() {
  const { data: confirmed, isLoading } = useOrders({ status: ['confirmed'], pageSize: 200, sort: 'createdAt', dir: 'asc' });
  const { data: batches } = useBatches();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reviewIds, setReviewIds] = useState<string[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const items = confirmed?.items ?? [];
  const allSelected = items.length > 0 && items.every((o) => selected.has(o.id));
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div className="space-y-5">
      <PageHeader
        title="التوصيل"
        subtitle="تجهيز ملف شركة التوصيل للطلبيات المؤكدة"
        actions={
          <Button variant="primary" icon={<FileSpreadsheet className="size-4" />} disabled={!selected.size} onClick={() => setReviewIds([...selected])}>
            مراجعة وتحميل الملف ({selected.size})
          </Button>
        }
      />

      <Alert tone="primary" icon={<PackageCheck className="mt-0.5 size-4 shrink-0" />}>
        اختر الطلبيات المؤكدة ← راجع الملف ← حمّله وارفعه في موقع شركة التوصيل (أو أرسل عبر API إن كان مفعلاً). بعد التحميل تتغير الحالة إلى «تم تجهيزها لشركة التوصيل» وتخرج القطع من المخزون، حتى لا ترسل مرتين.
      </Alert>

      <Card className="overflow-hidden">
        <CardHeader title={`طلبيات مؤكدة في الانتظار (${items.length})`} icon={<PackageCheck className="size-4 text-muted" />} />
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
                  <tr key={o.id} className="cursor-pointer hover:bg-subtle/70" onClick={() => setOpenId(o.id)}>
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
      </Card>

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

      {reviewIds && <ExportReviewModal ids={reviewIds} onClose={() => { setReviewIds(null); setSelected(new Set()); }} onOpenOrder={setOpenId} />}
      <OrderDrawer orderId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
