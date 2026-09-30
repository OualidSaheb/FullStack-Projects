import { ORDER_STATUSES, STATUS_META, type OrderStatus, type StatusCounts } from '@touraya/shared';
import { cn } from '@/lib/cn';
import { StatusIcon } from '@/components/status';

/** Status filter pills with live counts. Multi-select with Ctrl/⌘-click. */
export function StatusTabs({ counts, selected, onChange }: { counts?: StatusCounts; selected: OrderStatus[]; onChange: (s: OrderStatus[]) => void }) {
  const toggle = (status: OrderStatus, multi: boolean) => {
    if (!multi) return onChange(selected.length === 1 && selected[0] === status ? [] : [status]);
    onChange(selected.includes(status) ? selected.filter((s) => s !== status) : [...selected, status]);
  };
  return (
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 scroll-thin" role="tablist">
      <button
        role="tab"
        aria-selected={!selected.length}
        onClick={() => onChange([])}
        className={cn(
          'flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition',
          !selected.length ? 'border-fg bg-fg text-bg' : 'border-line bg-surface text-muted hover:text-fg',
        )}
      >
        الكل
        <span className="ltr opacity-80">{counts?.total ?? '…'}</span>
      </button>
      {ORDER_STATUSES.map((status) => {
        const n = counts?.byStatus[status] ?? 0;
        const active = selected.includes(status);
        if (!n && !active) return null;
        return (
          <button
            key={status}
            role="tab"
            aria-selected={active}
            title="Ctrl + نقرة لاختيار أكثر من حالة"
            onClick={(e) => toggle(status, e.ctrlKey || e.metaKey)}
            className="status-chip flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition hover:brightness-95"
            style={{ '--s': STATUS_META[status].color } as React.CSSProperties}
            data-active={active}
          >
            <StatusIcon status={status} />
            {STATUS_META[status].short}
            <span className="ltr font-semibold">{n}</span>
          </button>
        );
      })}
    </div>
  );
}
