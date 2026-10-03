import { Link } from 'react-router';
import { Sparkles, TriangleAlert } from 'lucide-react';
import type { SourceDTO } from '@touraya/shared';
import { useCan } from '@/lib/auth';
import { timeAgo } from '@/lib/format';
import { useForms, useSources } from '@/lib/queries';

/** The script reports to the database at least every hour; two hours of silence means the sheet stopped syncing. */
export function isSourceStale(s: Pick<SourceDTO, 'lastSyncAt'>, now = Date.now()) {
  return !s.lastSyncAt || now - new Date(s.lastSyncAt).getTime() > 2 * 60 * 60_000;
}

/**
 * Banners for admins: a connection that stops syncing means orders silently
 * stop arriving; a new Facebook form without an offer means its orders arrive
 * without product, quantity and price.
 */
export function SyncAlert() {
  const can = useCan();
  const allowed = can('sources.manage');
  const { data } = useSources();
  const { data: forms } = useForms();
  if (!allowed) return null;
  // Connections that worked once and then went silent (never-connected ones are shown in the admin page).
  const silent = (data ?? []).filter((s) => s.active && s.type !== 'webhook' && s.lastSyncAt && isSourceStale(s));
  const waiting = (forms ?? []).filter((f) => !f.offerId && f.stats.pending > 0);
  if (!silent.length && !waiting.length) return null;
  return (
    <div className="mb-4 space-y-2">
      {waiting.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-warn/40 bg-warn/8 px-4 py-3 text-sm text-warn">
          <Sparkles className="mt-0.5 size-4 shrink-0" />
          <div>
            <b>فورم جديد بدون عرض:</b> {waiting.map((f) => `${f.name} (${f.stats.pending})`).join('، ')}.{' '}
            <Link to="/admin/sources" className="font-semibold underline">اربطه بعرض</Link>
          </div>
        </div>
      )}
      {silent.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/8 px-4 py-3 text-sm text-danger">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <div>
            <b>لم يتصل منذ أكثر من ساعتين:</b> {silent.map((s) => `${s.name} (آخر اتصال ${timeAgo(s.lastSyncAt!)})`).join('، ')}.{' '}
            افتح Apps Script وتحقق من Executions، أو أعد تشغيل setupTouraya.{' '}
            <Link to="/admin/sources" className="font-semibold underline">الاستقبال</Link>
          </div>
        </div>
      )}
    </div>
  );
}
