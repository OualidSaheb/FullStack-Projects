import { useMutation } from '@tanstack/react-query';
import { Activity, Info, Webhook } from 'lucide-react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/queries';
import { Alert, Button, Card, CardHeader, Field, Input, PageLoader, Switch } from '@/components/ui';
import { useSettingsForm } from './use-settings-form';

type TestResult = { ok: boolean; message?: string; status?: number; cfRay?: string | null };

export function YalidineTab() {
  const { data, form, setForm, save } = useSettingsForm();
  const test = useMutation({ mutationFn: () => api.post<TestResult>('/shipping/yalidine/test') });
  if (!form || !data) return <PageLoader />;
  const y = form.yalidine;
  const set = (patch: Partial<typeof y>) => setForm({ ...form, yalidine: { ...y, ...patch } });
  const webhookUrl = `${window.location.origin}/api/webhooks/yalidine`;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader title="Yalidine API" />
        <div className="space-y-4 p-4">
          <Alert tone="primary" icon={<Info className="mt-0.5 size-4 shrink-0" />}>
            حالياً API يرجع 403 (Cloudflare 1106): الحساب غير مفعل للـ API أو عنوان IP محجوب. الحل المؤقت: ملف التوصيل من صفحة «التوصيل». عند حل المشكل فعّل الإرسال هنا.
          </Alert>
          <Switch checked={y.enabled} onChange={(enabled) => set({ enabled })} label="تفعيل الإرسال عبر API" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="API ID">{(id) => <Input id={id} dir="ltr" value={y.apiId} onChange={(e) => set({ apiId: e.target.value })} />}</Field>
            <Field label="API TOKEN" hint={data.yalidine.hasApiToken ? 'محفوظ (مشفر) — اتركه فارغاً للإبقاء عليه' : 'غير محفوظ'}>
              {(id) => <Input id={id} dir="ltr" type="password" autoComplete="off" value={y.apiToken} onChange={(e) => set({ apiToken: e.target.value })} />}
            </Field>
            <Field label="رابط API" hint="غيّره إلى رابط Relay بعنوان IP ثابت إذا لزم" className="sm:col-span-2">
              {(id) => <Input id={id} dir="ltr" value={y.apiBaseUrl} onChange={(e) => set({ apiBaseUrl: e.target.value })} />}
            </Field>
            <Field label="ولاية الانطلاق">{(id) => <Input id={id} dir="ltr" value={y.fromWilayaName} onChange={(e) => set({ fromWilayaName: e.target.value })} />}</Field>
          </div>
          <div className="flex gap-2">
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(form)}>حفظ</Button>
            <Button icon={<Activity className="size-4" />} loading={test.isPending} onClick={() => test.mutate()}>اختبار الاتصال</Button>
          </div>
          {test.data && (
            <Alert tone={test.data.ok ? 'ok' : 'danger'}>
              {test.data.ok ? 'الاتصال ناجح ✓' : test.data.message}
              {test.data.cfRay && <span className="ltr block text-xs opacity-80">Cloudflare ray: {test.data.cfRay}</span>}
            </Alert>
          )}
          {test.error && <Alert tone="danger">{errorMessage(test.error)}</Alert>}
        </div>
      </Card>
      <Card>
        <CardHeader title="Webhook — تحديث الحالة تلقائياً" icon={<Webhook className="size-4 text-muted" />} />
        <div className="space-y-4 p-4 text-sm">
          <p>ضع هذا الرابط في لوحة Yalidine واختر الحدث <code className="ltr rounded bg-subtle px-1">parcel_status_updated</code>. الرابط يرد دائماً بـ HTTP 200 (لتفادي not2xx).</p>
          <Input readOnly dir="ltr" value={webhookUrl} onFocus={(e) => e.target.select()} />
          <Field label="Webhook secret (اختياري)" hint="إذا أعطتك Yalidine مفتاحاً للتوقيع ضعه هنا للتحقق من الطلبات">
            {(id) => <Input id={id} dir="ltr" value={y.webhookSecret} onChange={(e) => set({ webhookSecret: e.target.value })} />}
          </Field>
          <p className="text-muted">الحالات: «Livré» ← تم التوصيل · «Retour…» ← مرتجعة · مراحل النقل ← استلمتها شركة التوصيل.</p>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(form)}>حفظ</Button>
        </div>
      </Card>
    </div>
  );
}
