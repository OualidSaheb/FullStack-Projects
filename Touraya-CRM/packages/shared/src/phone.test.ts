import { describe, expect, it } from 'vitest';
import { normalizePhone, resolvePhone } from './phone';

describe('normalizePhone', () => {
  it.each([
    ['p:+213556251779', '0556251779'],
    ['+213770331038', '0770331038'],
    ['0556 25 17 79', '0556251779'],
    ['(0556)-25-17-79', '0556251779'],
    ['556251779', '0556251779'],
    ['00213661122334', '0661122334'],
    ['+213 0661122334', '0661122334'],
    ['٠٥٥٦٢٥١٧٧٩', '0556251779'],
    ['021223344', '021223344'],
  ])('%s → %s', (input, expected) => {
    const r = normalizePhone(input);
    expect(r.value).toBe(expected);
    expect(r.valid).toBe(true);
  });

  it('flags invalid numbers', () => {
    expect(normalizePhone('12345').valid).toBe(false);
    expect(normalizePhone('').valid).toBe(false);
    expect(normalizePhone('0856251779').valid).toBe(false);
  });
});

describe('resolvePhone', () => {
  it('prefers the number typed by the customer', () => {
    const r = resolvePhone('0556251779', 'p:+213770331038');
    expect(r.phone).toBe('0556251779');
    expect(r.source).toBe('customer');
    expect(r.issue).toBe('differs_from_facebook');
  });

  it('no issue when both match', () => {
    expect(resolvePhone('0556251779', 'p:+213556251779').issue).toBeNull();
  });

  it('falls back to Facebook on a typo', () => {
    const r = resolvePhone('055625177', 'p:+213556251779');
    expect(r.phone).toBe('0556251779');
    expect(r.source).toBe('facebook');
    expect(r.issue).toBe('customer_typo_used_facebook');
  });

  it('falls back to Facebook when customer number is garbage', () => {
    const r = resolvePhone('abc', '+213770331038');
    expect(r.phone).toBe('0770331038');
    expect(r.issue).toBe('customer_missing_used_facebook');
    expect(resolvePhone('0912345', '+213770331038').issue).toBe('customer_invalid_used_facebook');
  });

  it('warns when nothing is valid', () => {
    expect(resolvePhone('123', '').issue).toBe('invalid');
    expect(resolvePhone('', '').issue).toBe('missing');
  });
});
