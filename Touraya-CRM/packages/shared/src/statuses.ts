/**
 * Order lifecycle. Single source of truth for labels, colors, grouping and
 * which transitions are allowed — used by the API (validation) and the UI (badges, filters).
 */
export const ORDER_STATUSES = [
  'new',
  'call_1',
  'call_2',
  'call_3',
  'call_4',
  'postponed',
  'confirmed',
  'ready_for_carrier',
  'sent_to_carrier',
  'carrier_received',
  'out_for_delivery',
  'at_desk',
  'delivery_failed',
  'delivered',
  'returned',
  'return_received',
  'cancelled',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type StatusStage = 'inbox' | 'calling' | 'confirmed' | 'shipping' | 'closed';

export interface StatusMeta {
  label: string;
  short: string;
  stage: StatusStage;
  /** Distinct hue per status (hex). The UI derives soft backgrounds from it. */
  color: string;
  /** lucide icon name, resolved by the UI. */
  icon: string;
  /** Can an agent pick it by hand, or is it set by the system/manager? */
  manual: boolean;
}

export const STATUS_META: Record<OrderStatus, StatusMeta> = {
  new: { label: 'طلب جديد', short: 'جديد', stage: 'inbox', color: '#2563eb', icon: 'sparkles', manual: true },
  call_1: { label: 'اتصال 1 - لم يرد', short: 'اتصال 1', stage: 'calling', color: '#a16207', icon: 'phone-missed', manual: true },
  call_2: { label: 'اتصال 2 - لم يرد', short: 'اتصال 2', stage: 'calling', color: '#ea580c', icon: 'phone-missed', manual: true },
  call_3: { label: 'اتصال 3 - لم يرد', short: 'اتصال 3', stage: 'calling', color: '#b91c1c', icon: 'phone-missed', manual: true },
  call_4: { label: 'اتصال 4 - لم يرد', short: 'اتصال 4', stage: 'calling', color: '#c026d3', icon: 'phone-off', manual: true },
  postponed: { label: 'مؤجلة - اتصل لاحقاً', short: 'مؤجلة', stage: 'calling', color: '#64748b', icon: 'clock', manual: true },
  confirmed: { label: 'تم تأكيد الطلبية', short: 'مؤكدة', stage: 'confirmed', color: '#059669', icon: 'badge-check', manual: true },
  ready_for_carrier: { label: 'تم تجهيزها لشركة التوصيل', short: 'مجهزة', stage: 'shipping', color: '#7c3aed', icon: 'package', manual: false },
  sent_to_carrier: { label: 'أُرسلت لشركة التوصيل (لم تُستلم بعد)', short: 'مرسلة', stage: 'shipping', color: '#0891b2', icon: 'send', manual: false },
  carrier_received: { label: 'في الطريق (عند شركة التوصيل)', short: 'في الطريق', stage: 'shipping', color: '#4338ca', icon: 'truck', manual: false },
  out_for_delivery: { label: 'خرجت للتوصيل اليوم', short: 'خرجت للتوصيل', stage: 'shipping', color: '#0d9488', icon: 'bike', manual: false },
  at_desk: { label: 'في المكتب — بانتظار الزبون', short: 'في المكتب', stage: 'shipping', color: '#0369a1', icon: 'store', manual: false },
  delivery_failed: { label: 'محاولة توصيل فاشلة — اتصل بالزبون', short: 'فشل التوصيل', stage: 'shipping', color: '#dc2626', icon: 'alert-triangle', manual: false },
  delivered: { label: 'تم التوصيل', short: 'موصلة', stage: 'closed', color: '#15803d', icon: 'package-check', manual: false },
  returned: { label: 'مرتجعة (في الطريق)', short: 'مرتجعة', stage: 'closed', color: '#92400e', icon: 'undo-2', manual: false },
  return_received: { label: 'المرتجع وصل للمخزن', short: 'مرتجع مستلم', stage: 'closed', color: '#57534e', icon: 'warehouse', manual: false },
  cancelled: { label: 'إلغاء الطلبية', short: 'ملغاة', stage: 'closed', color: '#475569', icon: 'ban', manual: true },
};

export const STAGE_LABELS: Record<StatusStage, string> = {
  inbox: 'جديدة',
  calling: 'قيد الاتصال',
  confirmed: 'مؤكدة',
  shipping: 'التوصيل',
  closed: 'مغلقة',
};

export const CALL_ATTEMPT_STATUSES: OrderStatus[] = ['call_1', 'call_2', 'call_3', 'call_4'];

/** Next "no answer" status after the current one (used by the one-click "لم يرد" button). */
export function nextCallAttempt(current: OrderStatus): OrderStatus {
  const idx = CALL_ATTEMPT_STATUSES.indexOf(current);
  if (idx === -1) return 'call_1';
  return CALL_ATTEMPT_STATUSES[Math.min(idx + 1, CALL_ATTEMPT_STATUSES.length - 1)]!;
}

/** Orders waiting for a call (the agent work queue). */
export const QUEUE_STATUSES: OrderStatus[] = ['new', 'call_1', 'call_2', 'call_3', 'call_4', 'postponed'];

/** The goods have physically left the warehouse in these statuses (stock is deducted). */
export const STOCK_OUT_STATUSES: OrderStatus[] = ['ready_for_carrier', 'sent_to_carrier', 'carrier_received', 'out_for_delivery', 'at_desk', 'delivery_failed', 'delivered', 'returned'];

/** With the delivery company, not finished yet (tracked, synced with the carrier). */
export const IN_TRANSIT_STATUSES: OrderStatus[] = ['sent_to_carrier', 'carrier_received', 'out_for_delivery', 'at_desk', 'delivery_failed'];

/** Pieces, price and address can no longer change (the parcel exists). */
export const PARCEL_LOCKED_STATUSES: OrderStatus[] = ['ready_for_carrier', ...IN_TRANSIT_STATUSES, 'delivered', 'returned', 'return_received'];

/** Final outcomes from the carrier: a late, older tracking update never moves an order back from them. */
export const CARRIER_FINAL_STATUSES: OrderStatus[] = ['delivered', 'returned', 'return_received'];

/** Confirmed but not shipped yet: the goods are reserved. */
export const RESERVING_STATUSES: OrderStatus[] = ['confirmed'];

/** Statuses from which an order may be included in a carrier export. */
export const EXPORTABLE_STATUSES: OrderStatus[] = ['confirmed', 'ready_for_carrier'];

/** Shipped at least once (left the warehouse): used to warn about returning customers. */
export const SHIPPED_STATUSES: OrderStatus[] = [...IN_TRANSIT_STATUSES, 'delivered', 'returned', 'return_received'];

/** Reached "confirmed" or any later step of the delivery. */
export const CONFIRMED_OR_LATER: OrderStatus[] = ['confirmed', ...PARCEL_LOCKED_STATUSES];

/** Lead → confirmed → delivered funnel from order counts per status (forms, ads, offers). */
export function funnelOf(counts: Partial<Record<OrderStatus, number>>) {
  const sum = (list: readonly OrderStatus[]) => list.reduce((n, s) => n + (counts[s] ?? 0), 0);
  return {
    leads: sum(ORDER_STATUSES),
    pending: sum(QUEUE_STATUSES),
    confirmed: sum(CONFIRMED_OR_LATER),
    cancelled: counts.cancelled ?? 0,
    delivered: counts.delivered ?? 0,
    returned: sum(['returned', 'return_received']),
  };
}

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value);
}

