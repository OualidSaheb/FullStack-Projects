import { AlertTriangle, Copy, MapPinOff, PackageX, ShieldAlert, Shirt, UserX } from 'lucide-react';
import { ORDER_FLAGS, RISK_META, type CustomerRiskLevel, type OrderFlag } from '@touraya/shared';
import { Badge } from '@/components/ui';

const FLAG_ICONS: Record<OrderFlag, typeof AlertTriangle> = {
  phone: AlertTriangle,
  commune: MapPinOff,
  duplicate: Copy,
  risky: ShieldAlert,
  blacklisted: UserX,
  variants: Shirt,
  stock: PackageX,
};

const FLAG_TONE: Record<OrderFlag, 'warn' | 'danger'> = {
  phone: 'warn',
  commune: 'warn',
  duplicate: 'warn',
  variants: 'warn',
  risky: 'danger',
  blacklisted: 'danger',
  stock: 'danger',
};

/** Problems that need attention before/while calling. Icon + text, never color alone. */
export function FlagBadges({ flags, compact }: { flags: OrderFlag[]; compact?: boolean }) {
  if (!flags.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {flags.map((f) => {
        const Icon = FLAG_ICONS[f];
        return (
          <Badge key={f} tone={FLAG_TONE[f]} className={compact ? 'px-1' : undefined}>
            <Icon className="size-3" aria-hidden />
            {compact ? <span className="sr-only">{ORDER_FLAGS[f]}</span> : ORDER_FLAGS[f]}
          </Badge>
        );
      })}
    </span>
  );
}

export function RiskBadge({ risk }: { risk: CustomerRiskLevel }) {
  if (risk === 'new') return null;
  const meta = RISK_META[risk];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}
