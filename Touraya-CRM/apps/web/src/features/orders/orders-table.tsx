import { useMemo } from 'react';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type RowSelectionState } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, Clock, MessageSquare, MapPinOff } from 'lucide-react';
import type { OrderListItem, OrderListQuery } from '@touraya/shared';
import { fmtDA, fmtDateTime, timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';
import { StatusBadge } from '@/components/status';
import { CallButton } from '@/components/phone';
import { communeLabel, wilayaLabel } from '@/components/geo-select';
import { Checkbox } from '@/components/ui';
import { FlagBadges, RiskBadge } from './parts/flags';

type SortKey = OrderListQuery['sort'];

const columns: ColumnDef<OrderListItem>[] = [
  {
    id: 'select',
    header: ({ table }) => (
      <Checkbox
        aria-label="تحديد الكل"
        checked={table.getIsAllRowsSelected()}
        indeterminate={table.getIsSomeRowsSelected()}
        onChange={table.getToggleAllRowsSelectedHandler()}
      />
    ),
    cell: ({ row }) => <Checkbox aria-label="تحديد" checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} onClick={(e) => e.stopPropagation()} />,
    meta: { className: 'w-10' },
  },
  {
    id: 'createdAt',
    header: 'الطلبية',
    cell: ({ row: { original: o } }) => (
      <div className="leading-tight">
        <p className="ltr text-right font-semibold whitespace-nowrap text-fg">{o.reference}</p>
        <p className="mt-0.5 text-xs text-faint" title={fmtDateTime(o.createdAt)}>{timeAgo(o.createdAt)}</p>
      </div>
    ),
  },
  {
    id: 'customerName',
    header: 'الزبون',
    cell: ({ row: { original: o } }) => (
      <div className="min-w-36 space-y-1 leading-tight">
        <p className="font-medium">{o.customerName || <span className="text-faint">بدون اسم</span>}</p>
        <div className="flex items-center gap-1.5 text-xs">
          <CallButton phone={o.phone} compact />
        </div>
        <div className="flex flex-wrap gap-1">
          <RiskBadge risk={o.risk} />
          <FlagBadges flags={o.flags.filter((f) => f !== 'commune' && f !== 'risky' && f !== 'blacklisted')} compact />
        </div>
      </div>
    ),
  },
  {
    id: 'wilayaCode',
    header: 'التوصيل',
    cell: ({ row: { original: o } }) => (
      <div className="min-w-28 leading-tight">
        <p className={o.wilayaCode ? undefined : 'text-warn'}>{o.wilayaCode ? wilayaLabel(o.wilayaCode) : o.wilayaRaw || 'بدون ولاية'}</p>
        {o.communeName ? (
          <p className="mt-0.5 text-xs text-muted">{communeLabel(o.communeName, o.wilayaCode)}</p>
        ) : (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-warn" title="البلدية غير مطابقة — يجب تصحيحها">
            <MapPinOff className="size-3" />
            {o.communeRaw || 'بدون بلدية'}
          </p>
        )}
      </div>
    ),
  },
  {
    id: 'price',
    header: 'العرض',
    cell: ({ row: { original: o } }) => (
      <div className="min-w-32 leading-tight">
        <p className="font-medium">{o.offerName ?? <span className="text-warn">بدون عرض</span>}</p>
        <p className="ltr mt-0.5 text-right text-xs text-muted">{fmtDA(o.price)}</p>
      </div>
    ),
  },
  {
    id: 'items',
    header: 'القطع',
    cell: ({ row: { original: o } }) => (
      <p className={o.flags.includes('variants') ? 'max-w-48 text-xs text-warn' : 'max-w-48 text-xs text-muted'}>
        {o.itemsLabel || [o.size, o.colors].filter(Boolean).join(' · ') || '—'}
      </p>
    ),
  },
  {
    id: 'status',
    header: 'الحالة',
    cell: ({ row: { original: o } }) => (
      <div className="space-y-1">
        <StatusBadge status={o.status} short />
        {o.nextCallAt && (
          <p className="flex items-center gap-1 text-[11px] text-muted" title={fmtDateTime(o.nextCallAt)}>
            <Clock className="size-3" />
            {fmtDateTime(o.nextCallAt)}
          </p>
        )}
      </div>
    ),
  },
  {
    id: 'agent',
    header: 'الموظف',
    cell: ({ row: { original: o } }) => <span className="text-xs text-muted">{o.assignedToName ?? '—'}</span>,
  },
  {
    id: 'lastComment',
    header: 'آخر تعليق',
    cell: ({ row: { original: o } }) =>
      o.lastComment ? (
        <p className="flex max-w-48 items-center gap-1 truncate text-xs text-muted" title={o.lastComment}>
          <MessageSquare className="size-3 shrink-0" />
          {o.commentCount > 1 && <span className="ltr text-faint">{o.commentCount}</span>}
          <span className="truncate">{o.lastComment}</span>
        </p>
      ) : null,
  },
];

const SORTABLE: Partial<Record<string, SortKey>> = { createdAt: 'createdAt', customerName: 'customerName', wilayaCode: 'wilayaCode', price: 'price', status: 'status' };

export function OrdersTable({
  rows,
  sort,
  dir,
  onSort,
  selection,
  onSelectionChange,
  onOpen,
  activeId,
}: {
  rows: OrderListItem[];
  sort: SortKey;
  dir: 'asc' | 'desc';
  onSort: (sort: SortKey, dir: 'asc' | 'desc') => void;
  selection: RowSelectionState;
  onSelectionChange: (s: RowSelectionState) => void;
  onOpen: (id: string) => void;
  activeId: string | null;
}) {
  const table = useReactTable({
    data: rows,
    columns: useMemo(() => columns, []),
    getRowId: (r) => r.id,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    enableRowSelection: true,
    state: { rowSelection: selection },
    onRowSelectionChange: (updater) => onSelectionChange(typeof updater === 'function' ? updater(selection) : updater),
  });

  return (
    <div className="overflow-x-auto scroll-thin">
      <table className="w-full min-w-[960px] border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-10">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const key = SORTABLE[h.column.id];
                const active = key === sort;
                const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown;
                return (
                  <th key={h.id} className={cn('border-b border-line bg-subtle px-3 py-2.5 text-start text-xs font-semibold text-muted', (h.column.columnDef.meta as { className?: string })?.className)}>
                    {key ? (
                      <button
                        className={cn('inline-flex items-center gap-1 hover:text-fg', active && 'text-fg')}
                        onClick={() => onSort(key, active && dir === 'desc' ? 'asc' : 'desc')}
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        <Icon className={cn('size-3', !active && 'opacity-40')} />
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              onClick={() => onOpen(row.id)}
              className={cn(
                'cursor-pointer transition-colors hover:bg-subtle/70',
                row.getIsSelected() && 'bg-primary-soft/60',
                activeId === row.id && 'bg-primary-soft',
              )}
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="border-b border-line px-3 py-2.5 align-middle">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
