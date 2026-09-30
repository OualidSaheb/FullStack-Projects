import { useEffect, useState } from 'react';
import type { RowSelectionState } from '@tanstack/react-table';
import { Inbox, PhoneForwarded, RefreshCw, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useDeleteByFilter, useOrderCounts, useOrders } from '@/lib/queries';
import { Button, Card, EmptyState, Input, Modal, PageHeader, PageLoader } from '@/components/ui';
import { ExportReviewModal } from '../shipping/export-review-modal';
import { BulkBar } from './bulk-bar';
import { FilterBar } from './filter-bar';
import { OrderDrawer } from './order-drawer';
import { OrdersTable } from './orders-table';
import { Pagination } from './pagination';
import { StatusTabs } from './status-tabs';
import { useOrderFilters } from './use-order-filters';

function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    const t = setTimeout(() => text !== value && onChange(text), 300);
    return () => clearTimeout(t);
  }, [text, value, onChange]);
  return (
    <div className="relative w-full sm:w-80">
      <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
      <Input className="ps-9" value={text} onChange={(e) => setText(e.target.value)} placeholder="بحث: اسم، هاتف، رقم الطلبية، بلدية…" />
    </div>
  );
}

export function OrdersPage({ trash = false }: { trash?: boolean }) {
  const filters = useOrderFilters(trash);
  const { query, filter, set, openOrderId, openOrder } = filters;
  const { data, isLoading, isFetching, refetch } = useOrders(query);
  const { data: counts } = useOrderCounts(filter);
  const can = useCan();
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [exportIds, setExportIds] = useState<string[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteByFilter = useDeleteByFilter();
  const selectedIds = Object.keys(selection).filter((k) => selection[k]);

  useEffect(() => setSelection({}), [trash]);

  const openNext = async () => {
    const { id } = await api.get<{ id: string | null }>('/orders/next');
    if (id) openOrder(id);
    else toast.info('لا توجد طلبيات جديدة 🎉');
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={trash ? 'سلة المحذوفات' : 'الطلبيات'}
        subtitle={trash ? 'الطلبيات المحذوفة يمكن استرجاعها في أي وقت' : 'استقبال وتأكيد ومتابعة طلبيات Facebook'}
        actions={
          <>
            <SearchBox value={query.q ?? ''} onChange={(q) => set({ q })} />
            <Button variant="ghost" aria-label="تحديث" icon={<RefreshCw className={isFetching ? 'size-4 animate-spin' : 'size-4'} />} onClick={() => refetch()} />
            {!trash && (
              <Button variant="primary" icon={<PhoneForwarded className="size-4" />} onClick={openNext}>
                الطلبية التالية
              </Button>
            )}
          </>
        }
      />

      <StatusTabs counts={counts} selected={query.status ?? []} onChange={(status) => set({ status })} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FilterBar filters={filters} />
        {!trash && can('orders.delete') && (filters.activeFilterCount > 0 || query.q || query.status?.length) && data && data.total > 0 ? (
          <Button size="sm" variant="ghost" className="text-danger" icon={<Trash2 className="size-3.5" />} onClick={() => setConfirmDelete(true)}>
            حذف كل النتائج ({data.total})
          </Button>
        ) : null}
      </div>

      {selectedIds.length > 0 && (
        <BulkBar ids={selectedIds} trash={trash} onClear={() => setSelection({})} onExport={() => setExportIds(selectedIds)} />
      )}

      <Card className="overflow-hidden">
        {isLoading ? (
          <PageLoader />
        ) : !data?.items.length ? (
          <EmptyState icon={<Inbox className="size-6" />} title={trash ? 'السلة فارغة' : 'لا توجد طلبيات'}>
            {!trash && 'غيّر الفلاتر أو تأكد من ربط ملفات Google Sheets في الإدارة ← المصادر'}
          </EmptyState>
        ) : (
          <>
            <OrdersTable
              rows={data.items}
              sort={query.sort}
              dir={query.dir}
              onSort={(sort, dir) => set({ sort, dir })}
              selection={selection}
              onSelectionChange={setSelection}
              onOpen={openOrder}
              activeId={openOrderId}
            />
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={(p) => set({ ...p, page: p.page })} />
          </>
        )}
      </Card>

      <OrderDrawer orderId={openOrderId} onClose={() => openOrder(null)} />
      {exportIds && <ExportReviewModal ids={exportIds} onClose={() => { setExportIds(null); setSelection({}); }} onOpenOrder={openOrder} />}

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        size="sm"
        title="حذف كل النتائج"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>إلغاء</Button>
            <Button
              variant="danger"
              loading={deleteByFilter.isPending}
              onClick={() =>
                deleteByFilter.mutate(
                  { filter: { ...filter, deleted: false }, confirmCount: data?.total ?? 0 },
                  { onSuccess: (r) => { toast.success(`نقلت ${r.affected} طلبية إلى المحذوفات`); setConfirmDelete(false); } },
                )
              }
            >
              حذف {data?.total} طلبية
            </Button>
          </>
        }
      >
        <p className="text-sm">
          سيتم نقل <b>{data?.total}</b> طلبية تطابق الفلاتر الحالية إلى سلة المحذوفات. يمكن استرجاعها لاحقاً، ولن تعاد من Google Sheets.
        </p>
      </Modal>
    </div>
  );
}
