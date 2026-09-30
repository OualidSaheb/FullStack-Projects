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
  'delivered',
  'returned',
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
  sent_to_carrier: { label: 'تم إرسالها إلى Yalidine', short: 'مرسلة', stage: 'shipping', color: '#0891b2', icon: 'send', manual: false },
  carrier_received: { label: 'استلمتها شركة التوصيل', short: 'عند الناقل', stage: 'shipping', color: '#4338ca', icon: 'truck', manual: false },
  delivered: { label: 'تم التوصيل', short: 'موصلة', stage: 'closed', color: '#15803d', icon: 'package-check', manual: false },
  returned: { label: 'مرتجعة', short: 'مرتجعة', stage: 'closed', color: '#92400e', icon: 'undo-2', manual: false },
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

/** Statuses from which an order may be included in a carrier export. */
export const EXPORTABLE_STATUSES: OrderStatus[] = ['confirmed', 'ready_for_carrier'];

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && (ORDER_STATUSES as readonly string[]).includes(value);
}

/** Maps a Yalidine tracking status (French label) to a CRM status, when it is meaningful. */
export function statusFromYalidine(label: string): OrderStatus | null {
  const s = label.toLowerCase();
  if (s.includes('livré') && !s.includes('non')) return 'delivered';
  if (s.includes('retour') || s.includes('retourné')) return 'returned';
  if (s.includes('annul')) return 'cancelled';
  if (
    s.includes('ramassé') ||
    s.includes('expédié') ||
    s.includes('centre') ||
    s.includes('transfert') ||
    s.includes('sorti en livraison') ||
    s.includes('en livraison')
  )
    return 'carrier_received';
  return null;
}
