import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Copy, ExternalLink, KeyRound, Pencil, Plus, Settings, Sheet, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import type { SourceInput } from '@touraya/shared';
import { api } from '@/lib/api';
import { fmtDateTime, timeAgo } from '@/lib/format';
import { qk, useAdminMutation, useProducts, useSources, type SourceWithStats } from '@/lib/queries';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, PageLoader, Select, Switch, TagInput } from '@/components/ui';

const DEFAULT_SOURCE: SourceInput = { name: '', spreadsheetId: '', formType: 'new', productId: null, sheetNames: ['Sheet1', 'Sheet2'], importFrom: '2026-09-27', fieldMap: {}, active: true };

function SourceForm({ source, onClose }: { source: SourceWithStats | null; onClose: () => void }) {
  const { data: products } = useProducts();
  const [form, setForm] = useState<SourceInput>(() => (source ? { ...DEFAULT_SOURCE, ...source } : DEFAULT_SOURCE));
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
        <Field label="رابط أو معرف Google Sheet" className="sm:col-span-2">{(id) => <Input id={id} dir="ltr" value={form.spreadsheetId} onChange={(e) => setSheetId(e.target.value)} />}</Field>
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
            <Select id={id} value={form.productId ?? ''} onChange={(e) => set('productId', e.target.value ? Number(e.target.value) : null)}>
              <option value="">—</option>
              {products?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="الأوراق (Tabs) المقروءة" hint="اكتب الاسم ثم Enter">{() => <TagInput value={form.sheetNames} onChange={(v) => set('sheetNames', v)} />}</Field>
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
    <>الطلبيات الجديدة تصل كل دقيقة تقريباً. لإعادة إرسال الكل: شغّل <code className="rounded bg-subtle px-1.5 ltr">resendAllTouraya</code> (بدون تكرار)</>,
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

function SyncStatus({ source }: { source: SourceWithStats }) {
  const s = source.lastSyncStats;
  if (!source.lastSyncAt || !s) return <Badge tone="warn">لم يتصل بعد</Badge>;
  const stale = Date.now() - new Date(source.lastSyncAt).getTime() > 30 * 60_000;
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
  const { data: products } = useProducts();
  const [editing, setEditing] = useState<SourceWithStats | null | 'new'>(null);
  const [setup, setSetup] = useState<SourceWithStats | null>(null);
  if (isLoading) return <PageLoader />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">كل ملف Google Sheet (عرض) يرسل طلبياته عبر Apps Script. يقرأ Sheet1 و Sheet2 ولا يكرر أي طلبية (Facebook Lead ID).</p>
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
                  <p className="ltr mt-1 truncate text-start text-xs text-faint">{s.spreadsheetId}</p>
                  <p className="mt-1 text-xs text-muted">
                    {products?.find((p) => p.id === s.productId)?.name ?? 'بدون عرض افتراضي'} · {s.sheetNames.join(' + ')} · من {s.importFrom} · <b>{s.orderCount}</b> طلبية
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(s)}>تعديل</Button>
                  <Button size="sm" variant="primary" icon={<Settings className="size-3.5" />} onClick={() => setSetup(s)}>إعداد الاستقبال</Button>
                </div>
              </div>
              <div className="mt-3 border-t border-line pt-3"><SyncStatus source={s} /></div>
            </Card>
          ))}
        </div>
      )}
      {editing && <SourceForm source={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {setup && <SetupModal source={setup} onClose={() => setSetup(null)} />}
    </div>
  );
}
