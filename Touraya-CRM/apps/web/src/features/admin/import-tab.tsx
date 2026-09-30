import { useState } from 'react';
import Papa from 'papaparse';
import { useQueryClient } from '@tanstack/react-query';
import { FileUp, Info } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { errorMessage, qk, useSources } from '@/lib/queries';
import { Alert, Button, Card, Field, Input, Select } from '@/components/ui';

interface Summary { received: number; created: number; duplicates: number; skipped: number; errors: { row: number; message: string }[] }

const CHUNK = 200;

/** Legacy import: CSV downloaded from the sheet (File → Download → CSV), same pipeline and dedup as live sync. */
export function ImportTab() {
  const { data: sources } = useSources();
  const qc = useQueryClient();
  const [sourceId, setSourceId] = useState<number | ''>('');
  const [sheetName, setSheetName] = useState('Sheet2');
  const [from, setFrom] = useState('2026-09-27');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<Summary | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    if (!file || !sourceId) return;
    setRunning(true);
    try {
      const text = await file.text();
      const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
      const rows = parsed.data.map((values, i) => ({ rowNumber: i + 2, values }));
      const total: Summary = { received: 0, created: 0, duplicates: 0, skipped: 0, errors: [] };
      for (let i = 0; i < rows.length; i += CHUNK) {
        const r = await api.post<Summary>(`/sources/${sourceId}/import`, { sheetName, importFrom: from, rows: rows.slice(i, i + CHUNK) });
        total.received += r.received;
        total.created += r.created;
        total.duplicates += r.duplicates;
        total.skipped += r.skipped;
        total.errors.push(...r.errors);
        setProgress({ ...total });
      }
      qc.invalidateQueries({ queryKey: qk.orders });
      toast.success(`تم الاستيراد: ${total.created} طلبية جديدة`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <Alert tone="primary" icon={<Info className="mt-0.5 size-4 shrink-0" />}>
        حمّل الورقة من Google Sheets بصيغة CSV (File ← Download ← CSV) ثم ارفعها هنا. الطلبيات الموجودة مسبقاً (نفس Lead ID) لا تُكرر.
        يمكن أيضاً تشغيل <code className="ltr rounded bg-surface px-1">resendAllTouraya</code> من Apps Script لإعادة إرسال كل الملف.
      </Alert>
      <Card className="grid gap-4 p-4 sm:grid-cols-2">
        <Field label="المصدر" className="sm:col-span-2">
          {(id) => (
            <Select id={id} value={sourceId} onChange={(e) => setSourceId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">— اختر —</option>
              {sources?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="اسم الورقة (للسجل)">{(id) => <Input id={id} value={sheetName} onChange={(e) => setSheetName(e.target.value)} />}</Field>
        <Field label="تاريخ البداية">{(id) => <Input id={id} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
        <Field label="ملف CSV" className="sm:col-span-2">
          {(id) => <Input id={id} type="file" accept=".csv,text/csv" className="h-auto py-1.5" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}
        </Field>
        <div className="sm:col-span-2">
          <Button variant="primary" icon={<FileUp className="size-4" />} disabled={!file || !sourceId} loading={running} onClick={run}>استيراد</Button>
        </div>
      </Card>
      {progress && (
        <Card className="p-4 text-sm">
          <p>أسطر مقروءة: <b>{progress.received}</b> · جديدة: <b className="text-ok">{progress.created}</b> · مكررة: <b>{progress.duplicates}</b> · متجاهلة (قبل التاريخ/فارغة): <b>{progress.skipped}</b></p>
          {progress.errors.length > 0 && (
            <ul className="mt-2 max-h-40 overflow-y-auto text-xs text-danger scroll-thin">
              {progress.errors.map((e, i) => <li key={i}>سطر {e.row}: {e.message}</li>)}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
