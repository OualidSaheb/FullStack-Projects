import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { fmtDA } from '@/lib/format';
import { errorMessage, useSettings } from '@/lib/queries';
import { Button, Card, CardHeader, Field, Input } from '@/components/ui';

type Total = { usd: number; usdRate: number } | null;

/**
 * The whole ad spend so far, typed in one go (e.g. Ads Manager's total since
 * the start) with its exchange rate: the overall profit after ads uses it.
 */
export function AdsTotalCard({ daysUsd }: { daysUsd: number }) {
  const can = useCan();
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const { data: total } = useQuery({ queryKey: ['ads', 'total'], queryFn: () => api.get<Total>('/ads/total') });
  const [usd, setUsd] = useState('');
  const [rate, setRate] = useState('');
  useEffect(() => {
    setUsd(total ? String(total.usd) : '');
    setRate(String(total?.usdRate ?? settings?.calculator.usdRate ?? 250));
  }, [total, settings]);

  const save = useMutation({
    mutationFn: (v: Total) => api.put<Total>('/ads/total', v),
    onSuccess: (v) => {
      toast.success(v ? 'تم حفظ المبلغ الكلي' : 'رجوع إلى مجموع الأيام');
      qc.invalidateQueries({ queryKey: ['ads'] });
      qc.invalidateQueries({ queryKey: ['stats', 'carrier'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const amount = Number(usd);
  const usdRate = Number(rate);
  const editable = can('ads.manage');

  return (
    <Card>
      <CardHeader title="المبلغ الكلي للإعلانات" icon={<Megaphone className="size-4 text-muted" />} />
      <div className="space-y-3 p-4 text-sm">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="المصروف الكلي ($)" className="w-40">
            {(id) => <Input id={id} type="number" inputMode="decimal" min={0} step="0.01" dir="ltr" value={usd} disabled={!editable} onChange={(e) => setUsd(e.target.value)} placeholder="0.00" />}
          </Field>
          <Field label="سعر الصرف (دج للدولار)" className="w-40">
            {(id) => <Input id={id} type="number" inputMode="decimal" min={1} dir="ltr" value={rate} disabled={!editable} onChange={(e) => setRate(e.target.value)} />}
          </Field>
          <div className="pb-2 text-muted">= <b className="ltr text-fg">{fmtDA(Math.round((amount || 0) * (usdRate || 0)))}</b></div>
          {editable && (
            <div className="flex gap-2">
              <Button variant="primary" icon={<Save className="size-4" />} loading={save.isPending} disabled={!(amount >= 0) || !(usdRate > 0) || usd === ''} onClick={() => save.mutate({ usd: amount, usdRate })}>
                حفظ
              </Button>
              {total && (
                <Button variant="ghost" icon={<X className="size-4" />} disabled={save.isPending} onClick={() => confirm('مسح المبلغ الكلي والرجوع إلى مجموع الأيام؟') && save.mutate(null)}>
                  مسح
                </Button>
              )}
            </div>
          )}
        </div>
        <p className="text-xs text-muted">
          {total
            ? 'الربح الكلي بعد الإعلانات يُحسب بهذا المبلغ. الأيام المضافة في الأسفل تُستعمل فقط للحساب الشهري والأسبوعي.'
            : `لم يُدخل مبلغ كلي: يُحسب الربح الكلي بمجموع الأيام المضافة في الأسفل (${daysUsd.toFixed(2)} $). اكتب هنا المبلغ الكلي من Ads Manager ليكون الحساب كاملاً.`}
        </p>
      </div>
    </Card>
  );
}
