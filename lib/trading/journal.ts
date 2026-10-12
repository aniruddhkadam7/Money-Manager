import { fill, openCostMinor, openQuantity, type Lot } from "@/lib/finance/fifo";
import type { Account, Book, Ledger, TradeEvent, TradeStyle } from "@/lib/finance/types";

/** One order, with what it did to its position. */
export interface TradeFill {
  event: TradeEvent;
  holding: Account;
  /** Quantity × price, in paise. */
  valueMinor: number;
  /** Shares of this order that closed earlier ones. */
  closedQuantity: number;
  /** Profit on those shares before charges. */
  grossMinor: number;
  /** Shares held after this order: positive long, negative short. */
  positionAfter: number;
}

/** A stock + product as it stands after every order. */
export interface Position {
  holding: Account;
  /** The open shares, oldest first (what a new order would close first). */
  lots: Lot[];
  symbol: string;
  product: TradeStyle;
  /** Shares held: positive long, negative short, 0 when flat. */
  quantity: number;
  /** Average price of the open shares (0 when flat), in paise. */
  avgPriceMinor: number;
  /** What the open shares cost (negative for a short). */
  openCostMinor: number;
  /** Booked profit before charges, and the charges, over all time. */
  realizedGrossMinor: number;
  chargesMinor: number;
  lastDate: string;
}

/** A position from flat back to flat: one "trade" as a trader counts it. */
export interface RoundTrip {
  holding: Account;
  direction: "long" | "short";
  openedOn: string;
  openedAt?: string;
  closedOn: string;
  closedAt?: string;
  /** The most shares held during it. */
  maxQuantity: number;
  orders: number;
  grossMinor: number;
  chargesMinor: number;
  netMinor: number;
}

export interface Journal {
  /** Every order the ledger accepted, oldest first. */
  fills: TradeFill[];
  positions: Position[];
  /** Finished round trips, oldest first. */
  roundTrips: RoundTrip[];
}

/** The same order as the ledger: by date, then time, then when entered. */
function byTime(a: TradeEvent, b: TradeEvent) {
  return (
    a.date.localeCompare(b.date) ||
    (a.time ?? "").localeCompare(b.time ?? "") ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id)
  );
}

export function buildJournal(book: Book, ledger: Ledger): Journal {
  const accepted = new Set(ledger.entries.map((e) => e.sourceId));
  const accounts = new Map(book.accounts.map((a) => [a.id, a]));
  const trades = book.events
    .filter((e): e is TradeEvent => e.type === "trade" && accepted.has(e.id) && !!accounts.get(e.holdingId)?.style)
    .sort(byTime);

  const lots = new Map<string, Lot[]>();
  const totals = new Map<string, { gross: number; charges: number; lastDate: string }>();
  const open = new Map<string, Omit<RoundTrip, "closedOn" | "closedAt" | "netMinor">>();
  const fills: TradeFill[] = [];
  const roundTrips: RoundTrip[] = [];

  for (const e of trades) {
    const holding = accounts.get(e.holdingId)!;
    const before = lots.get(holding.id) ?? [];
    const side = e.side === "buy" ? 1 : -1;
    const f = fill(before, side, e.quantity, e.priceMinor);
    lots.set(holding.id, f.lots);
    const positionAfter = openQuantity(f.lots);
    fills.push({ event: e, holding, valueMinor: e.quantity * e.priceMinor, closedQuantity: f.closedQuantity, grossMinor: f.grossMinor, positionAfter });

    const t = totals.get(holding.id) ?? { gross: 0, charges: 0, lastDate: e.date };
    totals.set(holding.id, { gross: t.gross + f.grossMinor, charges: t.charges + e.chargesMinor, lastDate: e.date });

    // Round trips: the order adds to the open one (or starts one); reaching flat, or flipping past it, finishes it.
    let trip = open.get(holding.id);
    if (!trip) {
      trip = { holding, direction: side > 0 ? "long" : "short", openedOn: e.date, openedAt: e.time, maxQuantity: 0, orders: 0, grossMinor: 0, chargesMinor: 0 };
    }
    trip.orders += 1;
    trip.grossMinor += f.grossMinor;
    trip.chargesMinor += e.chargesMinor;
    const crossed = f.closedQuantity > 0 && (positionAfter === 0 || f.openedQuantity > 0);
    if (crossed) {
      trip.maxQuantity = Math.max(trip.maxQuantity, Math.abs(openQuantity(before)));
      roundTrips.push({ ...trip, closedOn: e.date, closedAt: e.time, netMinor: trip.grossMinor - trip.chargesMinor });
      open.delete(holding.id);
      // Flipped from long to short (or back): the rest of the order opens a new one.
      if (f.openedQuantity > 0) {
        open.set(holding.id, {
          holding,
          direction: side > 0 ? "long" : "short",
          openedOn: e.date,
          openedAt: e.time,
          maxQuantity: f.openedQuantity,
          orders: 0,
          grossMinor: 0,
          chargesMinor: 0,
        });
      }
    } else {
      trip.maxQuantity = Math.max(trip.maxQuantity, Math.abs(positionAfter));
      open.set(holding.id, trip);
    }
  }

  const positions: Position[] = [...totals.entries()].map(([id, t]) => {
    const holding = accounts.get(id)!;
    const l = lots.get(id) ?? [];
    const quantity = openQuantity(l);
    const cost = openCostMinor(l);
    return {
      holding,
      lots: l,
      symbol: holding.name,
      product: holding.style!,
      quantity,
      avgPriceMinor: quantity === 0 ? 0 : Math.round(cost / quantity),
      openCostMinor: cost,
      realizedGrossMinor: t.gross,
      chargesMinor: t.charges,
      lastDate: t.lastDate,
    };
  });

  return { fills, positions, roundTrips };
}

