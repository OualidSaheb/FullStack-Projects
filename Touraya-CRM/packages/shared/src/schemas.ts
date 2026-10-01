import { z } from 'zod';
import { ORDER_STATUSES } from './statuses';
import { ROLES } from './roles';
import { LEAD_FIELDS } from './lead-mapping';
import { EXPORT_FIELDS, type ExportFieldKey } from './carrier-export';
import { CARRIER_PROVIDER_KEYS } from './carriers';

/** Request contracts shared by the API (validation) and the web app (forms). */

const csv = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v), z.array(item));
const optionalId = z.coerce.number().int().positive().optional();
const boolish = z.preprocess((v) => (v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : v), z.boolean());
const nullableText = z.string().trim().max(500).nullable().optional();
const names = z.array(z.string().trim().min(1).max(60)).max(60);

// ── Orders ───────────────────────────────────────────────────────────────

export const ORDER_PROBLEMS = ['phone', 'commune', 'duplicate', 'variants'] as const;
export type OrderProblem = (typeof ORDER_PROBLEMS)[number];

export const ORDER_SORT_FIELDS = ['createdAt', 'updatedAt', 'nextCallAt', 'price', 'status', 'wilayaCode', 'customerName'] as const;

export const orderFilterSchema = z.object({
  q: z.string().trim().optional(),
  status: csv(z.enum(ORDER_STATUSES)).optional(),
  offerId: optionalId,
  productId: optionalId,
  sourceId: optionalId,
  carrierId: optionalId,
  wilayaCode: optionalId,
  assignedTo: z.union([z.literal('me'), z.literal('none'), z.coerce.number().int()]).optional(),
  problem: z.enum(ORDER_PROBLEMS).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  deleted: boolish.optional(),
});
export type OrderFilter = z.infer<typeof orderFilterSchema>;

export const orderListQuerySchema = orderFilterSchema.extend({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(200).default(25),
  sort: z.enum(ORDER_SORT_FIELDS).default('createdAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;

export const orderItemInputSchema = z.object({
  productId: z.number().int().positive(),
  size: z.string().trim().max(40).nullable(),
  color: z.string().trim().max(40).nullable(),
  quantity: z.number().int().min(1).max(50).default(1),
});
export type OrderItemInput = z.infer<typeof orderItemInputSchema>;

export const orderUpdateSchema = z.object({
  customerName: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(30).optional(),
  phoneAlt: nullableText,
  wilayaCode: z.number().int().min(1).max(58).nullable().optional(),
  communeName: nullableText,
  address: nullableText,
  offerId: z.number().int().positive().nullable().optional(),
  price: z.number().int().min(0).optional(),
  /** Full replacement of the pieces (size/color per piece). */
  items: z.array(orderItemInputSchema).max(50).optional(),
  deliveryType: z.enum(['home', 'stopdesk']).optional(),
  stopdeskId: nullableText,
  carrierId: z.number().int().positive().nullable().optional(),
  /** Optional reason, stored as a comment together with the change. */
  reason: z.string().trim().max(500).optional(),
});
export type OrderUpdate = z.infer<typeof orderUpdateSchema>;

export const statusChangeSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  comment: z.string().trim().max(1000).optional(),
  /** "Call me later": exact time for status postponed. */
  callAt: z.string().datetime().optional(),
  cancelReason: z.string().trim().max(120).optional(),
});
export type StatusChange = z.infer<typeof statusChangeSchema>;

export const commentSchema = z.object({ body: z.string().trim().min(1).max(2000) });

const ids = z.array(z.string().uuid()).min(1).max(1000);
export const bulkActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status'), ids, status: z.enum(ORDER_STATUSES), cancelReason: z.string().max(120).optional() }),
  z.object({ action: z.literal('assign'), ids, userId: z.number().int().nullable() }),
  z.object({ action: z.literal('delete'), ids }),
  z.object({ action: z.literal('restore'), ids }),
  z.object({ action: z.literal('purge'), ids }),
]);
export type BulkAction = z.infer<typeof bulkActionSchema>;

/** Soft-delete everything matching a filter (e.g. all tests, all cancelled of an offer). */
export const deleteByFilterSchema = z.object({ filter: orderFilterSchema, confirmCount: z.number().int().min(1) });

export const returnReceiveSchema = z.object({
  condition: z.enum(['restock', 'damaged']),
  note: z.string().trim().max(500).optional(),
});

// ── Catalog & stock ──────────────────────────────────────────────────────

export const productSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sku: z.string().trim().max(60).default(''),
  sizes: names.default([]),
  colors: names.default([]),
  costPrice: z.number().int().min(0).default(0),
  lowStockAlert: z.number().int().min(0).default(3),
  active: z.boolean().default(true),
});
export type ProductInput = z.infer<typeof productSchema>;

/** A sellable offer: N pieces of a product for a price (1 = 2000, 2 = 3500, 3 = 4999…). */
export const offerSchema = z.object({
  productId: z.number().int().positive(),
  name: z.string().trim().min(1).max(120),
  carrierName: z.string().trim().min(1).max(120),
  units: z.number().int().min(1).max(50),
  price: z.number().int().min(0),
  aliases: z.array(z.string().trim().min(1)).default([]),
  active: z.boolean().default(true),
});
export type OfferInput = z.infer<typeof offerSchema>;

