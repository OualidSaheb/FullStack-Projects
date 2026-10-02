import { useState } from 'react';
import { AlertTriangle, BadgeCheck, Ban, Package, PackageCheck, Truck, Undo2, Users } from 'lucide-react';
import { STATUS_META, type OrderFilter } from '@touraya/shared';
import { fmtDA, fmtNumber, todayDZ } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useOffers, useStats } from '@/lib/queries';
import { wilayaLabel } from '@/components/geo-select';
import { StatusIcon } from '@/components/status';
import { Card, CardHeader, PageHeader, PageLoader, Select } from '@/components/ui';
import { BarList, DailyColumns, StatTile } from './charts';

const RANGES = [
  { key: 'today', label: 'اليوم', from: () => todayDZ() },
  { key: '7d', label: '7 أيام', from: () => todayDZ(-6) },
  { key: '30d', label: '30 يوم', from: () => todayDZ(-29) },
  { key: 'all', label: 'الكل', from: () => undefined },
] as const;

export function StatsPage() {
  const [range, setRange] = useState<(typeof RANGES)[number]['key']>('30d');
  const [offerId, setOfferId] = useState<number | undefined>();
  const { data: offers } = useOffers();
  const filter: OrderFilter = { from: RANGES.find((r) => r.key === range)!.from(), offerId };
  const { data, isLoading } = useStats(filter);

  return (
    <div className="space-y-5">
      <PageHeader
        title="الإحصائيات"
        actions={
          <>
            <div className="flex rounded-lg border border-line bg-surface p-0.5">
              {RANGES.map((r) => (
                <button key={r.key} onClick={() => setRange(r.key)} className={cn('rounded-md px-3 py-1.5 text-xs font-medium transition', range === r.key ? 'bg-fg text-bg' : 'text-muted hover:text-fg')}>
                  {r.label}
                </button>
              ))}
            </div>
            <Select className="h-9 w-auto text-sm" value={offerId ?? ''} onChange={(e) => setOfferId(e.target.value ? Number(e.target.value) : undefined)} aria-label="العرض">
              <option value="">كل العروض</option>
              {offers?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          </>
        }
      />

      {isLoading || !data ? (
        <PageLoader />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="كل الطلبيات" value={fmtNumber(data.totals.all)} icon={<Package className="size-4" />} />
            <StatTile label="المؤكدة" value={fmtNumber(data.totals.confirmed)} hint={`نسبة التأكيد ${data.totals.confirmationRate}%`} icon={<BadgeCheck className="size-4 text-ok" />} />
            <StatTile label="الملغاة" value={fmtNumber(data.totals.cancelled)} icon={<Ban className="size-4" />} />
            <StatTile label="جهزت للتوصيل" value={fmtNumber(data.totals.shipped)} icon={<Truck className="size-4" />} />
            <StatTile label="الموصلة" value={fmtNumber(data.totals.delivered)} hint={`نسبة التوصيل ${data.totals.deliveryRate}%`} icon={<PackageCheck className="size-4 text-ok" />} />
            <StatTile label="المرتجعة" value={fmtNumber(data.totals.returned)} icon={<Undo2 className="size-4 text-warn" />} />
            <StatTile label="مشكل هاتف" value={fmtNumber(data.totals.phoneIssues)} icon={<AlertTriangle className="size-4 text-warn" />} />
            <StatTile label="مداخيل الموصلة" value={fmtDA(data.totals.revenueDelivered)} hint={`المؤكدة: ${fmtDA(data.totals.revenueConfirmed)}`} />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title="الطلبيات حسب اليوم" />
              <div className="p-4"><DailyColumns data={data.daily} /></div>
            </Card>
            <Card>
              <CardHeader title="حسب الحالة" />
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

          <div className="grid gap-4 xl:grid-cols-3">
            <Card>
              <CardHeader title="أفضل العروض" />
              <div className="p-4">
                <BarList
                  items={data.byOffer.map((p) => ({
                    key: p.offerId ?? 'none',
                    label: p.name,
                    value: p.count,
                    extra: <span className="ms-1.5 text-xs font-normal text-muted">({p.confirmed} مؤكدة · {p.delivered} موصلة · {p.returned} مرتجعة)</span>,
                  }))}
                />
              </div>
            </Card>
            <Card>
              <CardHeader title="الولايات الأكثر طلباً" />
              <div className="max-h-96 overflow-y-auto p-4 scroll-thin">
                <BarList
                  items={data.byWilaya.slice(0, 15).map((w) => ({
                    key: w.wilayaCode ?? 'none',
                    label: w.wilayaCode ? wilayaLabel(w.wilayaCode) : 'غير محددة',
                    value: w.count,
                    extra: w.returned > 0 ? <span className="ms-1.5 text-xs font-normal text-warn">({w.returned} مرتجعة)</span> : undefined,
                  }))}
                />
              </div>
            </Card>
            <Card>
              <CardHeader title="أسباب الإلغاء" />
              <div className="p-4">
                <BarList color="var(--danger)" items={data.cancelReasons.map((r) => ({ key: r.reason, label: r.reason, value: r.count }))} />
              </div>
            </Card>
            <Card className="xl:col-span-3">
              <CardHeader title="حسب المصدر" />
              <div className="p-4">
                <BarList items={data.bySource.map((s) => ({ key: s.sourceId ?? 'none', label: s.name, value: s.count }))} />
              </div>
            </Card>
          </div>

          <Card>
            <CardHeader title="المرتجعات" icon={<Undo2 className="size-4 text-muted" />} />
            <div className="grid gap-4 p-4 lg:grid-cols-2">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <StatTile label="في الطريق" value={fmtNumber(data.returns.inTransit)} />
                <StatTile label="مستلمة" value={fmtNumber(data.returns.received)} />
                <StatTile label="قطع رجعت للمخزن" value={fmtNumber(data.returns.restocked)} icon={<PackageCheck className="size-4 text-ok" />} />
                <StatTile label="قطع تالفة" value={fmtNumber(data.returns.damaged)} icon={<AlertTriangle className="size-4 text-danger" />} />
                <StatTile label="قطع لم ترجع" value={fmtNumber(data.returns.kept)} />
                <StatTile label="خسارة (سعر التكلفة)" value={fmtDA(data.returns.lossCost)} />
              </div>
              <div>
                <p className="mb-3 text-sm font-semibold">الأكثر رجوعاً (منتج · مقاس · لون)</p>
                <BarList color="var(--warn)" items={data.returns.topVariants.map((v) => ({ key: v.label, label: v.label, value: v.count }))} />
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader title="أداء الموظفين" icon={<Users className="size-4 text-muted" />} />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-subtle text-xs text-muted">
                  <tr>{['الموظف', 'الطلبيات', 'المؤكدة', 'الملغاة', 'نسبة التأكيد'].map((h) => <th key={h} className="px-4 py-2.5 text-start font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {data.byAgent.map((a) => (
                    <tr key={a.userId ?? 'none'}>
                      <td className="px-4 py-2.5 font-medium">{a.name}</td>
                      <td className="ltr px-4 py-2.5 text-right">{a.handled}</td>
                      <td className="ltr px-4 py-2.5 text-right text-ok">{a.confirmed}</td>
                      <td className="ltr px-4 py-2.5 text-right">{a.cancelled}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 rounded-full bg-subtle"><div className="h-1.5 rounded-full bg-ok" style={{ width: `${a.rate}%` }} /></div>
                          <span className="ltr text-xs">{a.rate}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
