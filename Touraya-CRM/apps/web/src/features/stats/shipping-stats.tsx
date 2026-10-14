import type { ReactNode } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { AlertTriangle, Banknote, Clock, Hourglass, Package, PackageCheck, Truck, Undo2 } from 'lucide-react';
import { STATUS_META, type ParcelGroupStats, type ShippingStatsDTO } from '@touraya/shared';
import { api } from '@/lib/api';
import { fmtDA, fmtNumber } from '@/lib/format';
import { wilayaLabel } from '@/components/geo-select';
import { StatusIcon } from '@/components/status';
import { Card, CardHeader, PageLoader } from '@/components/ui';
import { BarList, StatTile } from './charts';

const PAYMENT_LABELS: Record<string, string> = {
  'not-ready': 'لم يُحصَّل بعد',
  ready: 'حُصِّل — جاهز للدفع',
  receivable: 'في حسابك (قيد الدفع)',
  payed: 'دُفع لك',
  paid: 'دُفع لك',
};

/** Rate bar: delivered out of finished parcels; red under 60%, amber under 75%. */
function RateBar({ rate, finished }: { rate: number; finished: number }) {
  if (!finished) return <span className="text-xs text-faint">—</span>;
  const color = rate < 60 ? 'var(--danger)' : rate < 75 ? 'var(--warn)' : 'var(--ok)';
  return (
    <div className="flex items-center gap-2">
      <div className="hidden h-1.5 w-20 rounded-full bg-subtle sm:block"><div className="h-1.5 rounded-full" style={{ width: `${rate}%`, background: color }} /></div>
      <span className="ltr text-xs font-semibold" style={{ color }}>{rate}%</span>
    </div>
  );
}

