import { useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, Copy, MapPin, Package, Pencil, User } from 'lucide-react';
import { PHONE_ISSUES, BLOCKING_PHONE_ISSUES, type OrderDetail } from '@touraya/shared';
import { useCan } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { communeLabel, wilayaLabel } from '@/components/geo-select';
import { CallButton, WhatsAppButton } from '@/components/phone';
import { Alert, Button, Card, CardHeader } from '@/components/ui';
import { OrderEditForm } from './order-edit-form';
import { OrderActivity, OrderComments } from './order-timeline';
import { CustomerCard } from './parts/customer-card';
import { FlagBadges } from './parts/flags';
import { ItemsEditor } from './parts/items-editor';
import { PriceSummary } from './parts/price-summary';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="text-end font-medium">{children ?? <span className="text-faint">—</span>}</dd>
    </div>
  );
}

/** One-tap call to the right number; the other numbers stay one tap away. */
export function PhoneBlock({ order }: { order: OrderDetail }) {
  const [details, setDetails] = useState(false);
  const fb = order.phoneFacebook?.replace(/^p:/i, '') ?? null;
  const blocking = order.phoneIssue && BLOCKING_PHONE_ISSUES.includes(order.phoneIssue);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <CallButton phone={order.phone} label={order.phone ?? ''} className="h-12 flex-1 justify-center text-lg sm:h-10 sm:flex-none sm:text-base" />
        <WhatsAppButton phone={order.phone} />
        {order.phoneAlt && <CallButton phone={order.phoneAlt} compact className="rounded-lg border border-line px-3 py-2" />}
      </div>
      {order.phoneIssue && (
        <Alert tone={blocking ? 'warn' : 'primary'} icon={<AlertTriangle className="mt-0.5 size-4 shrink-0" />}>
          {PHONE_ISSUES[order.phoneIssue]}
          <button className="ms-2 text-xs underline" onClick={() => setDetails(!details)}>الأرقام</button>
        </Alert>
      )}
      {details && (
        <dl className="divide-y divide-line rounded-lg bg-subtle px-3">
          <Row label="الرقم الذي كتبه الزبون"><span className="ltr">{order.phoneCustomer}</span></Row>
          <Row label="رقم Facebook">
            {fb && <span className="inline-flex items-center gap-2"><span className="ltr">{fb}</span><CallButton phone={fb.replace(/^\+213/, '0')} label="اتصال" compact /></span>}
          </Row>
        </dl>
      )}
    </div>
  );
}

function RawData({ raw }: { raw: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const entries = Object.entries(raw).filter(([k]) => !k.startsWith('_'));
  return (
    <Card>
      <button className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold" onClick={() => setOpen(!open)}>
        البيانات الأصلية من الفورم ({entries.length})
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

/**
 * Everything about an order, in the order an agent needs it during a call:
 * who → call → what they ordered (pieces, price + delivery) → where → notes.
 * Shared by the detail drawer and the call (work) mode.
 */
export function OrderPanel({ order, onOpenOrder }: { order: OrderDetail; onOpenOrder?: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  const can = useCan();
  const editable = can('orders.edit') && !order.deletedAt;

  if (editing)
    return (
      <Card className="p-4">
        <OrderEditForm order={order} onDone={() => setEditing(false)} />
      </Card>
    );

  return (
    <div className="space-y-4">
      <FlagBadges flags={order.flags} />
      {order.duplicateOf && (
        <Alert tone="warn" icon={<Copy className="mt-0.5 size-4 shrink-0" />}>
          نفس الزبون عنده طلبية مفتوحة{' '}
          <button className="ltr font-semibold underline" onClick={() => onOpenOrder?.(order.duplicateOf!.id)}>{order.duplicateOf.reference}</button> — تأكد أنها ليست مكررة.
        </Alert>
      )}
      <CustomerCard order={order} onOpenOrder={onOpenOrder} />

      <Card>
        <CardHeader
          title={order.customerName || 'بدون اسم'}
          icon={<User className="size-4 text-muted" />}
          action={editable && <Button size="sm" icon={<Pencil className="size-3.5" />} onClick={() => setEditing(true)}>تعديل</Button>}
        />
        <div className="p-4"><PhoneBlock order={order} /></div>
      </Card>

      <Card>
        <CardHeader title={order.offerName ?? order.offerRaw ?? 'بدون عرض'} icon={<Package className="size-4 text-muted" />} />
        <div className="space-y-3 p-4">
          <PriceSummary order={order} />
          {(order.size || order.colors) && (
            <p className="text-xs text-muted">
              طلب الزبون: {order.size && <b className="text-fg">المقاس {order.size}</b>} {order.colors && <>· الألوان <b className="text-fg">{order.colors}</b></>}
            </p>
          )}
          <ItemsEditor order={order} />
        </div>
      </Card>

      <Card>
        <CardHeader title="التوصيل" icon={<MapPin className="size-4 text-muted" />} />
        <dl className="divide-y divide-line px-4">
          <Row label="الولاية">{order.wilayaCode ? wilayaLabel(order.wilayaCode) : <span className="text-warn">{order.wilayaRaw ?? 'غير محددة'}</span>}</Row>
          <Row label="البلدية">
            {order.communeName ? communeLabel(order.communeName, order.wilayaCode) : <span className="text-warn">{order.communeRaw ? `«${order.communeRaw}» غير مطابقة` : 'غير محددة'}</span>}
          </Row>
          <Row label="العنوان">{order.address}</Row>
          <Row label="النوع">{order.deliveryType === 'stopdesk' ? `مكتب ${order.stopdeskId ?? ''}` : 'المنزل'}</Row>
          {order.carrierName && <Row label="الشركة">{order.carrierName}</Row>}
          {order.carrierTracking && <Row label="رقم التتبع"><span className="ltr">{order.carrierTracking}</span></Row>}
          {order.carrierStatus && <Row label="حالة الناقل">{order.carrierStatus}</Row>}
          {order.cancelReason && <Row label="سبب الإلغاء">{order.cancelReason}</Row>}
        </dl>
      </Card>

      <OrderComments orderId={order.id} />
      <OrderActivity orderId={order.id} />
      <RawData raw={order.raw} />
      {order.leadId && <p className="ltr text-center text-xs text-faint">Lead ID: {order.leadId}</p>}
    </div>
  );
}
