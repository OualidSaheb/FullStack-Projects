import type { CarrierConfig, CarrierProvider, ExportableOrder, OrderStatus } from '@touraya/shared';

export interface LoadedCarrier {
  id: number;
  name: string;
  provider: CarrierProvider;
  apiEnabled: boolean;
  credentials: { apiId: string; apiToken: string };
  config: CarrierConfig;
}

export type ParcelResult = { reference: string; ok: true; tracking: string } | { reference: string; ok: false; message: string };

export interface WebhookUpdate {
  event: string;
  tracking?: string;
  reference?: string;
  carrierStatus?: string;
  /** Why a delivery failed or a parcel is held ("Client ne répond pas"…). */
  reason?: string;
  /** Cash-on-delivery money: the carrier's payment state (Yalidine: not-ready, ready, receivable, payed). */
  payment?: string;
}

/** A parcel already at the carrier (e.g. created by hand in its dashboard), to link to its order. */
export interface CarrierParcel {
  tracking: string;
  /** The order id typed at the carrier (our reference when the platform sent it). */
  reference?: string;
  name: string;
  phones: string[];
  createdAt: Date | null;
  status?: string;
}

export class CarrierError extends Error {
  constructor(message: string, public details: Record<string, unknown> = {}) {
    super(message);
  }
}

/**
 * What a delivery company integration must provide. Add a carrier = implement
 * this once (ZR Express, Ecotrack-based companies, Maystro…) and register it.
 */
export interface CarrierAdapter {
  test(carrier: LoadedCarrier): Promise<void>;
  createParcels(carrier: LoadedCarrier, orders: ExportableOrder[]): Promise<ParcelResult[]>;
  /** Validation handshake some carriers do on GET (echo a token). */
  handshake?(query: Record<string, string | undefined>): string | null;
  verifyWebhook?(carrier: LoadedCarrier, rawBody: string, headers: Record<string, string | string[] | undefined>): boolean;
  parseWebhook?(body: unknown): WebhookUpdate[];
  /** Current status of parcels by tracking number — the regular check behind the webhook. */
  fetchStatuses?(carrier: LoadedCarrier, trackings: string[]): Promise<WebhookUpdate[]>;
  /** Every parcel of the account created since a date (linking parcels sent before the platform). */
  listParcels?(carrier: LoadedCarrier, since: Date): Promise<CarrierParcel[]>;
  /** Carrier tracking label → CRM status. */
  mapStatus(label: string): OrderStatus | null;
}
