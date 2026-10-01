import { describe, expect, it } from 'vitest';
import { DEFAULT_CALL_POLICY as P, isWorkingTime, nextCallAt, nextWorkingTime } from './scheduling';

// Times in UTC; Algeria = UTC+1. 2026-10-01 is a Thursday, 2026-10-02 a Friday (off).
const utc = (s: string) => new Date(`${s}Z`);

describe('call scheduling', () => {
  it('knows working hours', () => {
    expect(isWorkingTime(utc('2026-10-01T09:00:00'), P)).toBe(true); // 10:00 local
    expect(isWorkingTime(utc('2026-10-01T21:30:00'), P)).toBe(false); // 22:30 local
    expect(isWorkingTime(utc('2026-10-02T10:00:00'), P)).toBe(false); // Friday
  });

  it('moves night retries to the next working morning, skipping Friday', () => {
    // Thursday 20:30 local + 60 min = 21:30 → Saturday 09:00 local (08:00Z)
    expect(nextCallAt(utc('2026-10-01T19:30:00'), 1, P).toISOString()).toBe('2026-10-03T08:00:00.000Z');
  });

  it('keeps a retry inside working hours', () => {
    expect(nextCallAt(utc('2026-10-01T09:00:00'), 1, P).toISOString()).toBe('2026-10-01T10:00:00.000Z');
  });

  it('early morning goes to opening time', () => {
    expect(nextWorkingTime(utc('2026-10-01T05:00:00'), P).toISOString()).toBe('2026-10-01T08:00:00.000Z');
  });
});
