import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, BarChart3, CheckCircle2, Plus, RotateCcw, Save, Trash2, TrendingDown } from 'lucide-react';
import { toast } from 'sonner';
import {
  computeProfit,
  DEFAULT_PROFIT_INPUT,
  profitAt,
  type CostItem,
  type ProfitInput,
  type Settings,
  type ShippingStatsDTO,
  type StatsDTO,
} from '@touraya/shared';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { fmtDA, fmtNumber, todayDZ } from '@/lib/format';
import { errorMessage, qk, useOffers, useProducts, useSettings } from '@/lib/queries';
import { Alert, Button, Card, CardHeader, Field, Input, PageHeader, Select } from '@/components/ui';

const STORAGE_KEY = 'touraya-calculator-v1';

const usd = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toFixed(2)} $`);
const da = (n: number | null | undefined) => (n === null || n === undefined ? '—' : fmtDA(Math.round(n)));
const pct = (n: number) => `${n.toFixed(1)}%`;
/** Prices shown rounded up to the next 50 DA. */
const roundPrice = (n: number | null) => (n === null ? null : Math.ceil(n / 50) * 50);

function load(): ProfitInput | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_PROFIT_INPUT, ...(JSON.parse(raw) as Partial<ProfitInput>) } : null;
  } catch {
    return null;
  }
}

function save(input: ProfitInput) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(input));
  } catch {
    /* private window: the page still works, it just forgets */
  }
}

const withShared = (input: ProfitInput, s?: Settings['calculator']): ProfitInput => (s ? { ...input, ...s } : input);

/** Number box with its unit; empty counts as 0. */
function Num({ label, value, onChange, unit, hint, step = 'any', className }: { label: string; value: number; onChange: (n: number) => void; unit?: string; hint?: ReactNode; step?: string; className?: string }) {
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

function CostList({ items, onChange, addLabel }: { items: CostItem[]; onChange: (items: CostItem[]) => void; addLabel: string }) {
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

function Line({ label, value, strong, tone }: { label: ReactNode; value: ReactNode; strong?: boolean; tone?: 'ok' | 'danger' | 'warn' }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 py-1.5 text-sm', strong && 'font-semibold')}>
      <span className="text-muted">{label}</span>
      <span className={cn('ltr text-right', tone === 'ok' && 'text-ok', tone === 'danger' && 'text-danger', tone === 'warn' && 'text-warn')}>{value}</span>
    </div>
  );
}

/**
 * Profit calculator: what a piece costs, what an order brings once everything
 * is paid, the highest ad cost before losing money, the right price. Open to
 * every user; inputs stay in this browser, the shared rates come from settings.
 */
export function CalculatorPage() {
  const can = useCan();
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const { data: offers } = useOffers();
  const { data: products } = useProducts();
  const [input, setInput] = useState<ProfitInput>(() => load() ?? DEFAULT_PROFIT_INPUT);
  const [offerId, setOfferId] = useState<number | ''>('');
  const [loadingRates, setLoadingRates] = useState(false);

  // First visit: the shared values (dollar, fees) set by the admin.
  useEffect(() => {
    if (settings && !load()) setInput((i) => withShared(i, settings.calculator));
  }, [settings]);
  useEffect(() => save(input), [input]);

  const set = <K extends keyof ProfitInput>(key: K, value: ProfitInput[K]) => setInput((i) => ({ ...i, [key]: value }));
  const r = useMemo(() => computeProfit(input), [input]);

  const pickOffer = (id: number | '') => {
    setOfferId(id);
    const offer = offers?.find((o) => o.id === id);
    if (!offer) return;
    const product = products?.find((p) => p.id === offer.productId);
    setInput((i) => ({
      ...i,
      price: offer.price,
      piecesPerOrder: offer.units,
      // The product's cost price, when known and nothing typed yet.
      ...(product?.costPrice && i.fabricCost === 0 && i.pieceCosts.every((c) => !c.amount) ? { pieceCosts: [{ label: `تكلفة القطعة (${product.name})`, amount: product.costPrice }] } : {}),
    }));
  };

  /** The platform's own last-30-days rates for this offer (confirmation, delivery, leads). */
  const realRates = async () => {
    setLoadingRates(true);
    try {
      const q = { from: todayDZ(-29), ...(offerId ? { offerId } : {}) };
      const [crm, ship] = await Promise.all([api.get<StatsDTO>('/stats', q as never), api.get<ShippingStatsDTO>('/stats/shipping', { from: q.from } as never)]);
      const offerShip = offerId ? ship.byOffer.find((o) => o.offerId === offerId) : null;
      const finished = offerShip ? offerShip.delivered + offerShip.returned : ship.totals.delivered + ship.totals.returned;
      setInput((i) => ({
        ...i,
        leads: crm.totals.all || i.leads,
        confirmationRate: crm.totals.confirmed + crm.totals.cancelled ? Math.round(crm.totals.confirmationRate) : i.confirmationRate,
        deliveryRate: finished ? Math.round(offerShip ? offerShip.rate : ship.totals.deliveryRate) : i.deliveryRate,
      }));
      toast.success(`نسب آخر 30 يوم: ${crm.totals.all} طلبية، تأكيد ${Math.round(crm.totals.confirmationRate)}%${finished ? `، توصيل ${Math.round(offerShip ? offerShip.rate : ship.totals.deliveryRate)}%` : ' (لا توجد طرود منتهية بعد)'}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoadingRates(false);
    }
  };

  const saveShared = useMutation({
    mutationFn: () => {
      const { usdRate, confirmFee, confirmFeeOn, sellerDeliveryFee, returnFee, packagingPerOrder, codFeePct, returnDamagePct, targetMarginPct } = input;
      return api.put<Settings>('/settings', { ...settings!, calculator: { usdRate, confirmFee, confirmFeeOn, sellerDeliveryFee, returnFee, packagingPerOrder, codFeePct, returnDamagePct, targetMarginPct } });
    },
    onSuccess: () => {
      toast.success('تم الحفظ — كل الموظفين يرون هذه القيم');
      qc.invalidateQueries({ queryKey: qk.settings });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  // "When do the ads make me lose money": cost per lead × delivery rate.
  const grid = useMemo(() => {
    const max = r.breakeven?.maxCplUsd ?? 2;
    const step = Math.max(0.05, Math.round((max / 4) * 20) / 20);
    const cpls = Array.from({ length: 7 }, (_, i) => Math.round(step * (i + 1) * 100) / 100);
    const rates = [50, 60, 70, 80, 90];
    return { cpls, rates, cell: (cpl: number, rate: number) => profitAt(input, cpl, rate) };
  }, [input, r.breakeven?.maxCplUsd]);

  const verdict = {
    good: { tone: 'ok' as const, icon: <CheckCircle2 className="mt-0.5 size-5 shrink-0" />, text: 'مربح' },
    thin: { tone: 'warn' as const, icon: <AlertTriangle className="mt-0.5 size-5 shrink-0" />, text: `مربح لكن الهامش أقل من ${input.targetMarginPct}%` },
    loss: { tone: 'danger' as const, icon: <TrendingDown className="mt-0.5 size-5 shrink-0" />, text: 'خسارة' },
  }[r.verdict];
  const cplTone = r.cplUsd === null || !r.breakeven?.maxCplUsd ? undefined : r.cplUsd > r.breakeven.maxCplUsd ? 'danger' : r.breakeven.targetCplUsd !== null && r.cplUsd > r.breakeven.targetCplUsd ? 'warn' : 'ok';

  return (
    <div className="space-y-5">
      <PageHeader
        title="حاسبة الربح"
        subtitle="تكلفة القطعة، الربح الحقيقي بعد التأكيد والتوصيل والإرجاع والإعلانات، وسقف تكلفة الإعلان قبل الخسارة"
        actions={
          <>
            <Select className="h-9 w-auto text-sm" value={offerId} onChange={(e) => pickOffer(e.target.value ? Number(e.target.value) : '')} aria-label="العرض">
              <option value="">اختر عرضاً (اختياري)</option>
              {offers?.filter((o) => o.active).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
            {can('stats.view') && (
              <Button size="sm" icon={<BarChart3 className="size-3.5" />} loading={loadingRates} onClick={realRates}>
                نسب المنصة الحقيقية
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => confirm('مسح كل الأرقام والبدء من جديد؟') && setInput(withShared(DEFAULT_PROFIT_INPUT, settings?.calculator))}>
              من جديد
            </Button>
          </>
        }
      />

      {/* Phone: the answer stays in sight while typing the numbers. */}
      <div
        className={cn(
          'sticky top-0 z-10 grid grid-cols-3 gap-2 rounded-xl border-2 bg-surface px-3 py-2 text-center text-xs shadow-md lg:hidden',
          r.verdict === 'loss' ? 'border-danger' : r.verdict === 'thin' ? 'border-warn' : 'border-ok',
        )}
      >
        <div><p className="text-muted">ربح الطلبية المسلّمة</p><p className="ltr font-bold">{da(r.perDelivered?.profit)}</p></div>
        <div><p className="text-muted">CPL الآن</p><p className="ltr font-bold">{usd(r.cplUsd)}</p></div>
        <div><p className="text-muted">سقف الخسارة</p><p className="ltr font-bold text-danger">{usd(r.breakeven?.maxCplUsd)}</p></div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        {/* Inputs */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="1. الإنتاج (دفعة واحدة)" />
            <div className="space-y-4 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Num label="سعر القماش (كل الدفعة)" unit="دج" value={input.fabricCost} onChange={(v) => set('fabricCost', v)} />
                <Num label="عدد القطع المنتجة" unit="قطعة" step="1" value={input.pieces} onChange={(v) => set('pieces', Math.round(v))} />
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-muted">تكاليف أخرى على الدفعة كلها (التفصيل، النقل…)</p>
                <CostList items={input.batchCosts} onChange={(v) => set('batchCosts', v)} addLabel="إضافة تكلفة للدفعة" />
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-muted">تكاليف على كل قطعة (الخياطة، السحاب، الملصق، الكيس…)</p>
                <CostList items={input.pieceCosts} onChange={(v) => set('pieceCosts', v)} addLabel="إضافة تكلفة للقطعة" />
              </div>
              <div className="rounded-lg bg-subtle px-3 py-2">
                <Line label="تكلفة القطعة الواحدة" value={da(r.costPerPiece)} strong />
                <Line label="رأس مال الدفعة كلها" value={da(r.batchTotal)} />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="2. العرض" />
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <Num label="سعر البيع (بدون التوصيل)" unit="دج" value={input.price} onChange={(v) => set('price', v)} />
              <Num label="عدد القطع في الطلبية" unit="قطعة" step="1" value={input.piecesPerOrder} onChange={(v) => set('piecesPerOrder', Math.max(1, Math.round(v)))} />
              <p className="text-xs text-muted sm:col-span-2">تكلفة منتج الطلبية: <b className="ltr">{da(r.productCostPerOrder)}</b></p>
            </div>
          </Card>

          <Card>
            <CardHeader title="3. الإعلانات" />
            <div className="grid gap-3 p-4 sm:grid-cols-3">
              <Num label="المصروف على الإعلانات" unit="$" value={input.adSpendUsd} onChange={(v) => set('adSpendUsd', v)} />
              <Num label="سعر الدولار" unit="دج" value={input.usdRate} onChange={(v) => set('usdRate', v)} hint="حسب سعر اليوم" />
              <Num label="الطلبيات التي جاءت" unit="طلبية" step="1" value={input.leads} onChange={(v) => set('leads', Math.round(v))} />
              <p className="text-xs text-muted sm:col-span-3">
                تكلفة الطلبية الواحدة (CPL): <b className="ltr">{usd(r.cplUsd)}</b> = <b className="ltr">{da(r.cplUsd !== null ? r.cplUsd * input.usdRate : null)}</b>
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="4. النسب" />
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <Num label="نسبة التأكيد (من كل الطلبيات)" unit="%" value={input.confirmationRate} onChange={(v) => set('confirmationRate', Math.min(100, v))} />
              <Num label="نسبة التوصيل (من المؤكدة المرسلة)" unit="%" value={input.deliveryRate} onChange={(v) => set('deliveryRate', Math.min(100, v))} />
            </div>
          </Card>

          <Card>
            <CardHeader title="5. تكاليف كل طلبية" />
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <Num label="ثمن تأكيد الطلبية (للعامل)" unit="دج" value={input.confirmFee} onChange={(v) => set('confirmFee', v)} />
              <Field label="يُدفع على كل طلبية">
                {(id) => (
                  <Select id={id} value={input.confirmFeeOn} onChange={(e) => set('confirmFeeOn', e.target.value as ProfitInput['confirmFeeOn'])}>
                    <option value="confirmed">مؤكدة</option>
                    <option value="delivered">مسلّمة فقط</option>
                  </Select>
                )}
              </Field>
              <Num label="التوصيل على حسابك (للطرد المسلّم)" unit="دج" value={input.sellerDeliveryFee} onChange={(v) => set('sellerDeliveryFee', v)} hint="0 إذا كان الزبون يدفع التوصيل" />
              <Num label="ثمن رجوع الطرد" unit="دج" value={input.returnFee} onChange={(v) => set('returnFee', v)} hint="ما تخصمه شركة التوصيل على المرتجع" />
              <Num label="التغليف لكل طرد" unit="دج" value={input.packagingPerOrder} onChange={(v) => set('packagingPerOrder', v)} />
              <Num label="عمولة التحصيل" unit="%" value={input.codFeePct} onChange={(v) => set('codFeePct', Math.min(100, v))} hint="نسبة من المبلغ المحصّل، إن وجدت" />
              <Num label="مرتجعات تالفة أو ضائعة" unit="%" value={input.returnDamagePct} onChange={(v) => set('returnDamagePct', Math.min(100, v))} />
              <Num label="الهامش المطلوب" unit="%" value={input.targetMarginPct} onChange={(v) => set('targetMarginPct', Math.min(90, v))} hint="من المبيعات — للسعر المقترح وتنبيه الإعلان الغالي" />
              {can('settings.manage') && (
                <div className="sm:col-span-2">
                  <Button size="sm" variant="secondary" icon={<Save className="size-3.5" />} loading={saveShared.isPending} disabled={!settings} onClick={() => saveShared.mutate()}>
                    حفظ سعر الدولار والتكاليف كقيم افتراضية للجميع
                  </Button>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Results */}
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Alert tone={verdict.tone} icon={verdict.icon}>
            <p className="font-semibold">{verdict.text}: <span className="ltr">{da(r.profit)}</span> على {fmtNumber(input.leads)} طلبية ({pct(r.margin)} من المبيعات)</p>
            {r.perDelivered && <p className="mt-1 text-sm">الربح الصافي لكل طلبية مسلّمة: <b className="ltr">{da(r.perDelivered.profit)}</b></p>}
          </Alert>

          <Card>
            <CardHeader title="متى يصبح الإعلان غالياً؟" />
            <div className="space-y-1 p-4">
              {r.breakeven ? (
                <>
                  <Line label="تكلفة الطلبية الآن (CPL)" value={usd(r.cplUsd)} strong tone={cplTone} />
                  <Line label={`سقف يحافظ على هامش ${input.targetMarginPct}%`} value={usd(r.breakeven.targetCplUsd)} tone="warn" />
                  <Line label="سقف الخسارة (فوقه تخسر)" value={usd(r.breakeven.maxCplUsd)} tone="danger" strong />
                  <Line label="أقصى مصروف إعلانات لهذا العدد" value={usd(r.breakeven.maxAdSpendUsd)} />
                  <Line label="ROAS الآن / ROAS التعادل" value={`${r.roas?.toFixed(2) ?? '—'} / ${r.breakeven.roas?.toFixed(2) ?? '—'}`} />
                </>
              ) : (
                <p className="text-sm text-danger">حتى بدون إعلانات هذا العرض يخسر: ارفع السعر أو خفّض التكاليف.</p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="السعر" />
            <div className="p-4">
              <Line label="سعر التعادل (ربح 0)" value={da(roundPrice(r.breakevenPrice))} />
              <Line label={`السعر المقترح (هامش ${input.targetMarginPct}%)`} value={da(roundPrice(r.recommendedPrice))} strong tone="ok" />
              <Line label="سعرك الحالي" value={da(input.price)} />
            </div>
          </Card>

          <Card>
            <CardHeader title="أين يذهب المال" />
            <div className="p-4">
              <Line label={`${fmtNumber(Math.round(r.confirmed))} مؤكدة → ${fmtNumber(Math.round(r.delivered))} مسلّمة · ${fmtNumber(Math.round(r.returned))} مرتجعة`} value="" />
              <Line label="المبيعات (المسلّمة)" value={da(r.revenue)} strong />
              <Line label="المنتج (القطع المسلّمة)" value={`− ${da(r.costs.product)}`} />
              <Line label="الإعلانات" value={`− ${da(r.costs.ads)}`} />
              <Line label="التأكيد" value={`− ${da(r.costs.confirmation)}`} />
              <Line label="التوصيل" value={`− ${da(r.costs.delivery)}`} />
              <Line label="رجوع الطرود" value={`− ${da(r.costs.returns)}`} />
              <Line label="التغليف" value={`− ${da(r.costs.packaging)}`} />
              {r.costs.cod > 0 && <Line label="عمولة التحصيل" value={`− ${da(r.costs.cod)}`} />}
              {r.costs.returnLoss > 0 && <Line label="مرتجعات تالفة" value={`− ${da(r.costs.returnLoss)}`} />}
              <div className="mt-1 border-t border-line pt-1">
                <Line label="الربح الصافي" value={da(r.profit)} strong tone={r.profit < 0 ? 'danger' : 'ok'} />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="الدفعة كلها" />
            <div className="p-4">
              <Line label="طلبيات تكفيها الدفعة" value={fmtNumber(r.batch.orders)} />
              <Line label="طلبيات مسلّمة لاسترجاع رأس المال" value={r.batch.ordersToRecover !== null ? fmtNumber(r.batch.ordersToRecover) : '—'} strong />
              <Line label="طلبيات من الإعلان لبيع الدفعة كلها" value={r.batch.leadsNeeded !== null ? fmtNumber(r.batch.leadsNeeded) : '—'} />
              <Line label="ربح الدفعة كلها بهذه النسب" value={da(r.batch.profit)} tone={r.batch.profit !== null && r.batch.profit < 0 ? 'danger' : 'ok'} />
            </div>
          </Card>
        </div>
      </div>

      <Card className="overflow-hidden">
        <CardHeader title="الربح لكل طلبية مسلّمة: حسب تكلفة الطلبية (CPL) ونسبة التوصيل" />
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
                    const c = grid.cell(cpl, d);
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
    </div>
  );
}
