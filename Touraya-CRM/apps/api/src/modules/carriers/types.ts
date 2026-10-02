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
  /** Carrier tracking label → CRM status. */
  mapStatus(label: string): OrderStatus | null;
}
