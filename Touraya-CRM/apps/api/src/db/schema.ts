import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type { FieldMap, OrderEventType, OrderStatus, PhoneIssue, Role } from '@touraya/shared';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').$type<Role>().notNull(),
  active: boolean('active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  ...timestamps,
});

export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  carrierName: text('carrier_name').notNull(),
  price: integer('price').notNull(),
  aliases: jsonb('aliases').$type<string[]>().notNull().default([]),
  sizes: jsonb('sizes').$type<string[]>().notNull().default([]),
  colors: jsonb('colors').$type<string[]>().notNull().default([]),
  active: boolean('active').notNull().default(true),
  ...timestamps,
});

export interface SyncStats {
  at: string;
  received: number;
  created: number;
  duplicates: number;
  skipped: number;
  errors: { row: number; sheet: string; message: string }[];
}

export const sources = pgTable('sources', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  spreadsheetId: text('spreadsheet_id').notNull(),
  formType: text('form_type').$type<'new' | 'legacy'>().notNull(),
  productId: integer('product_id').references(() => products.id, { onDelete: 'set null' }),
  sheetNames: jsonb('sheet_names').$type<string[]>().notNull().default(['Sheet1', 'Sheet2']),
  importFrom: text('import_from').notNull(), // YYYY-MM-DD
  fieldMap: jsonb('field_map').$type<FieldMap>().notNull().default({}),
  token: text('token').notNull().unique(),
  active: boolean('active').notNull().default(true),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  lastHeaders: jsonb('last_headers').$type<string[]>().notNull().default([]),
  lastSyncStats: jsonb('last_sync_stats').$type<SyncStats | null>(),
  ...timestamps,
});

export const exportBatches = pgTable('export_batches', {
  id: serial('id').primaryKey(),
  createdById: integer('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  orderIds: jsonb('order_ids').$type<string[]>().notNull(),
  orderCount: integer('order_count').notNull(),
  totalAmount: integer('total_amount').notNull(),
  /** Snapshot of the file so it can be downloaded again exactly as sent. */
  headers: jsonb('headers').$type<string[]>().notNull(),
  rows: jsonb('rows').$type<(string | number)[][]>().notNull(),
  fileName: text('file_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: serial('number').notNull().unique(),
    leadId: text('lead_id').unique(),
    sourceId: integer('source_id').references(() => sources.id, { onDelete: 'set null' }),
    sheetName: text('sheet_name'),
    sheetRow: integer('sheet_row'),
    status: text('status').$type<OrderStatus>().notNull().default('new'),

    customerName: text('customer_name').notNull().default(''),
    phone: text('phone'),
    phoneCustomer: text('phone_customer'),
    phoneFacebook: text('phone_facebook'),
    phoneAlt: text('phone_alt'),
    phoneIssue: text('phone_issue').$type<PhoneIssue>(),

    wilayaCode: integer('wilaya_code'),
    wilayaRaw: text('wilaya_raw'),
    communeName: text('commune_name'),
    communeRaw: text('commune_raw'),
    address: text('address'),

    productId: integer('product_id').references(() => products.id, { onDelete: 'set null' }),
    offerRaw: text('offer_raw'),
    quantity: integer('quantity').notNull().default(1),
    price: integer('price').notNull().default(0),
    size: text('size'),
    colors: text('colors'),

    assignedToId: integer('assigned_to_id').references(() => users.id, { onDelete: 'set null' }),
    callAttempts: integer('call_attempts').notNull().default(0),
    confirmedById: integer('confirmed_by_id').references(() => users.id, { onDelete: 'set null' }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),

    exportBatchId: integer('export_batch_id').references(() => exportBatches.id, { onDelete: 'set null' }),
    carrierTracking: text('carrier_tracking'),
    carrierStatus: text('carrier_status'),

    commentCount: integer('comment_count').notNull().default(0),
    lastComment: text('last_comment'),

    raw: jsonb('raw').$type<Record<string, unknown>>().notNull().default({}),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /** Lead time from Facebook (falls back to import time). */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('orders_status_idx').on(t.status),
    index('orders_created_idx').on(t.createdAt),
    index('orders_product_idx').on(t.productId),
    index('orders_wilaya_idx').on(t.wilayaCode),
    index('orders_assigned_idx').on(t.assignedToId),
    index('orders_phone_idx').on(t.phone),
    index('orders_tracking_idx').on(t.carrierTracking),
    index('orders_active_idx').on(t.createdAt).where(sql`${t.deletedAt} is null`),
  ],
);

export const orderComments = pgTable(
  'order_comments',
  {
    id: serial('id').primaryKey(),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    authorId: integer('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('order_comments_order_idx').on(t.orderId)],
);

export const orderEvents = pgTable(
  'order_events',
  {
    id: serial('id').primaryKey(),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    actorId: integer('actor_id').references(() => users.id, { onDelete: 'set null' }),
    type: text('type').$type<OrderEventType>().notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('order_events_order_idx').on(t.orderId)],
);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
