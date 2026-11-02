import { describe, expect, it } from 'vitest';
import { computeCarrierStats, weekKey, type CarrierStatParcel } from './carrier-stats';

const p = (over: Partial<CarrierStatParcel>): CarrierStatParcel => ({
  tracking: Math.random().toString(36).slice(2),
  createdAt: '2026-10-05T09:00:00Z',
  lastStatusAt: null,
  status: 'Livré',
  price: 3500,
  deliveryFee: 400,
  freeShipping: false,
  stopdesk: false,
  wilayaCode: 16,
  offer: 'pants 2pcs 3500',
  cost: 1700,
  paymentStatus: null,
  inPlatform: true,
  ...over,
});
const opts = { returnFee: 200, confirmFee: 50, confirmFeeOn: 'confirmed' as const };

describe('delivery company statistics', () => {
  it('counts, rates and profit before ads, worked by hand', () => {
    const s = computeCarrierStats(
      [
        p({ createdAt: '2026-10-05T09:00:00Z', lastStatusAt: '2026-10-07T09:00:00Z' }), // delivered in 2 days
        p({ createdAt: '2026-10-06T09:00:00Z', lastStatusAt: '2026-10-10T09:00:00Z', freeShipping: true }), // 4 days, seller pays 400
        p({ status: 'Retourné au vendeur' }),
        p({ status: 'Tentative échouée' }),
        p({ status: 'Centre' }),
        p({ status: 'Livré', cost: null, offer: 'p 3pcs manual', price: 4999, createdAt: '2026-09-20T09:00:00Z' }),
      ],
      opts,
    );
    expect(s.totals).toMatchObject({ parcels: 6, delivered: 3, returned: 1, failed: 1, transit: 1, deliveryRate: 75, returnRate: 25, unknownCost: 1 });
    expect(s.totals.revenue).toBe(3500 + 3500 + 4999);
    expect(s.totals.pending).toBe(7000); // failed + in transit
    expect(s.totals.lostSales).toBe(3500);
    // 11 999 − 3400 (known costs) − 400 (seller delivery) − 200 (return) − 6 × 50 (confirmed) = 7699
    expect(s.totals.profit).toBe(7699);
    expect(s.totals.avgDeliveryDays).toBe(3); // (2 + 4) / 2 (the third has no dates)
  });

  it('by month (newest first), by week (Monday, Algeria time), by offer', () => {
    const s = computeCarrierStats([p({ createdAt: '2026-10-05T09:00:00Z' }), p({ createdAt: '2026-09-30T23:30:00Z' }), p({ offer: 'other', createdAt: '2026-10-11T22:30:00Z' })], opts);
    // 30 Sept 23:30 UTC is already 1 October in Algeria.
    expect(s.byMonth.map((m) => [m.key, m.parcels])).toEqual([['2026-10', 3]]);
    expect(weekKey('2026-10-11T22:30:00Z')).toBe('2026-10-05'); // still Sunday 11 in Algeria
    expect(weekKey('2026-10-11T23:30:00Z')).toBe('2026-10-12'); // Monday 12, 00:30 in Algeria
    expect(weekKey('2026-10-05T09:00:00Z')).toBe('2026-10-05');
    expect(s.byOffer.map((o) => [o.key, o.parcels])).toEqual([['pants 2pcs 3500', 2], ['other', 1]]);
  });

  it('payments of delivered parcels and the carrier\'s labels', () => {
    const s = computeCarrierStats([p({ paymentStatus: 'payed' }), p({ paymentStatus: 'payed' }), p({ paymentStatus: 'receivable', price: 4999 }), p({ status: 'Centre', paymentStatus: 'not-ready' })], opts);
    expect(s.payments).toEqual(expect.arrayContaining([{ status: 'payed', count: 2, amount: 7000 }, { status: 'receivable', count: 1, amount: 4999 }]));
    expect(s.statuses[0]).toEqual({ label: 'Livré', stage: 'delivered', count: 3 });
  });
});
