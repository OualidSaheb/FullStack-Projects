import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Copy, ExternalLink, KeyRound, Pencil, Plus, Settings, Sheet, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { SOURCE_TYPES, type SourceInput } from '@touraya/shared';
import { api } from '@/lib/api';
import { fmtDateTime, timeAgo } from '@/lib/format';
import { qk, useAdminMutation, useOffers, useSources, type SourceWithStats } from '@/lib/queries';
import { isSourceStale } from '@/components/sync-alert';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageLoader, Select, Switch, TagInput } from '@/components/ui';

const DEFAULT_SOURCE: SourceInput = { name: '', type: 'google_sheet', spreadsheetId: '', formType: 'new', offerId: null, sheetNames: ['Sheet1', 'Sheet2'], importFrom: '2026-09-27', syncMinutes: 5, fieldMap: {}, active: true };

function SourceForm({ source, onClose }: { source: SourceWithStats | null; onClose: () => void }) {
  const { data: offers } = useOffers();
  const [form, setForm] = useState<SourceInput>(() => (source ? { ...DEFAULT_SOURCE, ...source } : DEFAULT_SOURCE));
  const sheet = form.type === 'google_sheet';
  const save = useAdminMutation(qk.sources, (v: SourceInput) => (source ? api.put(`/sources/${source.id}`, v) : api.post('/sources', v)));
  const set = <K extends keyof SourceInput>(k: K, v: SourceInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  // Accept a full Google Sheets URL and keep only the id.
  const setSheetId = (value: string) => set('spreadsheetId', /\/d\/([\w-]+)/.exec(value)?.[1] ?? value.trim());

  return (
    <Modal
      open
      onClose={onClose}
      title={source ? 'تعديل المصدر' : 'مصدر جديد'}
      footer={<><Button variant="ghost" onClick={onClose}>إلغاء</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(form, { onSuccess: onClose })}>حفظ</Button></>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="اسم المصدر / العرض" className="sm:col-span-2">{(id) => <Input id={id} value={form.name} onChange={(e) => set('name', e.target.value)} />}</Field>
        <Field label="نوع المصدر" className="sm:col-span-2">
          {(id) => (
            <Select id={id} value={form.type} onChange={(e) => set('type', e.target.value as SourceInput['type'])}>
              {Object.entries(SOURCE_TYPES).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </Select>
          )}
        </Field>
        {sheet && <Field label="رابط أو معرف Google Sheet" className="sm:col-span-2">{(id) => <Input id={id} dir="ltr" value={form.spreadsheetId} onChange={(e) => setSheetId(e.target.value)} />}</Field>}
        <Field label="نوع الفورم">
          {(id) => (
            <Select id={id} value={form.formType} onChange={(e) => set('formType', e.target.value as 'new' | 'legacy')}>
              <option value="new">فورم جديد</option>
              <option value="legacy">فورم قديم</option>
            </Select>
          )}
        </Field>
        <Field label="العرض الافتراضي" hint="يستعمل إذا لم يُعرف العرض من اسم الفورم">
          {(id) => (
            <Select id={id} value={form.offerId ?? ''} onChange={(e) => set('offerId', e.target.value ? Number(e.target.value) : null)}>
              <option value="">—</option>
              {offers?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          )}
        </Field>
        {sheet && <Field label="الأوراق (Tabs) المقروءة" hint="اكتب الاسم ثم Enter">{() => <TagInput value={form.sheetNames} onChange={(v) => set('sheetNames', v)} />}</Field>}
        {sheet && (
          <Field label="التحقق من الشيت كل" hint="5 دقائق موصى به (حدود Google اليومية). فحص كامل كل 30 دقيقة في كل الحالات.">
            {(id) => (
              <Select id={id} value={form.syncMinutes} onChange={(e) => set('syncMinutes', Number(e.target.value) as SourceInput['syncMinutes'])}>
                {[1, 5, 10, 15, 30].map((m) => <option key={m} value={m}>{m} دقيقة</option>)}
              </Select>
            )}
          </Field>
        )}
        <Field label="الاستيراد ابتداءً من">{(id) => <Input id={id} type="date" value={form.importFrom} onChange={(e) => set('importFrom', e.target.value)} />}</Field>
        <Switch checked={form.active} onChange={(v) => set('active', v)} label="مفعل (يستقبل الطلبيات)" />
      </div>
    </Modal>
  );
}

function SetupModal({ source, onClose }: { source: SourceWithStats; onClose: () => void }) {
  const { data: code, isLoading } = useQuery({ queryKey: ['apps-script', source.id], queryFn: () => api.get<string>(`/sources/${source.id}/apps-script`) });
  const rotate = useAdminMutation(qk.sources, () => api.post(`/sources/${source.id}/rotate-token`), 'تم تغيير المفتاح — الصق الكود الجديد في الشيت');
  const copy = () => code && navigator.clipboard.writeText(code).then(() => toast.success('تم نسخ الكود'));
  const steps = [
    <>افتح الملف <a className="inline-flex items-center gap-1 text-primary hover:underline" href={`https://docs.google.com/spreadsheets/d/${source.spreadsheetId}`} target="_blank" rel="noreferrer">{source.name} <ExternalLink className="size-3" /></a></>,
    <>اذهب إلى <b>Extensions → Apps Script</b> واحذف أي كود قديم</>,
    <>الصق الكود المنسوخ واحفظ (Ctrl+S)</>,
    <>اختر الدالة <code className="rounded bg-subtle px-1.5 ltr">setupTouraya</code> واضغط <b>Run</b> ثم وافق على الصلاحيات</>,
    <>للتأكد من الربط: شغّل <code className="rounded bg-subtle px-1.5 ltr">testTouraya</code> ← تظهر طلبية «TEST Touraya» في المنصة (احذفها بعد ذلك)</>,
    <>الطلبيات الجديدة تصل كل {source.syncMinutes} دقيقة. لإعادة إرسال الكل: <code className="rounded bg-subtle px-1.5 ltr">resendAllTouraya</code> (بدون تكرار)</>,
    <>بعد أي تغيير في إعدادات المصدر (الأوراق، التاريخ، المدة) انسخ الكود من جديد وأعد تشغيل <code className="rounded bg-subtle px-1.5 ltr">setupTouraya</code></>,
  ];
  return (
    <Modal open onClose={onClose} size="lg" title={`إعداد الاستقبال — ${source.name}`} footer={<><Button variant="ghost" icon={<KeyRound className="size-4" />} loading={rotate.isPending} onClick={() => confirm('تغيير المفتاح يوقف الكود الحالي حتى تلصق الجديد. متابعة؟') && rotate.mutate(undefined)}>تغيير المفتاح</Button><Button variant="primary" icon={<Copy className="size-4" />} onClick={copy}>نسخ الكود</Button></>}>
      <ol className="mb-4 space-y-2 text-sm">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary">{i + 1}</span>
            <span className="pt-0.5">{s}</span>
          </li>
        ))}
      </ol>
      <Alert tone="warn" icon={<TriangleAlert className="mt-0.5 size-4 shrink-0" />}>الكود يحتوي مفتاحاً سرياً خاصاً بهذا الملف. لا تشاركه. حذف السكريبت من الشيت يوقف وصول الطلبيات منه.</Alert>
      {isLoading ? <PageLoader /> : <pre className="mt-4 max-h-80 overflow-auto rounded-lg bg-ink p-4 text-xs leading-relaxed text-slate-200 scroll-thin" dir="ltr">{code}</pre>}
    </Modal>
  );
}

