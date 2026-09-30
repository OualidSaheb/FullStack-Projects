import { z } from 'zod';
import { ORDER_STATUSES } from './statuses';
import { ROLES } from './roles';
import { LEAD_FIELDS } from './lead-mapping';
import { EXPORT_FIELDS, type ExportFieldKey } from './carrier-export';

/** Request/response contracts shared by the API (validation) and the web app (forms). */

const csv = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v), z.array(item));
const optionalInt = z.coerce.number().int().positive().optional();
const boolish = z.preprocess((v) => (v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : v), z.boolean());

export const ORDER_SORT_FIELDS = ['createdAt', 'updatedAt', 'price', 'status', 'wilayaCode', 'customerName'] as const;

export const orderFilterSchema = z.object({
  q: z.string().trim().optional(),
  status: csv(z.enum(ORDER_STATUSES)).optional(),
  productId: optionalInt,
  sourceId: optionalInt,
  wilayaCode: optionalInt,
  assignedTo: z.union([z.literal('me'), z.literal('none'), z.coerce.number().int()]).optional(),
  phoneIssue: boolish.optional(),
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

const nullableText = z.string().trim().max(500).nullable().optional();

export const orderUpdateSchema = z.object({
  customerName: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().max(30).optional(),
  phoneAlt: nullableText,
  wilayaCode: z.number().int().min(1).max(58).nullable().optional(),
  communeName: nullableText,
  address: nullableText,
  productId: z.number().int().positive().nullable().optional(),
  quantity: z.number().int().min(1).max(50).optional(),
  price: z.number().int().min(0).optional(),
  size: nullableText,
  colors: nullableText,
  /** Optional reason, stored as a comment together with the change. */
  reason: z.string().trim().max(500).optional(),
});
export type OrderUpdate = z.infer<typeof orderUpdateSchema>;

export const statusChangeSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  comment: z.string().trim().max(1000).optional(),
});
export type StatusChange = z.infer<typeof statusChangeSchema>;

export const commentSchema = z.object({ body: z.string().trim().min(1).max(2000) });

export const bulkActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status'), ids: z.array(z.string().uuid()).min(1), status: z.enum(ORDER_STATUSES) }),
  z.object({ action: z.literal('assign'), ids: z.array(z.string().uuid()).min(1), userId: z.number().int().nullable() }),
  z.object({ action: z.literal('delete'), ids: z.array(z.string().uuid()).min(1) }),
  z.object({ action: z.literal('restore'), ids: z.array(z.string().uuid()).min(1) }),
  z.object({ action: z.literal('purge'), ids: z.array(z.string().uuid()).min(1) }),
]);
export type BulkAction = z.infer<typeof bulkActionSchema>;

/** Soft-delete everything matching a filter (e.g. all tests, all cancelled of an offer). */
export const deleteByFilterSchema = z.object({ filter: orderFilterSchema, confirmCount: z.number().int().min(1) });

export const productSchema = z.object({
  name: z.string().trim().min(1).max(120),
  carrierName: z.string().trim().min(1).max(120),
  price: z.number().int().min(0),
  aliases: z.array(z.string().trim().min(1)).default([]),
  sizes: z.array(z.string().trim().min(1)).default([]),
  colors: z.array(z.string().trim().min(1)).default([]),
  active: z.boolean().default(true),
});
export type ProductInput = z.infer<typeof productSchema>;

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

export const fieldMapSchema = z.record(z.enum(LEAD_FIELDS), z.array(z.string()));

export const sourceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  spreadsheetId: z.string().trim().min(10).max(120),
  formType: z.enum(['new', 'legacy']),
  productId: z.number().int().positive().nullable(),
  sheetNames: z.array(z.string().trim().min(1)).min(1).default(['Sheet1', 'Sheet2']),
  importFrom: z.string().date(),
  fieldMap: fieldMapSchema.default({}),
  active: z.boolean().default(true),
});
export type SourceInput = z.infer<typeof sourceSchema>;

/** Payload sent by the Google Apps Script. */
export const ingestSchema = z.object({
  sheetName: z.string().max(120),
  rows: z
    .array(z.object({ rowNumber: z.number().int().nonnegative(), values: z.record(z.string(), z.unknown()) }))
    .max(500),
});
export type IngestPayload = z.infer<typeof ingestSchema>;

const exportFieldKeys = Object.keys(EXPORT_FIELDS) as [ExportFieldKey, ...ExportFieldKey[]];
export const exportColumnSchema = z.union([
  z.object({ header: z.string().min(1), field: z.enum(exportFieldKeys) }),
  z.object({ header: z.string().min(1), value: z.union([z.string(), z.number()]) }),
]);

export const settingsSchema = z.object({
  quickComments: z.array(z.string().trim().min(1)).default([]),
  exportColumns: z.array(exportColumnSchema).min(1),
  exportFormat: z.enum(['xlsx', 'csv']).default('xlsx'),
  yalidine: z.object({
    enabled: z.boolean().default(false),
    apiBaseUrl: z.string().url().default('https://api.yalidine.app/v1'),
    apiId: z.string().default(''),
    /** Write-only from the UI: an empty string keeps the stored token. */
    apiToken: z.string().default(''),
    webhookSecret: z.string().default(''),
    fromWilayaName: z.string().default('Alger'),
  }),
});
export type Settings = z.infer<typeof settingsSchema>;

export const exportRequestSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(1000) });
