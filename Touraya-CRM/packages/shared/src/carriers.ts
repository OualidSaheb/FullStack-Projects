import { DEFAULT_EXPORT_COLUMNS, type ExportColumn } from './carrier-export';

/**
 * Delivery companies. Each provider declares what it can do; the API has one
 * implementation per provider behind a common interface, so adding ZR Express,
 * Ecotrack-based carriers, Maystro… means adding one adapter, nothing else.
 */
export const CARRIER_PROVIDERS = {
  yalidine: {
    label: 'Yalidine',
    api: true,
    webhook: true,
    defaults: { apiBaseUrl: 'https://api.yalidine.app/v1', parcelDefaults: { can_open: false } as Record<string, string | number | boolean> },
  },
  manual: {
    label: 'شركة أخرى (ملف Excel فقط)',
    api: false,
    webhook: false,
    defaults: { apiBaseUrl: '', parcelDefaults: {} as Record<string, string | number | boolean> },
  },
} as const;

export type CarrierProvider = keyof typeof CARRIER_PROVIDERS;
export const CARRIER_PROVIDER_KEYS = Object.keys(CARRIER_PROVIDERS) as [CarrierProvider, ...CarrierProvider[]];

export const DELIVERY_TYPES = { home: 'توصيل للمنزل', stopdesk: 'استلام من المكتب (Stop desk)' } as const;
export type DeliveryType = keyof typeof DELIVERY_TYPES;

export interface CarrierConfig {
  apiBaseUrl: string;
  fromWilayaName: string;
  webhookSecret: string;
  /** Extra fields sent with every API parcel (e.g. can_open). Editable without code. */
  parcelDefaults: Record<string, string | number | boolean>;
  exportColumns: ExportColumn[];
  exportFormat: 'xlsx' | 'csv';
}

export function defaultCarrierConfig(provider: CarrierProvider): CarrierConfig {
  return {
    apiBaseUrl: CARRIER_PROVIDERS[provider].defaults.apiBaseUrl,
    fromWilayaName: 'Alger',
    webhookSecret: '',
    parcelDefaults: { ...CARRIER_PROVIDERS[provider].defaults.parcelDefaults },
    exportColumns: DEFAULT_EXPORT_COLUMNS,
    exportFormat: 'xlsx',
  };
}
