import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { weekKey, type AdSpendDTO, type AdSpendInput } from '@touraya/shared';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { fmtDA, todayDZ } from '@/lib/format';
import { errorMessage, useOffers, useSettings } from '@/lib/queries';
import { Button, Card, CardHeader, Field, Input, Select } from '@/components/ui';

const RATE_KEY = 'touraya-usd-rate';
const MONTHS = ['جانفي', 'فيفري', 'مارس', 'أفريل', 'ماي', 'جوان', 'جويلية', 'أوت', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const monthLabel = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
const usd = (n: number) => `${n.toFixed(2)} $`;
const weekLabel = (key: string) => {
  const end = new Date(`${key}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  return `${key.slice(8, 10)}/${key.slice(5, 7)} → ${end.toISOString().slice(8, 10)}/${end.toISOString().slice(5, 7)}`;
};

function storedRate(): number | null {
  try {
    return Number(localStorage.getItem(RATE_KEY)) || null;
  } catch {
    return null;
  }
}

/**
 * Ad spend, typed a day at a time in dollars with the dollar's price that day:
 * totals by day, month and overall, in dollars and dinars. The statistics
 * above take it off the profit.
 */
export function AdsCard() {
  const can = useCan();
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const { data: offers } = useOffers();
  const { data: ads } = useQuery({ queryKey: ['ads'], queryFn: () => api.get<AdSpendDTO[]>('/ads') });
  const [rate, setRate] = useState<number | null>(storedRate);
  const [day, setDay] = useState(todayDZ());
  const [amount, setAmount] = useState('');
  const [offerId, setOfferId] = useState<number | ''>('');
  const [note, setNote] = useState('');
  const [showAll, setShowAll] = useState(false);
  const usdRate = rate ?? settings?.calculator.usdRate ?? 250;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['ads'] });
    qc.invalidateQueries({ queryKey: ['stats', 'carrier'] });
  };
  const add = useMutation({
    mutationFn: () => api.post('/ads', { day, amountUsd: Number(amount), usdRate, offerId: offerId || null, note: note.trim() || undefined } satisfies AdSpendInput),
    onSuccess: () => {
      toast.success('تمت إضافة المصروف');
      setAmount('');
      setNote('');
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({ mutationFn: (id: number) => api.delete(`/ads/${id}`), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });

  const setRateKept = (v: number | null) => {
    setRate(v);
    try {
      if (v) localStorage.setItem(RATE_KEY, String(v));
    } catch {
      /* private window: kept for this visit only */
    }
  };

  const list = ads ?? [];
  const months = [...list.reduce((m, a) => {
    const k = a.day.slice(0, 7);
    const cur = m.get(k) ?? { usd: 0, da: 0 };
    return m.set(k, { usd: cur.usd + a.amountUsd, da: cur.da + a.amountUsd * a.usdRate });
  }, new Map<string, { usd: number; da: number }>())].sort((a, b) => b[0].localeCompare(a[0]));
  const weeks = [...list.reduce((m, a) => {
    const k = weekKey(`${a.day}T12:00:00Z`);
    const cur = m.get(k) ?? { usd: 0, da: 0 };
    return m.set(k, { usd: cur.usd + a.amountUsd, da: cur.da + a.amountUsd * a.usdRate });
  }, new Map<string, { usd: number; da: number }>())].sort((a, b) => b[0].localeCompare(a[0]));
  const days = [...list.reduce((m, a) => m.set(a.day, [...(m.get(a.day) ?? []), a]), new Map<string, AdSpendDTO[]>())];

  return (
    <Card>
      <CardHeader title="مصاريف الإعلانات اليومية (للحساب الشهري والأسبوعي)" icon={<Megaphone className="size-4 text-muted" />} />
      <div className="space-y-4 p-4 text-sm">
        <p className="text-xs text-muted">للحساب الشهري والأسبوعي: أضف مصروف كل يوم (أو كل أسبوع في يوم واحد). الربح الكلي يُحسب بـ «المبلغ الكلي للإعلانات» في الأعلى إن أُدخل.</p>
        {months.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-medium text-muted">شهرياً</p>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {months.map(([k, v]) => (
                  <li key={k} className="flex justify-between gap-2 px-3 py-1.5"><span>{monthLabel(k)}</span><span className="ltr">{usd(v.usd)} · {fmtDA(Math.round(v.da))}</span></li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted">أسبوعياً</p>
              <ul className="max-h-52 divide-y divide-line overflow-y-auto rounded-lg border border-line scroll-thin">
                {weeks.map(([k, v]) => (
                  <li key={k} className="flex justify-between gap-2 px-3 py-1.5"><span className="ltr">{weekLabel(k)}</span><span className="ltr">{usd(v.usd)} · {fmtDA(Math.round(v.da))}</span></li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {can('ads.manage') && (
          <div className="space-y-3 rounded-lg border border-line p-3">
            <div className="grid gap-3 sm:grid-cols-[10rem_8rem_8rem_minmax(0,1fr)]">
              <Field label="سعر الصرف (دج للدولار)" hint="يُحفظ مع كل يوم تضيفه">
                {(id) => <Input id={id} type="number" inputMode="decimal" min={1} dir="ltr" value={usdRate} onChange={(e) => setRateKept(Number(e.target.value) || null)} />}
              </Field>
              <Field label="اليوم">{(id) => <Input id={id} type="date" dir="ltr" value={day} max={todayDZ()} onChange={(e) => setDay(e.target.value)} />}</Field>
              <Field label="المصروف ($)">
                {(id) => <Input id={id} type="number" inputMode="decimal" min={0} step="0.01" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />}
              </Field>
              <Field label="العرض (اختياري)">
                {(id) => (
                  <Select id={id} value={offerId} onChange={(e) => setOfferId(e.target.value ? Number(e.target.value) : '')}>
                    <option value="">كل العروض</option>
                    {offers?.filter((o) => o.active).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </Select>
                )}
              </Field>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="ملاحظة (اختياري)" className="min-w-48 flex-1">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً: حملة الفيديو الجديد" />}</Field>
              <Button variant="primary" icon={<Plus className="size-4" />} loading={add.isPending} disabled={!(Number(amount) > 0) || !usdRate} onClick={() => add.mutate()}>
                إضافة {Number(amount) > 0 && <span className="ltr">({fmtDA(Math.round(Number(amount) * usdRate))})</span>}
              </Button>
            </div>
          </div>
        )}

        {days.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-medium text-muted">يومياً</p>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {(showAll ? days : days.slice(0, 14)).map(([d, entries]) => (
                <li key={d} className="px-3 py-2">
                  <div className="flex items-center justify-between gap-2 font-medium">
                    <span className="ltr">{d}</span>
                    <span className="ltr">{usd(entries.reduce((n, a) => n + a.amountUsd, 0))} · {fmtDA(Math.round(entries.reduce((n, a) => n + a.amountUsd * a.usdRate, 0)))}</span>
                  </div>
                  {entries.map((a) => (
                    <div key={a.id} className="flex items-center gap-2 text-xs text-muted">
                      <span className="ltr">{usd(a.amountUsd)} × {a.usdRate}</span>
                      <span className="min-w-0 flex-1 truncate">{a.offerName ?? 'كل العروض'}{a.note ? ` — ${a.note}` : ''}</span>
                      {can('ads.manage') && (
                        <button className="rounded p-1 hover:text-danger" onClick={() => confirm('حذف هذا المصروف؟') && remove.mutate(a.id)} aria-label="حذف">
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </li>
              ))}
            </ul>
            {days.length > 14 && (
              <button className="mt-2 text-xs text-primary hover:underline" onClick={() => setShowAll(!showAll)}>{showAll ? 'إخفاء' : `عرض كل الأيام (${days.length})`}</button>
            )}
          </div>
        ) : (
          <p className="text-center text-xs text-faint">لم تُضف أي مصاريف بعد</p>
        )}
      </div>
    </Card>
  );
}
