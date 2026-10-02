import { describe, expect, it } from 'vitest';
import { combineOffers, type Tier } from './pricing';

const tiers: Tier[] = [
  { id: 1, units: 1, price: 2100, carrierName: 'p 1pc 2100' },
  { id: 2, units: 2, price: 3500, carrierName: 'p 2pcs 3500' },
  { id: 3, units: 3, price: 4999, carrierName: 'p 3pcs 4999' },
];

describe('price by number of pieces', () => {
  it.each([
    [1, 2100, 1],
    [2, 3500, 2],
    [3, 4999, 3],
  ])('%i pieces → exact tier %i', (units, price, offer) => {
    expect(combineOffers(tiers, units)).toMatchObject({ price, exactOfferId: offer, mainOfferId: offer });
  });

  it('4 pieces = cheapest combination for the customer (2 + 2 = 7000 < 3 + 1 = 7099)', () => {
    expect(combineOffers(tiers, 4)).toMatchObject({ price: 7000, exactOfferId: null, mainOfferId: 2, carrierLabel: '2 × p 2pcs 3500' });
  });

  it('5 pieces = 3 + 2', () => {
    expect(combineOffers(tiers, 5)).toMatchObject({ price: 8499, carrierLabel: 'p 3pcs 4999 + p 2pcs 3500' });
  });

  it('6 pieces = 2 × 3', () => {
    expect(combineOffers(tiers, 6)).toMatchObject({ price: 9998, carrierLabel: '2 × p 3pcs 4999' });
  });

  it('impossible counts return null (only 2- and 3-piece offers, 1 piece asked)', () => {
    expect(combineOffers(tiers.slice(1), 1)).toBeNull();
    expect(combineOffers(tiers.slice(1), 5)).toMatchObject({ price: 8499 });
  });
});
