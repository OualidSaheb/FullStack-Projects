/**
 * Customer reliability from past orders (all offers, all carriers), keyed by
 * phone. Shown to the agent before calling; the main defense against COD refusals.
 */
export interface CustomerHistory {
  orders: number;
  delivered: number;
  returned: number;
  cancelled: number;
  blacklisted: boolean;
}

export type CustomerRiskLevel = 'new' | 'good' | 'watch' | 'risky' | 'blocked';

export const RISK_META: Record<CustomerRiskLevel, { label: string; tone: 'neutral' | 'ok' | 'warn' | 'danger' }> = {
  new: { label: 'زبون جديد', tone: 'neutral' },
  good: { label: 'زبون موثوق', tone: 'ok' },
  watch: { label: 'انتبه: سبق ورجّع طلبية', tone: 'warn' },
  risky: { label: 'خطر: يرجّع الطلبيات كثيراً', tone: 'danger' },
  blocked: { label: 'في القائمة السوداء', tone: 'danger' },
};

export function customerRisk(h: CustomerHistory): CustomerRiskLevel {
  if (h.blacklisted) return 'blocked';
  const closed = h.delivered + h.returned;
  if (h.returned >= 2 && h.returned / closed >= 0.5) return 'risky';
  if (h.returned >= 1) return 'watch';
  if (h.delivered >= 1) return 'good';
  return 'new';
}

/** Problems surfaced as badges on an order; computed, never stored. */
export const ORDER_FLAGS = {
  phone: 'مشكل في الهاتف',
  commune: 'البلدية غير مطابقة',
  duplicate: 'طلب مكرر محتمل',
  risky: 'زبون خطر',
  blacklisted: 'قائمة سوداء',
  variants: 'مقاس/لون ناقص',
  stock: 'غير متوفر في المخزون',
} as const;
export type OrderFlag = keyof typeof ORDER_FLAGS;