/** One stock's orders on one day, as the Positions screen shows them. */
export interface DayPosition {
  holding: Account;
  buyQuantity: number;
  buyValueMinor: number;
  sellQuantity: number;
  sellValueMinor: number;
  grossMinor: number;
  chargesMinor: number;
}

export function dayPositions(journal: Journal, date: string): Map<string, DayPosition> {
  const out = new Map<string, DayPosition>();
  for (const f of journal.fills) {
    if (f.event.date !== date) continue;
    const d = out.get(f.holding.id) ?? { holding: f.holding, buyQuantity: 0, buyValueMinor: 0, sellQuantity: 0, sellValueMinor: 0, grossMinor: 0, chargesMinor: 0 };
    if (f.event.side === "buy") {
      d.buyQuantity += f.event.quantity;
      d.buyValueMinor += f.valueMinor;
    } else {
      d.sellQuantity += f.event.quantity;
      d.sellValueMinor += f.valueMinor;
    }
    d.grossMinor += f.grossMinor;
    d.chargesMinor += f.event.chargesMinor;
    out.set(f.holding.id, d);
  }
  return out;
}

/** P&L over a period, counting the orders and finished round trips dated inside it. */
export interface PeriodStats {
  grossMinor: number;
  chargesMinor: number;
  netMinor: number;
  orders: number;
  turnoverMinor: number;
  trips: number;
  wins: number;
  losses: number;
  /** Share of finished round trips that made money after charges, 0–1 (null with none). */
  winRate: number | null;
  avgWinMinor: number;
  avgLossMinor: number;
  bestMinor: number;
  worstMinor: number;
  /** Money won ÷ money lost on round trips (null when nothing was lost). */
  profitFactor: number | null;
  /** Net P&L per day that had orders, oldest first. */
  days: { date: string; netMinor: number; orders: number }[];
  /** Net P&L per stock, best first. */
  bySymbol: { symbol: string; product: TradeStyle; netMinor: number; orders: number }[];
}

export function periodStats(journal: Journal, from: string, to: string): PeriodStats {
  const inRange = (d: string) => d >= from && d <= to;
  const fills = journal.fills.filter((f) => inRange(f.event.date));
  const trips = journal.roundTrips.filter((t) => inRange(t.closedOn));

  const days = new Map<string, { netMinor: number; orders: number }>();
  const symbols = new Map<string, { symbol: string; product: TradeStyle; netMinor: number; orders: number }>();
  let gross = 0;
  let charges = 0;
  let turnover = 0;
  for (const f of fills) {
    const net = f.grossMinor - f.event.chargesMinor;
    gross += f.grossMinor;
    charges += f.event.chargesMinor;
    turnover += f.valueMinor;
    const d = days.get(f.event.date) ?? { netMinor: 0, orders: 0 };
    days.set(f.event.date, { netMinor: d.netMinor + net, orders: d.orders + 1 });
    const s = symbols.get(f.holding.id) ?? { symbol: f.holding.name, product: f.holding.style!, netMinor: 0, orders: 0 };
    symbols.set(f.holding.id, { ...s, netMinor: s.netMinor + net, orders: s.orders + 1 });
  }

  const won = trips.filter((t) => t.netMinor > 0);
  const lost = trips.filter((t) => t.netMinor < 0);
  const sum = (ts: RoundTrip[]) => ts.reduce((t, x) => t + x.netMinor, 0);
  const wonMinor = sum(won);
  const lostMinor = -sum(lost);

  return {
    grossMinor: gross,
    chargesMinor: charges,
    netMinor: gross - charges,
    orders: fills.length,
    turnoverMinor: turnover,
    trips: trips.length,
    wins: won.length,
    losses: lost.length,
    winRate: trips.length ? won.length / trips.length : null,
    avgWinMinor: won.length ? Math.round(wonMinor / won.length) : 0,
    avgLossMinor: lost.length ? Math.round(-lostMinor / lost.length) : 0,
    bestMinor: trips.length ? Math.max(...trips.map((t) => t.netMinor)) : 0,
    worstMinor: trips.length ? Math.min(...trips.map((t) => t.netMinor)) : 0,
    profitFactor: lostMinor > 0 ? wonMinor / lostMinor : null,
    days: [...days.entries()].map(([date, d]) => ({ date, ...d })).sort((a, b) => a.date.localeCompare(b.date)),
    bySymbol: [...symbols.values()].sort((a, b) => b.netMinor - a.netMinor),
  };
}
