import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, Copy, ExternalLink, FolderOpen, KeyRound, Settings, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtDateTime, timeAgo } from '@/lib/format';
import { qk, useAdminMutation, useSources, type SourceWithStats } from '@/lib/queries';
import { isSourceStale } from '@/components/sync-alert';
import { Alert, Badge, Button, Card, CardHeader, Modal, PageLoader, Switch } from '@/components/ui';
import { FacebookCard } from './facebook-card';
import { FormsPanel } from './forms-panel';
import { SourcesTab } from './sources-tab';

const code = (text: string) => <code className="ltr rounded bg-subtle px-1.5">{text}</code>;

/** The one script, installed once: every spreadsheet put in the Drive folder is read by itself. */
function DriveSetupModal({ source, onClose }: { source: SourceWithStats; onClose: () => void }) {
  const { data: script, isLoading } = useQuery({ queryKey: ['apps-script', source.id], queryFn: () => api.get<string>(`/sources/${source.id}/apps-script`) });
  const rotate = useAdminMutation(qk.sources, () => api.post(`/sources/${source.id}/rotate-token`), 'تم تغيير المفتاح — الصق الكود الجديد');
  const copy = () => script && navigator.clipboard.writeText(script).then(() => toast.success('تم نسخ الكود'));
  const steps = [
    <>افتح <a className="inline-flex items-center gap-1 text-primary hover:underline" href="https://script.google.com/home/projects/create" target="_blank" rel="noreferrer">script.google.com ← New project <ExternalLink className="size-3" /></a> بنفس حساب Google الذي فيه الشيتات</>,
    <>الصق الكود المنسوخ مكان الكود الموجود واحفظ (Ctrl+S)</>,
    <>اختر الدالة {code('setupTouraya')} واضغط <b>Run</b> ثم وافق على الصلاحيات — ينشئ المجلد «{source.folderName}» في Drive إن لم يكن موجوداً</>,
    <>ضع شيتات Facebook في هذا المجلد (اسحبها إليه في Drive). كل الأوراق تُقرأ، وكل شيت جديد تضيفه لاحقاً يُقرأ وحده</>,
    <>للتأكد: شغّل {code('testTouraya')} ← تظهر طلبية «TEST Touraya» (احذفها بعد ذلك)</>,
    <>إذا كانت الشيتات مربوطة سابقاً بسكريبت خاص بها، احذفه منها بعد أن تتأكد أن هذا يعمل (لا خطر من التكرار)</>,
  ];
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="ربط مجلد Google Drive — مرة واحدة فقط"
      footer={<><Button variant="ghost" icon={<KeyRound className="size-4" />} loading={rotate.isPending} onClick={() => confirm('تغيير المفتاح يوقف الكود الحالي حتى تلصق الجديد. متابعة؟') && rotate.mutate(undefined)}>تغيير المفتاح</Button><Button variant="primary" icon={<Copy className="size-4" />} onClick={copy}>نسخ الكود</Button></>}
    >
      <ol className="mb-4 space-y-2 text-sm">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary">{i + 1}</span>
            <span className="pt-0.5">{s}</span>
          </li>
        ))}
      </ol>
      <Alert tone="primary" icon={<CheckCircle2 className="mt-0.5 size-4 shrink-0" />}>
        نصيحة: سمِّ كل فورم في Facebook باسم العرض ثم ما تريد بعده، مثلاً {code('skirt 2pcs 3600 - test A')}، فيُربط بالعرض تلقائياً بدون أي ضغطة.
      </Alert>
      <div className="mt-3"><Alert tone="warn" icon={<TriangleAlert className="mt-0.5 size-4 shrink-0" />}>الكود يحتوي مفتاحاً سرياً. لا تشاركه.</Alert></div>
      {isLoading ? <PageLoader /> : <pre className="mt-4 max-h-72 overflow-auto rounded-lg bg-ink p-4 text-xs leading-relaxed text-slate-200 scroll-thin" dir="ltr">{script}</pre>}
    </Modal>
  );
}

