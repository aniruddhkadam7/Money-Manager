import type { TradeStyle } from "./types";

/** How a stock is bought, as Zerodha names it: MIS for intraday, CNC for delivery. */
export const TRADE_STYLES: { style: TradeStyle; code: string; label: string; hint: string }[] = [
  { style: "intraday", code: "MIS", label: "Intraday", hint: "Sold the same day" },
  { style: "delivery", code: "CNC", label: "Longterm", hint: "Delivery, held as long as you like" },
];

export const tradeStyleCode = (style: TradeStyle) => TRADE_STYLES.find((s) => s.style === style)?.code ?? style;

/** A holding's name with its product, e.g. "RELIANCE · MIS" (other investments: just the name). */
export const holdingLabel = (account: { name: string; style?: TradeStyle }) =>
  account.style ? `${account.name} · ${tradeStyleCode(account.style)}` : account.name;
