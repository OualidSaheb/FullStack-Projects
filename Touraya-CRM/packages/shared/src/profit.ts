/**
 * Profit calculator for cash-on-delivery offers: what a piece costs to make,
 * what an order really brings once confirmation, delivery, returns and ads are
 * paid, the highest ad cost before losing money, and the price that keeps a
 * chosen margin. Pure arithmetic, shared by the page and its tests.
 */

export interface CostItem {
  label: string;
  amount: number;
}

export interface ProfitInput {
  /** Production batch: fabric (total DA) and other batch costs (cutting, transport…). */
  fabricCost: number;
  batchCosts: CostItem[];
  /** Pieces the batch produced. */
  pieces: number;
  /** Per piece: sewing, zipper, label, bag… (DA). */
  pieceCosts: CostItem[];

  /** The offer: what the customer pays (DA, delivery not included) for how many pieces. */
  price: number;
  piecesPerOrder: number;

  /** Orders received from the ads, and the funnel rates (%). */
  leads: number;
  confirmationRate: number;
  deliveryRate: number;

  /** Per order (DA). */
  confirmFee: number;
  confirmFeeOn: 'confirmed' | 'delivered';
  /** Delivery paid by the seller for a delivered parcel (0 when the customer pays it). */
  sellerDeliveryFee: number;
  /** Charged by the carrier for a parcel that comes back. */
  returnFee: number;
  /** Bag, label… per parcel sent. */
  packagingPerOrder: number;
  /** Carrier's cash-collection fee, % of the amount collected. */
  codFeePct: number;
  /** Returned parcels whose pieces are lost or damaged (%). */
  returnDamagePct: number;

  /** Ads: spend in dollars and the dollar's price in dinars (entered by hand). */
  adSpendUsd: number;
  usdRate: number;

  /** Net margin wanted (% of sales) for the recommended price and the "expensive" alert. */
  targetMarginPct: number;
}

export type ProfitVerdict = 'loss' | 'thin' | 'good';

export interface ProfitResult {
  costPerPiece: number;
  productCostPerOrder: number;
  batchTotal: number;

  confirmed: number;
  delivered: number;
  returned: number;

  revenue: number;
  costs: { product: number; returnLoss: number; delivery: number; returns: number; packaging: number; confirmation: number; cod: number; ads: number };
  totalCosts: number;
  profit: number;
  /** % of sales. */
  margin: number;
  verdict: ProfitVerdict;

  perDelivered: { revenue: number; profit: number; ads: number; costs: number } | null;
  cplUsd: number | null;
  /** Sales ÷ ad spend. */
  roas: number | null;

  /** Ads, at most, before losing money (null when losing even without ads). */
  breakeven: {
    maxAdSpendUsd: number;
    maxCplUsd: number | null;
    /** Highest cost per lead that still keeps the target margin. */
    targetCplUsd: number | null;
    roas: number | null;
  } | null;
  /** Lowest price that covers every cost, and the price that keeps the target margin. */
  breakevenPrice: number | null;
  recommendedPrice: number | null;

  /** The whole batch sold at these rates. */
  batch: {
    orders: number;
    /** Delivered orders needed before the money put in the batch is back. */
    ordersToRecover: number | null;
    /** Leads to buy to sell the whole batch. */
    leadsNeeded: number | null;
    profit: number | null;
  };
}

const sum = (items: CostItem[]) => items.reduce((n, i) => n + (Number.isFinite(i.amount) ? i.amount : 0), 0);
const pct = (v: number) => Math.min(Math.max(v, 0), 100) / 100;
const div = (a: number, b: number) => (b > 0 ? a / b : null);

