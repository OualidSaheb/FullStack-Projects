import { useMemo, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Plus, Trash2, TrendingDown } from 'lucide-react';
import { profitAt, type CostItem, type ProfitInput, type ProfitResult, type Settings } from '@touraya/shared';
import { cn } from '@/lib/cn';
import { fmtDA, fmtNumber } from '@/lib/format';
import { Alert, Button, Card, CardHeader, Field, Input, Select } from '@/components/ui';

export const usd = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toFixed(2)} $`);
export const da = (n: number | null | undefined) => (n === null || n === undefined ? '—' : fmtDA(Math.round(n)));
export const pct = (n: number) => `${n.toFixed(1)}%`;
/** Prices shown rounded up to the next 50 DA. */
export const roundPrice = (n: number | null) => (n === null ? null : Math.ceil(n / 50) * 50);

/** Values every calculator takes from the shared settings (dollar rate, fees). */
export type SharedValues = Settings['calculator'];
export const SHARED_KEYS = ['usdRate', 'confirmFee', 'confirmFeeOn', 'sellerDeliveryFee', 'returnFee', 'packagingPerOrder', 'codFeePct', 'returnDamagePct', 'targetMarginPct'] as const;
export const pickShared = (v: SharedValues & Record<string, unknown>): SharedValues => Object.fromEntries(SHARED_KEYS.map((k) => [k, v[k]])) as SharedValues;

export function loadStored<T>(key: string, fallback: T): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<T>) } : null;
  } catch {
    return null;
  }
}

export function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private window: the page still works, it just forgets */
  }
}

/** Number box with its unit; empty counts as 0. */
export function Num({ label, value, onChange, unit, hint, step = 'any', className }: { label: string; value: number; onChange: (n: number) => void; unit?: string; hint?: ReactNode; step?: string; className?: string }) {
  return (
    <Field label={label} hint={hint} className={className}>
      {(id) => (
        <div className="relative">
          <Input
            id={id}
            type="number"
            inputMode="decimal"
            min={0}
            step={step}
            dir="ltr"
            className={cn('text-right', unit && 'pe-12')}
            value={Number.isFinite(value) && value !== 0 ? value : ''}
            placeholder="0"
            onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
          />
          {unit && <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-muted">{unit}</span>}
        </div>
      )}
    </Field>
  );
}

export function CostList({ items, onChange, addLabel }: { items: CostItem[]; onChange: (items: CostItem[]) => void; addLabel: string }) {
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input className="min-w-0 flex-1" value={item.label} placeholder="البند" onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} aria-label="البند" />
          <div className="relative w-32 shrink-0">
            <Input type="number" inputMode="decimal" min={0} dir="ltr" className="pe-9 text-right" value={item.amount || ''} placeholder="0" onChange={(e) => onChange(items.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) || 0 } : x)))} aria-label="المبلغ" />
            <span className="pointer-events-none absolute inset-y-0 end-2 flex items-center text-xs text-muted">دج</span>
          </div>
          <button className="rounded-md p-1.5 text-muted hover:bg-subtle hover:text-danger" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label="حذف">
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}
      <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => onChange([...items, { label: '', amount: 0 }])}>
        {addLabel}
      </Button>
    </div>
  );
}

export function Line({ label, value, strong, tone }: { label: ReactNode; value: ReactNode; strong?: boolean; tone?: 'ok' | 'danger' | 'warn' }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 py-1.5 text-sm', strong && 'font-semibold')}>
      <span className="text-muted">{label}</span>
      <span className={cn('ltr text-right', tone === 'ok' && 'text-ok', tone === 'danger' && 'text-danger', tone === 'warn' && 'text-warn')}>{value}</span>
    </div>
  );
}

/** Rates and per-order fees, the same in both calculators. */
export function FunnelAndFees<T extends SharedValues & { confirmationRate: number; deliveryRate: number }>({ value, set, footer }: { value: T; set: <K extends keyof T>(k: K, v: T[K]) => void; footer?: ReactNode }) {
  return (
    <>
      <Card>
        <CardHeader title="النسب" />
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <Num label="نسبة التأكيد (من كل الطلبيات)" unit="%" value={value.confirmationRate} onChange={(v) => set('confirmationRate', Math.min(100, v) as T['confirmationRate'])} />
          <Num label="نسبة التوصيل (من المؤكدة المرسلة)" unit="%" value={value.deliveryRate} onChange={(v) => set('deliveryRate', Math.min(100, v) as T['deliveryRate'])} />
        </div>
      </Card>
      <Card>
        <CardHeader title="تكاليف كل طلبية" />
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <Num label="ثمن تأكيد الطلبية (للعامل)" unit="دج" value={value.confirmFee} onChange={(v) => set('confirmFee', v as T['confirmFee'])} />
          <Field label="يُدفع على كل طلبية">
            {(id) => (
              <Select id={id} value={value.confirmFeeOn} onChange={(e) => set('confirmFeeOn', e.target.value as T['confirmFeeOn'])}>
                <option value="confirmed">مؤكدة</option>
                <option value="delivered">مسلّمة فقط</option>
              </Select>
            )}
          </Field>
          <Num label="التوصيل على حسابك (للطرد المسلّم)" unit="دج" value={value.sellerDeliveryFee} onChange={(v) => set('sellerDeliveryFee', v as T['sellerDeliveryFee'])} hint="0 إذا كان الزبون يدفع التوصيل" />
          <Num label="ثمن رجوع الطرد" unit="دج" value={value.returnFee} onChange={(v) => set('returnFee', v as T['returnFee'])} hint="ما تخصمه شركة التوصيل على المرتجع" />
          <Num label="التغليف لكل طرد" unit="دج" value={value.packagingPerOrder} onChange={(v) => set('packagingPerOrder', v as T['packagingPerOrder'])} />
          <Num label="عمولة التحصيل" unit="%" value={value.codFeePct} onChange={(v) => set('codFeePct', Math.min(100, v) as T['codFeePct'])} hint="نسبة من المبلغ المحصّل، إن وجدت" />
          <Num label="مرتجعات تالفة أو ضائعة" unit="%" value={value.returnDamagePct} onChange={(v) => set('returnDamagePct', Math.min(100, v) as T['returnDamagePct'])} />
          <Num label="الهامش المطلوب" unit="%" value={value.targetMarginPct} onChange={(v) => set('targetMarginPct', Math.min(90, v) as T['targetMarginPct'])} hint="من المبيعات — للسعر المقترح وتنبيه الإعلان الغالي" />
          {footer && <div className="sm:col-span-2">{footer}</div>}
        </div>
      </Card>
    </>
  );
}

const VERDICT = {
  good: { tone: 'ok' as const, icon: <CheckCircle2 className="mt-0.5 size-5 shrink-0" />, text: 'مربح' },
  thin: { tone: 'warn' as const, icon: <AlertTriangle className="mt-0.5 size-5 shrink-0" />, text: 'مربح لكن الهامش ضعيف' },
  loss: { tone: 'danger' as const, icon: <TrendingDown className="mt-0.5 size-5 shrink-0" />, text: 'خسارة' },
};

export function VerdictAlert({ r, children }: { r: ProfitResult; children: ReactNode }) {
  const v = VERDICT[r.verdict];
  return (
    <Alert tone={v.tone} icon={v.icon}>
      <p className="font-semibold">{v.text}</p>
      {children}
    </Alert>
  );
}

/** Phone: the answer stays in sight while typing the numbers. */
export function StickySummary({ r, label }: { r: ProfitResult; label: string }) {
  return (
    <div className={cn('sticky top-0 z-10 grid grid-cols-3 gap-2 rounded-xl border-2 bg-surface px-3 py-2 text-center text-xs shadow-md lg:hidden', r.verdict === 'loss' ? 'border-danger' : r.verdict === 'thin' ? 'border-warn' : 'border-ok')}>
      <div><p className="text-muted">{label}</p><p className="ltr font-bold">{da(r.perDelivered?.profit)}</p></div>
      <div><p className="text-muted">CPL الآن</p><p className="ltr font-bold">{usd(r.cplUsd)}</p></div>
      <div><p className="text-muted">سقف الخسارة</p><p className="ltr font-bold text-danger">{usd(r.breakeven?.maxCplUsd)}</p></div>
    </div>
  );
}

export function AdCeilingCard({ r, targetMarginPct, spendLine = true }: { r: ProfitResult; targetMarginPct: number; spendLine?: boolean }) {
  const tone = r.cplUsd === null || !r.breakeven?.maxCplUsd ? undefined : r.cplUsd > r.breakeven.maxCplUsd ? 'danger' : r.breakeven.targetCplUsd !== null && r.cplUsd > r.breakeven.targetCplUsd ? 'warn' : 'ok';
  return (
    <Card>
      <CardHeader title="متى يصبح الإعلان غالياً؟" />
      <div className="space-y-1 p-4">
        {r.breakeven ? (
          <>
            <Line label="تكلفة الطلبية الآن (CPL)" value={usd(r.cplUsd)} strong tone={tone} />
            <Line label={`سقف يحافظ على هامش ${targetMarginPct}%`} value={usd(r.breakeven.targetCplUsd)} tone="warn" />
            <Line label="سقف الخسارة (فوقه تخسر)" value={usd(r.breakeven.maxCplUsd)} tone="danger" strong />
            {spendLine && <Line label="أقصى مصروف إعلانات لهذا العدد" value={usd(r.breakeven.maxAdSpendUsd)} />}
            <Line label="ROAS الآن / ROAS التعادل" value={`${r.roas?.toFixed(2) ?? '—'} / ${r.breakeven.roas?.toFixed(2) ?? '—'}`} />
          </>
        ) : (
          <p className="text-sm text-danger">حتى بدون إعلانات هذا البيع يخسر: ارفع السعر أو خفّض التكاليف.</p>
        )}
      </div>
    </Card>
  );
}

export function PriceCard({ r, price, targetMarginPct }: { r: ProfitResult; price: number; targetMarginPct: number }) {
  return (
    <Card>
      <CardHeader title="السعر" />
      <div className="p-4">
        <Line label="سعر التعادل (ربح 0)" value={da(roundPrice(r.breakevenPrice))} />
        <Line label={`السعر المقترح (هامش ${targetMarginPct}%)`} value={da(roundPrice(r.recommendedPrice))} strong tone="ok" />
        <Line label="سعرك الحالي" value={da(price)} />
      </div>
    </Card>
  );
}

/** Where the money goes: for all the orders, or for one delivered piece (`perUnit`). */
export function MoneyCard({ r, perUnit }: { r: ProfitResult; perUnit?: boolean }) {
  const k = perUnit ? (r.delivered > 0 ? 1 / r.delivered : 0) : 1;
  const m = (n: number) => `− ${da(n * k)}`;
  return (
    <Card>
      <CardHeader title={perUnit ? 'أين يذهب سعر القطعة المسلّمة' : 'أين يذهب المال'} />
      <div className="p-4">
        {!perUnit && <Line label={`${fmtNumber(Math.round(r.confirmed))} مؤكدة → ${fmtNumber(Math.round(r.delivered))} مسلّمة · ${fmtNumber(Math.round(r.returned))} مرتجعة`} value="" />}
        <Line label={perUnit ? 'سعر البيع' : 'المبيعات (المسلّمة)'} value={da(r.revenue * k)} strong />
        <Line label={perUnit ? 'تكلفة القطعة' : 'المنتج (القطع المسلّمة)'} value={m(r.costs.product)} />
        <Line label={perUnit ? 'الإعلان (حصة القطعة المسلّمة)' : 'الإعلانات'} value={m(r.costs.ads)} />
        <Line label="التأكيد" value={m(r.costs.confirmation)} />
        <Line label="التوصيل" value={m(r.costs.delivery)} />
        <Line label={perUnit ? 'رجوع الطرود (حصتها)' : 'رجوع الطرود'} value={m(r.costs.returns)} />
        <Line label="التغليف" value={m(r.costs.packaging)} />
        {r.costs.cod > 0 && <Line label="عمولة التحصيل" value={m(r.costs.cod)} />}
        {r.costs.returnLoss > 0 && <Line label="مرتجعات تالفة" value={m(r.costs.returnLoss)} />}
        <div className="mt-1 border-t border-line pt-1">
          <Line label="الربح الصافي" value={da(r.profit * k)} strong tone={r.profit < 0 ? 'danger' : 'ok'} />
        </div>
      </div>
    </Card>
  );
}

/** "When do the ads make me lose money": cost per lead × delivery rate, profit per delivered order. */
export function ProfitGrid({ input, maxCplUsd, title }: { input: ProfitInput; maxCplUsd: number | null | undefined; title: string }) {
  const grid = useMemo(() => {
    const max = maxCplUsd ?? 2;
    const step = Math.max(0.05, Math.round((max / 4) * 20) / 20);
    return { cpls: Array.from({ length: 7 }, (_, i) => Math.round(step * (i + 1) * 100) / 100), rates: [50, 60, 70, 80, 90] };
  }, [maxCplUsd]);
  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} />
      <div className="overflow-x-auto scroll-thin">
        <table className="w-full text-sm" dir="ltr">
          <thead className="bg-subtle text-xs text-muted">
            <tr>
              <th className="px-3 py-2 text-left">CPL ↓ · التوصيل →</th>
              {grid.rates.map((d) => <th key={d} className="px-3 py-2 text-right">{d}%</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {grid.cpls.map((cpl) => (
              <tr key={cpl}>
                <td className="px-3 py-2 font-semibold">{usd(cpl)}</td>
                {grid.rates.map((d) => {
                  const c = profitAt(input, cpl, d);
                  const v = c.perDelivered?.profit ?? null;
                  return (
                    <td key={d} className={cn('px-3 py-2 text-right', c.verdict === 'loss' ? 'bg-danger/10 text-danger' : c.verdict === 'thin' ? 'bg-warn/10 text-warn' : 'bg-ok/10 text-ok')}>
                      {v === null ? '—' : fmtNumber(Math.round(v))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2 text-xs text-muted">أخضر: مربح بالهامش المطلوب · برتقالي: مربح بهامش ضعيف · أحمر: خسارة. الأرقام بالدينار لكل طلبية مسلّمة، بنفس نسبة التأكيد وباقي التكاليف.</p>
    </Card>
  );
}
