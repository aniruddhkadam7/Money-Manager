import type { TradeSide, TradeStyle } from "@/lib/finance/types";

/**
 * Zerodha's equity charges (zerodha.com/charges, checked October 2026), worked out per order the way its contract note
 * does. All amounts in paise.
 */
export const ZERODHA_EQUITY = {
  /** Intraday brokerage: 0.03% of the order, at most ₹20. Delivery is free. */
  intradayBrokerageRate: 0.0003,
  brokerageCapMinor: 2000,
  /** STT: delivery 0.1% on buys and sells; intraday 0.025% on sells only. Rounded to the rupee. */
  deliverySttRate: 0.001,
  intradaySellSttRate: 0.00025,
  /** Exchange transaction charges. */
  exchangeRate: { NSE: 0.0000307, BSE: 0.0000375 },
  /** SEBI: ₹10 per crore. */
  sebiRate: 0.000001,
  gstRate: 0.18,
  /** Stamp duty on buys: delivery 0.015%, intraday 0.003%. */
  deliveryStampRate: 0.00015,
  intradayStampRate: 0.00003,
  /** DP charge on a delivery sell: ₹15.34 (GST included) per stock per day, however many shares. */
  dpChargeMinor: 1534,
} as const;

export interface ChargeBreakdown {
  brokerage: number;
  stt: number;
  exchange: number;
  sebi: number;
  gst: number;
  stamp: number;
  dp: number;
  total: number;
}

export interface ChargeInput {
  product: TradeStyle;
  side: TradeSide;
  /** Quantity × price, in paise. */
  valueMinor: number;
  exchange?: "NSE" | "BSE";
  /** A delivery sell: whether the day's DP charge for this stock is already on another sell. */
  dpAlreadyCharged?: boolean;
}

const paise = (n: number) => Math.round(n);

export function zerodhaCharges({ product, side, valueMinor, exchange = "NSE", dpAlreadyCharged = false }: ChargeInput): ChargeBreakdown {
  const z = ZERODHA_EQUITY;
  const intraday = product === "intraday";
  const brokerage = intraday ? Math.min(paise(valueMinor * z.intradayBrokerageRate), z.brokerageCapMinor) : 0;
  const sttRate = intraday ? (side === "sell" ? z.intradaySellSttRate : 0) : z.deliverySttRate;
  const stt = Math.round((valueMinor * sttRate) / 100) * 100;
  const exch = paise(valueMinor * z.exchangeRate[exchange]);
  const sebi = paise(valueMinor * z.sebiRate);
  const gst = paise((brokerage + exch + sebi) * z.gstRate);
  const stamp = side === "buy" ? paise(valueMinor * (intraday ? z.intradayStampRate : z.deliveryStampRate)) : 0;
  const dp = !intraday && side === "sell" && !dpAlreadyCharged ? z.dpChargeMinor : 0;
  return { brokerage, stt, exchange: exch, sebi, gst, stamp, dp, total: brokerage + stt + exch + sebi + gst + stamp + dp };
}

/**
 * A broker's own charges (brokerage and DP); the government's and exchange's (STT, exchange, SEBI, stamp, GST) are
 * the same everywhere and come from the rates above.
 */
export interface BrokerRates {
  /** Delivery brokerage, a share of the order (0.002 = 0.2%). */
  deliveryRate: number;
  /** Intraday brokerage: this share of the order, but at most `intradayCapMinor`. */
  intradayRate: number;
  intradayCapMinor: number;
  /** DP charge on a delivery sell, per stock per day: this share of what's sold, at least `dpMinMinor` (GST on top). */
  dpRate: number;
  dpMinMinor: number;
}

/**
 * Kotak Neo (Trade Free plan) as published in November 2026: delivery 0.2%, intraday ₹10 or 0.05% (lower), DP 0.04%
 * of the sale with a ₹20 minimum. Sources differ, so they can be changed to match a contract note.
 */
export const KOTAK_NEO_RATES: BrokerRates = { deliveryRate: 0.002, intradayRate: 0.0005, intradayCapMinor: 1000, dpRate: 0.0004, dpMinMinor: 2000 };

/** An order's charges with a broker's own rates (see BrokerRates), the rest as on any contract note. */
export function brokerCharges({ product, side, valueMinor, exchange = "NSE", dpAlreadyCharged = false }: ChargeInput, r: BrokerRates): ChargeBreakdown {
  const z = ZERODHA_EQUITY;
  const intraday = product === "intraday";
  const brokerage = intraday ? Math.min(paise(valueMinor * r.intradayRate), r.intradayCapMinor) : paise(valueMinor * r.deliveryRate);
  const sttRate = intraday ? (side === "sell" ? z.intradaySellSttRate : 0) : z.deliverySttRate;
  const stt = Math.round((valueMinor * sttRate) / 100) * 100;
  const exch = paise(valueMinor * z.exchangeRate[exchange]);
  const sebi = paise(valueMinor * z.sebiRate);
  const gst = paise((brokerage + exch + sebi) * z.gstRate);
  const stamp = side === "buy" ? paise(valueMinor * (intraday ? z.intradayStampRate : z.deliveryStampRate)) : 0;
  const dpBase = !intraday && side === "sell" && !dpAlreadyCharged ? Math.max(paise(valueMinor * r.dpRate), r.dpMinMinor) : 0;
  const dp = dpBase ? paise(dpBase * (1 + z.gstRate)) : 0;
  return { brokerage, stt, exchange: exch, sebi, gst, stamp, dp, total: brokerage + stt + exch + sebi + gst + stamp + dp };
}