export function computeProfit(input: ProfitInput): ProfitResult {
  const batchExtra = input.fabricCost + sum(input.batchCosts);
  const perPiece = sum(input.pieceCosts);
  const costPerPiece = (input.pieces > 0 ? batchExtra / input.pieces : 0) + perPiece;
  const productCostPerOrder = costPerPiece * input.piecesPerOrder;

  const confirmed = input.leads * pct(input.confirmationRate);
  const delivered = confirmed * pct(input.deliveryRate);
  const returned = confirmed - delivered;

  const revenue = delivered * input.price;
  const costs = {
    product: delivered * productCostPerOrder,
    returnLoss: returned * productCostPerOrder * pct(input.returnDamagePct),
    delivery: delivered * input.sellerDeliveryFee,
    returns: returned * input.returnFee,
    packaging: confirmed * input.packagingPerOrder,
    confirmation: input.confirmFee * (input.confirmFeeOn === 'confirmed' ? confirmed : delivered),
    cod: revenue * pct(input.codFeePct),
    ads: input.adSpendUsd * input.usdRate,
  };
  const totalCosts = Object.values(costs).reduce((a, b) => a + b, 0);
  const profit = revenue - totalCosts;
  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
  const target = pct(input.targetMarginPct);
  const verdict: ProfitVerdict = profit < 0 ? 'loss' : margin < input.targetMarginPct ? 'thin' : 'good';

  // Everything but the ads: what the ads may cost at most.
  const beforeAds = profit + costs.ads;
  const breakeven =
    beforeAds > 0 && input.usdRate > 0
      ? {
          maxAdSpendUsd: beforeAds / input.usdRate,
          maxCplUsd: div(beforeAds / input.usdRate, input.leads),
          targetCplUsd: div(Math.max(0, beforeAds - target * revenue) / input.usdRate, input.leads),
          roas: div(revenue, beforeAds),
        }
      : null;

  // Profit is linear in the price: price × delivered × (1 − cod%) − the costs that do not depend on it.
  const priceIndependent = totalCosts - costs.cod;
  const perPriceUnit = delivered * (1 - pct(input.codFeePct));
  const breakevenPrice = div(priceIndependent, perPriceUnit);
  const recommendedPrice = div(priceIndependent, delivered * (1 - pct(input.codFeePct) - target));

  // Money back on the batch: each delivered order brings its price minus what it cost to sell
  // (ads, delivery, returns…), the pieces themselves being the batch.
  const cashPerDelivered = div(revenue - (totalCosts - costs.product), delivered);
  const batchTotal = batchExtra + input.pieces * perPiece;
  const orders = input.piecesPerOrder > 0 ? Math.floor(input.pieces / input.piecesPerOrder) : 0;
  const leadRate = pct(input.confirmationRate) * pct(input.deliveryRate);
  const profitPerDelivered = div(profit, delivered);

  return {
    costPerPiece,
    productCostPerOrder,
    batchTotal,
    confirmed,
    delivered,
    returned,
    revenue,
    costs,
    totalCosts,
    profit,
    margin,
    verdict,
    perDelivered: delivered > 0 ? { revenue: input.price, profit: profit / delivered, ads: costs.ads / delivered, costs: totalCosts / delivered } : null,
    cplUsd: div(input.adSpendUsd, input.leads),
    roas: div(revenue, costs.ads),
    breakeven,
    breakevenPrice: breakevenPrice !== null && breakevenPrice > 0 ? breakevenPrice : null,
    recommendedPrice: recommendedPrice !== null && recommendedPrice > 0 && 1 - pct(input.codFeePct) - target > 0 ? recommendedPrice : null,
    batch: {
      orders,
      ordersToRecover: cashPerDelivered !== null && cashPerDelivered > 0 && batchTotal > 0 ? Math.ceil(batchTotal / cashPerDelivered) : null,
      leadsNeeded: leadRate > 0 && orders > 0 ? Math.ceil(orders / leadRate) : null,
      profit: profitPerDelivered !== null ? profitPerDelivered * orders : null,
    },
  };
}

/** Same offer, another cost per lead and delivery rate: the "when do the ads make me lose money" grid. */
export function profitAt(input: ProfitInput, cplUsd: number, deliveryRate: number) {
  return computeProfit({ ...input, adSpendUsd: cplUsd * input.leads, deliveryRate });
}

export const DEFAULT_PROFIT_INPUT: ProfitInput = {
  fabricCost: 0,
  batchCosts: [],
  pieces: 100,
  pieceCosts: [
    { label: 'الخياطة', amount: 0 },
    { label: 'الإكسسوارات (سحاب، أزرار، ملصق)', amount: 0 },
  ],
  price: 0,
  piecesPerOrder: 1,
  leads: 100,
  confirmationRate: 70,
  deliveryRate: 75,
  confirmFee: 0,
  confirmFeeOn: 'confirmed',
  sellerDeliveryFee: 0,
  returnFee: 0,
  packagingPerOrder: 0,
  codFeePct: 0,
  returnDamagePct: 0,
  adSpendUsd: 0,
  usdRate: 250,
  targetMarginPct: 20,
};
