import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  /** Postgres URL. When empty, an embedded PGlite database is used (local dev / tests). */
  DATABASE_URL: z.string().optional(),
  PGLITE_DIR: z.string().default('./data/pglite'),
  /** Used to sign sessions and encrypt stored API tokens. */
  APP_SECRET: z.string().min(16).default('dev-secret-change-me-please'),
  /** Public URL of the CRM, used in the Apps Script and webhook URLs. */
  PUBLIC_URL: z.string().optional(),
  ORDER_PREFIX: z.string().default('TR'),
  WEB_DIST: z.string().optional(),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = envSchema.parse(env);
  if (config.NODE_ENV === 'production' && config.APP_SECRET.startsWith('dev-secret')) {
    throw new Error('APP_SECRET must be set in production');
  }
  return config;
}
