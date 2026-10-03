import { useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, Copy, Link2, MapPin, Package, User } from 'lucide-react';
import {
  BLOCKING_PHONE_ISSUES,
  DELIVERY_TYPES,
  getWilaya,
  PHONE_ISSUES,
  suggestCommunes,
  WILAYAS,
  type DeliveryType,
  type OrderDetail,
} from '@touraya/shared';
import { fmtDA } from '@/lib/format';
import { useInlineUpdate, useOffers, useProducts } from '@/lib/queries';
import { InlineSelect, InlineText } from '@/components/inline';
import { StatusBadge } from '@/components/status';
import { useCan } from '@/lib/auth';
import { cn } from '@/lib/cn';
import { CallButton, WhatsAppButton } from '@/components/phone';
import { Alert, Card, CardHeader } from '@/components/ui';
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

/** Wilaya → commune pickers that save immediately; communes limited to the wilaya (carrier names). */
function LocationEditor({ order, disabled }: { order: OrderDetail; disabled: boolean }) {
  const update = useInlineUpdate(order.id);
  const wilaya = getWilaya(order.wilayaCode);
  const suggestions = order.communeRaw && !order.communeName && wilaya ? suggestCommunes(order.communeRaw, wilaya.code, 3).filter((x) => x.score > 0.4) : [];
  const communeOptions = [
    ...suggestions.map((x) => ({ value: x.commune.name, label: `★ ${x.commune.nameAr || x.commune.name}` })),
    ...(wilaya?.communes ?? []).map((c) => ({ value: c.name, label: c.nameAr ? `${c.nameAr} (${c.name})` : c.name })),
  ];
  return (
    <>
      <Row label="الولاية">
        <InlineSelect
          disabled={disabled}
          value={order.wilayaCode}
          placeholder={order.wilayaRaw ? `«${order.wilayaRaw}» — اختر` : 'اختر الولاية'}
          tone={order.wilayaCode ? undefined : 'warn'}
          options={WILAYAS.map((w) => ({ value: w.code, label: `${String(w.code).padStart(2, '0')} - ${w.nameAr}` }))}
          onSave={(v) => update.mutate({ wilayaCode: v, communeName: null })}
          aria-label="الولاية"
        />
      </Row>
      <Row label="البلدية">
        <InlineSelect
          disabled={disabled || !wilaya}
          className="max-w-56"
          value={order.communeName}
          placeholder={order.communeRaw ? `«${order.communeRaw}» — اختر` : 'اختر البلدية'}
          tone={order.communeName ? undefined : 'warn'}
          options={communeOptions}
          onSave={(v) => update.mutate({ communeName: v })}
          aria-label="البلدية"
        />
      </Row>
      <Row label="العنوان">
        <InlineText disabled={disabled} value={order.address ?? ''} placeholder="اختياري" onSave={(v) => update.mutate({ address: v || null })} />
      </Row>
      <Row label="التوصيل">
        <InlineSelect
          disabled={disabled}
          value={order.deliveryType}
          options={Object.entries(DELIVERY_TYPES).map(([value, label]) => ({ value: value as DeliveryType, label }))}
          onSave={(v) => v && update.mutate({ deliveryType: v })}
          aria-label="نوع التوصيل"
        />
      </Row>
      {order.deliveryType === 'stopdesk' && (
        <Row label="رقم المكتب">
          <InlineText disabled={disabled} dir="ltr" value={order.stopdeskId ?? ''} placeholder="Stop desk ID" onSave={(v) => update.mutate({ stopdeskId: v || null })} />
        </Row>
      )}
    </>
  );
}

/**
 * The product of the order. The offer is not picked by hand: it follows the
 * number of pieces. Choosing is only needed when the order came in without a
 * known product (or to switch to another product).
 */