function GroupTable<T extends ParcelGroupStats>({ title, rows, label, rowKey, limit = 20 }: { title: string; rows: T[]; label: (r: T) => ReactNode; rowKey: (r: T) => string | number; limit?: number }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} />
      {!rows.length ? (
        <p className="py-6 text-center text-sm text-faint">لا توجد بيانات</p>
      ) : (
        <div className="max-h-[26rem] overflow-auto scroll-thin">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-subtle text-xs text-muted">
              <tr>{['', 'الطرود', 'سُلّمت', 'مرتجعة', 'النسبة'].map((h) => <th key={h} className="px-3 py-2 text-start font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.slice(0, limit).map((r) => (
                <tr key={rowKey(r)}>
                  <td className="max-w-32 truncate px-3 py-2 font-medium sm:max-w-40">{label(r)}</td>
                  <td className="ltr px-3 py-2 text-right">{fmtNumber(r.count)}</td>
                  <td className="ltr px-3 py-2 text-right text-ok">{fmtNumber(r.delivered)}</td>
                  <td className="ltr px-3 py-2 text-right text-warn">{fmtNumber(r.returned)}</td>
                  <td className="px-3 py-2"><RateBar rate={r.rate} finished={r.delivered + r.returned} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/** Parcels per day: delivered and returned stacked at the base, the rest still on the way. */
function ParcelDays({ data }: { data: ShippingStatsDTO['daily'] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  if (!data.length) return <p className="py-10 text-center text-sm text-faint">لا توجد بيانات</p>;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: 'var(--ok)' }} />سُلّمت</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: 'var(--warn)' }} />مرتجعة</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-primary/35" />في الطريق</span>
      </div>
      <div className="flex h-48 items-end justify-center gap-[2px] border-b border-line" dir="ltr">
        {data.map((d) => (
          <div key={d.day} className="group relative flex h-full max-w-14 flex-1 flex-col justify-end">
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-md bg-ink px-2 py-1 text-[11px] whitespace-nowrap text-white shadow-lg group-hover:block">
              {d.day} · {d.count} طرد · {d.delivered} سُلّمت · {d.returned} مرتجعة
            </div>
            <div className="rounded-t-[4px] bg-primary/35" style={{ height: `${((d.count - d.delivered - d.returned) / max) * 100}%` }} />
            <div style={{ height: `${(d.returned / max) * 100}%`, background: 'var(--warn)' }} />
            <div style={{ height: `${(d.delivered / max) * 100}%`, background: 'var(--ok)' }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-faint" dir="ltr">
        <span>{data[0]?.day}</span>
        <span>{data[data.length - 1]?.day}</span>
      </div>
    </div>
  );
}

/**
 * Delivery company statistics: only the parcels (sent, linked, exported), by
 * confirmation day. The CRM statistics stay on their own tab.
 */
export function ShippingStats({ from }: { from?: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['stats', 'shipping', from ?? 'all'],
    queryFn: () => api.get<ShippingStatsDTO>('/stats/shipping', (from ? { from } : {}) as never),
    placeholderData: keepPreviousData,
  });
  if (isLoading || !data) return <PageLoader />;
  const t = data.totals;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="كل الطرود" value={fmtNumber(t.parcels)} icon={<Package className="size-4" />} />
        <StatTile label="في الطريق الآن" value={fmtNumber(t.inProgress)} hint={`قيمتها ${fmtDA(t.revenuePending)}`} icon={<Truck className="size-4" />} />
        <StatTile label="سُلّمت" value={fmtNumber(t.delivered)} hint={`نسبة التوصيل ${t.deliveryRate}%`} icon={<PackageCheck className="size-4 text-ok" />} />
        <StatTile label="مرتجعة" value={fmtNumber(t.returned)} hint={`نسبة الإرجاع ${t.returnRate}%`} icon={<Undo2 className="size-4 text-warn" />} />
        <StatTile label="المدخول (المسلّمة)" value={fmtDA(t.revenueDelivered)} icon={<Banknote className="size-4 text-ok" />} />
        <StatTile label="ينتظر التحصيل" value={fmtDA(t.revenuePending)} hint="طرود في الطريق" icon={<Hourglass className="size-4" />} />
        <StatTile label="مبيعات ضاعت بالإرجاع" value={fmtDA(t.revenueReturned)} icon={<Undo2 className="size-4 text-danger" />} />
        <StatTile
          label="فشل التوصيل الآن"
          value={fmtNumber(t.failedNow)}
          hint={t.avgDeliveryDays !== null ? `متوسط مدة التوصيل ${t.avgDeliveryDays} يوم` : 'اتصل بهم اليوم'}
          icon={t.failedNow ? <AlertTriangle className="size-4 text-danger" /> : <Clock className="size-4" />}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="الطرود حسب يوم التأكيد" />
          <div className="p-4"><ParcelDays data={data.daily} /></div>
        </Card>
        <Card>
          <CardHeader title="حسب الحالة الآن" />
          <div className="p-4">
            <BarList
              items={[...data.byStatus].sort((a, b) => b.count - a.count).map((s) => ({
                key: s.status,
                label: <><StatusIcon status={s.status} className="text-muted" />{STATUS_META[s.status].label}</>,
                value: s.count,
                color: STATUS_META[s.status].color,
              }))}
            />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="المال عند شركة التوصيل" icon={<Banknote className="size-4 text-muted" />} />
          <div className="p-4">
            {data.payments.length ? (
              <BarList
                color="var(--ok)"
                items={data.payments.map((p) => ({ key: p.status, label: PAYMENT_LABELS[p.status] ?? p.status, value: p.count, extra: <span className="ms-1.5 text-xs font-normal text-muted">({fmtDA(p.amount)})</span> }))}
              />
            ) : (
              <p className="py-6 text-center text-sm text-faint">لم تصل بعد أخبار الدفع من شركة التوصيل (تصل مع الطرود الجديدة)</p>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="أسباب فشل التوصيل" icon={<AlertTriangle className="size-4 text-muted" />} />
          <div className="p-4">
            <BarList color="var(--danger)" items={data.failReasons.map((r) => ({ key: r.reason, label: r.reason, value: r.count }))} />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <GroupTable title="الولايات" rows={data.byWilaya} rowKey={(r) => r.wilayaCode ?? 'none'} label={(r) => (r.wilayaCode ? wilayaLabel(r.wilayaCode) : 'غير محددة')} limit={58} />
        <GroupTable title="العروض" rows={data.byOffer} rowKey={(r) => r.offerId ?? 'none'} label={(r) => r.name} />
        <GroupTable title="من أكّد الطلبية" rows={data.byAgent} rowKey={(r) => r.userId ?? 'none'} label={(r) => r.name} />
        <GroupTable title="نوع التوصيل" rows={data.byDeliveryType} rowKey={(r) => r.deliveryType} label={(r) => (r.deliveryType === 'stopdesk' ? 'المكتب (Stop desk)' : 'المنزل')} />
      </div>
      <p className="text-xs text-muted">نسبة التوصيل = المسلّمة من الطرود التي انتهت (سُلّمت أو رجعت). الطرود التي ما زالت في الطريق لا تدخل في النسبة.</p>
    </div>
  );
}
