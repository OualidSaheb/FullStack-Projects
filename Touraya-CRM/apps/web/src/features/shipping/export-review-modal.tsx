import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Download, Send } from 'lucide-react';
import { toast } from 'sonner';
import type { OrderStatus } from '@touraya/shared';
import { api, ApiError, download } from '@/lib/api';
import { errorMessage, qk, useSettings } from '@/lib/queries';
import { cn } from '@/lib/cn';
import { StatusBadge } from '@/components/status';
import { Alert, Button, Modal, PageLoader } from '@/components/ui';

interface Preview {
  headers: string[];
  rows: { id: string; reference: string; status: OrderStatus; cells: (string | number)[]; errors: string[] }[];
}

/**
 * Review step before anything is sent: the exact rows of the carrier file,
 * with blocking problems highlighted. Only valid, confirmed orders go out.
 */
export function ExportReviewModal({ ids, onClose, onOpenOrder }: { ids: string[]; onClose: () => void; onOpenOrder?: (id: string) => void }) {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const { data, isLoading } = useQuery({
    queryKey: ['shipping-preview', ids],
    queryFn: () => api.post<Preview>('/shipping/preview', { ids }),
    enabled: ids.length > 0,
  });
  const valid = data?.rows.filter((r) => !r.errors.length) ?? [];
  const invalid = data?.rows.filter((r) => r.errors.length) ?? [];

  const done = () => {
    qc.invalidateQueries({ queryKey: qk.orders });
    qc.invalidateQueries({ queryKey: qk.batches });
    onClose();
  };

  const exportFile = useMutation({
    mutationFn: () => api.post<{ id: number; fileName: string }>('/shipping/exports', { ids: valid.map((r) => r.id) }),
    onSuccess: (batch) => {
      download(`/shipping/exports/${batch.id}/file`);
      toast.success(`تم تجهيز ${valid.length} طلبية لشركة التوصيل`);
      done();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const sendApi = useMutation({
    mutationFn: () => api.post<{ results: { ok: boolean; reference: string; message?: string }[] }>('/shipping/yalidine/send', { ids: valid.map((r) => r.id) }),
    onSuccess: ({ results }) => {
      const ok = results.filter((r) => r.ok).length;
      if (ok) toast.success(`تم إرسال ${ok} طلبية إلى Yalidine`);
      results.filter((r) => !r.ok).forEach((r) => toast.error(`${r.reference}: ${r.message}`));
      done();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : errorMessage(e), { duration: 12_000 }),
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title="مراجعة ملف شركة التوصيل"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          {settings?.yalidine.enabled && (
            <Button icon={<Send className="size-4" />} disabled={!valid.length} loading={sendApi.isPending} onClick={() => sendApi.mutate()}>
              إرسال عبر API
            </Button>
          )}
          <Button variant="primary" icon={<Download className="size-4" />} disabled={!valid.length} loading={exportFile.isPending} onClick={() => exportFile.mutate()}>
            تحميل الملف وتجهيز {valid.length} طلبية
          </Button>
        </>
      }
    >
      {isLoading || !data ? (
        <PageLoader />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Alert tone="ok" icon={<CheckCircle2 className="mt-0.5 size-4 shrink-0" />}>
              <b>{valid.length}</b> طلبية جاهزة — ستتغير حالتها إلى «تم تجهيزها لشركة التوصيل» بعد التحميل.
            </Alert>
            {invalid.length > 0 && (
              <Alert tone="danger" icon={<AlertTriangle className="mt-0.5 size-4 shrink-0" />}>
                <b>{invalid.length}</b> طلبية لن تدخل الملف حتى يتم تصحيحها.
              </Alert>
            )}
          </div>

          {invalid.length > 0 && (
            <ul className="divide-y divide-line rounded-lg border border-danger/30">
              {invalid.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                  <button className="ltr font-semibold text-primary hover:underline" onClick={() => onOpenOrder?.(r.id)}>{r.reference}</button>
                  <StatusBadge status={r.status} short />
                  <span className="text-danger">{r.errors.join(' · ')}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="overflow-x-auto rounded-lg border border-line scroll-thin" dir="ltr">
            <table className="w-full text-xs">
              <thead className="bg-subtle">
                <tr>
                  {data.headers.map((h, i) => (
                    <th key={i} className="border-b border-line px-2 py-2 text-start font-semibold whitespace-nowrap text-muted" title={h}>
                      {h.split('\n')[0]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className={cn(r.errors.length && 'bg-danger/6 text-faint line-through decoration-danger/40')}>
                    {r.cells.map((c, i) => (
                      <td key={i} className="border-b border-line px-2 py-1.5 whitespace-nowrap">{String(c)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