function ProductTitle({ order, editable }: { order: OrderDetail; editable: boolean }) {
  const update = useInlineUpdate(order.id);
  const { data: offers } = useOffers();
  const { data: products } = useProducts();
  const [changing, setChanging] = useState(false);
  const name = order.items[0]?.productName ?? products?.find((p) => offers?.some((o) => o.id === order.offerId && o.productId === p.id))?.name;
  if (name && !changing)
    return (
      <span className="flex min-w-0 items-center gap-2">
        <span className="truncate">{name}</span>
        {editable && <button className="shrink-0 text-xs font-normal text-primary hover:underline" onClick={() => setChanging(true)}>تغيير</button>}
      </span>
    );
  if (!editable) return <>{order.offerName ?? order.offerRaw ?? 'بدون منتج'}</>;
  // One entry per product (its 1-piece price, or its smallest offer); the piece count is set below.
  const choices = (products ?? [])
    .filter((p) => p.active)
    .flatMap((p) => {
      const first = (offers ?? []).filter((o) => o.productId === p.id && o.active).sort((a, b) => a.units - b.units)[0];
      return first ? [{ value: first.id, label: `${p.name} — ${first.units} ${first.units === 1 ? 'قطعة' : 'قطع'} ${fmtDA(first.price)}` }] : [];
    });
  return (
    <InlineSelect
      value={null}
      placeholder={order.offerRaw ? `«${order.offerRaw}» — اختر المنتج` : 'اختر المنتج'}
      tone="warn"
      className="max-w-full"
      options={choices}
      onSave={(v) => {
        if (v) update.mutate({ offerId: v });
        setChanging(false);
      }}
      aria-label="المنتج"
    />
  );
}

/**
 * Everything about an order, in the order an agent needs it during a call:
 * who → call → what they ordered (pieces, price + delivery) → where → notes.
 * Every value is edited in place (tap → change → saved); each change is logged.
 * Shared by the detail drawer and the call (work) mode.
 */
export function OrderPanel({ order, onOpenOrder }: { order: OrderDetail; onOpenOrder?: (id: string) => void }) {
  const can = useCan();
  const update = useInlineUpdate(order.id);
  const editable = can('orders.edit') && !order.deletedAt;
  const shipped = ['ready_for_carrier', 'sent_to_carrier', 'carrier_received', 'delivered', 'returned', 'return_received'].includes(order.status);

  return (
    <div className="space-y-4">
      <FlagBadges flags={order.flags} />
      {order.duplicateOf && (
        <Alert tone="warn" icon={<Copy className="mt-0.5 size-4 shrink-0" />}>
          نفس الزبون عنده طلبية مفتوحة{' '}
          <button className="ltr font-semibold underline" onClick={() => onOpenOrder?.(order.duplicateOf!.id)}>{order.duplicateOf.reference}</button> — تأكد أنها ليست مكررة.
        </Alert>
      )}
      {order.related && (
        <Alert tone="primary" icon={<Link2 className="mt-0.5 size-4 shrink-0" />}>
          مرتبطة بالطلبية <button className="ltr font-semibold underline" onClick={() => onOpenOrder?.(order.related!.id)}>{order.related.reference}</button>{' '}
          <StatusBadge status={order.related.status} short />
        </Alert>
      )}
      <CustomerCard order={order} onOpenOrder={onOpenOrder} />

      <Card>
        <CardHeader
          title={<InlineText disabled={!editable} value={order.customerName} placeholder="بدون اسم" onSave={(v) => v && update.mutate({ customerName: v })} />}
          icon={<User className="size-4 text-muted" />}
        />
        <div className="space-y-3 p-4">
          <PhoneBlock order={order} />
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <span className="flex items-center gap-2 text-muted">
              الهاتف:
              <InlineText disabled={!editable} dir="ltr" inputMode="tel" value={order.phone ?? ''} onSave={(v) => update.mutate({ phone: v })} className="text-fg" />
            </span>
            <span className="flex items-center gap-2 text-muted">
              احتياطي:
              <InlineText disabled={!editable} dir="ltr" inputMode="tel" value={order.phoneAlt ?? ''} placeholder="إضافة" onSave={(v) => update.mutate({ phoneAlt: v || null })} className="text-fg" />
            </span>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={<ProductTitle order={order} editable={editable && !shipped} />}
          icon={<Package className="size-4 text-muted" />}
          action={order.suggestedPrice && <span className="truncate rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary" title="العرض حسب عدد القطع">{order.suggestedPrice.label}</span>}
        />
        <div className="space-y-3 p-4">
          <PriceSummary order={order} onPrice={editable && !shipped ? (price) => update.mutate({ price }) : undefined} />
          {(order.size || order.colors) && (
            <p className="text-xs text-muted">
              طلب الزبون:{' '}
              {[order.size && <>المقاس <b className="text-fg">{order.size}</b></>, order.colors && <>الألوان <b className="text-fg">{order.colors}</b></>]
                .filter(Boolean)
                .map((part, i) => <span key={i}>{i > 0 && ' · '}{part}</span>)}
            </p>
          )}
          <ItemsEditor order={order} />
        </div>
      </Card>

      <Card>
        <CardHeader title="التوصيل" icon={<MapPin className="size-4 text-muted" />} />
        <dl className="divide-y divide-line px-4">
          <LocationEditor order={order} disabled={!editable || shipped} />
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
