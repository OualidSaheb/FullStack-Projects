import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, CircleHelp, Link2, ListChecks, Megaphone, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { LEAD_FIELD_LABELS, LEAD_FIELDS, type FieldMap, type FormDTO, type FunnelStats, type LeadField, type OfferDTO, type ProductDTO } from '@touraya/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtDA, fmtDateTime, timeAgo } from '@/lib/format';
import { errorMessage, qk, useForms, useOffers, useProducts } from '@/lib/queries';
import { InlineSelect } from '@/components/inline';
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Modal, PageLoader, Select } from '@/components/ui';

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');
/** Confirmed out of the leads already decided (calls still running are not counted against the form). */
export const confirmRate = (s: FunnelStats) => pct(s.confirmed, s.confirmed + s.cancelled);
/** Delivered out of the parcels that finished their trip. */
export const deliveryRate = (s: FunnelStats) => pct(s.delivered, s.delivered + s.returned);

export function offerLabel(o: OfferDTO, products: ProductDTO[] | undefined) {
  const p = products?.find((x) => x.id === o.productId);
  return `${p?.name ?? o.name} — ${o.units} ${o.units === 1 ? 'قطعة' : 'قطع'} ${fmtDA(o.price)}`;
}

function useLinkForm() {
  const qc = useQueryClient();
  const [pending, setPending] = useState<number | null>(null);
  const link = async (form: FormDTO, offerId: number | null) => {
    setPending(form.id);
    try {
      const res = await api.put<{ relinked: number }>(`/forms/${form.id}`, { offerId });
      toast.success(offerId ? `تم الربط${res.relinked ? ` — تحديث ${res.relinked} طلبية` : ''}` : 'تم فك الربط');
      qc.invalidateQueries({ queryKey: qk.forms });
      qc.invalidateQueries({ queryKey: qk.orders });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPending(null);
    }
  };
  return { link, pending };
}

