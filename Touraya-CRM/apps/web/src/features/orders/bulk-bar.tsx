import { useState } from 'react';
import { FileSpreadsheet, Trash2, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';
import { ORDER_STATUSES, STATUS_META, type OrderStatus } from '@touraya/shared';
import { useCan } from '@/lib/auth';
import { useBulkAction, useOffers, useUsers } from '@/lib/queries';
import { Button, IconButton, Select } from '@/components/ui';

export function BulkBar({ ids, trash, onClear, onExport }: { ids: string[]; trash: boolean; onClear: () => void; onExport: () => void }) {
  const can = useCan();
  const bulk = useBulkAction();
  const { data: users } = useUsers();
  const { data: offers } = useOffers();
  const [assignTo, setAssignTo] = useState('');
  const run = (action: Parameters<typeof bulk.mutate>[0], msg: string) =>
    bulk.mutate(action, { onSuccess: (r) => { toast.success(`${msg} (${r.affected})`); onClear(); } });

  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary-soft px-3 py-2 shadow-sm">
      <IconButton label="إلغاء التحديد" icon={<X className="size-4" />} onClick={onClear} />
      <span className="text-sm font-semibold text-primary">
        <span className="ltr">{ids.length}</span> محددة
      </span>
      <div className="mx-1 h-5 w-px bg-primary/20" />
      {trash ? (
        <>
          <Button size="sm" onClick={() => run({ action: 'restore', ids }, 'تم الاسترجاع')}>استرجاع</Button>
          {can('orders.purge') && (
            <Button size="sm" variant="danger" onClick={() => confirm('حذف نهائي؟ لا يمكن التراجع.') && run({ action: 'purge', ids }, 'حذفت نهائياً')}>
              حذف نهائي
            </Button>
          )}
        </>
      ) : (
        <>
          {can('orders.status') && (
            <Select className="h-8 w-auto text-xs" value="" onChange={(e) => e.target.value && run({ action: 'status', ids, status: e.target.value as OrderStatus }, 'تم تغيير الحالة')} aria-label="تغيير الحالة">
              <option value="">تغيير الحالة…</option>
              {ORDER_STATUSES.filter((s) => STATUS_META[s].manual || can('orders.status.any')).map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </Select>
          )}
          {can('orders.assign') && (
            <div className="flex items-center gap-1">
              <Select className="h-8 w-auto text-xs" value={assignTo} onChange={(e) => setAssignTo(e.target.value)} aria-label="إسناد">
                <option value="">إسناد إلى…</option>
                <option value="none">إلغاء الإسناد</option>
                {users?.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
              <Button size="sm" icon={<UserPlus className="size-3.5" />} disabled={!assignTo} onClick={() => run({ action: 'assign', ids, userId: assignTo === 'none' ? null : Number(assignTo) }, 'تم الإسناد')}>
                إسناد
              </Button>
            </div>
          )}
          {can('orders.edit') && (
            <Select
              className="h-8 w-auto text-xs"
              value=""
              onChange={(e) => e.target.value && run({ action: 'offer', ids, offerId: Number(e.target.value) }, 'تم تغيير العرض والسعر')}
              aria-label="تغيير العرض"
              title="يعيد حساب السعر والقطع (الطلبيات التي خرجت من المخزن لا تتغير)"
            >
              <option value="">تغيير العرض…</option>
              {offers?.filter((o) => o.active).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          )}
          {can('shipping.export') && (
            <Button size="sm" variant="primary" icon={<FileSpreadsheet className="size-3.5" />} onClick={onExport}>
              ملف التوصيل
            </Button>
          )}
          {can('orders.delete') && (
            <Button size="sm" variant="ghost" className="text-danger" icon={<Trash2 className="size-3.5" />} onClick={() => run({ action: 'delete', ids }, 'نقلت إلى المحذوفات')}>
              حذف
            </Button>
          )}
        </>
      )}
    </div>
  );
}
