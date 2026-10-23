import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BarChart3, RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { computeProfit, DEFAULT_PROFIT_INPUT, type CostItem, type ProfitInput, type Settings, type ShippingStatsDTO, type StatsDTO } from '@touraya/shared';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { fmtNumber, todayDZ } from '@/lib/format';
import { errorMessage, qk, useOffers, useProducts, useSettings } from '@/lib/queries';
import { Button, Card, CardHeader, PageHeader, Select } from '@/components/ui';
import {
  AdCeilingCard,
  CostList,
  da,
  FunnelAndFees,
  Line,
  loadStored,
  MoneyCard,
  Num,
  pct,
  pickShared,
  PriceCard,
  ProfitGrid,
  StickySummary,
  store,
  usd,
  VerdictAlert,
  type SharedValues,
} from './parts';

type Tab = 'offer' | 'unit';

/** Admins: today's dollar rate and fees become everyone's starting values. */
function SaveShared({ values }: { values: SharedValues }) {
  const can = useCan();
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const save = useMutation({
    mutationFn: () => api.put<Settings>('/settings', { ...settings!, calculator: pickShared(values as SharedValues & Record<string, unknown>) }),
    onSuccess: () => {
      toast.success('تم الحفظ — كل الموظفين يرون هذه القيم');
      qc.invalidateQueries({ queryKey: qk.settings });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!can('settings.manage')) return null;
  return (
    <Button size="sm" variant="secondary" icon={<Save className="size-3.5" />} loading={save.isPending} disabled={!settings} onClick={() => save.mutate()}>
      حفظ سعر الدولار والتكاليف كقيم افتراضية للجميع
    </Button>
  );
}

/** Inputs kept in the browser; the first time, the shared values from the settings. */
function useStoredInput<T extends object>(key: string, defaults: T) {
  const { data: settings } = useSettings();
  const [value, setValue] = useState<T>(() => loadStored(key, defaults) ?? defaults);
  useEffect(() => {
    if (settings && !loadStored(key, defaults)) setValue((v) => ({ ...v, ...settings.calculator }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);
  useEffect(() => store(key, value), [key, value]);
  const reset = () => setValue({ ...defaults, ...(settings?.calculator ?? {}) });
  return [value, setValue, reset] as const;
}

// ——— By offer: a production batch, an offer of N pieces, a campaign's spend and orders ———

function OfferCalculator() {
  const can = useCan();
  const { data: offers } = useOffers();
  const { data: products } = useProducts();
  const [input, setInput, reset] = useStoredInput<ProfitInput>('touraya-calculator-v1', DEFAULT_PROFIT_INPUT);
  const [offerId, setOfferId] = useState<number | ''>('');
  const [loadingRates, setLoadingRates] = useState(false);
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
      const delivery = Math.round(offerShip ? offerShip.rate : ship.totals.deliveryRate);
      setInput((i) => ({
        ...i,
        leads: crm.totals.all || i.leads,
        confirmationRate: crm.totals.confirmed + crm.totals.cancelled ? Math.round(crm.totals.confirmationRate) : i.confirmationRate,
        deliveryRate: finished ? delivery : i.deliveryRate,
      }));
      toast.success(`نسب آخر 30 يوم: ${crm.totals.all} طلبية، تأكيد ${Math.round(crm.totals.confirmationRate)}%${finished ? `، توصيل ${delivery}%` : ' (لا توجد طرود منتهية بعد)'}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoadingRates(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Select className="h-9 w-auto text-sm" value={offerId} onChange={(e) => pickOffer(e.target.value ? Number(e.target.value) : '')} aria-label="العرض">
          <option value="">اختر عرضاً (اختياري)</option>
          {offers?.filter((o) => o.active).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </Select>
        {can('stats.view') && (
          <Button size="sm" icon={<BarChart3 className="size-3.5" />} loading={loadingRates} onClick={realRates}>
            نسب المنصة الحقيقية
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => confirm('مسح كل الأرقام والبدء من جديد؟') && reset()}>
          من جديد
        </Button>
      </div>

      <StickySummary r={r} label="ربح الطلبية المسلّمة" />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="الإنتاج (دفعة واحدة)" />
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
            <CardHeader title="العرض" />
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <Num label="سعر البيع (بدون التوصيل)" unit="دج" value={input.price} onChange={(v) => set('price', v)} />
              <Num label="عدد القطع في الطلبية" unit="قطعة" step="1" value={input.piecesPerOrder} onChange={(v) => set('piecesPerOrder', Math.max(1, Math.round(v)))} />
              <p className="text-xs text-muted sm:col-span-2">تكلفة منتج الطلبية: <b className="ltr">{da(r.productCostPerOrder)}</b></p>
            </div>
          </Card>

          <Card>
            <CardHeader title="الإعلانات" />
            <div className="grid gap-3 p-4 sm:grid-cols-3">
              <Num label="المصروف على الإعلانات" unit="$" value={input.adSpendUsd} onChange={(v) => set('adSpendUsd', v)} />
              <Num label="سعر الدولار" unit="دج" value={input.usdRate} onChange={(v) => set('usdRate', v)} hint="حسب سعر اليوم" />
              <Num label="الطلبيات التي جاءت" unit="طلبية" step="1" value={input.leads} onChange={(v) => set('leads', Math.round(v))} />
              <p className="text-xs text-muted sm:col-span-3">
                تكلفة الطلبية الواحدة (CPL): <b className="ltr">{usd(r.cplUsd)}</b> = <b className="ltr">{da(r.cplUsd !== null ? r.cplUsd * input.usdRate : null)}</b>
              </p>
            </div>
          </Card>

          <FunnelAndFees value={input} set={set} footer={<SaveShared values={input} />} />
        </div>

        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <VerdictAlert r={r}>
            <p className="text-sm">
              <span className="ltr">{da(r.profit)}</span> على {fmtNumber(input.leads)} طلبية ({pct(r.margin)} من المبيعات)
            </p>
            {r.perDelivered && <p className="mt-1 text-sm">الربح الصافي لكل طلبية مسلّمة: <b className="ltr">{da(r.perDelivered.profit)}</b></p>}
          </VerdictAlert>
          <AdCeilingCard r={r} targetMarginPct={input.targetMarginPct} />
          <PriceCard r={r} price={input.price} targetMarginPct={input.targetMarginPct} />
          <MoneyCard r={r} />
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

      <ProfitGrid input={input} maxCplUsd={r.breakeven?.maxCplUsd} title="الربح لكل طلبية مسلّمة: حسب تكلفة الطلبية (CPL) ونسبة التوصيل" />
    </div>
  );
}

// ——— Per piece: one piece sold alone, whatever the offers ———

interface UnitInput extends SharedValues {
  metersPerPiece: number;
  pricePerMeter: number;
  pieceCosts: CostItem[];
  price: number;
  cplUsd: number;
  confirmationRate: number;
  deliveryRate: number;
}

const DEFAULT_UNIT: UnitInput = {
  ...pickShared(DEFAULT_PROFIT_INPUT as unknown as SharedValues & Record<string, unknown>),
  metersPerPiece: 0,
  pricePerMeter: 0,
  pieceCosts: [
    { label: 'الخياطة', amount: 0 },
    { label: 'الإكسسوارات (سحاب، أزرار، ملصق)', amount: 0 },
  ],
  price: 0,
  cplUsd: 0,
  confirmationRate: DEFAULT_PROFIT_INPUT.confirmationRate,
  deliveryRate: DEFAULT_PROFIT_INPUT.deliveryRate,
};

/** One piece = an order of one piece; 100 orders stand for the rates (results are per delivered piece). */
const unitToProfit = (u: UnitInput): ProfitInput => ({
  ...DEFAULT_PROFIT_INPUT,
  ...pickShared(u as UnitInput & Record<string, unknown>),
  fabricCost: 0,
  batchCosts: [],
  pieces: 0,
  pieceCosts: [{ label: 'القماش', amount: u.metersPerPiece * u.pricePerMeter }, ...u.pieceCosts],
  price: u.price,
  piecesPerOrder: 1,
  leads: 100,
  adSpendUsd: u.cplUsd * 100,
  confirmationRate: u.confirmationRate,
  deliveryRate: u.deliveryRate,
});

function UnitCalculator() {
  const { data: products } = useProducts();
  const [u, setU, reset] = useStoredInput<UnitInput>('touraya-calculator-unit-v1', DEFAULT_UNIT);
  const set = <K extends keyof UnitInput>(key: K, value: UnitInput[K]) => setU((v) => ({ ...v, [key]: value }));
  const input = useMemo(() => unitToProfit(u), [u]);
  const r = useMemo(() => computeProfit(input), [input]);
  const fabric = u.metersPerPiece * u.pricePerMeter;
  const leadsPerSale = u.confirmationRate && u.deliveryRate ? 1 / ((u.confirmationRate / 100) * (u.deliveryRate / 100)) : null;

  const pickProduct = (id: number) => {
    const product = products?.find((p) => p.id === id);
    if (product?.costPrice) setU((v) => ({ ...v, metersPerPiece: 0, pricePerMeter: 0, pieceCosts: [{ label: `تكلفة القطعة (${product.name})`, amount: product.costPrice }] }));
    else if (product) toast.info('لا توجد تكلفة لهذا المنتج في الكتالوج — أدخلها هنا');
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Select className="h-9 w-auto text-sm" value="" onChange={(e) => e.target.value && pickProduct(Number(e.target.value))} aria-label="المنتج">
          <option value="">تكلفة منتج من الكتالوج (اختياري)</option>
          {products?.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => confirm('مسح كل الأرقام والبدء من جديد؟') && reset()}>
          من جديد
        </Button>
      </div>

      <StickySummary r={r} label="ربح القطعة المسلّمة" />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="تكلفة القطعة الواحدة" />
            <div className="space-y-4 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Num label="سعر متر القماش" unit="دج" value={u.pricePerMeter} onChange={(v) => set('pricePerMeter', v)} />
                <Num label="المتر المستهلك للقطعة" unit="متر" value={u.metersPerPiece} onChange={(v) => set('metersPerPiece', v)} hint={fabric ? <>القماش للقطعة: <b className="ltr">{da(fabric)}</b></> : 'مثلاً 1.2'} />
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-muted">تكاليف أخرى على القطعة (الخياطة، السحاب، الملصق، الكيس…)</p>
                <CostList items={u.pieceCosts} onChange={(v) => set('pieceCosts', v)} addLabel="إضافة تكلفة" />
              </div>
              <div className="rounded-lg bg-subtle px-3 py-2">
                <Line label="تكلفة القطعة الواحدة" value={da(r.costPerPiece)} strong />
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="البيع والإعلان" />
            <div className="grid gap-3 p-4 sm:grid-cols-3">
              <Num label="سعر بيع القطعة (بدون التوصيل)" unit="دج" value={u.price} onChange={(v) => set('price', v)} />
              <Num label="تكلفة الطلبية من الإعلان (CPL)" unit="$" value={u.cplUsd} onChange={(v) => set('cplUsd', v)} hint="Cost per result في Ads Manager" />
              <Num label="سعر الدولار" unit="دج" value={u.usdRate} onChange={(v) => set('usdRate', v)} hint="حسب سعر اليوم" />
            </div>
          </Card>

          <FunnelAndFees value={u} set={set} footer={<SaveShared values={u} />} />
        </div>

        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <VerdictAlert r={r}>
            {r.perDelivered ? (
              <>
                <p className="text-sm">الربح الصافي لكل قطعة مسلّمة: <b className="ltr">{da(r.perDelivered.profit)}</b> ({pct(r.margin)} من سعر البيع)</p>
                <p className="mt-1 text-sm">
                  الإعلان يكلف <b className="ltr">{da(r.perDelivered.ads)}</b> لكل قطعة مسلّمة
                  {leadsPerSale ? <> (كل قطعة مسلّمة تحتاج <b className="ltr">{leadsPerSale.toFixed(1)}</b> طلبية من الإعلان)</> : null}.
                </p>
              </>
            ) : (
              <p className="text-sm">أدخل نسبة التأكيد والتوصيل.</p>
            )}
          </VerdictAlert>
          <AdCeilingCard r={r} targetMarginPct={u.targetMarginPct} spendLine={false} />
          <PriceCard r={r} price={u.price} targetMarginPct={u.targetMarginPct} />
          <MoneyCard r={r} perUnit />
        </div>
      </div>

      <ProfitGrid input={input} maxCplUsd={r.breakeven?.maxCplUsd} title="الربح لكل قطعة مسلّمة: حسب تكلفة الطلبية (CPL) ونسبة التوصيل" />
    </div>
  );
}

/**
 * Profit calculators, open to every user: by offer (a production batch, an
 * offer of N pieces, a campaign) and per piece (one piece, whatever the
 * offers). Inputs stay in this browser; the dollar rate and fees start from
 * the shared settings.
 */
export function CalculatorPage() {
  const [tab, setTab] = useState<Tab>(() => loadStored<{ tab: Tab }>('touraya-calculator-tab', { tab: 'offer' })?.tab ?? 'offer');
  useEffect(() => store('touraya-calculator-tab', { tab }), [tab]);
  return (
    <div className="space-y-5">
      <PageHeader title="حاسبة الربح" subtitle="تكلفة القطعة، الربح الحقيقي بعد التأكيد والتوصيل والإرجاع والإعلانات، وسقف تكلفة الإعلان قبل الخسارة" />
      <nav className="flex gap-1 overflow-x-auto border-b border-line scroll-thin">
        {([['offer', 'حسب العرض والدفعة'], ['unit', 'للقطعة الواحدة']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn('-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium transition', tab === key ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-fg')}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === 'offer' ? <OfferCalculator /> : <UnitCalculator />}
    </div>
  );
}
