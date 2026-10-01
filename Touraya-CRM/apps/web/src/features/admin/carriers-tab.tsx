import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Activity, Pencil, Plus, Trash2, Truck } from 'lucide-react';
import { CARRIER_PROVIDERS, defaultCarrierConfig, WILAYAS, type CarrierDTO, type CarrierInput, type CarrierProvider, type CarrierRateDTO } from '@touraya/shared';
import { api } from '@/lib/api';
import { qk, useAdminMutation, useCarriers, useRates } from '@/lib/queries';
import { cn } from '@/lib/cn';
import { Alert, Badge, Button, Card, Field, IconButton, Input, Modal, PageLoader, Select, Switch } from '@/components/ui';
import { ExportColumnsEditor } from './export-columns-editor';

type Primitive = string | number | boolean;

/** Extra fields sent with every API parcel (e.g. can_open=false). */
function ParcelDefaultsEditor({ value, onChange }: { value: Record<string, Primitive>; onChange: (v: Record<string, Primitive>) => void }) {
  const entries = Object.entries(value);
  const parse = (raw: string): Primitive => (raw === 'true' ? true : raw === 'false' ? false : raw.trim() !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw);
  const update = (i: number, key: string, raw: string) => onChange(Object.fromEntries(entries.map(([k, v], j) => (j === i ? [key, parse(raw)] : [k, v]))));
  return (
    <div className="space-y-2">
      {entries.map(([k, v], i) => (
        <div key={i} className="flex gap-2">
          <Input dir="ltr" value={k} onChange={(e) => update(i, e.target.value, String(v))} aria-label="الحقل" />
          <Input dir="ltr" value={String(v)} onChange={(e) => update(i, k, e.target.value)} aria-label="القيمة" />
          <IconButton label="حذف" icon={<Trash2 className="size-3.5" />} onClick={() => onChange(Object.fromEntries(entries.filter((_, j) => j !== i)))} />
        </div>
      ))}
      <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => onChange({ ...value, [`field_${entries.length + 1}`]: '' })}>حقل</Button>
    </div>
  );
}

