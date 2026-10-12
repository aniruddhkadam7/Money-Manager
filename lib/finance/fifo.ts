/**
 * First in, first out matching of a stock's orders, shared by the ledger (which books the money) and the trading
 * journal (which shows positions and P&L), so both always agree.
 */

/** Shares still open from one order: positive quantity for a buy (long), negative for a short sale. */
export interface Lot {
  quantity: number;
  priceMinor: number;
}

export interface Fill {
  /** The open lots after this order. */
  lots: Lot[];
  /** Shares of this order that closed earlier lots. */
  closedQuantity: number;
  /** What the closed lots cost (for a short: what they were sold for), in paise. */
  closedCostMinor: number;
  /** Shares of this order left open as a new lot (after closing everything it could). */
  openedQuantity: number;
  /** Profit on the closed shares before charges, in paise. */
  grossMinor: number;
}

/** Applies one order to the open lots. `side` +1 buys, -1 sells. Never mutates `lots`. */
export function fill(lots: Lot[], side: 1 | -1, quantity: number, priceMinor: number): Fill {
  const next = lots.map((l) => ({ ...l }));
  let remaining = quantity;
  let closedCostMinor = 0;
  // An order first closes lots held the other way (a sell closes longs, a buy covers shorts), oldest first.
  while (remaining > 0 && next.length > 0 && Math.sign(next[0].quantity) === -side) {
    const lot = next[0];
    const take = Math.min(remaining, Math.abs(lot.quantity));
    closedCostMinor += take * lot.priceMinor;
    lot.quantity += side * take;
    remaining -= take;
    if (lot.quantity === 0) next.shift();
  }
  if (remaining > 0) next.push({ quantity: side * remaining, priceMinor });
  const closedQuantity = quantity - remaining;
  return {
    lots: next,
    closedQuantity,
    closedCostMinor,
    openedQuantity: remaining,
    // Closing longs by selling: sold for more than they cost. Covering shorts by buying: bought back for less.
    grossMinor: side * (closedCostMinor - closedQuantity * priceMinor),
  };
}

/** Shares held: positive long, negative short. */
export const openQuantity = (lots: Lot[]) => lots.reduce((t, l) => t + l.quantity, 0);

/** What the open shares cost (negative for a short), in paise. */
export const openCostMinor = (lots: Lot[]) => lots.reduce((t, l) => t + l.quantity * l.priceMinor, 0);
