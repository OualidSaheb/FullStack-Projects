import { describe, expect, it } from 'vitest';
import { matchCommune, matchWilaya, suggestCommunes, WILAYAS } from './index';

describe('geo', () => {
  it('has 58 wilayas and all communes', () => {
    expect(WILAYAS).toHaveLength(58);
    expect(WILAYAS.reduce((n, w) => n + w.communes.length, 0)).toBe(1541);
  });

  it.each([
    ['16', 16],
    ['16 - Alger', 16],
    ['الجزائر', 16],
    ['Bejaia', 6],
    ['بجاية', 6],
    ['ولاية وهران', 31],
    ['Setif', 19],
    ['سطيف', 19],
    ['Tizi-Ouzou', 15],
  ])('matchWilaya(%s) → %i', (input, code) => {
    expect(matchWilaya(input)?.value.code).toBe(code);
  });

  it('matches communes within their wilaya, with typos', () => {
    expect(matchCommune('Bab Ezzouar', 16)?.value.name).toBe('Bab Ezzouar');
    expect(matchCommune('باب الزوار', 16)?.exact).toBe(true);
    expect(matchCommune('Bab Ezouar', 16)?.value.name).toBe('Bab Ezzouar');
    expect(matchCommune('Bab Ezzouar', 31)).toBeNull();
  });

  it('suggests close communes', () => {
    expect(suggestCommunes('bab zouar', 16)[0]?.commune.name).toBe('Bab Ezzouar');
  });
});
