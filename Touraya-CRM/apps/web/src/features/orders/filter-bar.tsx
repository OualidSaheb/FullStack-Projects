import { AlertTriangle, FilterX } from 'lucide-react';
import { WILAYAS } from '@touraya/shared';
import { useProducts, useSources, useUsers } from '@/lib/queries';
import { cn } from '@/lib/cn';
import { Button, Input, Select } from '@/components/ui';
import type { useOrderFilters } from './use-order-filters';

type Filters = ReturnType<typeof useOrderFilters>;

export function FilterBar({ filters }: { filters: Filters }) {
  const { query, set, clear, activeFilterCount } = filters;
  const { data: products } = useProducts();
  const { data: sources } = useSources();
  const { data: users } = useUsers();
  const selectCls = 'h-8 w-auto min-w-32 max-w-56 text-xs';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select className={selectCls} value={query.productId ?? ''} onChange={(e) => set({ productId: e.target.value })} aria-label="العرض">
        <option value="">كل العروض</option>
        {products?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </Select>
      <Select className={selectCls} value={query.sourceId ?? ''} onChange={(e) => set({ sourceId: e.target.value })} aria-label="المصدر">
        <option value="">كل المصادر</option>
        {sources?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
      <Select className={selectCls} value={query.wilayaCode ?? ''} onChange={(e) => set({ wilayaCode: e.target.value })} aria-label="الولاية">
        <option value="">كل الولايات</option>
        {WILAYAS.map((w) => <option key={w.code} value={w.code}>{String(w.code).padStart(2, '0')} {w.nameAr}</option>)}
      </Select>
      <Select className={selectCls} value={query.assignedTo ?? ''} onChange={(e) => set({ assignedTo: e.target.value })} aria-label="الموظف">
        <option value="">كل الموظفين</option>
        <option value="me">طلبياتي</option>
        <option value="none">غير مسندة</option>
        {users?.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </Select>
      <div className="flex items-center gap-1 text-xs text-muted">
        <Input type="date" className="h-8 w-36 text-xs" value={query.from ?? ''} onChange={(e) => set({ from: e.target.value })} aria-label="من تاريخ" />
        <span>→</span>
        <Input type="date" className="h-8 w-36 text-xs" value={query.to ?? ''} onChange={(e) => set({ to: e.target.value })} aria-label="إلى تاريخ" />
      </div>
      <button
        onClick={() => set({ phoneIssue: query.phoneIssue ? undefined : true })}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition',
          query.phoneIssue ? 'border-warn bg-warn text-white dark:text-ink' : 'border-line bg-surface text-muted hover:text-fg',
        )}
      >
        <AlertTriangle className="size-3.5" />
        مشكل هاتف
      </button>
      {(activeFilterCount > 0 || query.q || query.status?.length) && (
        <Button size="sm" variant="ghost" icon={<FilterX className="size-3.5" />} onClick={clear}>
          مسح الفلاتر
        </Button>
      )}
    </div>
  );
}