/** Which question feeds each field, with this form's latest answer as example; and its ads compared. */
function FormModal({ form, onClose }: { form: FormDTO; onClose: () => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'fields' | 'ads'>('fields');
  const [fieldMap, setFieldMap] = useState<FieldMap>(form.fieldMap);
  const [saving, setSaving] = useState(false);
  const preview = useQuery({
    queryKey: ['form-preview', form.id, fieldMap],
    queryFn: () => api.post<{ headers: string[]; mapping: Partial<Record<LeadField, string>>; inferred: LeadField[]; sample: Record<string, unknown> }>(`/forms/${form.id}/preview-mapping`, { fieldMap }),
  });
  const ads = useQuery({ queryKey: ['form-ads', form.id], queryFn: () => api.get<{ ad: string | null; stats: FunnelStats }[]>(`/forms/${form.id}/ads`), enabled: tab === 'ads' });
  const save = async () => {
    setSaving(true);
    try {
      const res = await api.put<{ refilled: number }>(`/forms/${form.id}`, { fieldMap });
      toast.success(`تم الحفظ${res.refilled ? ` — تم إكمال ${res.refilled} طلبية` : ''}`);
      qc.invalidateQueries({ queryKey: qk.forms });
      qc.invalidateQueries({ queryKey: qk.orders });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  const fields = LEAD_FIELDS.filter((f) => !['formId', 'formName', 'campaignName', 'adName', 'platform', 'leadId', 'createdAt'].includes(f));
  const answer = (header?: string) => {
    const v = header ? preview.data?.sample[header] : undefined;
    return v === undefined || v === null || v === '' ? null : String(v);
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={form.name}
      footer={tab === 'fields' ? <><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button variant="primary" loading={saving} onClick={save}>حفظ وإكمال الطلبيات</Button></> : undefined}
    >
      <div className="mb-4 flex gap-1 rounded-lg bg-subtle p-1 text-sm">
        {([['fields', 'الأسئلة', ListChecks], ['ads', 'الإعلانات', Megaphone]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k)} className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 font-medium', tab === k ? 'bg-surface shadow-sm' : 'text-muted')}>
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>
      {tab === 'fields' ? (
        preview.isLoading || !preview.data ? (
          <PageLoader />
        ) : !preview.data.headers.length ? (
          <EmptyState title="لم تصل أي طلبية من هذا الفورم بعد" />
        ) : (
          <div className="space-y-3">
            <Alert tone="primary" icon={<CircleHelp className="mt-0.5 size-4 shrink-0" />}>
              «تلقائي» يتعرف على الأسئلة بمعناها، وعلى الأسئلة المرتبطة (conditional_question) من إجاباتها: ولاية، بلدية، رقم هاتف. غيّر فقط ما هو خاطئ؛ الطلبيات القديمة لهذا الفورم تُكمَل بعد الحفظ بدون لمس ما عدّله الموظفون.
            </Alert>
            <div className="divide-y divide-line rounded-xl border border-line">
              {fields.map((field) => {
                const header = preview.data.mapping[field];
                const inferred = preview.data.inferred.includes(field);
                return (
                  <div key={field} className="grid items-center gap-2 px-3 py-2 sm:grid-cols-[9rem_1fr_1fr]">
                    <span className="text-sm font-medium">{LEAD_FIELD_LABELS[field]}</span>
                    <Select
                      className="h-9 text-sm"
                      value={fieldMap[field]?.[0] ?? ''}
                      onChange={(e) => setFieldMap((m) => ({ ...m, [field]: e.target.value ? [e.target.value] : [] }))}
                      aria-label={LEAD_FIELD_LABELS[field]}
                    >
                      <option value="">تلقائي{header ? ` (${header})` : ''}</option>
                      {preview.data.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                    </Select>
                    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
                      {inferred && <Sparkles className="size-3.5 shrink-0 text-primary" aria-label="اكتُشف من الإجابة" />}
                      {header ? <span className="truncate">مثال: <b className="text-fg">{answer(header) ?? '—'}</b></span> : <span className="text-faint">غير موجود في هذا الفورم</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )
      ) : ads.isLoading ? (
        <PageLoader />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted">
              <tr>{['الإعلان', 'الطلبيات', 'التأكيد', 'التسليم'].map((h) => <th key={h} className="py-1.5 text-start font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ads.data?.map((a) => (
                <tr key={a.ad ?? '-'}>
                  <td className="py-2">{a.ad ?? <span className="text-faint">غير معروف</span>}</td>
                  <td className="ltr py-2 text-right">{a.stats.leads}</td>
                  <td className="ltr py-2 text-right">{confirmRate(a.stats)}</td>
                  <td className="ltr py-2 text-right">{deliveryRate(a.stats)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function FormRow({ form, offers, products, onOpen }: { form: FormDTO; offers: OfferDTO[]; products?: ProductDTO[]; onOpen: () => void }) {
  const qc = useQueryClient();
  const { link, pending } = useLinkForm();
  const archive = async () => {
    await api.delete(`/forms/${form.id}`);
    qc.invalidateQueries({ queryKey: qk.forms });
  };
  const where = form.spreadsheetName ? `${form.spreadsheetName}${form.sheetName ? ` / ${form.sheetName}` : ''}` : form.sheetName;
  return (
    <div className="grid items-center gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1.6fr)_repeat(3,4.5rem)_auto]">
      <div className="min-w-0">
        <p className="truncate font-medium" title={form.name}>{form.name}</p>
        <p className="truncate text-xs text-muted">
          {where && <>{where} · </>}
          {form.lastLeadAt ? <span title={fmtDateTime(form.lastLeadAt)}>آخر طلبية {timeAgo(form.lastLeadAt)}</span> : 'لا طلبيات'}
          {form.linkedBy === 'auto' && <> · ربط تلقائي بالاسم</>}
        </p>
      </div>
      <InlineSelect
        value={form.offerId}
        placeholder="اختر العرض…"
        tone={form.offerId ? undefined : 'warn'}
        disabled={pending === form.id}
        className="w-full"
        options={offers.filter((o) => o.active || o.id === form.offerId).map((o) => ({ value: o.id, label: offerLabel(o, products) }))}
        onSave={(v) => link(form, v)}
        aria-label={`عرض الفورم ${form.name}`}
      />
      <div className="flex items-center justify-between gap-3 md:contents">
        <div className="flex items-center gap-5 md:contents">
          <Stat label="طلبيات" value={String(form.stats.leads)} />
          <Stat label="تأكيد" value={confirmRate(form.stats)} />
          <Stat label="تسليم" value={deliveryRate(form.stats)} />
        </div>
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" icon={<ListChecks className="size-3.5" />} onClick={onOpen}>تفاصيل</Button>
          <Button size="sm" variant="ghost" icon={<Archive className="size-3.5" />} onClick={archive} aria-label="إخفاء" title="إخفاء من القائمة (يعود إذا أرسل طلبيات)" />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1 text-sm md:flex-col md:items-start md:gap-0">
      <span className="ltr font-semibold">{value}</span>
      <span className="text-[11px] text-muted">{label}</span>
    </span>
  );
}

/**
 * Facebook forms found from the leads. Each one is linked once to the offer it
 * sells (automatically when its name starts with the offer's name); several
 * forms of the same offer are compared side by side.
 */
export function FormsPanel() {
  const { data: forms, isLoading } = useForms();
  const { data: offers } = useOffers();
  const { data: products } = useProducts();
  const [open, setOpen] = useState<FormDTO | null>(null);
  if (isLoading || !offers) return <PageLoader />;

  const unlinked = (forms ?? []).filter((f) => !f.offerId);
  const groups = offers
    .map((o) => ({ offer: o, forms: (forms ?? []).filter((f) => f.offerId === o.id) }))
    .filter((g) => g.forms.length)
    .sort((a, b) => b.forms.reduce((n, f) => n + f.stats.leads, 0) - a.forms.reduce((n, f) => n + f.stats.leads, 0));

  return (
    <div className="space-y-4">
      {!forms?.length && (
        <Card><EmptyState icon={<Link2 className="size-6" />} title="لا توجد فورمات بعد">تظهر هنا تلقائياً عند وصول أول طلبية من كل فورم.</EmptyState></Card>
      )}
      {unlinked.length > 0 && (
        <Card className="border-warn/50">
          <CardHeader title={<>فورمات تنتظر الربط <Badge tone="warn">{unlinked.length}</Badge></>} icon={<Sparkles className="size-4 text-warn" />} />
          <p className="px-4 pt-3 text-xs text-muted">طلبياتها تصل بدون عرض. اختر العرض مرة واحدة: كل طلبياتها (التي لم تؤكد بعد) تأخذ المنتج والكمية والسعر.</p>
          <div className="divide-y divide-line">{unlinked.map((f) => <FormRow key={f.id} form={f} offers={offers} products={products} onOpen={() => setOpen(f)} />)}</div>
        </Card>
      )}
      {groups.map(({ offer, forms: list }) => (
        <Card key={offer.id}>
          <CardHeader title={offerLabel(offer, products)} action={<span className="text-xs text-muted">{list.length} {list.length === 1 ? 'فورم' : 'فورمات'}</span>} />
          <div className="divide-y divide-line">{list.map((f) => <FormRow key={f.id} form={f} offers={offers} products={products} onOpen={() => setOpen(f)} />)}</div>
        </Card>
      ))}
      {open && <FormModal form={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
