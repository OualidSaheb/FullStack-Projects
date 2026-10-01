import { MapPinOff, MessageSquare } from 'lucide-react';
import type { OrderListItem } from '@touraya/shared';
import { fmtDA, timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';
import { communeLabel, wilayaLabel } from '@/components/geo-select';
import { CallButton } from '@/components/phone';
import { StatusBadge } from '@/components/status';
import { Checkbox } from '@/components/ui';
import { FlagBadges, RiskBadge } from './parts/flags';

/** Phone layout of the orders list: one tappable card per order, call button inside. */
export function OrderCards({ rows, selected, onToggle, onOpen }: { rows: OrderListItem[]; selected: Record<string, boolean>; onToggle: (id: string) => void; onOpen: (id: string) => void }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((o) => (
        <li key={o.id} className={cn('flex gap-3 px-3 py-3 active:bg-subtle', selected[o.id] && 'bg-primary-soft/60')} onClick={() => onOpen(o.id)}>
          <Checkbox className="mt-1" checked={Boolean(selected[o.id])} onChange={() => onToggle(o.id)} onClick={(e) => e.stopPropagation()} aria-label="تحديد" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate font-semibold">{o.customerName || 'بدون اسم'}</p>
              <StatusBadge status={o.status} short />
            </div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <CallButton phone={o.phone} compact />
              <span className="ltr text-xs text-faint">{o.reference} · {timeAgo(o.createdAt)}</span>
            </div>
            <p className="text-sm">
              <span className="font-medium">{o.offerName ?? 'بدون عرض'}</span>
              <span className="ltr mx-1.5 text-muted">{fmtDA(o.price)}</span>
            </p>
            {o.itemsLabel && <p className="text-xs text-muted">{o.itemsLabel}</p>}
            <p className="flex items-center gap-1 text-xs text-muted">
              {wilayaLabel(o.wilayaCode)} ·{' '}
              {o.communeName ? communeLabel(o.communeName, o.wilayaCode) : <span className="inline-flex items-center gap-1 text-warn"><MapPinOff className="size-3" />{o.communeRaw ?? '—'}</span>}
            </p>
            {(o.flags.length > 0 || o.risk !== 'new') && (
              <div className="flex flex-wrap gap-1">
                <RiskBadge risk={o.risk} />
                <FlagBadges flags={o.flags.filter((f) => f !== 'risky' && f !== 'blacklisted')} />
              </div>
            )}
            {o.lastComment && (
              <p className="flex items-center gap-1 truncate text-xs text-faint"><MessageSquare className="size-3 shrink-0" />{o.lastComment}</p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
