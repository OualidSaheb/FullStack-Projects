import type { CarrierProvider } from '@touraya/shared';
import { yalidine } from './providers/yalidine';
import type { CarrierAdapter } from './types';

/** Carriers with an API integration. "manual" carriers work through the Excel file only. */
export const ADAPTERS: Partial<Record<CarrierProvider, CarrierAdapter>> = {
  yalidine,
};