/** Delivery price per wilaya: shown to the agent as "price + delivery = total". */
function RatesEditor({ carrierId }: { carrierId: number }) {
  const { data } = useRates(carrierId);
  const [rates, setRates] = useState<Record<number, CarrierRateDTO>>({});
  const [bulk, setBulk] = useState({ home: '', desk: '' });
  const save = useAdminMutation(qk.rates(carrierId), (v: CarrierRateDTO[]) => api.put(`/carriers/${carrierId}/rates`, v), 'تم حفظ أسعار التوصيل');
  useEffect(() => setRates(Object.fromEntries((data ?? []).map((r) => [r.wilayaCode, r]))), [data]);
  const get = (code: number) => rates[code] ?? { wilayaCode: code, homeFee: null, deskFee: null };
  const set = (code: number, patch: Partial<CarrierRateDTO>) => setRates((r) => ({ ...r, [code]: { ...get(code), ...patch } }));
  const num = (v: string) => (v === '' ? null : Number(v));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 rounded-lg bg-subtle p-3">
        <Field label="المنزل للكل">{(id) => <Input id={id} className="w-28" type="number" value={bulk.home} onChange={(e) => setBulk({ ...bulk, home: e.target.value })} />}</Field>
        <Field label="المكتب للكل">{(id) => <Input id={id} className="w-28" type="number" value={bulk.desk} onChange={(e) => setBulk({ ...bulk, desk: e.target.value })} />}</Field>
        <Button onClick={() => setRates(Object.fromEntries(WILAYAS.map((w) => [w.code, { wilayaCode: w.code, homeFee: num(bulk.home), deskFee: num(bulk.desk) }])))}>تطبيق على كل الولايات</Button>
      </div>
      <div className="max-h-80 overflow-y-auto rounded-lg border border-line scroll-thin">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-subtle text-xs text-muted">
            <tr><th className="px-3 py-2 text-start">الولاية</th><th className="px-3 py-2 text-start">المنزل</th><th className="px-3 py-2 text-start">المكتب</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {WILAYAS.map((w) => (
              <tr key={w.code}>
                <td className="px-3 py-1">{String(w.code).padStart(2, '0')} {w.nameAr}</td>
                <td className="px-3 py-1"><Input className="h-8 w-24" type="number" value={get(w.code).homeFee ?? ''} onChange={(e) => set(w.code, { homeFee: num(e.target.value) })} /></td>
                <td className="px-3 py-1"><Input className="h-8 w-24" type="number" value={get(w.code).deskFee ?? ''} onChange={(e) => set(w.code, { deskFee: num(e.target.value) })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(Object.values(rates))}>حفظ الأسعار</Button>
    </div>
  );
}

const TABS = [
  ['general', 'عام و API'],
  ['file', 'ملف Excel'],
  ['rates', 'أسعار التوصيل'],
] as const;

function CarrierForm({ carrier, onClose }: { carrier: CarrierDTO | null; onClose: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('general');
  const [form, setForm] = useState<CarrierInput>(() =>
    carrier
      ? { name: carrier.name, provider: carrier.provider, active: carrier.active, isDefault: carrier.isDefault, apiEnabled: carrier.apiEnabled, credentials: { apiId: carrier.credentials.apiId, apiToken: '' }, config: carrier.config }
      : { name: 'Yalidine', provider: 'yalidine', active: true, isDefault: false, apiEnabled: false, credentials: { apiId: '', apiToken: '' }, config: defaultCarrierConfig('yalidine') },
  );
  const save = useAdminMutation(qk.carriers, (v: CarrierInput) => (carrier ? api.put(`/carriers/${carrier.id}`, v) : api.post('/carriers', v)));
  const test = useMutation({ mutationFn: () => api.post<{ ok: boolean; message?: string; cfRay?: string }>(`/carriers/${carrier!.id}/test`) });
  const set = <K extends keyof CarrierInput>(k: K, v: CarrierInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setConfig = (patch: Partial<CarrierInput['config']>) => setForm((f) => ({ ...f, config: { ...f.config, ...patch } }));
  const meta = CARRIER_PROVIDERS[form.provider];

  return (
    <Modal open onClose={onClose} size="lg" title={carrier ? carrier.name : 'شركة توصيل جديدة'} footer={<><Button variant="ghost" onClick={onClose}>إغلاق</Button>{tab !== 'rates' && <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(form)}>حفظ</Button>}</>}>
      <div className="mb-4 flex gap-1 border-b border-line">
        {TABS.filter(([k]) => k !== 'rates' || carrier).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-medium', tab === k ? 'border-primary text-primary' : 'border-transparent text-muted')}>{label}</button>
        ))}
      </div>

      {tab === 'general' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="الاسم">{(id) => <Input id={id} value={form.name} onChange={(e) => set('name', e.target.value)} />}</Field>
          <Field label="النوع">
            {(id) => (
              <Select id={id} value={form.provider} onChange={(e) => { const p = e.target.value as CarrierProvider; setForm((f) => ({ ...f, provider: p, config: { ...defaultCarrierConfig(p), exportColumns: f.config.exportColumns } })); }}>
                {(Object.keys(CARRIER_PROVIDERS) as CarrierProvider[]).map((p) => <option key={p} value={p}>{CARRIER_PROVIDERS[p].label}</option>)}
              </Select>
            )}
          </Field>
          <Switch checked={form.active} onChange={(v) => set('active', v)} label="مفعلة" />
          <Switch checked={form.isDefault} onChange={(v) => set('isDefault', v)} label="الشركة الافتراضية" />
          {meta.api && (
            <>
              <div className="sm:col-span-2"><Switch checked={form.apiEnabled} onChange={(v) => set('apiEnabled', v)} label="الإرسال المباشر عبر API" /></div>
              <Field label="API ID">{(id) => <Input id={id} dir="ltr" value={form.credentials.apiId} onChange={(e) => set('credentials', { ...form.credentials, apiId: e.target.value })} />}</Field>
              <Field label="API TOKEN" hint={carrier?.hasCredentials ? 'محفوظ ومشفر — اتركه فارغاً للإبقاء عليه' : undefined}>
                {(id) => <Input id={id} dir="ltr" type="password" autoComplete="off" value={form.credentials.apiToken} onChange={(e) => set('credentials', { ...form.credentials, apiToken: e.target.value })} />}
              </Field>
              <Field label="رابط API" hint="ضع رابط Relay بعنوان IP ثابت إذا كان IP المنصة محجوباً" className="sm:col-span-2">
                {(id) => <Input id={id} dir="ltr" value={form.config.apiBaseUrl} onChange={(e) => setConfig({ apiBaseUrl: e.target.value })} />}
              </Field>
              <Field label="ولاية الانطلاق">{(id) => <Input id={id} dir="ltr" value={form.config.fromWilayaName} onChange={(e) => setConfig({ fromWilayaName: e.target.value })} />}</Field>
              <Field label="Webhook secret (اختياري)">{(id) => <Input id={id} dir="ltr" value={form.config.webhookSecret} onChange={(e) => setConfig({ webhookSecret: e.target.value })} />}</Field>
              <Field label="حقول إضافية تُرسل مع كل طرد" hint="مثلاً can_open = false (لا يسمح بفتح الطرد). يمكن تعديلها أو حذفها إذا رفضتها الشركة." className="sm:col-span-2">
                {() => <ParcelDefaultsEditor value={form.config.parcelDefaults} onChange={(parcelDefaults) => setConfig({ parcelDefaults })} />}
              </Field>
              {carrier && (
                <div className="space-y-2 sm:col-span-2">
                  <Field label="رابط Webhook (ضعه في لوحة الشركة، الحدث parcel_status_updated)">
                    {(id) => <Input id={id} readOnly dir="ltr" value={`${window.location.origin}/api/webhooks/carriers/${carrier.id}`} onFocus={(e) => e.target.select()} />}
                  </Field>
                  <Button icon={<Activity className="size-4" />} loading={test.isPending} onClick={() => test.mutate()}>اختبار الاتصال</Button>
                  {test.data && (
                    <Alert tone={test.data.ok ? 'ok' : 'danger'}>
                      {test.data.ok ? 'الاتصال ناجح ✓' : test.data.message}
                      {test.data.cfRay && <span className="ltr block text-xs opacity-80">Cloudflare ray: {test.data.cfRay}</span>}
                    </Alert>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'file' && (
        <div className="space-y-3">
          <Field label="الصيغة" className="w-40">
            {(id) => (
              <Select id={id} value={form.config.exportFormat} onChange={(e) => setConfig({ exportFormat: e.target.value as 'xlsx' | 'csv' })}>
                <option value="xlsx">Excel (xlsx)</option>
                <option value="csv">CSV</option>
              </Select>
            )}
          </Field>
          <ExportColumnsEditor value={form.config.exportColumns} onChange={(exportColumns) => setConfig({ exportColumns })} />
        </div>
      )}

      {tab === 'rates' && carrier && <RatesEditor carrierId={carrier.id} />}
    </Modal>
  );
}

export function CarriersTab() {
  const { data: carriers, isLoading } = useCarriers();
  const [editing, setEditing] = useState<CarrierDTO | null | 'new'>(null);
  if (isLoading) return <PageLoader />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">كل شركة لها قالب ملف خاص، أسعار توصيل لكل ولاية، و API إن وجد. يمكن إضافة شركات أخرى في أي وقت.</p>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>شركة توصيل</Button>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {carriers?.map((c) => (
          <Card key={c.id} className="flex items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-lg bg-primary-soft text-primary"><Truck className="size-5" /></div>
              <div>
                <p className="font-semibold">{c.name}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {c.isDefault && <Badge tone="primary">الافتراضية</Badge>}
                  {!c.active && <Badge tone="danger">متوقفة</Badge>}
                  <Badge tone={c.apiEnabled ? 'ok' : 'neutral'}>{c.apiEnabled ? 'API مفعل' : 'ملف Excel'}</Badge>
                </div>
              </div>
            </div>
            <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(c)}>إعدادات</Button>
          </Card>
        ))}
      </div>
      {editing && <CarrierForm carrier={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
