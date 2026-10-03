import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, ExternalLink, Facebook, RefreshCw, TriangleAlert, Unplug } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { fmtDateTime, timeAgo } from '@/lib/format';
import { errorMessage, qk } from '@/lib/queries';
import { Alert, Button, Card, CardHeader, Field, Input, Select } from '@/components/ui';

interface MetaStatus {
  webhookUrl: string;
  connected: boolean;
  appId: string | null;
  pageName: string | null;
  connectedAt: string | null;
  lastPollAt: string | null;
  lastError: string | null;
  lastSyncAt: string | null;
}

/**
 * Facebook Lead Ads connected directly: paste the app and system-user token
 * once, pick the page; new leads arrive within seconds (and a pull every 10
 * minutes catches any missed one). The Drive folder can stay as a backup.
 */
export function FacebookCard() {
  const qc = useQueryClient();
  const { data: status } = useQuery({ queryKey: ['meta'], queryFn: () => api.get<MetaStatus>('/meta') });
  const [editing, setEditing] = useState(false);
  const [creds, setCreds] = useState({ appId: '', appSecret: '', token: '' });
  const [pages, setPages] = useState<{ id: string; name: string }[] | null>(null);
  const [pageId, setPageId] = useState('');
  const [busy, setBusy] = useState<'pages' | 'connect' | 'pull' | 'off' | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['meta'] });
    qc.invalidateQueries({ queryKey: qk.sources });
    qc.invalidateQueries({ queryKey: qk.forms });
    qc.invalidateQueries({ queryKey: qk.orders });
  };
  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  const showForm = editing || (status && !status.connected);
  const privacyUrl = status ? status.webhookUrl.replace(/\/api\/meta\/webhook$/, '/privacy') : '';

  return (
    <Card>
      <CardHeader
        title="Facebook — ربط مباشر"
        icon={<Facebook className="size-4 text-primary" />}
        action={
          status?.connected && !editing ? (
            <div className="flex gap-1">
              <Button size="sm" icon={<RefreshCw className="size-3.5" />} loading={busy === 'pull'} onClick={() => run('pull', async () => {
                const r = await api.post<{ created: number }>('/meta/pull');
                toast.success(r.created ? `وصلت ${r.created} طلبية جديدة` : 'لا توجد طلبيات جديدة');
                refresh();
              })}>سحب الآن</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>تغيير</Button>
              <Button size="sm" variant="ghost" icon={<Unplug className="size-3.5" />} loading={busy === 'off'} onClick={() => confirm('فصل Facebook؟ الطلبيات تبقى تصل من الشيتات إن كانت مربوطة.') && run('off', async () => { await api.delete('/meta'); refresh(); })} aria-label="فصل" />
            </div>
          ) : undefined
        }
      />
      <div className="space-y-3 p-4 text-sm">
        {status?.connected && !editing && (
          <>
            <p className="flex items-center gap-1.5 text-ok">
              <CheckCircle2 className="size-4" /> متصل بالصفحة <b>{status.pageName}</b>
              {status.lastSyncAt && <span className="text-muted" title={fmtDateTime(status.lastSyncAt)}>· آخر نشاط {timeAgo(status.lastSyncAt)}</span>}
            </p>
            <p className="text-xs text-muted">الطلبيات تصل خلال ثوانٍ، وتُراجع كل الفورمات كل 10 دقائق احتياطاً. كل إجابات الأسئلة متعددة الاختيار تصل كاملة.</p>
          </>
        )}
        {status?.lastError && (
          <Alert tone="warn" icon={<TriangleAlert className="mt-0.5 size-4 shrink-0" />}>{status.lastError}</Alert>
        )}
        {showForm && (
          <div className="space-y-3">
            <p className="text-muted">
              تحتاج تطبيقاً في Meta for Developers و Token من System User (الخطوات في الدليل). عنوان سياسة الخصوصية للتطبيق:{' '}
              <button className="ltr inline-flex items-center gap-1 text-primary hover:underline" onClick={() => navigator.clipboard.writeText(privacyUrl).then(() => toast.success('تم النسخ'))}>
                {privacyUrl} <Copy className="size-3" />
              </button>{' '}
              <a className="inline-flex items-center gap-1 text-primary hover:underline" href={privacyUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-3" /></a>
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="App ID">{(id) => <Input id={id} dir="ltr" inputMode="numeric" value={creds.appId} onChange={(e) => setCreds({ ...creds, appId: e.target.value })} />}</Field>
              <Field label="App Secret">{(id) => <Input id={id} dir="ltr" type="password" autoComplete="off" value={creds.appSecret} onChange={(e) => setCreds({ ...creds, appSecret: e.target.value })} />}</Field>
              <Field label="Token الـ System User" className="sm:col-span-2">{(id) => <Input id={id} dir="ltr" type="password" autoComplete="off" value={creds.token} onChange={(e) => setCreds({ ...creds, token: e.target.value })} />}</Field>
            </div>
            {!pages ? (
              <Button variant="primary" loading={busy === 'pages'} disabled={!creds.appId || !creds.appSecret || !creds.token} onClick={() => run('pages', async () => {
                const list = await api.post<{ id: string; name: string }[]>('/meta/pages', creds);
                if (!list.length) throw new Error('هذا الـ Token لا يملك أي صفحة — أضف الصفحة للـ System User');
                setPages(list);
                setPageId(list[0]!.id);
              })}>التحقق وعرض الصفحات</Button>
            ) : (
              <div className="flex flex-wrap items-end gap-2">
                <Field label="الصفحة" className="min-w-56 flex-1">
                  {(id) => <Select id={id} value={pageId} onChange={(e) => setPageId(e.target.value)}>{pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}
                </Field>
                <Button variant="primary" loading={busy === 'connect'} onClick={() => run('connect', async () => {
                  const r = await api.post<{ pageName: string; created: number }>('/meta/connect', { ...creds, pageId });
                  toast.success(`تم الربط بـ ${r.pageName}${r.created ? ` — وصلت ${r.created} طلبية` : ''}`);
                  setEditing(false);
                  setPages(null);
                  setCreds({ appId: '', appSecret: '', token: '' });
                  refresh();
                })}>ربط الصفحة</Button>
              </div>
            )}
            {editing && <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setPages(null); }}>إلغاء</Button>}
          </div>
        )}
      </div>
    </Card>
  );
}
