import type { OrderStatus } from './statuses';
import type { Role } from './roles';
import type { PhoneIssue } from './phone';
import type { FieldMap } from './lead-mapping';
import type { CarrierConfig, CarrierProvider, DeliveryType } from './carriers';
import type { CustomerHistory, CustomerRiskLevel, OrderFlag } from './customers';
import type { StockMovementType } from './schemas';

/** API response shapes. */

export interface UserDTO {
  id: number;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  lastLoginAt: string | null;
}

export interface VariantDTO {
  id: number;
  size: string | null;
  color: string | null;
  sku: string;
  stock: number;
  reserved: number;
  available: number;
  active: boolean;
}

export interface ProductDTO {
  id: number;
  name: string;
  sku: string;
  sizes: string[];
  colors: string[];
  costPrice: number;
  lowStockAlert: number;
  active: boolean;
  variants: VariantDTO[];
}

export interface OfferDTO {
  id: number;
  productId: number;
  name: string;
  carrierName: string;
  units: number;
  price: number;
  aliases: string[];
  active: boolean;
}

export interface StockMovementDTO {
  id: number;
  variantId: number;
  productName: string;
  size: string | null;
  color: string | null;
  type: StockMovementType;
  quantity: number;
  note: string | null;
  orderId: string | null;
  orderReference: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface SourceDTO {
  id: number;
  name: string;
  type: 'google_sheet' | 'google_drive' | 'webhook';
  spreadsheetId: string;
  folderName: string;
  /** Drive folder: spreadsheets (and tabs) seen by the script. */
  files: { spreadsheetId: string; name: string; tabs: { name: string; rows: number }[] }[];
  formType: 'new' | 'legacy';
  offerId: number | null;
  sheetNames: string[];
  importFrom: string;
  syncMinutes: 1 | 5 | 10 | 15 | 30;
  fieldMap: FieldMap;
  active: boolean;
  /** Last contact from the script (data or "alive" ping). */
  lastSyncAt: string | null;
  lastHeaders: string[];
  orderCount: number;
  lastSyncStats: { at: string; received: number; created: number; duplicates: number; skipped: number; errors: { row: number; sheet: string; message: string }[] } | null;
}

/** Funnel of a form / ad: how many leads became real, delivered sales. */
export interface FunnelStats {
  leads: number;
  /** Still being called (new, no answer, postponed). */
  pending: number;
  /** Reached "confirmed" (or any later step). */
  confirmed: number;
  cancelled: number;
  delivered: number;
  returned: number;
}

export interface FormDTO {
  id: number;
  name: string;
  sourceId: number | null;
  spreadsheetId: string;
  spreadsheetName: string;
  sheetName: string;
  offerId: number | null;
  linkedBy: 'auto' | 'manual' | 'source' | null;
  fieldMap: FieldMap;
  lastHeaders: string[];
  lastLeadAt: string | null;
  stats: FunnelStats;
}

export interface CarrierDTO {
  id: number;
  name: string;
  provider: CarrierProvider;
  active: boolean;
  isDefault: boolean;
  apiEnabled: boolean;
  hasCredentials: boolean;
  credentials: { apiId: string; apiToken: '' };
  config: CarrierConfig;
}

export interface CarrierRateDTO {
  wilayaCode: number;
  homeFee: number | null;
  deskFee: number | null;
}

export interface OrderItemDTO {
  id: number;
  productId: number;
  productName: string;
  variantId: number | null;
  size: string | null;
  color: string | null;
  quantity: number;
  available: number | null;
  returnCondition: 'restock' | 'damaged' | 'kept' | null;
}

export interface OrderListItem {
  id: string;
  reference: string;
  status: OrderStatus;
  customerName: string;
  phone: string | null;
  phoneIssue: PhoneIssue | null;
  wilayaCode: number | null;
  communeName: string | null;
  communeRaw: string | null;
  /** What the customer typed for the wilaya (shown when it did not match). */
  wilayaRaw: string | null;
  offerId: number | null;
  offerName: string | null;
  price: number;
  /** "L أسود + L رمادي" */
  itemsLabel: string;
  units: number;
  size: string | null;
  colors: string | null;
  deliveryType: DeliveryType;
  carrierId: number | null;
  sourceId: number | null;
  sourceName: string | null;
  assignedToId: number | null;
  assignedToName: string | null;
  callAttempts: number;
  nextCallAt: string | null;
  cancelReason: string | null;
  commentCount: number;
  lastComment: string | null;
  flags: OrderFlag[];
  risk: CustomerRiskLevel;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface OrderDetail extends OrderListItem {
  leadId: string | null;
  phoneCustomer: string | null;
  phoneFacebook: string | null;
  phoneAlt: string | null;
  address: string | null;
  offerRaw: string | null;
  stopdeskId: string | null;
  carrierName: string | null;
  carrierTracking: string | null;
  carrierStatus: string | null;
  /** Delivery price the customer pays (from the carrier rates), null when unknown. */
  deliveryFee: number | null;
  items: OrderItemDTO[];
  customer: (CustomerHistory & { id: number; blacklistReason: string | null }) | null;
  duplicateOf: { id: string; reference: string; status: OrderStatus } | null;
  /** Linked order (re-sent after a return, or reused this return's pieces). */
  related: { id: string; reference: string; status: OrderStatus } | null;
  /** Price for the current number of pieces from the product's offers (null if no tier fits). */
  suggestedPrice: { price: number; label: string } | null;
  raw: Record<string, unknown>;
  sheetName: string | null;
  sheetRow: number | null;
}

export interface CommentDTO {
  id: number;
  body: string;
  authorName: string | null;
  createdAt: string;
}

export type OrderEventType =
  | 'created'
  | 'status_changed'
  | 'updated'
  | 'commented'
  | 'assigned'
  | 'exported'
  | 'carrier_sent'
  | 'carrier_error'
  | 'carrier_update'
  | 'phone_issue'
  | 'stock'
  | 'deleted'
  | 'restored';

export interface OrderEventDTO {
  id: number;
  type: OrderEventType;
  data: Record<string, unknown>;
  actorName: string | null;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface StatusCounts {
  byStatus: Partial<Record<OrderStatus, number>>;
  total: number;
  problems: number;
  due: number;
}

export interface ExportBatchDTO {
  id: number;
  carrierName: string | null;
  orderCount: number;
  totalAmount: number;
  createdAt: string;
  createdByName: string | null;
  fileName: string;
}

export interface StatsDTO {
  totals: {
    all: number;
    confirmed: number;
    cancelled: number;
    shipped: number;
    delivered: number;
    returned: number;
    phoneIssues: number;
    confirmationRate: number;
    deliveryRate: number;
    revenueConfirmed: number;
    revenueDelivered: number;
  };
  byStatus: { status: OrderStatus; count: number }[];
  byOffer: { offerId: number | null; name: string; count: number; confirmed: number; delivered: number; returned: number }[];
  byWilaya: { wilayaCode: number | null; count: number; delivered: number; returned: number }[];
  bySource: { sourceId: number | null; name: string; count: number }[];
  byAgent: { userId: number | null; name: string; handled: number; confirmed: number; cancelled: number; rate: number }[];
  cancelReasons: { reason: string; count: number }[];
  daily: { day: string; count: number; confirmed: number }[];
  returns: {
    inTransit: number;
    received: number;
    /** Pieces by outcome at check-in. */
    restocked: number;
    damaged: number;
    kept: number;
    /** Cost of damaged + never-returned pieces (product cost price). */
    lossCost: number;
    topVariants: { label: string; count: number }[];
  };
}