/** Yalidine tracking status (French label) → CRM status. Accents and case do not matter. */
const YALIDINE_STATUSES: Record<string, OrderStatus | null> = {
  'pas encore expedie': 'sent_to_carrier',
  'a verifier': 'sent_to_carrier',
  'en preparation': 'sent_to_carrier',
  'pas encore ramasse': 'sent_to_carrier',
  'pret a expedier': 'sent_to_carrier',
  ramasse: 'carrier_received',
  bloque: 'carrier_received',
  debloque: 'carrier_received',
  transfert: 'carrier_received',
  expedie: 'carrier_received',
  centre: 'carrier_received',
  'en localisation': 'carrier_received',
  'vers wilaya': 'carrier_received',
  'recu a wilaya': 'carrier_received',
  'pret pour livreur': 'carrier_received',
  'en attente du client': 'at_desk',
  'sorti en livraison': 'out_for_delivery',
  'en attente': 'delivery_failed',
  'en alerte': 'delivery_failed',
  'tentative echouee': 'delivery_failed',
  'echec livraison': 'delivery_failed',
  'echange echoue': 'delivery_failed',
  livre: 'delivered',
  'retour vers centre': 'returned',
  'retourne au centre': 'returned',
  'retour transfert': 'returned',
  'retour groupe': 'returned',
  'retour a retirer': 'returned',
  'retour vers vendeur': 'returned',
  'retourne au vendeur': 'returned',
};

const plain = (label: string) =>
  label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Maps a Yalidine tracking status (French label) to a CRM status, when it is meaningful. */
export function statusFromYalidine(label: string): OrderStatus | null {
  const key = plain(label);
  if (key in YALIDINE_STATUSES) return YALIDINE_STATUSES[key] ?? null;
  // Unknown wording (new status at Yalidine): best guess from its words.
  if (key.startsWith('retour')) return 'returned';
  if (key.includes('echec') || key.includes('echou')) return 'delivery_failed';
  if (key.includes('annul')) return 'cancelled';
  return null;
}
