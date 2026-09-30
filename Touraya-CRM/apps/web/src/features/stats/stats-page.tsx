import { useState } from 'react';
import { AlertTriangle, BadgeCheck, Ban, Package, Truck, Users } from 'lucide-react';
import { STATUS_META, type OrderFilter } from '@touraya/shared';
import { fmtDA, fmtNumber, todayDZ } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useProducts, useStats } from '@/lib/queries';
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
  const [productId, setProductId] = useState<number | undefined>();
  const { data: products } = useProducts();
  const filter: OrderFilter = { from: RANGES.find((r) => r.key === range)!.from(), productId };
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
            <Select className="h-9 w-auto text-sm" value={productId ?? ''} onChange={(e) => setProductId(e.target.value ? Number(e.target.value) : undefined)} aria-label="العرض">
              <option value="">كل العروض</option>
              {products?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </>
        }
      />

      {isLoading || !data ? (
        <PageLoader />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatTile label="كل الطلبيات" value={fmtNumber(data.totals.all)} icon={<Package className="size-4" />} />
            <StatTile label="المؤكدة" value={fmtNumber(data.totals.confirmed)} hint={`نسبة التأكيد ${data.totals.confirmationRate}%`} icon={<BadgeCheck className="size-4 text-ok" />} />
            <StatTile label="الملغاة" value={fmtNumber(data.totals.cancelled)} icon={<Ban className="size-4" />} />
            <StatTile label="جهزت للتوصيل" value={fmtNumber(data.totals.shipped)} hint={`موصلة ${data.totals.delivered} · نسبة التوصيل ${data.totals.deliveryRate}%`} icon={<Truck className="size-4" />} />
            <StatTile label="مشكل هاتف" value={fmtNumber(data.totals.phoneIssues)} icon={<AlertTriangle className="size-4 text-warn" />} />
            <StatTile label="قيمة المؤكدة" value={fmtDA(data.totals.revenueConfirmed)} />
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
                  items={data.byProduct.map((p) => ({
                    key: p.productId ?? 'none',
                    label: p.name,
                    value: p.count,
                    extra: <span className="ms-1.5 text-xs font-normal text-muted">({p.confirmed} مؤكدة)</span>,
                  }))}
                />
              </div>
            </Card>
            <Card>
              <CardHeader title="الولايات الأكثر طلباً" />
              <div className="max-h-96 overflow-y-auto p-4 scroll-thin">
                <BarList items={data.byWilaya.slice(0, 15).map((w) => ({ key: w.wilayaCode ?? 'none', label: w.wilayaCode ? wilayaLabel(w.wilayaCode) : 'غير محددة', value: w.count }))} />
              </div>
            </Card>
            <Card>
              <CardHeader title="حسب المصدر" />
              <div className="p-4">
                <BarList items={data.bySource.map((s) => ({ key: s.sourceId ?? 'none', label: s.name, value: s.count }))} />
              </div>
            </Card>
          </div>

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
                      <td className="ltr px-4 py-2.5 text-start">{a.handled}</td>
                      <td className="ltr px-4 py-2.5 text-start text-ok">{a.confirmed}</td>
                      <td className="ltr px-4 py-2.5 text-start">{a.cancelled}</td>
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
