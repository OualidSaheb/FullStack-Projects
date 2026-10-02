import { normalizeText } from './text';

/**
 * Canonical fields a Facebook lead row can provide. Each Google Sheet may name
 * its columns differently (the Facebook form questions), so every source has a
 * field map; when a field is not mapped explicitly, the header candidates
 * below are tried. The full raw row is always stored with the order, so
 * renaming questions later never breaks existing orders.
 */
export const LEAD_FIELDS = [
  'leadId',
  'createdAt',
  'fullName',
  'phoneCustomer',
  'phoneFacebook',
  'wilaya',
  'commune',
  'address',
  'offer',
  'quantity',
  'size',
  'colors',
  'formName',
  'campaignName',
  'adName',
  'platform',
] as const;
export type LeadField = (typeof LEAD_FIELDS)[number];

export const LEAD_FIELD_LABELS: Record<LeadField, string> = {
  leadId: 'Facebook Lead ID',
  createdAt: 'تاريخ الطلب',
  fullName: 'الاسم الكامل',
  phoneCustomer: 'رقم الزبون (من الفورم)',
  phoneFacebook: 'رقم Facebook',
  wilaya: 'الولاية',
  commune: 'البلدية',
  address: 'العنوان',
  offer: 'العرض / المنتج',
  quantity: 'الكمية',
  size: 'المقاس',
  colors: 'الألوان',
  formName: 'اسم الفورم',
  campaignName: 'الحملة',
  adName: 'الإعلان',
  platform: 'المنصة',
};

/** Header candidates, most specific first. Compared after normalizeText(). */
export const DEFAULT_HEADER_CANDIDATES: Record<LeadField, string[]> = {
  leadId: ['id', 'lead_id', 'leadgen_id'],
  createdAt: ['created_time', 'created_at', 'date'],
  fullName: ['full_name', 'الاسم_الكامل', 'الاسم_واللقب', 'الاسم', 'name', 'nom'],
  phoneCustomer: ['رقمك_الخاص_للتواصل_معاك', 'رقم_الهاتف', 'رقمك', 'الهاتف', 'رقم'],
  phoneFacebook: ['phone_number', 'phone'],
  wilaya: ['الولاية', 'ولاية', 'ولايتك', 'wilaya', 'state', 'province'],
  commune: ['البلدية', 'بلدية', 'بلديتك', 'commune', 'city', 'المدينة', 'ville'],
  address: ['العنوان', 'عنوانك', 'address', 'street_address', 'adresse', 'مكان_السكن', 'مقر_السكن', 'السكن'],
  offer: ['العرض', 'offer', 'اختر_العرض', 'المنتج', 'product'],
  quantity: ['الكمية', 'quantity', 'qty'],
  size: ['المقاس', 'مقاس', 'المقاسات', 'القياس', 'size', 'taille', 'pointure'],
  colors: ['الألوان', 'الالوان', 'اللون', 'الوان', 'color', 'colors', 'couleur'],
  formName: ['form_name'],
  campaignName: ['campaign_name'],
  adName: ['ad_name'],
  platform: ['platform'],
};

export type FieldMap = Partial<Record<LeadField, string[]>>;
export type LeadValues = Partial<Record<LeadField, string>>;

export interface ParsedLead {
  values: LeadValues;
  /** Which sheet header fed each field — shown in the admin mapping screen. */
  matchedHeaders: Partial<Record<LeadField, string>>;
}

/** Resolves which header of a sheet feeds each lead field. */
export function resolveHeaders(headers: string[], fieldMap: FieldMap = {}): Partial<Record<LeadField, string>> {
  const normalized = headers.map((h) => ({ header: h, key: normalizeText(h) }));
  const used = new Set<string>();
  // Headers that are exactly some field's known name are never "loosely" grabbed by another field
  // (e.g. "ad_name" must not feed fullName through the "name" candidate).
  const reserved = new Set(Object.values(DEFAULT_HEADER_CANDIDATES).flat().map(normalizeText));
  const result: Partial<Record<LeadField, string>> = {};

  const find = (candidates: string[], loose: boolean) => {
    for (const candidate of candidates) {
      const c = normalizeText(candidate);
      if (!c) continue;
      const hit =
        normalized.find((h) => !used.has(h.header) && h.key === c) ??
        (loose
          ? normalized.find((h) => !used.has(h.header) && !reserved.has(h.key) && c.length >= 4 && h.key.includes(c))
          : undefined);
      if (hit) return hit.header;
    }
    return undefined;
  };

  // Explicit mapping first, then exact default candidates, then "contains" matches.
  for (const pass of ['explicit', 'exact', 'loose'] as const) {
    for (const field of LEAD_FIELDS) {
      if (result[field]) continue;
      const candidates = pass === 'explicit' ? fieldMap[field] ?? [] : DEFAULT_HEADER_CANDIDATES[field];
      const header = find(candidates, pass !== 'exact');
      if (header) {
        result[field] = header;
        used.add(header);
      }
    }
  }
  return result;
}

export function parseLeadRow(row: Record<string, unknown>, fieldMap: FieldMap = {}): ParsedLead {
  const matchedHeaders = resolveHeaders(Object.keys(row), fieldMap);
  const values: LeadValues = {};
  for (const [field, header] of Object.entries(matchedHeaders) as [LeadField, string][]) {
    const v = row[header];
    const text = v === null || v === undefined ? '' : String(v).trim();
    if (text) values[field] = text;
  }
  if (values.leadId) values.leadId = cleanLeadId(values.leadId);
  return { values, matchedHeaders };
}

/** Facebook exports ids as "l:1234567890" — keep only the digits/identifier. */
export function cleanLeadId(id: string): string {
  return id.trim().replace(/^l:/i, '');
}

/** Facebook multi-choice answers come as "rouge_noir" or "أسود, أبيض". */
export function humanizeAnswer(value: string | undefined): string {
  return (value ?? '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
}

export function parseLeadDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
