import type { Config } from './config';
import type { Db } from './db/client';
import type { SecretBox } from './lib/crypto';

/** Dependencies shared by services; decorated onto the Fastify instance. */
export interface AppContext {
  db: Db;
  config: Config;
  secrets: SecretBox;
}

declare module 'fastify' {
  interface FastifyInstance extends AppContext {}
}

/** Order number → human reference, e.g. 12 → "TR-00012". */
export function formatReference(prefix: string, number: number): string {
  return `${prefix}-${String(number).padStart(5, '0')}`;
}

/** Parses "TR-00012" / "00012" / "12" back to the order number. */
export function parseReference(input: string): number | null {
  const m = /^(?:[a-z]+-)?0*(\d{1,9})$/i.exec(input.trim());
  return m ? Number(m[1]) : null;
}

/** Algeria is UTC+1 all year — date filters are expressed in local days. */
export const TZ_OFFSET = '+01:00';
export const startOfDay = (day: string) => new Date(`${day}T00:00:00${TZ_OFFSET}`);
export const endOfDay = (day: string) => new Date(startOfDay(day).getTime() + 24 * 3600 * 1000);
