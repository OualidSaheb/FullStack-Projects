import { Link } from 'react-router';
import { TriangleAlert } from 'lucide-react';
import type { SourceDTO } from '@touraya/shared';
import { useCan } from '@/lib/auth';
import { timeAgo } from '@/lib/format';
import { useSources } from '@/lib/queries';

/** The script pings at least every 30 minutes; one hour of silence means the sheet stopped syncing. */
export function isSourceStale(s: Pick<SourceDTO, 'lastSyncAt'>, now = Date.now()) {
  return !s.lastSyncAt || now - new Date(s.lastSyncAt).getTime() > 60 * 60_000;
}

/** Banner for admins: a Google Sheet that stops syncing means orders silently stop arriving. */
export function SyncAlert() {
  const can = useCan();
  const { data } = useSources();
  if (!can('sources.manage')) return null;
  // Sources that were connected once and then went silent (never-connected ones are shown in Admin → Sources).
  const silent = (data ?? []).filter((s) => s.active && s.type === 'google_sheet' && s.lastSyncAt && isSourceStale(s));
  if (!silent.length) return null;
  return (
    <div className="mb-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/8 px-4 py-3 text-sm text-danger">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <div>
        <b>توقف استقبال الطلبيات من:</b> {silent.map((s) => `${s.name} (آخر اتصال ${timeAgo(s.lastSyncAt!)})`).join('، ')}.{' '}
        افتح Apps Script في الشيت وتحقق من Executions، أو أعد تشغيل setupTouraya.{' '}
        <Link to="/admin/sources" className="font-semibold underline">المصادر</Link>
      </div>
    </div>
  );
}
