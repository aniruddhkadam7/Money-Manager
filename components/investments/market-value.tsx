"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useKotakPositions } from "@/lib/brokers/kotak-store";
import { addDays } from "@/lib/domain/dates";
import { ledgerIds } from "@/lib/finance/engine";
import type { AnchorGap } from "@/lib/finance/statement-anchor";
import type { TradeEvent } from "@/lib/finance/types";
import { buildJournal } from "@/lib/trading/journal";
import { useFinance } from "../finance-provider";
import { authFetch } from "@/lib/cloud/client";
import { useLtp, yahooSymbol } from "./use-ltp";

const MarksContext = createContext<AnchorGap[]>([]);

/** How often share prices are fetched for valuing what you own (the Invest tab fetches its own, faster). */
const PRICE_EVERY_MS = 5 * 60_000;
/** How far back each day's value is worked out (charts go back a year). */
const HISTORY_DAYS = 400;

/** Each share's daily closes since a date (rupees, by date), kept in this browser for the day. */
function useDailyCloses(symbols: string[], from: string | null, today: string): Record<string, Record<string, number>> {
  const key = from ? `${[...new Set(symbols.map((s) => yahooSymbol(s)))].sort().join(",")}|${from}` : "";
  const [state, setState] = useState<{ key: string; closes: Record<string, Record<string, number>> }>({ key: "", closes: {} });
  useEffect(() => {
    if (!key) return;
    const storeKey = `stock-history:${today}:${key}`;
    try {
      const kept = window.localStorage.getItem(storeKey);
      if (kept) {
        setState({ key, closes: JSON.parse(kept) });
        return;
      }
    } catch {
      /* fetch it */
    }
    let alive = true;
    const [syms] = key.split("|");
    authFetch(`/api/stocks/history?symbols=${encodeURIComponent(syms)}&from=${from}`)
      .then((r) => (r.ok ? r.json() : { closes: {} }))
      .then((d: { closes: Record<string, Record<string, number>> }) => {
        if (!alive) return;
        setState({ key, closes: d.closes ?? {} });
        try {
          window.localStorage.setItem(storeKey, JSON.stringify(d.closes ?? {}));
        } catch {
          /* not kept */
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [key, from, today]);
  return state.key === key ? state.closes : {};
}

/**
 * Your shares at their market value, on every day: each trading day's closing price times the shares you held
 * that day, less what they cost then; and today, the live price (else Kotak's closing price). As adjustments, so
 * every total and chart that goes by the statements (net worth, what you own, Money health, the Investments and
 * Net worth charts, Friday's figures) shows what your shares were worth each day, not what they cost.
 */
export function MarketValueProvider({ children }: { children: ReactNode }) {
  const { book, ledger, today, status } = useFinance();
  const kotak = useKotakPositions();
  const ready = status === "ready";
  const open = useMemo(() => (ready ? buildJournal(book, ledger).positions.filter((p) => p.quantity !== 0) : []), [book, ledger, ready]);
  const { ltp } = useLtp(
    open.map((p) => p.symbol),
    PRICE_EVERY_MS,
  );

  // Every stock ever traded, with its trades and its cost (the holding's balance) over time.
  const history = useMemo(() => {
    if (!ready) return null;
    const stocks = book.accounts.filter((a) => a.type === "investment" && a.style);
    if (!stocks.length) return null;
    const trades = book.events.filter((e): e is TradeEvent => e.type === "trade" && stocks.some((s) => s.id === e.holdingId));
    if (!trades.length) return null;
    const first = trades.reduce((m, t) => (t.date < m ? t.date : m), today);
    const earliest = addDays(today, -HISTORY_DAYS);
    const costMoves = new Map<string, { date: string; delta: number }[]>();
    for (const s of stocks) {
      const id = ledgerIds.account(s.id);
      const moves: { date: string; delta: number }[] = [];
      for (const e of ledger.entries) for (const p of e.postings) if (p.ledger === id) moves.push({ date: e.date, delta: p.amountMinor });
      costMoves.set(s.id, moves.sort((a, b) => (a.date < b.date ? -1 : 1)));
    }
    return { stocks, trades, from: first < earliest ? earliest : first, costMoves };
  }, [ready, book, ledger, today]);
  const closes = useDailyCloses(history?.stocks.map((s) => s.name) ?? [], history?.from ?? null, today);

  // Each past trading day's value of each stock, as an adjustment on that day.
  const dailyMarks = useMemo<AnchorGap[]>(() => {
    if (!history) return [];
    const out: AnchorGap[] = [];
    for (const s of history.stocks) {
      const prices = closes[yahooSymbol(s.name)];
      if (!prices) continue;
      const trades = history.trades.filter((t) => t.holdingId === s.id).sort((a, b) => (a.date < b.date ? -1 : 1));
      const moves = history.costMoves.get(s.id) ?? [];
      let qty = 0;
      let cost = 0;
      let ti = 0;
      let mi = 0;
      for (const date of Object.keys(prices).sort()) {
        if (date >= today) continue;
        while (ti < trades.length && trades[ti].date <= date) {
          qty += trades[ti].side === "buy" ? trades[ti].quantity : -trades[ti].quantity;
          ti++;
        }
        while (mi < moves.length && moves[mi].date <= date) cost += moves[mi++].delta;
        // Held that day: worth that day's close. Not held: nothing to add (and nothing carried from before).
        out.push({ accountId: s.id, date, gapMinor: qty !== 0 ? Math.round(prices[date] * 100) * qty - cost : 0, kind: "investment" });
      }
    }
    return out;
  }, [history, closes, today]);

  // Today: the live price (else Kotak's closing price), so the latest figure moves with the market.
  const closeOf = (symbol: string) => kotak?.holdings?.find((h) => h.symbol === symbol.toUpperCase())?.closePriceMinor || null;
  const priceKey = open.map((p) => `${p.holding.id}:${ltp(p.symbol) ?? closeOf(p.symbol) ?? ""}`).join(",");
  const todayMarks = useMemo<AnchorGap[]>(
    () =>
      open.flatMap((p) => {
        const price = ltp(p.symbol) ?? closeOf(p.symbol);
        if (!price) return [];
        return [{ accountId: p.holding.id, date: today, gapMinor: price * p.quantity - p.openCostMinor, kind: "investment" as const }];
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [priceKey, today],
  );

  const marks = useMemo(() => [...dailyMarks, ...todayMarks], [dailyMarks, todayMarks]);
  return <MarksContext.Provider value={marks}>{children}</MarksContext.Provider>;
}

/** The market-value adjustments for your shares, day by day (empty while prices load, or when you hold none). */
export const useMarketMarks = () => useContext(MarksContext);
