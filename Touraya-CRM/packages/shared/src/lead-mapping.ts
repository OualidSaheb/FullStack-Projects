import { matchCommune, matchWilaya } from './geo';
import { normalizePhone } from './phone';
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
  'formId',
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
  formId: 'معرف الفورم (Facebook)',
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
  formId: ['form_id'],
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
  /** Fields recognised from the answers themselves (e.g. conditional_question_1 = the wilaya). */
  inferred: LeadField[];
}

/** Columns Facebook adds to every lead (ids, ad / campaign names): never read as answers. */
const META_COLUMNS = new Set(
  ['id', 'created_time', 'ad_id', 'ad_name', 'adset_id', 'adset_name', 'campaign_id', 'campaign_name', 'form_id', 'form_name', 'is_organic', 'platform', 'lead_status', 'inbox_url', 'retailer_item_id'].map(normalizeText),
);
const hasLetters = (v: string) => /\p{L}/u.test(v);

/** "الجزائر", "Alger", "16 - Alger" — but not "2 قطع" (a number followed by anything else). */
function isWilayaAnswer(text: string): boolean {
  const m = matchWilaya(text);
  if (!m?.exact || !hasLetters(text)) return false;
  const rest = text.replace(/^\d{1,2}\s*[-–.:]?\s*/, '');
  return rest === text || matchWilaya(rest)?.value.code === m.value.code;
}

/**
 * Questions whose column title says nothing — Facebook names the follow-up of a
 * conditional question "conditional_question_1", "conditional_question_2"… —
 * are recognised by their answers: a wilaya name, a commune of that wilaya, a
 * phone number. Only columns no other field uses, never Facebook's own columns.
 */
function inferFromAnswers(row: Record<string, unknown>, values: LeadValues, matched: Partial<Record<LeadField, string>>): LeadField[] {
  const used = new Set(Object.values(matched));
  const free = Object.keys(row)
    .filter((h) => !used.has(h) && !h.startsWith('_') && !META_COLUMNS.has(normalizeText(h)))
    .map((h) => ({ header: h, text: row[h] === null || row[h] === undefined ? '' : String(row[h]).trim() }))
    .filter((c) => c.text && c.text.length <= 60);
  const inferred: LeadField[] = [];
  const take = (field: LeadField, test: (text: string) => boolean) => {
    if (values[field]) return;
    const hit = free.find((c) => !used.has(c.header) && test(c.text));
    if (!hit) return;
    values[field] = hit.text;
    matched[field] = hit.header;
    used.add(hit.header);
    inferred.push(field);
  };
  take('wilaya', isWilayaAnswer);
  const wilayaCode = matchWilaya(values.wilaya)?.value.code;
  take('commune', (t) => hasLetters(t) && Boolean(matchCommune(t, wilayaCode)?.exact));
  take('phoneCustomer', (t) => normalizePhone(t).valid);
  return inferred;
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
  joinPerPieceQuestions(row, values, matchedHeaders);
  const inferred = inferFromAnswers(row, values, matchedHeaders);
  if (values.leadId) values.leadId = cleanLeadId(values.leadId);
  if (values.formId) values.formId = cleanLeadId(values.formId.replace(/^f:/i, ''));
  return { values, matchedHeaders, inferred };
}

/** Words that make a question a color / size question ("لون القطعة 2", "مقاس القطعة الأولى", "Couleur 1"). */
const PIECE_WORDS: Partial<Record<LeadField, string[]>> = {
  colors: ['لون', 'الوان', 'ألوان', 'color', 'colour', 'couleur'],
  size: ['مقاس', 'قياس', 'size', 'taille', 'pointure'],
};

const ORDINALS: [RegExp, number][] = [
  [/(^| )(ال)?(اول|اولي)($| )|first|premier|premiere/, 1],
  [/(^| )(ال)?ثانيه?($| )|second|deuxieme/, 2],
  [/(^| )(ال)?ثالثه?($| )|third|troisieme/, 3],
  [/(^| )(ال)?رابعه?($| )|fourth|quatrieme/, 4],
  [/(^| )(ال)?خامسه?($| )|fifth|cinquieme/, 5],
];
/** Piece number written in a question title (1, "الأول", "الثانية", "second"…); 99 when none. */
function pieceRank(header: string): number {
  const h = normalizeText(header);
  const digit = /(\d+)/.exec(h);
  if (digit) return Number(digit[1]);
  return ORDINALS.find(([re]) => re.test(h))?.[1] ?? 99;
}

/**
 * One question per piece: Facebook's Google Sheet keeps a single answer of a
 * "select all that apply" question, so forms ask "لون القطعة 1", "لون القطعة 2"…
 * All color (size) questions are read together, in column order = piece order.
 */
function joinPerPieceQuestions(row: Record<string, unknown>, values: LeadValues, matched: Partial<Record<LeadField, string>>) {
  const usedElsewhere = new Set(Object.entries(matched).filter(([f]) => !(f in PIECE_WORDS)).map(([, h]) => h));
  for (const [field, keys] of Object.entries(PIECE_WORDS) as [LeadField, string[]][]) {
    const normalizedKeys = keys.map(normalizeText);
    const headers = Object.keys(row).filter(
      (h) => h === matched[field] || (!usedElsewhere.has(h) && !META_COLUMNS.has(normalizeText(h)) && normalizedKeys.some((k) => normalizeText(h).includes(k))),
    );
    if (headers.length < 2) continue;
    // "اللون الأول / الثاني…" or "القطعة 1 / 2…": piece order from the title, else column order.
    headers.sort((a, b) => pieceRank(a) - pieceRank(b));
    const answers = headers.map((h) => (row[h] === null || row[h] === undefined ? '' : String(row[h]).trim())).filter(Boolean);
    if (answers.length) values[field] = answers.join(' | ');
    matched[field] ??= headers[0];
    headers.forEach((h) => usedElsewhere.add(h));
  }
}

/**
 * Which form a lead belongs to: Facebook's form_id when the sheet has it, else
 * the form name, else the sheet tab it was written to (one form per tab).
 */
export function formIdentity(values: LeadValues, where: { spreadsheetId?: string; spreadsheetName?: string; sheetName: string; sourceId: number; sourceName: string }) {
  if (values.formId) return { key: `fb:${values.formId}`, name: values.formName ?? `Form ${values.formId}` };
  if (values.formName) return { key: `name:${normalizeText(values.formName)}`, name: values.formName };
  const file = where.spreadsheetId || `source-${where.sourceId}`;
  return { key: `sheet:${file}:${where.sheetName}`, name: `${where.spreadsheetName || where.sourceName} / ${where.sheetName}` };
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
