"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useKotakPositions } from "@/lib/brokers/kotak-store";
import type { AnchorGap } from "@/lib/finance/statement-anchor";
import { buildJournal } from "@/lib/trading/journal";
import { useFinance } from "../finance-provider";
import { useLtp } from "./use-ltp";

const MarksContext = createContext<AnchorGap[]>([]);

/** How often share prices are fetched for valuing what you own (the Invest tab fetches its own, faster). */
const PRICE_EVERY_MS = 5 * 60_000;

/**
 * Your shares at their market value: for each stock you hold (or are short), the last price (live, else Kotak's
 * closing price) times the shares, less what they cost, as an adjustment from today on. Every total that goes by
 * the statements (net worth, what you own, Money health, Friday's figures) picks it up through useStatementGaps.
 */
export function MarketValueProvider({ children }: { children: ReactNode }) {
  const { book, ledger, today, status } = useFinance();
  const kotak = useKotakPositions();
  const open = useMemo(() => (status === "ready" ? buildJournal(book, ledger).positions.filter((p) => p.quantity !== 0) : []), [book, ledger, status]);
  const { ltp } = useLtp(
    open.map((p) => p.symbol),
    PRICE_EVERY_MS,
  );
  // The prices as a string, so the adjustments only change when a price (or a position) does.
  const closeOf = (symbol: string) => kotak?.holdings?.find((h) => h.symbol === symbol.toUpperCase())?.closePriceMinor || null;
  const priceKey = open.map((p) => `${p.holding.id}:${ltp(p.symbol) ?? closeOf(p.symbol) ?? ""}`).join(",");
  const marks = useMemo<AnchorGap[]>(
    () =>
      open.flatMap((p) => {
        const price = ltp(p.symbol) ?? closeOf(p.symbol);
        if (!price) return [];
        const delta = price * p.quantity - p.openCostMinor;
        return delta ? [{ accountId: p.holding.id, date: today, gapMinor: delta, kind: "investment" as const }] : [];
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [priceKey, today],
  );
  return <MarksContext.Provider value={marks}>{children}</MarksContext.Provider>;
}

/** Today's market-value adjustments for your shares (empty while prices load, or when you hold none). */
export const useMarketMarks = () => useContext(MarksContext);
