import type { Settings } from '@touraya/shared';
import { cn } from '@/lib/cn';
import { Button, Card, CardHeader, Field, Input, PageLoader, Select, Switch, TagInput } from '@/components/ui';
import { useSettingsForm } from './use-settings-form';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const fmtHour = (h: number) => `${String(h).padStart(2, '0')}:00`;

const DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

const fmtDelay = (m: number) => (m % 1440 === 0 ? `${m / 1440} يوم` : m % 60 === 0 ? `${m / 60} سا` : `${m} د`);
const parseDelay = (s: string) => {
  const n = parseFloat(s);
  if (!n) return null;
  if (/يوم|d/i.test(s)) return Math.round(n * 1440);
  if (/سا|h/i.test(s)) return Math.round(n * 60);
  return Math.round(n);
};

export function SettingsTab() {
  const { form, setForm, save } = useSettingsForm();
  if (!form) return <PageLoader />;
  const p = form.callPolicy;
  const setPolicy = (patch: Partial<Settings['callPolicy']>) => setForm({ ...form, callPolicy: { ...p, ...patch } });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="سياسة الاتصال" />
        <div className="space-y-4 p-4">
          <p className="text-sm text-muted">بعد «لم يرد» تُبرمج المحاولة التالية تلقائياً داخل أوقات العمل فقط (لا اتصال في الليل). نفس القواعد سيستعملها وكيل الاتصال الآلي لاحقاً.</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="بداية العمل">{(id) => <Input id={id} type="time" value={p.workStart} onChange={(e) => setPolicy({ workStart: e.target.value })} />}</Field>
            <Field label="نهاية العمل">{(id) => <Input id={id} type="time" value={p.workEnd} onChange={(e) => setPolicy({ workEnd: e.target.value })} />}</Field>
            <Field label="عدد المحاولات">{(id) => <Input id={id} type="number" min={1} max={10} value={p.maxAttempts} onChange={(e) => setPolicy({ maxAttempts: Number(e.target.value) })} />}</Field>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">أيام العمل</p>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((d, i) => {
                const on = p.workDays.includes(i);
                return (
                  <button key={d} onClick={() => setPolicy({ workDays: on ? p.workDays.filter((x) => x !== i) : [...p.workDays, i].sort() })} className={cn('rounded-full border px-3 py-1 text-xs font-medium', on ? 'border-primary bg-primary-soft text-primary' : 'border-line text-muted')}>
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
          <Field label="الانتظار قبل كل محاولة جديدة" hint="مثلاً: 60 (دقيقة)، 3 سا، 1 يوم — بالترتيب، والأخير يتكرر">
            {() => <TagInput value={p.retryDelays.map(fmtDelay)} onChange={(v) => setPolicy({ retryDelays: v.map(parseDelay).filter((n): n is number => n !== null) })} />}
          </Field>
          <Switch checked={p.autoCancelAfterMax} onChange={(v) => setPolicy({ autoCancelAfterMax: v })} label="إلغاء تلقائي بعد آخر محاولة بدون رد" />
        </div>
      </Card>

      <Card>
        <CardHeader title="توزيع الطلبيات والتكرار" />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="توزيع الطلبيات الجديدة" hint="متوازن: كل طلبية جديدة تُسند للموظف الذي عنده أقل طلبيات مفتوحة">
            {(id) => (
              <Select id={id} value={form.assignment} onChange={(e) => setForm({ ...form, assignment: e.target.value as Settings['assignment'] })}>
                <option value="manual">يدوي (أول من يأخذها)</option>
                <option value="balanced">متوازن بين الموظفين</option>
              </Select>
            )}
          </Field>
          <Field label="كشف الطلب المكرر خلال (أيام)" hint="نفس الهاتف وعنده طلبية مفتوحة — 0 لإيقافه">
            {(id) => <Input id={id} type="number" min={0} max={30} value={form.duplicateWindowDays} onChange={(e) => setForm({ ...form, duplicateWindowDays: Number(e.target.value) })} />}
          </Field>
          <div className="sm:col-span-2">
            <Switch checked={form.agentsCanShip} onChange={(agentsCanShip) => setForm({ ...form, agentsCanShip })} label="موظفو التأكيد يرسلون الطلبيات المؤكدة لشركة التوصيل (API) بأنفسهم" />
            <p className="mt-1 text-xs text-muted">ملف Excel وسجل الملفات يبقيان للمسؤولين فقط.</p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="النشاط والإيقاف الليلي (قاعدة البيانات)" />
        <div className="space-y-3 p-4 text-sm">
          <Switch checked={form.alwaysOn} onChange={(alwaysOn) => setForm({ ...form, alwaysOn })} label="المنصة نشيطة دائماً (لا تنام أبداً)" />
          <p className="text-xs text-muted">
            الصفحات تفتح فوراً بدون انتظار. تستهلك ساعات قاعدة البيانات طوال اليوم (~186 ساعة في الشهر): مناسب لخطة Neon المدفوعة. مع الخطة المجانية أطفئه وفعّل الإيقاف الليلي.
          </p>
          <hr className="border-line" />
          <Switch
            checked={form.nightPause.enabled}
            onChange={(enabled) => setForm({ ...form, nightPause: { ...form.nightPause, enabled } })}
            label="لا تستعمل المنصة قاعدة البيانات في الليل (بتوقيت الجزائر)"
          />
          <div className={cn('flex flex-wrap items-center gap-2', !form.nightPause.enabled && 'opacity-50')}>
            من
            <Select className="h-9 w-24" value={form.nightPause.from} disabled={!form.nightPause.enabled} onChange={(e) => setForm({ ...form, nightPause: { ...form.nightPause, from: Number(e.target.value) } })} aria-label="من الساعة">
              {HOURS.map((h) => <option key={h} value={h}>{fmtHour(h)}</option>)}
            </Select>
            إلى
            <Select className="h-9 w-24" value={form.nightPause.to} disabled={!form.nightPause.enabled} onChange={(e) => setForm({ ...form, nightPause: { ...form.nightPause, to: Number(e.target.value) } })} aria-label="إلى الساعة">
              {HOURS.map((h) => <option key={h} value={h}>{fmtHour(h)}</option>)}
            </Select>
          </div>
          <p className="text-xs text-muted">
            لا تضيع أي طلبية: شيتات Google تحتفظ بالطلبيات وترسلها صباحاً، وطلبيات Facebook وحالات الطرود تُجلب كلها عند انتهاء الإيقاف. المنصة نفسها تبقى مفتوحة؛ من يعمل في الليل يستطيع ذلك (لكن قاعدة البيانات تستيقظ).
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title="التعليقات السريعة" />
        <div className="p-4"><TagInput value={form.quickComments} onChange={(quickComments) => setForm({ ...form, quickComments })} placeholder="أضف تعليقاً ثم Enter" /></div>
      </Card>
      <Card>
        <CardHeader title="أسباب الإلغاء" />
        <div className="p-4"><TagInput value={form.cancelReasons} onChange={(cancelReasons) => setForm({ ...form, cancelReasons })} placeholder="أضف سبباً ثم Enter" /></div>
      </Card>
      <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(form)}>حفظ الإعدادات</Button>
    </div>
  );
}