function DriveCard({ source }: { source: SourceWithStats }) {
  const [setup, setSetup] = useState(false);
  const connected = Boolean(source.lastSyncAt);
  const stale = connected && isSourceStale(source);
  // Pause (e.g. to test Facebook alone): the script keeps its rows and re-sends them when switched back on.
  const pause = useAdminMutation(qk.sources, (active: boolean) => api.put(`/sources/${source.id}`, { ...source, active }), 'تم الحفظ');
  return (
    <Card>
      <CardHeader
        title={<>مجلد Google Drive «{source.folderName}»</>}
        icon={<FolderOpen className="size-4 text-primary" />}
        action={
          <div className="flex items-center gap-3">
            {connected && <Switch checked={source.active} onChange={(on) => pause.mutate(on)} label={source.active ? 'يستقبل' : 'متوقف مؤقتاً'} />}
            <Button size="sm" variant={connected ? 'secondary' : 'primary'} icon={<Settings className="size-3.5" />} onClick={() => setSetup(true)}>{connected ? 'الكود والخطوات' : 'إعداد (مرة واحدة)'}</Button>
          </div>
        }
      />
      <div className="space-y-3 p-4 text-sm">
        {!source.active && (
          <Alert tone="warn" icon={<TriangleAlert className="mt-0.5 size-4 shrink-0" />}>
            متوقف مؤقتاً: المنصة لا تقبل طلبيات هذا المجلد. لا يضيع شيء — السكريبت يحتفظ بالأسطر ويرسلها كلها عند إعادة التشغيل (بدون تكرار).
          </Alert>
        )}
        {!connected ? (
          <p className="text-muted">سكريبت واحد يقرأ كل الشيتات الموجودة في هذا المجلد. بعد إعداده، كل إعلان جديد = تضع الشيت في المجلد فقط.</p>
        ) : (
          <p className={cn('flex items-center gap-1.5', stale ? 'text-warn' : 'text-ok')} title={fmtDateTime(source.lastSyncAt!)}>
            {stale ? <TriangleAlert className="size-4" /> : <CheckCircle2 className="size-4" />}
            آخر اتصال {timeAgo(source.lastSyncAt!)}
            {source.lastSyncStats && <span className="text-muted">· آخر دفعة {source.lastSyncStats.created} جديدة</span>}
          </p>
        )}
        {source.files.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {source.files.map((f) => (
              <li key={f.spreadsheetId}>
                <a href={`https://docs.google.com/spreadsheets/d/${f.spreadsheetId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs hover:border-primary">
                  {f.name}
                  <Badge>{f.tabs.reduce((n, t) => n + t.rows, 0)} سطر</Badge>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      {setup && <DriveSetupModal source={source} onClose={() => setSetup(false)} />}
    </Card>
  );
}

/**
 * Where orders come from, in one place: the Drive folder (one script for all
 * sheets), the Facebook forms found in it (linked to offers, compared), and
 * the older per-sheet / webhook connections.
 */
export function ReceivingTab() {
  const { data: sources, isLoading } = useSources();
  const [others, setOthers] = useState(true);
  if (isLoading) return <PageLoader />;
  const drive = sources?.find((s) => s.type === 'google_drive');
  const legacy = sources?.filter((s) => s.type !== 'google_drive' && s.type !== 'facebook') ?? [];
  return (
    <div className="space-y-5">
      <FacebookCard />
      {drive && <DriveCard source={drive} />}
      <section className="space-y-2">
        <h2 className="text-base font-semibold">الفورمات</h2>
        <FormsPanel />
      </section>
      {legacy.length > 0 && (
        <section>
          <button className="flex items-center gap-2 text-sm font-semibold text-muted hover:text-fg" onClick={() => setOthers(!others)}>
            <ChevronDown className={cn('size-4 transition', others && 'rotate-180')} />
            مصادر أخرى ({legacy.length}) — شيت بسكريبت خاص، Webhook
          </button>
          {others && <div className="mt-3"><SourcesTab hideDrive /></div>}
        </section>
      )}
    </div>
  );
}