export const STOCK_MOVEMENT_TYPES = ['purchase', 'adjust', 'ship', 'ship_reversal', 'return', 'damaged'] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];
export const STOCK_MOVEMENT_LABELS: Record<StockMovementType, string> = {
  purchase: 'دخول سلعة',
  adjust: 'تصحيح الجرد',
  ship: 'خروج للتوصيل',
  ship_reversal: 'إلغاء خروج',
  return: 'رجوع مرتجع',
  damaged: 'تالف',
};

export const stockMovementSchema = z.object({
  variantId: z.number().int().positive(),
  type: z.enum(['purchase', 'adjust', 'damaged']),
  quantity: z.number().int().refine((n) => n !== 0, 'الكمية لا يمكن أن تكون 0'),
  note: z.string().trim().max(300).optional(),
});

// ── Customers ────────────────────────────────────────────────────────────

export const blacklistSchema = z.object({ blacklisted: z.boolean(), reason: z.string().trim().max(300).optional() });

// ── Users ────────────────────────────────────────────────────────────────

export const userCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
  role: z.enum(ROLES),
  active: z.boolean().default(true),
});
export const userUpdateSchema = userCreateSchema.partial().extend({ password: z.string().min(8).max(200).optional() });
export type UserCreate = z.infer<typeof userCreateSchema>;

export const loginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });

// ── Sources (where orders come from) ─────────────────────────────────────

export const fieldMapSchema = z.record(z.enum(LEAD_FIELDS), z.array(z.string()));

export const SOURCE_TYPES = {
  google_sheet: 'Google Sheet (Facebook Lead Ads)',
  webhook: 'Webhook (موقع، Make/Zapier، أي فورم)',
} as const;

export const sourceSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    type: z.enum(['google_sheet', 'webhook']).default('google_sheet'),
    spreadsheetId: z.string().trim().max(120).default(''),
    formType: z.enum(['new', 'legacy']).default('new'),
    offerId: z.number().int().positive().nullable(),
    sheetNames: z.array(z.string().trim().min(1)).default(['Sheet1', 'Sheet2']),
    importFrom: z.string().date(),
    syncMinutes: z.union([z.literal(1), z.literal(5), z.literal(10), z.literal(15), z.literal(30)]).default(5),
    fieldMap: fieldMapSchema.default({}),
    active: z.boolean().default(true),
  })
  .refine((s) => s.type !== 'google_sheet' || s.spreadsheetId.length >= 10, { path: ['spreadsheetId'], message: 'معرف Google Sheet مطلوب' });
export type SourceInput = z.infer<typeof sourceSchema>;

/** Rows sent by the Google Apps Script or any webhook. */
export const ingestSchema = z.object({
  sheetName: z.string().max(120),
  rows: z
    .array(z.object({ rowNumber: z.number().int().nonnegative(), values: z.record(z.string(), z.unknown()) }))
    .max(500),
});
export type IngestPayload = z.infer<typeof ingestSchema>;

// ── Carriers ─────────────────────────────────────────────────────────────

const exportFieldKeys = Object.keys(EXPORT_FIELDS) as [ExportFieldKey, ...ExportFieldKey[]];
export const exportColumnSchema = z.union([
  z.object({ header: z.string().min(1), field: z.enum(exportFieldKeys) }),
  z.object({ header: z.string().min(1), value: z.union([z.string(), z.number()]) }),
]);

export const carrierSchema = z.object({
  name: z.string().trim().min(1).max(80),
  provider: z.enum(CARRIER_PROVIDER_KEYS),
  active: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  apiEnabled: z.boolean().default(false),
  /** Write-only: empty strings keep the stored values. */
  credentials: z.object({ apiId: z.string().default(''), apiToken: z.string().default('') }).default({}),
  config: z.object({
    apiBaseUrl: z.string().default(''),
    fromWilayaName: z.string().default('Alger'),
    webhookSecret: z.string().default(''),
    parcelDefaults: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
    exportColumns: z.array(exportColumnSchema).min(1),
    exportFormat: z.enum(['xlsx', 'csv']).default('xlsx'),
  }),
});
export type CarrierInput = z.infer<typeof carrierSchema>;

export const carrierRatesSchema = z.array(
  z.object({ wilayaCode: z.number().int().min(1).max(58), homeFee: z.number().int().min(0).nullable(), deskFee: z.number().int().min(0).nullable() }),
);

export const exportRequestSchema = z.object({ ids, carrierId: z.number().int().positive().optional() });

// ── Settings ─────────────────────────────────────────────────────────────

export const callPolicySchema = z.object({
  workStart: z.string().regex(/^\d{2}:\d{2}$/),
  workEnd: z.string().regex(/^\d{2}:\d{2}$/),
  workDays: z.array(z.number().int().min(0).max(6)),
  retryDelays: z.array(z.number().int().min(5).max(7 * 24 * 60)).min(1),
  maxAttempts: z.number().int().min(1).max(10),
  autoCancelAfterMax: z.boolean(),
});

export const settingsSchema = z.object({
  quickComments: z.array(z.string().trim().min(1)).default([]),
  cancelReasons: z.array(z.string().trim().min(1)).default([]),
  callPolicy: callPolicySchema,
  /** New orders: leave unassigned, or give each to the agent with the fewest open orders. */
  assignment: z.enum(['manual', 'balanced']).default('manual'),
  /** Same phone with an open order within N days → "possible duplicate". */
  duplicateWindowDays: z.number().int().min(0).max(30).default(3),
});
export type Settings = z.infer<typeof settingsSchema>;
