import { useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, Copy, MapPin, Package, Pencil, RotateCcw, Trash2, User, X } from 'lucide-react';
import { toast } from 'sonner';
import { BLOCKING_PHONE_ISSUES, PHONE_ISSUES, type OrderDetail } from '@touraya/shared';
import { useCan } from '@/lib/auth';
import { fmtDA, fmtDateTime } from '@/lib/format';
import { useBulkAction, useOrder } from '@/lib/queries';
import { cn } from '@/lib/cn';
import { communeLabel, wilayaLabel } from '@/components/geo-select';
import { CallButton, WhatsAppButton } from '@/components/phone';
import { StatusBadge } from '@/components/status';
import { Alert, Badge, Button, Card, CardHeader, Drawer, IconButton, PageLoader } from '@/components/ui';
import { OrderEditForm } from './order-edit-form';
import { OrderActivity, OrderComments } from './order-timeline';
import { StatusActions } from './status-actions';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="text-end font-medium">{children ?? <span className="text-faint">—</span>}</dd>
    </div>
  );
}

function PhonePanel({ order }: { order: OrderDetail }) {
  const blocking = order.phoneIssue && BLOCKING_PHONE_ISSUES.includes(order.phoneIssue);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <CallButton phone={order.phone} label={`اتصال ${order.phone ?? ''}`} />
        <WhatsAppButton phone={order.phone} />
        {order.phoneAlt && <CallButton phone={order.phoneAlt} compact className="rounded-lg border border-line px-3 py-2" />}
      </div>
      {order.phoneIssue && (
        <Alert tone={blocking ? 'warn' : 'primary'} icon={<AlertTriangle className="mt-0.5 size-4 shrink-0" />}>
          {PHONE_ISSUES[order.phoneIssue]}
        </Alert>
      )}
      <dl className="divide-y divide-line rounded-lg bg-subtle px-3">
        <Row label="الرقم المعتمد"><span className="ltr">{order.phone}</span></Row>
        <Row label="الرقم الذي كتبه الزبون"><span className="ltr">{order.phoneCustomer}</span></Row>
        <Row label="رقم Facebook">
          {order.phoneFacebook && (
            <span className="inline-flex items-center gap-2">
              <span className="ltr">{order.phoneFacebook}</span>
              {order.phoneFacebook.replace(/\D/g, '').slice(-9) !== order.phone?.slice(-9) && (
                <CallButton phone={order.phoneFacebook.replace(/^p:/, '')} label="اتصال" compact />
              )}
            </span>
          )}
        </Row>
      </dl>
    </div>
  );
}

function RawData({ raw }: { raw: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(raw).filter(([k]) => !k.startsWith('_'));
  return (
    <Card>
      <button className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold" onClick={() => setOpen(!open)}>
        البيانات الأصلية من Google Sheet ({entries.length})
        <ChevronDown className={cn('size-4 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <dl className="divide-y divide-line border-t border-line px-4 text-xs">
          {entries.map(([k, v]) => (
            <div key={k} className="grid grid-cols-5 gap-3 py-1.5">
              <dt className="col-span-2 break-all text-muted">{k}</dt>
              <dd className="col-span-3 break-all">{String(v ?? '')}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

export function OrderDrawer({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  const { data: order, isLoading } = useOrder(orderId);
  const [editing, setEditing] = useState(false);
  const can = useCan();
  const bulk = useBulkAction();

  const close = () => {
    setEditing(false);
    onClose();
  };

  return (
    <Drawer open={Boolean(orderId)} onClose={close}>
      {isLoading || !order ? (
        <PageLoader />
      ) : (
        <>
          <header className="border-b border-line bg-surface px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="ltr text-lg font-bold">{order.reference}</h2>
                  <StatusBadge status={order.status} />
                  {order.deletedAt && <Badge tone="danger">محذوفة</Badge>}
                </div>
                <p className="mt-1 text-xs text-muted">
                  {fmtDateTime(order.createdAt)} · {order.sourceName ?? 'يدوي'}
                  {order.assignedToName && <> · الموظف: {order.assignedToName}</>}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <IconButton
                  label="نسخ رقم الطلبية"
                  icon={<Copy className="size-4" />}
                  onClick={() => navigator.clipboard.writeText(order.reference).then(() => toast.success('تم النسخ'))}
                />
                {can('orders.delete') &&
                  (order.deletedAt ? (
                    <IconButton label="استرجاع" icon={<RotateCcw className="size-4" />} onClick={() => bulk.mutate({ action: 'restore', ids: [order.id] })} />
                  ) : (
                    <IconButton
                      label="حذف"
                      className="hover:text-danger"
                      icon={<Trash2 className="size-4" />}
                      onClick={() => bulk.mutate({ action: 'delete', ids: [order.id] }, { onSuccess: () => { toast.success('نقلت إلى المحذوفات'); close(); } })}
                    />
                  ))}
                <IconButton label="إغلاق" icon={<X className="size-4" />} onClick={close} />
              </div>
            </div>
            <div className="mt-4">
              <StatusActions order={order} />
            </div>
          </header>

          <div className="flex-1 space-y-4 overflow-y-auto p-5 scroll-thin">
            {editing ? (
              <Card className="p-4">
                <OrderEditForm order={order} onDone={() => setEditing(false)} />
              </Card>
            ) : (
              <>
                <Card>
                  <CardHeader
                    title={order.customerName || 'بدون اسم'}
                    icon={<User className="size-4 text-muted" />}
                    action={can('orders.edit') && !order.deletedAt && (
                      <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>
                        تعديل الطلبية
                      </Button>
                    )}
                  />
                  <div className="p-4">
                    <PhonePanel order={order} />
                  </div>
                </Card>

                <div className="grid gap-4 md:grid-cols-2">
                  <Card>
                    <CardHeader title="التوصيل" icon={<MapPin className="size-4 text-muted" />} />
                    <dl className="divide-y divide-line px-4">
                      <Row label="الولاية">{order.wilayaCode ? wilayaLabel(order.wilayaCode) : <span className="text-warn">{order.wilayaRaw ?? 'غير محددة'}</span>}</Row>
                      <Row label="البلدية">
                        {order.communeName ? communeLabel(order.communeName, order.wilayaCode) : (
                          <span className="text-warn">{order.communeRaw ? `«${order.communeRaw}» غير مطابقة` : 'غير محددة'}</span>
                        )}
                      </Row>
                      <Row label="العنوان">{order.address}</Row>
                      {order.carrierTracking && <Row label="رقم التتبع"><span className="ltr">{order.carrierTracking}</span></Row>}
                      {order.carrierStatus && <Row label="حالة الناقل">{order.carrierStatus}</Row>}
                    </dl>
                  </Card>
                  <Card>
                    <CardHeader title="الطلب" icon={<Package className="size-4 text-muted" />} />
                    <dl className="divide-y divide-line px-4">
                      <Row label="العرض">{order.productName ?? <span className="text-warn">{order.offerRaw ?? 'غير محدد'}</span>}</Row>
                      <Row label="الكمية">{order.quantity}</Row>
                      <Row label="السعر"><span className="ltr">{fmtDA(order.price)}</span></Row>
                      <Row label="المقاس">{order.size}</Row>
                      <Row label="الألوان">{order.colors}</Row>
                    </dl>
                  </Card>
                </div>
              </>
            )}

            <OrderComments orderId={order.id} />
            <OrderActivity orderId={order.id} />
            <RawData raw={order.raw} />
            {order.leadId && <p className="ltr text-center text-xs text-faint">Lead ID: {order.leadId}</p>}
          </div>
        </>
      )}
    </Drawer>
  );
}
