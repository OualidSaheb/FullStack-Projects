import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, inNightPause } from './service';

const at = (utcHour: number) => new Date(Date.UTC(2026, 9, 20, utcHour, 30));
const night = { ...DEFAULT_SETTINGS, nightPause: { enabled: true, from: 22, to: 8 } };

describe('night pause (Algeria time = UTC+1)', () => {
  it('22:00 → 08:00 crosses midnight', () => {
    expect(inNightPause(night, at(21))).toBe(true); // 22:30 in Algeria
    expect(inNightPause(night, at(2))).toBe(true); // 03:30
    expect(inNightPause(night, at(6))).toBe(true); // 07:30
    expect(inNightPause(night, at(7))).toBe(false); // 08:30
    expect(inNightPause(night, at(20))).toBe(false); // 21:30
  });
  it('off when disabled', () => {
    expect(inNightPause(DEFAULT_SETTINGS, at(2))).toBe(false);
  });
});
