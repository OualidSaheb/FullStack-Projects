import {
  Ban, BadgeCheck, Clock, Package, PackageCheck, PhoneMissed, PhoneOff, Send, Sparkles, Truck, Undo2, type LucideIcon,
} from 'lucide-react';
import { STATUS_META, type OrderStatus } from '@touraya/shared';
import { cn } from '@/lib/cn';

const ICONS: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  'phone-missed': PhoneMissed,
  'phone-off': PhoneOff,
  clock: Clock,
  'badge-check': BadgeCheck,
  package: Package,
  send: Send,
  truck: Truck,
  'package-check': PackageCheck,
  'undo-2': Undo2,
  ban: Ban,
};

export function StatusIcon({ status, className }: { status: OrderStatus; className?: string }) {
  const Icon = ICONS[STATUS_META[status].icon] ?? Sparkles;
  return <Icon className={cn('size-3.5 shrink-0', className)} />;
}

/** Status chip: hue + icon + label, so the status never relies on color alone. */
export function StatusBadge({ status, short, active, className }: { status: OrderStatus; short?: boolean; active?: boolean; className?: string }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn('status-chip inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap', className)}
      style={{ '--s': meta.color } as React.CSSProperties}
      data-active={active}
    >
      <StatusIcon status={status} />
      {short ? meta.short : meta.label}
    </span>
  );
}

export function StatusDot({ status }: { status: OrderStatus }) {
  return <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: STATUS_META[status].color }} />;
}