function WebhookModal({ source, onClose }: { source: SourceWithStats; onClose: () => void }) {
  const { data } = useQuery({ queryKey: ['endpoint', source.id], queryFn: () => api.get<{ url: string }>(`/sources/${source.id}/endpoint`) });
  const example = `fetch('${data?.url ?? '…'}', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    id: 'ORDER-123',            // معرف فريد (يمنع التكرار)
    name: 'Karim Benali',
    phone: '0556251779',
    wilaya: 'Alger',            // أو 16 أو الجزائر
    commune: 'Bab Ezzouar',
    offer: 'pants 2pcs 3500',   // اسم العرض
    size: '42',
    colors: 'أسود رمادي'
  })
})`;
  return (
    <Modal open onClose={onClose} size="lg" title={`رابط الاستقبال — ${source.name}`}>
      <div className="space-y-3 text-sm">
        <p>أرسل الطلبيات بـ <b>POST</b> (JSON) إلى هذا الرابط من موقعك، أو من Make / Zapier / Shopify / WooCommerce. نفس المعالجة ومنع التكرار مثل Google Sheets.</p>
        <Input readOnly dir="ltr" value={data?.url ?? ''} onFocus={(e) => e.target.select()} />
        <Button icon={<Copy className="size-4" />} onClick={() => data && navigator.clipboard.writeText(data.url).then(() => toast.success('تم النسخ'))}>نسخ الرابط</Button>
        <pre className="overflow-auto rounded-lg bg-ink p-4 text-xs leading-relaxed text-slate-200" dir="ltr">{example}</pre>
        <p className="text-muted">أسماء الحقول قابلة للتغيير من «أسئلة الفورم».</p>
      </div>
    </Modal>
  );
}

