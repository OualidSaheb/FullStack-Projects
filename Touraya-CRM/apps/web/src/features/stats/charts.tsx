import type { ReactNode } from 'react';
import { fmtNumber } from '@/lib/format';

/** Hero number tile. */
export function StatTile({ label, value, hint, icon }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between text-xs font-medium text-muted">
        {label}
        {icon}
      </div>
      <p className="ltr mt-2 text-end text-2xl font-bold tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </div>
  );
}

/** Ranked horizontal bars; label + value always visible, so color is never the only cue. */
export function BarList({ items, color = 'var(--primary)' }: { items: { key: string | number; label: ReactNode; value: number; color?: string; extra?: ReactNode }[]; color?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <p className="py-6 text-center text-sm text-faint">لا توجد بيانات</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.key} className="group">
          <div className="mb-1 flex items-center justify-between gap-2 text-sm">
            <span className="flex min-w-0 items-center gap-1.5 truncate">{i.label}</span>
            <span className="ltr shrink-0 font-semibold">
              {fmtNumber(i.value)}
              {i.extra}
            </span>
          </div>
          <div className="h-2 rounded-full bg-subtle">
            <div className="h-2 rounded-full transition-all group-hover:brightness-110" style={{ width: `${(i.value / max) * 100}%`, background: i.color ?? color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Daily orders, confirmed part stacked at the base. Hover shows exact values. */
export function DailyColumns({ data }: { data: { day: string; count: number; confirmed: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  if (!data.length) return <p className="py-10 text-center text-sm text-faint">لا توجد بيانات</p>;
  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: 'var(--ok)' }} />مؤكدة</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-primary/35" />باقي الطلبيات</span>
      </div>
      <div className="flex h-48 items-end justify-center gap-[2px] border-b border-line" dir="ltr">
        {data.map((d) => (
          <div key={d.day} className="group relative flex h-full max-w-14 flex-1 flex-col justify-end">
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-md bg-ink px-2 py-1 text-[11px] whitespace-nowrap text-white shadow-lg group-hover:block">
              {d.day} · {d.count} طلبية · {d.confirmed} مؤكدة
            </div>
            <div className="rounded-t-[4px] bg-primary/35 group-hover:bg-primary/50" style={{ height: `${((d.count - d.confirmed) / max) * 100}%` }} />
            <div className="mt-[2px] first:mt-0" style={{ height: `${(d.confirmed / max) * 100}%`, background: 'var(--ok)', borderRadius: d.count === d.confirmed ? '4px 4px 0 0' : 0 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-faint" dir="ltr">
        <span>{data[0]?.day}</span>
        <span>{data[data.length - 1]?.day}</span>
      </div>
    </div>
  );
}
