import { levenshtein } from './text';

/**
 * Algerian phone normalisation.
 * Mobile: 05/06/07 + 8 digits. Landline: 02/03/04 + 7 digits.
 */
const MOBILE = /^0[567]\d{8}$/;
const LANDLINE = /^0[234]\d{7}$/;

export interface NormalizedPhone {
  raw: string;
  value: string; // best-effort cleaned digits ('' when nothing usable)
  valid: boolean;
}

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

function toLatinDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => String(Math.max(ARABIC_DIGITS.indexOf(d), PERSIAN_DIGITS.indexOf(d))));
}

export function isValidPhone(value: string): boolean {
  return MOBILE.test(value) || LANDLINE.test(value);
}

export function normalizePhone(input: unknown): NormalizedPhone {
  const raw = input === null || input === undefined ? '' : String(input).trim();
  let s = toLatinDigits(raw)
    .replace(/^p:/i, '')
    .replace(/[^\d+]/g, '');

  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('00')) s = s.slice(2);
  if (s.startsWith('213') && s.length >= 11) s = s.slice(3);
  if (!s.startsWith('0') && (s.length === 9 || s.length === 8)) s = `0${s}`;

  return { raw, value: s, valid: isValidPhone(s) };
}

export const PHONE_ISSUES = {
  missing: 'لا يوجد رقم هاتف',
  invalid: 'رقم الهاتف غير صالح',
  customer_invalid_used_facebook: 'رقم الزبون غير صالح — تم اعتماد رقم Facebook',
  customer_typo_used_facebook: 'رقم الزبون فيه خطأ بسيط — تم اعتماد رقم Facebook',
  customer_missing_used_facebook: 'الزبون لم يكتب رقماً — تم اعتماد رقم Facebook',
  differs_from_facebook: 'رقم الزبون مختلف عن رقم Facebook',
} as const;

export type PhoneIssue = keyof typeof PHONE_ISSUES;

/** Issues that need the agent's attention (a warning badge in the table). */
export const BLOCKING_PHONE_ISSUES: PhoneIssue[] = [
  'missing',
  'invalid',
  'customer_invalid_used_facebook',
  'customer_typo_used_facebook',
];

export interface ResolvedPhone {
  phone: string | null;
  source: 'customer' | 'facebook' | 'none';
  customer: NormalizedPhone;
  facebook: NormalizedPhone;
  issue: PhoneIssue | null;
}

/**
 * Picks the phone to call. The number typed by the customer wins; the
 * Facebook account phone is only a fallback when the typed one is unusable.
 */
export function resolvePhone(customerInput: unknown, facebookInput: unknown): ResolvedPhone {
  const customer = normalizePhone(customerInput);
  const facebook = normalizePhone(facebookInput);

  if (customer.valid) {
    const differs = facebook.valid && facebook.value !== customer.value;
    return { phone: customer.value, source: 'customer', customer, facebook, issue: differs ? 'differs_from_facebook' : null };
  }
  if (facebook.valid) {
    let issue: PhoneIssue = 'customer_invalid_used_facebook';
    if (!customer.value) issue = 'customer_missing_used_facebook';
    else if (levenshtein(customer.value, facebook.value) <= 2) issue = 'customer_typo_used_facebook';
    return { phone: facebook.value, source: 'facebook', customer, facebook, issue };
  }
  const fallback = customer.value || facebook.value;
  return {
    phone: fallback || null,
    source: fallback ? (customer.value ? 'customer' : 'facebook') : 'none',
    customer,
    facebook,
    issue: fallback ? 'invalid' : 'missing',
  };
}