function SyncStatus({ source }: { source: SourceWithStats }) {
  const s = source.lastSyncStats;
  if (!source.lastSyncAt || !s) return <Badge tone="warn">لم يتصل بعد</Badge>;
  const stale = isSourceStale(source);
  return (
    <div className="space-y-1 text-xs">
      <p className="flex items-center gap-1.5" title={fmtDateTime(source.lastSyncAt)}>
        {stale ? <TriangleAlert className="size-3.5 text-warn" /> : <CheckCircle2 className="size-3.5 text-ok" />}
        آخر اتصال {timeAgo(source.lastSyncAt)}
      </p>
      <p className="text-muted">آخر دفعة: {s.created} جديدة · {s.duplicates} مكررة · {s.skipped} متجاهلة</p>
      {s.errors.length > 0 && <p className="text-danger">{s.errors.length} أخطاء — مثلاً سطر {s.errors[0]!.row}: {s.errors[0]!.message}</p>}
    </div>
  );
}

export function SourcesTab() {
  const { data: sources, isLoading } = useSources();
  const { data: offers } = useOffers();
  const [hook, setHook] = useState<SourceWithStats | null>(null);
  const [editing, setEditing] = useState<SourceWithStats | null | 'new'>(null);
  const [setup, setSetup] = useState<SourceWithStats | null>(null);
  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">من أين تأتي الطلبيات: ملفات Google Sheets (Facebook Lead Ads عبر Apps Script) أو رابط Webhook لأي موقع أو أداة. لا تكرار أبداً (Lead ID).</p>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>مصدر جديد</Button>
      </div>
      {!sources?.length ? (
        <Card><EmptyState icon={<Sheet className="size-6" />} title="لا توجد مصادر" /></Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {sources.map((s) => (
            <Card key={s.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{s.name}</h3>
                    <Badge tone={s.formType === 'new' ? 'primary' : 'neutral'}>{s.formType === 'new' ? 'فورم جديد' : 'فورم قديم'}</Badge>
                    {!s.active && <Badge tone="danger">متوقف</Badge>}
                  </div>
                  {s.type === 'google_sheet' && <p className="ltr mt-1 truncate text-right text-xs text-faint">{s.spreadsheetId}</p>}
                  <p className="mt-1 text-xs text-muted">
                    {offers?.find((o) => o.id === s.offerId)?.name ?? 'بدون عرض افتراضي'} · {s.type === 'google_sheet' ? s.sheetNames.join(' + ') : 'Webhook'} · من {s.importFrom} · <b>{s.orderCount}</b> طلبية
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(s)}>تعديل</Button>
                  <Button size="sm" variant="primary" icon={<Settings className="size-3.5" />} onClick={() => (s.type === 'webhook' ? setHook(s) : setSetup(s))}>إعداد الاستقبال</Button>
                </div>
              </div>
              <div className="mt-3 border-t border-line pt-3"><SyncStatus source={s} /></div>
            </Card>
          ))}
        </div>
      )}
      {editing && <SourceForm source={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {setup && <SetupModal source={setup} onClose={() => setSetup(null)} />}
      {hook && <WebhookModal source={hook} onClose={() => setHook(null)} />}
    </div>
  );
}
