import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Banknote, Clock, Hourglass, Package, PackageCheck, RefreshCw, TrendingUp, Truck, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import type { CarrierGroupStats, CarrierStats, ParcelStage } from '@touraya/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtDA, fmtNumber, timeAgo } from '@/lib/format';
import { errorMessage } from '@/lib/queries';
import { wilayaLabel } from '@/components/geo-select';
import { Alert, Button, Card, CardHeader, PageLoader } from '@/components/ui';
import { BarList, StatTile } from './charts';

type DTO = CarrierStats & { fetchedAt: string; carriers: string[]; withoutCost: string[] };

const MONTHS = ['جانفي', 'فيفري', 'مارس', 'أفريل', 'ماي', 'جوان', 'جويلية', 'أوت', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const monthLabel = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
const weekLabel = (key: string) => {
  const end = new Date(`${key}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  return `${key.slice(8, 10)}/${key.slice(5, 7)} → ${end.toISOString().slice(8, 10)}/${end.toISOString().slice(5, 7)}`;
};

const STAGE: Record<ParcelStage, { label: string; color: string }> = {
  delivered: { label: 'سُلّمت', color: 'var(--ok)' },
  returned: { label: 'مرتجعة', color: 'var(--warn)' },
  failed: { label: 'فشل التوصيل', color: 'var(--danger)' },
  transit: { label: 'في الطريق', color: 'var(--primary)' },
  notShipped: { label: 'لم تُشحن بعد', color: 'var(--muted)' },
  cancelled: { label: 'ملغاة', color: 'var(--faint)' },
};
const PAYMENT: Record<string, string> = { 'not-ready': 'لم يُحصَّل بعد', ready: 'حُصِّل — جاهز للدفع', receivable: 'في حسابك (قيد الدفع)', payed: 'دُفع لك', paid: 'دُفع لك' };

function Rate({ g }: { g: CarrierGroupStats }) {
  const finished = g.delivered + g.returned;
  if (!finished) return <span className="text-xs text-faint">—</span>;
  const color = g.deliveryRate < 60 ? 'var(--danger)' : g.deliveryRate < 75 ? 'var(--warn)' : 'var(--ok)';
  return (
    <div className="flex items-center gap-2">
      <div className="hidden h-1.5 w-16 rounded-full bg-subtle sm:block"><div className="h-1.5 rounded-full" style={{ width: `${g.deliveryRate}%`, background: color }} /></div>
      <span className="ltr text-xs font-semibold" style={{ color }}>{g.deliveryRate}%</span>
    </div>
  );
}

/** One row per period / offer / wilaya: counts, delivery rate, money. */
function GroupTable<T extends CarrierGroupStats>({ rows, label, rowKey, money = true }: { rows: T[]; label: (r: T) => ReactNode; rowKey: (r: T) => string | number; money?: boolean }) {
  if (!rows.length) return <p className="py-6 text-center text-sm text-faint">لا توجد بيانات</p>;
  const heads = ['', 'الطرود', 'سُلّمت', 'مرتجعة', 'في الطريق', 'نسبة التوصيل', ...(money ? ['المدخول', 'الربح قبل الإعلانات'] : [])];
  return (
    <div className="max-h-[28rem] overflow-auto scroll-thin">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="sticky top-0 bg-subtle text-xs text-muted">
          <tr>{heads.map((h) => <th key={h} className="px-3 py-2 text-start font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={rowKey(r)}>
              <td className="max-w-48 truncate px-3 py-2 font-medium">{label(r)}</td>
              <td className="ltr px-3 py-2 text-right">{fmtNumber(r.parcels)}</td>
              <td className="ltr px-3 py-2 text-right text-ok">{fmtNumber(r.delivered)}</td>
              <td className="ltr px-3 py-2 text-right text-warn">{fmtNumber(r.returned)}</td>
              <td className="ltr px-3 py-2 text-right text-muted">{fmtNumber(r.transit + r.failed + r.notShipped)}</td>
              <td className="px-3 py-2"><Rate g={r} /></td>
              {money && <td className="ltr px-3 py-2 text-right">{fmtDA(r.revenue)}</td>}
              {money && <td className={cn('ltr px-3 py-2 text-right font-semibold', r.profit < 0 ? 'text-danger' : 'text-ok')}>{fmtDA(Math.round(r.profit))}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The delivery company's own figures: every parcel of its account, also those
 * created by hand in its dashboard — counts, rates, money and profit before
 * ads, overall, by month, week, offer and wilaya.
 */
export function CarrierActualStats() {
  const qc = useQueryClient();
  const [period, setPeriod] = useState<'month' | 'week'>('month');
  const [refreshing, setRefreshing] = useState(false);
  const { data, isLoading, error } = useQuery({ queryKey: ['stats', 'carrier'], queryFn: () => api.get<DTO>('/stats/carrier'), staleTime: 5 * 60_000, retry: false });
  const refresh = async () => {
    setRefreshing(true);
    try {
      qc.setQueryData(['stats', 'carrier'], await api.get<DTO>('/stats/carrier', { refresh: '1' } as never));
    } catch (e) {
      toast.error(errorMessage(e), { duration: 10_000 });
    } finally {
      setRefreshing(false);
    }
  };

  if (isLoading) return <div className="space-y-2 py-6 text-center text-sm text-muted"><PageLoader /><p>جاري قراءة كل الطرود من شركة التوصيل…</p></div>;
  if (error || !data) return <Alert tone="danger" icon={<AlertTriangle className="mt-0.5 size-4 shrink-0" />}>{errorMessage(error)}</Alert>;
  const t = data.totals;
  const onWay = t.transit + t.failed + t.notShipped;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <p>
          من حساب <b className="text-fg">{data.carriers.join('، ')}</b> مباشرة: <b className="text-fg">{fmtNumber(t.parcels)}</b> طرد، منها {fmtNumber(data.inPlatform)} مسجلة في المنصة · آخر قراءة {timeAgo(data.fetchedAt)}
        </p>
        <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} loading={refreshing} onClick={refresh}>قراءة من جديد</Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="كل الطرود" value={fmtNumber(t.parcels)} icon={<Package className="size-4" />} />
        <StatTile label="سُلّمت" value={fmtNumber(t.delivered)} hint={`نسبة التوصيل ${t.deliveryRate}%`} icon={<PackageCheck className="size-4 text-ok" />} />
        <StatTile label="مرتجعة" value={fmtNumber(t.returned)} hint={`نسبة الإرجاع ${t.returnRate}%`} icon={<Undo2 className="size-4 text-warn" />} />
        <StatTile label="في الطريق الآن" value={fmtNumber(onWay)} hint={t.failed ? `منها ${t.failed} فشل توصيلها` : t.notShipped ? `منها ${t.notShipped} لم تُشحن بعد` : undefined} icon={<Truck className="size-4" />} />
        <StatTile label="المدخول (المسلّمة)" value={fmtDA(t.revenue)} icon={<Banknote className="size-4 text-ok" />} />
        <StatTile label="ينتظر التحصيل" value={fmtDA(t.pending)} hint="الطرود التي في الطريق" icon={<Hourglass className="size-4" />} />
        <StatTile label="الربح قبل الإعلانات" value={fmtDA(Math.round(t.profit))} hint={`مبيعات ضاعت بالإرجاع: ${fmtDA(t.lostSales)}`} icon={<TrendingUp className={cn('size-4', t.profit < 0 ? 'text-danger' : 'text-ok')} />} />
        <StatTile label="متوسط مدة التوصيل" value={t.avgDeliveryDays !== null ? `${t.avgDeliveryDays} يوم` : '—'} hint="من إنشاء الطرد إلى التسليم" icon={<Clock className="size-4" />} />
      </div>

      <Card>
        <CardHeader title="كيف يُحسب الربح" />
        <div className="space-y-1 p-4 text-sm">
          <p className="ltr text-right">
            {fmtDA(t.revenue)} − المنتج {fmtDA(t.productCost)} − التوصيل على حسابك {fmtDA(t.sellerDelivery)} − رجوع الطرود {fmtDA(t.returnCosts)} − التأكيد {fmtDA(t.confirmCosts)} = <b>{fmtDA(Math.round(t.profit))}</b>
          </p>
          <p className="text-xs text-muted">
            ثمن الرجوع والتأكيد من «حاسبة الربح» (القيم المحفوظة للجميع)، وتكلفة المنتج من سعر تكلفته في الكتالوج. الإعلانات غير محسوبة هنا — اطرح مصروفك من هذا الربح، أو استعمل حاسبة الربح.
          </p>
          {data.withoutCost.length > 0 && (
            <p className="text-xs text-warn">
              {fmtNumber(t.unknownCost)} طرد مسلّم بدون تكلفة معروفة (لم تُطرح تكلفته): {data.withoutCost.slice(0, 6).join('، ')}{data.withoutCost.length > 6 ? '…' : ''}. أضف سعر التكلفة للمنتج في الكتالوج، واكتب اسم العرض عند شركة التوصيل كما هو في المنصة.
            </p>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          title={period === 'month' ? 'شهرياً' : 'أسبوعياً'}
          action={
            <div className="flex rounded-lg border border-line bg-surface p-0.5">
              {([['month', 'شهري'], ['week', 'أسبوعي']] as const).map(([k, l]) => (
                <button key={k} onClick={() => setPeriod(k)} className={cn('rounded-md px-3 py-1 text-xs font-medium', period === k ? 'bg-fg text-bg' : 'text-muted hover:text-fg')}>{l}</button>
              ))}
            </div>
          }
        />
        {period === 'month' ? (
          <GroupTable rows={data.byMonth} rowKey={(r) => r.key} label={(r) => monthLabel(r.key)} />
        ) : (
          <GroupTable rows={data.byWeek} rowKey={(r) => r.key} label={(r) => <span className="ltr">{weekLabel(r.key)}</span>} />
        )}
        <p className="px-4 py-2 text-xs text-muted">حسب تاريخ إنشاء الطرد. نسبة التوصيل = المسلّمة من الطرود التي انتهت (سُلّمت أو رجعت).</p>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader title="حسب العرض" />
        <GroupTable rows={data.byOffer} rowKey={(r) => r.key} label={(r) => r.key} />
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="حالات شركة التوصيل" />
          <div className="p-4">
            <BarList items={data.statuses.map((s) => ({ key: s.label, label: <>{s.label} <span className="text-xs text-muted">({STAGE[s.stage].label})</span></>, value: s.count, color: STAGE[s.stage].color }))} />
          </div>
        </Card>
        <Card>
          <CardHeader title="المال عند شركة التوصيل (الطرود المسلّمة)" />
          <div className="p-4">
            {data.payments.length ? (
              <BarList color="var(--ok)" items={data.payments.map((p) => ({ key: p.status, label: PAYMENT[p.status] ?? p.status, value: p.count, extra: <span className="ms-1.5 text-xs font-normal text-muted">({fmtDA(p.amount)})</span> }))} />
            ) : (
              <p className="py-6 text-center text-sm text-faint">لا توجد معلومات دفع</p>
            )}
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader title="حسب الولاية" />
        <GroupTable rows={data.byWilaya} rowKey={(r) => r.key ?? 'none'} label={(r) => (r.key ? wilayaLabel(r.key) : 'غير محددة')} money={false} />
      </Card>
    </div>
  );
}
