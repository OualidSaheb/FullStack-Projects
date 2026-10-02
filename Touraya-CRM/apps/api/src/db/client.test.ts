import { describe, expect, it } from 'vitest';
import { normalizeDatabaseUrl } from './client';

describe('normalizeDatabaseUrl', () => {
  it('drops libpq-only options from Neon URLs and keeps sslmode', () => {
    const url = normalizeDatabaseUrl('postgresql://u:p@ep-x-pooler.neon.tech/neondb?sslmode=require&channel_binding=require');
    expect(url).toBe('postgresql://u:p@ep-x-pooler.neon.tech/neondb?sslmode=require');
  });
});
