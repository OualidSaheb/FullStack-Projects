import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn('rounded-xl border border-line bg-surface', className)}>{children}</section>;
}

export function CardHeader({ title, action, icon }: { title: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </h3>
      {action}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-5 animate-spin text-faint', className)} />;
}

export function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Spinner className="size-7" />
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon && <div className="mb-1 rounded-full bg-subtle p-3 text-faint">{icon}</div>}
      <p className="font-medium">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
    </div>
  );
}

const tones = {
  neutral: 'bg-subtle text-muted',
  primary: 'bg-primary-soft text-primary',
  warn: 'bg-warn/12 text-warn',
  danger: 'bg-danger/10 text-danger',
  ok: 'bg-ok/12 text-ok',
} as const;

export function Badge({ tone = 'neutral', className, children }: { tone?: keyof typeof tones; className?: string; children: ReactNode }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium', tones[tone], className)}>{children}</span>;
}

export function Alert({ tone = 'warn', icon, children }: { tone?: 'warn' | 'danger' | 'primary' | 'ok'; icon?: ReactNode; children: ReactNode }) {
  const styles = {
    warn: 'border-warn/30 bg-warn/8 text-warn',
    danger: 'border-danger/30 bg-danger/8 text-danger',
    primary: 'border-primary/30 bg-primary-soft text-primary',
    ok: 'border-ok/30 bg-ok/8 text-ok',
  }[tone];
  return <div className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-sm', styles)}>{icon}<div className="flex-1">{children}</div></div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
