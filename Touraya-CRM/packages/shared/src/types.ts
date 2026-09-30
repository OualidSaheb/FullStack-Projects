import type { OrderStatus } from './statuses';
import type { Role } from './roles';
import type { PhoneIssue } from './phone';
import type { FieldMap } from './lead-mapping';

/** API response shapes. */

export interface UserDTO {
  id: number;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  lastLoginAt: string | null;
}

export interface ProductDTO {
  id: number;
  name: string;
  carrierName: string;
  price: number;
  aliases: string[];
  sizes: string[];
  colors: string[];
  active: boolean;
}

export interface SourceDTO {
  id: number;
  name: string;
  spreadsheetId: string;
  formType: 'new' | 'legacy';
  productId: number | null;
  sheetNames: string[];
  importFrom: string;
  fieldMap: FieldMap;
  active: boolean;
  lastSyncAt: string | null;
  lastHeaders: string[];
  orderCount?: number;
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
  productId: number | null;
  productName: string | null;
  quantity: number;
  price: number;
  size: string | null;
  colors: string | null;
  sourceId: number | null;
  sourceName: string | null;
  assignedToId: number | null;
  assignedToName: string | null;
  callAttempts: number;
  commentCount: number;
  lastComment: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface OrderDetail extends OrderListItem {
  leadId: string | null;
  phoneCustomer: string | null;
  phoneFacebook: string | null;
  phoneAlt: string | null;
  wilayaRaw: string | null;
  address: string | null;
  offerRaw: string | null;
  carrierTracking: string | null;
  carrierStatus: string | null;
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
  phoneIssues: number;
  unassigned: number;
}

export interface ExportBatchDTO {
  id: number;
  orderCount: number;
  totalAmount: number;
  createdAt: string;
  createdByName: string | null;
  fileName: string;
}

export interface StatsDTO {
  totals: { all: number; confirmed: number; cancelled: number; shipped: number; delivered: number; phoneIssues: number; confirmationRate: number; deliveryRate: number; revenueConfirmed: number };
  byStatus: { status: OrderStatus; count: number }[];
  byProduct: { productId: number | null; name: string; count: number; confirmed: number }[];
  byWilaya: { wilayaCode: number | null; count: number }[];
  bySource: { sourceId: number | null; name: string; count: number }[];
  byAgent: { userId: number | null; name: string; handled: number; confirmed: number; cancelled: number; rate: number }[];
  daily: { day: string; count: number; confirmed: number }[];
}
