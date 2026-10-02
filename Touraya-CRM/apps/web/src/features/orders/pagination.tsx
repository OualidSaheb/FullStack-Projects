import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, Select } from '@/components/ui';

export function Pagination({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: { page?: number; pageSize?: number }) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs text-muted">
      <span>
        <span className="ltr">{from}–{to}</span> من <span className="ltr font-semibold text-fg">{total}</span>
      </span>
      <div className="flex items-center gap-2">
        <Select className="h-8 w-20 text-xs" value={pageSize} onChange={(e) => onChange({ pageSize: Number(e.target.value), page: 1 })} aria-label="عدد الأسطر">
          {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
        </Select>
        <Button size="sm" icon={<ChevronRight className="size-4" />} disabled={page <= 1} onClick={() => onChange({ page: page - 1 })}>
          السابق
        </Button>
        <span className="ltr">{page} / {pages}</span>
        <Button size="sm" disabled={page >= pages} onClick={() => onChange({ page: page + 1 })}>
          التالي
          <ChevronLeft className="size-4" />
        </Button>
      </div>
    </div>
  );
}
