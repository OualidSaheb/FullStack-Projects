import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History, UserX } from 'lucide-react';
import { RISK_META, customerRisk, type OrderDetail, type OrderStatus } from '@touraya/shared';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { qk, useAdminMutation } from '@/lib/queries';
import { fmtDate } from '@/lib/format';
import { StatusBadge } from '@/components/status';
import { Alert, Button, Input, Modal } from '@/components/ui';

type Customer = { orders: { id: string; reference: string; status: OrderStatus; price: number; createdAt: string; deleted: boolean }[] };

/** Past orders of this phone number: the best predictor of a refusal at the door. */
export function CustomerCard({ order, onOpenOrder }: { order: OrderDetail; onOpenOrder?: (id: string) => void }) {
  const c = order.customer;
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const { data } = useQuery({ queryKey: qk.customer(c?.id ?? 0), queryFn: () => api.get<Customer>(`/customers/${c!.id}`), enabled: open && Boolean(c) });
  const blacklist = useAdminMutation(qk.orders, (v: { blacklisted: boolean; reason?: string }) => api.put(`/customers/${c!.id}/blacklist`, v), 'تم التحديث');
  if (!c) return null;
  const risk = customerRisk(c);
  if (risk === 'new' && c.orders === 0) return null;
  const tone = RISK_META[risk].tone === 'neutral' ? 'primary' : RISK_META[risk].tone;

  return (
    <>
      <Alert tone={tone} icon={c.blacklisted ? <UserX className="mt-0.5 size-4 shrink-0" /> : <History className="mt-0.5 size-4 shrink-0" />}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span>
            <b>{RISK_META[risk].label}</b>
            {c.orders > 0 && <> — {c.orders} طلبيات سابقة: {c.delivered} موصلة · {c.returned} مرتجعة · {c.cancelled} ملغاة</>}
            {c.blacklistReason && <> — {c.blacklistReason}</>}
          </span>
          {c.orders > 0 && <button className="text-xs font-semibold underline" onClick={() => setOpen(true)}>السجل</button>}
        </div>
      </Alert>
      <Modal open={open} onClose={() => setOpen(false)} size="sm" title="طلبيات هذا الزبون">
        <ul className="divide-y divide-line">
          {data?.orders.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-2 py-2 text-sm">
              <button className="ltr font-semibold text-primary" onClick={() => { setOpen(false); onOpenOrder?.(o.id); }}>{o.reference}</button>
              <span className="text-xs text-muted">{fmtDate(o.createdAt)}</span>
              <StatusBadge status={o.status} short />
            </li>
          ))}
        </ul>
        {can('customers.blacklist') && (
          <div className="mt-4 space-y-2 border-t border-line pt-4">
            {c.blacklisted ? (
              <Button className="w-full" onClick={() => blacklist.mutate({ blacklisted: false })}>إخراج من القائمة السوداء</Button>
            ) : (
              <>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="السبب (مثلاً: رفض الاستلام مرتين)" />
                <Button variant="danger" className="w-full" icon={<UserX className="size-4" />} onClick={() => blacklist.mutate({ blacklisted: true, reason })}>
                  إضافة إلى القائمة السوداء
                </Button>
              </>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
