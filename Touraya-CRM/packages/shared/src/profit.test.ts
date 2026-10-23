import { describe, expect, it } from 'vitest';
import { computeProfit, DEFAULT_PROFIT_INPUT, profitAt, type ProfitInput } from './profit';

/** A worked example done by hand: 100 leads, 2-piece offer at 3500 DA. */
const example: ProfitInput = {
  ...DEFAULT_PROFIT_INPUT,
  fabricCost: 40_000, // 100 pieces → 400 DA of fabric each
  batchCosts: [{ label: 'نقل', amount: 10_000 }], // → 100 DA each
  pieces: 100,
  pieceCosts: [{ label: 'خياطة', amount: 300 }, { label: 'سحاب', amount: 50 }], // → 850 DA a piece
  price: 3500,
  piecesPerOrder: 2, // → 1700 DA of product an order
  leads: 100,
  confirmationRate: 70, // 70 confirmed
  deliveryRate: 80, // 56 delivered, 14 returned
  confirmFee: 50,
  confirmFeeOn: 'confirmed',
  sellerDeliveryFee: 0,
  returnFee: 200,
  packagingPerOrder: 30,
  codFeePct: 0,
  returnDamagePct: 0,
  adSpendUsd: 100,
  usdRate: 250, // 25 000 DA of ads
  targetMarginPct: 20,
};

describe('profit calculator', () => {
  it('matches the hand-made example', () => {
    const r = computeProfit(example);
    expect(r.costPerPiece).toBe(850);
    expect(r.confirmed).toBeCloseTo(70);
    expect(r.delivered).toBeCloseTo(56);
    expect(r.returned).toBeCloseTo(14);
    expect(r.revenue).toBeCloseTo(196_000); // 56 × 3500
    expect(r.costs.product).toBeCloseTo(95_200); // 56 × 1700
    expect(r.costs.returns).toBeCloseTo(2800); // 14 × 200
    expect(r.costs.packaging).toBeCloseTo(2100); // 70 × 30
    expect(r.costs.confirmation).toBeCloseTo(3500); // 70 × 50
    expect(r.costs.ads).toBe(25_000);
    expect(r.profit).toBeCloseTo(67_400); // 196000 − 128600
    expect(r.cplUsd).toBe(1);
    expect(r.verdict).toBe('good'); // 34% margin
  });

  it('gives the highest cost per lead before losing money, and it really is the break-even', () => {
    const r = computeProfit(example);
    // Before ads: 92 400 DA → 369.6 $ → 3.696 $ a lead.
    expect(r.breakeven!.maxCplUsd).toBeCloseTo(3.696);
    expect(profitAt(example, r.breakeven!.maxCplUsd!, example.deliveryRate).profit).toBeCloseTo(0, 6);
    expect(profitAt(example, r.breakeven!.maxCplUsd! + 0.1, example.deliveryRate).verdict).toBe('loss');
    // Keeping 20% of sales: (92 400 − 39 200) / 250 / 100 = 2.128 $.
    expect(r.breakeven!.targetCplUsd).toBeCloseTo(2.128);
  });

  it('prices: break-even and recommended prices give exactly 0 and the target margin', () => {
    const r = computeProfit(example);
    expect(computeProfit({ ...example, price: r.breakevenPrice! }).profit).toBeCloseTo(0, 6);
    expect(computeProfit({ ...example, price: r.recommendedPrice! }).margin).toBeCloseTo(20, 6);
  });

  it('cash-collection fee and damaged returns count', () => {
    const r = computeProfit({ ...example, codFeePct: 1, returnDamagePct: 50 });
    expect(r.costs.cod).toBeCloseTo(1960);
    expect(r.costs.returnLoss).toBeCloseTo(14 * 1700 * 0.5);
    expect(computeProfit({ ...example, codFeePct: 1, price: computeProfit({ ...example, codFeePct: 1 }).breakevenPrice! }).profit).toBeCloseTo(0, 6);
  });

  it('batch: orders it makes, and delivered orders before its money is back', () => {
    const r = computeProfit(example);
    expect(r.batchTotal).toBe(85_000); // 50 000 + 100 × 350
    expect(r.batch.orders).toBe(50);
    // Each delivered order brings 3500 − (128 600 − 95 200) / 56 = 2903.57 DA → 30 orders.
    expect(r.batch.ordersToRecover).toBe(30);
    expect(r.batch.leadsNeeded).toBe(90); // 50 / 0.56
  });

  it('a loss even without ads has no break-even ad cost', () => {
    const r = computeProfit({ ...example, price: 1000 });
    expect(r.verdict).toBe('loss');
    expect(r.breakeven).toBeNull();
  });

  it('empty inputs never divide by zero', () => {
    const r = computeProfit({ ...DEFAULT_PROFIT_INPUT, leads: 0, pieces: 0 });
    expect(r.perDelivered).toBeNull();
    expect(r.cplUsd).toBeNull();
    expect(Number.isFinite(r.profit)).toBe(true);
  });
});
