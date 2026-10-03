import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, primaryKey, serial, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type {
  CarrierConfig,
  CarrierProvider,
  DeliveryType,
  FieldMap,
  OrderEventType,
  OrderStatus,
  PhoneIssue,
  Role,
  StockMovementType,
} from '@touraya/shared';

// Builders are created per table (a column builder must not be shared between tables).
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').$type<Role>().notNull(),
  active: boolean('active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  /** Removed employee: cannot log in, hidden from lists, name kept in the activity log. */
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ── Catalog & stock ──────────────────────────────────────────────────────

/** A physical product (pants, suit…) with its option lists. */
export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  sku: text('sku').notNull().default(''),
  sizes: jsonb('sizes').$type<string[]>().notNull().default([]),
  colors: jsonb('colors').$type<string[]>().notNull().default([]),
  costPrice: integer('cost_price').notNull().default(0),
  lowStockAlert: integer('low_stock_alert').notNull().default(3),
  active: boolean('active').notNull().default(true),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** One stock-keeping unit per size × color ('' when the product has no such option). */
export const variants = pgTable(
  'variants',
  {
    id: serial('id').primaryKey(),
    productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
    size: text('size').notNull().default(''),
    color: text('color').notNull().default(''),
    sku: text('sku').notNull().default(''),
    /** On hand. Only changed together with a stock_movements row. */
    stock: integer('stock').notNull().default(0),
    active: boolean('active').notNull().default(true),
  },
  (t) => [uniqueIndex('variants_option_idx').on(t.productId, t.size, t.color)],
);

/** What is sold: N pieces of a product for a price, with the coded name sent to the carrier. */
export const offers = pgTable('offers', {
  id: serial('id').primaryKey(),
  productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
  name: text('name').notNull(),
  carrierName: text('carrier_name').notNull(),
  units: integer('units').notNull().default(1),
  price: integer('price').notNull(),
  aliases: jsonb('aliases').$type<string[]>().notNull().default([]),
  active: boolean('active').notNull().default(true),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ── Carriers ─────────────────────────────────────────────────────────────

export const carriers = pgTable('carriers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  provider: text('provider').$type<CarrierProvider>().notNull(),
  active: boolean('active').notNull().default(true),
  isDefault: boolean('is_default').notNull().default(false),
  apiEnabled: boolean('api_enabled').notNull().default(false),
  /** Encrypted JSON {apiId, apiToken}. */
  credentials: text('credentials').notNull().default(''),
  config: jsonb('config').$type<CarrierConfig>().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Delivery price the customer pays, per wilaya (home / stop desk). */
export const carrierRates = pgTable(
  'carrier_rates',
  {
    carrierId: integer('carrier_id').notNull().references(() => carriers.id, { onDelete: 'cascade' }),
    wilayaCode: integer('wilaya_code').notNull(),
    homeFee: integer('home_fee'),
    deskFee: integer('desk_fee'),
  },
  (t) => [primaryKey({ columns: [t.carrierId, t.wilayaCode] })],
);

// ── Customers & sources ──────────────────────────────────────────────────

export const customers = pgTable('customers', {
  id: serial('id').primaryKey(),
  phone: text('phone').notNull().unique(),
  name: text('name').notNull().default(''),
  blacklisted: boolean('blacklisted').notNull().default(false),
  blacklistReason: text('blacklist_reason'),
  createdAt: createdAt(),
});

export interface SyncStats {
  at: string;
  received: number;
  created: number;
  duplicates: number;
  skipped: number;
  errors: { row: number; sheet: string; message: string }[];
}

export interface DriveFile {
  spreadsheetId: string;
  name: string;
  tabs: { name: string; rows: number }[];
}

export const sources = pgTable('sources', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').$type<'google_sheet' | 'google_drive' | 'webhook'>().notNull().default('google_sheet'),
  spreadsheetId: text('spreadsheet_id').notNull().default(''),
  formType: text('form_type').$type<'new' | 'legacy'>().notNull().default('new'),
  offerId: integer('offer_id').references(() => offers.id, { onDelete: 'set null' }),
  sheetNames: jsonb('sheet_names').$type<string[]>().notNull().default(['Sheet1', 'Sheet2']),
  importFrom: text('import_from').notNull(), // YYYY-MM-DD
  /** Apps Script trigger interval (1, 5, 10, 15 or 30 minutes). */
  syncMinutes: integer('sync_minutes').$type<1 | 5 | 10 | 15 | 30>().notNull().default(5),
  fieldMap: jsonb('field_map').$type<FieldMap>().notNull().default({}),
  token: text('token').notNull().unique(),
  active: boolean('active').notNull().default(true),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  lastHeaders: jsonb('last_headers').$type<string[]>().notNull().default([]),
  lastSyncStats: jsonb('last_sync_stats').$type<SyncStats | null>(),
  /** google_drive: the Drive folder the script reads (every spreadsheet, every tab). */
  folderName: text('folder_name').notNull().default(''),
  /** google_drive: spreadsheets the script saw on its last full pass. */
  files: jsonb('files').$type<DriveFile[]>().notNull().default([]),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const exportBatches = pgTable('export_batches', {
  id: serial('id').primaryKey(),
  carrierId: integer('carrier_id').references(() => carriers.id, { onDelete: 'set null' }),
  createdById: integer('created_by_id').references(() => users.id, { onDelete: 'set null' }),
  orderIds: jsonb('order_ids').$type<string[]>().notNull(),
  orderCount: integer('order_count').notNull(),
  totalAmount: integer('total_amount').notNull(),
  /** Snapshot of the file so it can be downloaded again exactly as sent. */
  headers: jsonb('headers').$type<string[]>().notNull(),
  rows: jsonb('rows').$type<(string | number)[][]>().notNull(),
  fileName: text('file_name').notNull(),
  createdAt: createdAt(),
});

/**
 * A Facebook lead form, found automatically from the leads it sends (form_id,
 * else its name, else the sheet tab). Linking it to an offer once tells every
 * lead of that form which product and how many pieces — several forms can sell
 * the same offer (testing questions), and they are compared in the statistics.
 */
export const forms = pgTable('forms', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),
  name: text('name').notNull().default(''),
  sourceId: integer('source_id').references(() => sources.id, { onDelete: 'set null' }),
  spreadsheetId: text('spreadsheet_id').notNull().default(''),
  spreadsheetName: text('spreadsheet_name').notNull().default(''),
  sheetName: text('sheet_name').notNull().default(''),
  offerId: integer('offer_id').references(() => offers.id, { onDelete: 'set null' }),
  /** How the offer was set: from the form name, by hand, or from the old per-sheet source. */
  linkedBy: text('linked_by').$type<'auto' | 'manual' | 'source'>(),
  /** This form's own question → field choices (on top of automatic recognition). */
  fieldMap: jsonb('field_map').$type<FieldMap>().notNull().default({}),
  lastHeaders: jsonb('last_headers').$type<string[]>().notNull().default([]),
  lastLeadAt: timestamp('last_lead_at', { withTimezone: true }),
  /** Hidden from the list; comes back by itself if it sends leads again. */
  archivedAt: timestamp('archived_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Leads of orders deleted for good: the sheet still has their rows, so they are
 * never imported again (re-sends, daily re-check of the sheets).
 */
export const purgedLeads = pgTable('purged_leads', {
  leadId: text('lead_id').primaryKey(),
  purgedAt: timestamp('purged_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Orders ───────────────────────────────────────────────────────────────

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: serial('number').notNull().unique(),
    leadId: text('lead_id').unique(),
    sourceId: integer('source_id').references(() => sources.id, { onDelete: 'set null' }),
    formId: integer('form_id').references(() => forms.id, { onDelete: 'set null' }),
    /** Facebook ad the lead came from (statistics per ad). */
    adName: text('ad_name'),
    sheetName: text('sheet_name'),
    sheetRow: integer('sheet_row'),
    status: text('status').$type<OrderStatus>().notNull().default('new'),

    customerId: integer('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    customerName: text('customer_name').notNull().default(''),
    phone: text('phone'),
    phoneCustomer: text('phone_customer'),
    phoneFacebook: text('phone_facebook'),
    phoneAlt: text('phone_alt'),
    phoneIssue: text('phone_issue').$type<PhoneIssue>(),
    duplicateOfId: uuid('duplicate_of_id').references((): AnyPgColumn => orders.id, { onDelete: 'set null' }),

    wilayaCode: integer('wilaya_code'),
    wilayaRaw: text('wilaya_raw'),
    communeName: text('commune_name'),
    communeRaw: text('commune_raw'),
    address: text('address'),
    deliveryType: text('delivery_type').$type<DeliveryType>().notNull().default('home'),
    stopdeskId: text('stopdesk_id'),

    offerId: integer('offer_id').references(() => offers.id, { onDelete: 'set null' }),
    offerRaw: text('offer_raw'),
    price: integer('price').notNull().default(0),
    /** What the customer asked for, as written; the pieces live in order_items. */
    size: text('size'),
    colors: text('colors'),

    assignedToId: integer('assigned_to_id').references(() => users.id, { onDelete: 'set null' }),
    callAttempts: integer('call_attempts').notNull().default(0),
    nextCallAt: timestamp('next_call_at', { withTimezone: true }),
    lockedById: integer('locked_by_id').references(() => users.id, { onDelete: 'set null' }),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    confirmedById: integer('confirmed_by_id').references(() => users.id, { onDelete: 'set null' }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),

    carrierId: integer('carrier_id').references(() => carriers.id, { onDelete: 'set null' }),
    exportBatchId: integer('export_batch_id').references(() => exportBatches.id, { onDelete: 'set null' }),
    carrierTracking: text('carrier_tracking'),
    carrierStatus: text('carrier_status'),
    /** Linked order: re-sent after a return, or the order that reused this return's pieces. */
    relatedOrderId: uuid('related_order_id').references((): AnyPgColumn => orders.id, { onDelete: 'set null' }),
    /** Whether the pieces are currently out of the warehouse (makes stock moves idempotent). */
    stockOut: boolean('stock_out').notNull().default(false),

    commentCount: integer('comment_count').notNull().default(0),
    lastComment: text('last_comment'),

    raw: jsonb('raw').$type<Record<string, unknown>>().notNull().default({}),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /** Lead time from Facebook (falls back to import time). */
    createdAt: createdAt(),
    importedAt: timestamp('imported_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('orders_status_idx').on(t.status),
    index('orders_created_idx').on(t.createdAt),
    index('orders_offer_idx').on(t.offerId),
    index('orders_form_idx').on(t.formId),
    index('orders_wilaya_idx').on(t.wilayaCode),
    index('orders_assigned_idx').on(t.assignedToId),
    index('orders_customer_idx').on(t.customerId),
    index('orders_phone_idx').on(t.phone),
    index('orders_tracking_idx').on(t.carrierTracking),
    index('orders_queue_idx').on(t.nextCallAt).where(sql`${t.deletedAt} is null`),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: serial('id').primaryKey(),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    productId: integer('product_id').notNull().references(() => products.id, { onDelete: 'restrict' }),
    variantId: integer('variant_id').references(() => variants.id, { onDelete: 'set null' }),
    size: text('size').notNull().default(''),
    color: text('color').notNull().default(''),
    quantity: integer('quantity').notNull().default(1),
    /** What happened to this piece when the parcel came back. */
    returnCondition: text('return_condition').$type<'restock' | 'damaged' | 'kept'>(),
  },
  (t) => [index('order_items_order_idx').on(t.orderId), index('order_items_variant_idx').on(t.variantId)],
);

export const stockMovements = pgTable(
  'stock_movements',
  {
    id: serial('id').primaryKey(),
    variantId: integer('variant_id').notNull().references(() => variants.id, { onDelete: 'cascade' }),
    type: text('type').$type<StockMovementType>().notNull(),
    quantity: integer('quantity').notNull(),
    note: text('note'),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
    actorId: integer('actor_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('stock_movements_variant_idx').on(t.variantId), index('stock_movements_order_idx').on(t.orderId)],
);

export const orderComments = pgTable(
  'order_comments',
  {
    id: serial('id').primaryKey(),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    authorId: integer('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: createdAt(),
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
    createdAt: createdAt(),
  },
  (t) => [index('order_events_order_idx').on(t.orderId)],
);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
