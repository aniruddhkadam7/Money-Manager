"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatMonthLong, monthEnd, monthStart, shiftMonth } from "@/lib/domain/dates";
import { DEFAULT_PERIOD, PERIODS, periodWords, rangeStart, type RangeKey } from "@/lib/finance/series";
import { useSessionState } from "@/lib/use-session-state";
import { useFinance } from "../finance-provider";

/**
 * A dashboard card's period: the tabs (This month, 1M … All) and, on "This month", the ‹ Nov 2026 › switcher that
 * steps back a month at a time. Gives the dates to show and how to say them. Kept for Back, like the rest of the view.
 */
export function useCardPeriod(key: string, firstActivity: string | null, initial: RangeKey = DEFAULT_PERIOD) {
  const { today } = useFinance();
  const [span, setSpanOnly] = useSessionState<RangeKey>(`${key}:span`, initial);
  // 0 is this month, 1 last month, and so on (only on "This month").
  const [monthsBack, setMonthsBack] = useSessionState(`${key}:monthsBack`, 0);
  const ym = shiftMonth(today.slice(0, 7), -monthsBack);
  const past = span === "MTD" && monthsBack > 0;
  return {
    span,
    setSpan: (v: RangeKey) => {
      setSpanOnly(v);
      setMonthsBack(0);
    },
    // Stepped back to an earlier month, "This month" would be wrong: it's a month picker then.
    options: PERIODS.map((p) => (p.value === "MTD" && monthsBack > 0 ? { ...p, label: "Month" } : p)),
    /** An earlier month is showing (its dates end on its last day, not today). */
    past,
    from: past ? monthStart(ym) : rangeStart(span, today, firstActivity),
    to: past ? monthEnd(ym) : today,
    /** "this month", "in October 2026", "in the last 3 months"… */
    words: past ? `in ${formatMonthLong(ym)}` : periodWords(span),
    stepper:
      span === "MTD" ? (
        <MonthStepper ym={ym} monthsBack={monthsBack} canGoBack={!!firstActivity && ym > firstActivity.slice(0, 7)} onChange={setMonthsBack} />
      ) : null,
  };
}

export type CardPeriod = ReturnType<typeof useCardPeriod>;

/** ‹ Nov 2026 › in a card's top-right corner: one month at a time, from this month back to the first month with entries. */
export function MonthStepper({ ym, monthsBack, canGoBack, onChange }: { ym: string; monthsBack: number; canGoBack: boolean; onChange: (n: number) => void }) {
  const name = new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  const btn =
    "flex size-8 shrink-0 items-center justify-center rounded-full border bg-card text-slate-700 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30";
  return (
    <div className="flex shrink-0 items-center gap-1.5" data-testid="month-stepper">
      <button type="button" className={btn} onClick={() => onChange(monthsBack + 1)} disabled={!canGoBack} aria-label="Previous month">
        <ChevronLeft className="size-4" />
      </button>
      <div className="min-w-[4.75rem] text-center leading-tight" aria-live="polite">
        <div className="text-sm font-semibold text-foreground">{name}</div>
        <div className="text-[10px] text-muted-foreground">{monthsBack === 0 ? "So far" : monthsBack === 1 ? "Last month" : `${monthsBack} months ago`}</div>
      </div>
      <button type="button" className={btn} onClick={() => onChange(monthsBack - 1)} disabled={monthsBack === 0} aria-label="Next month">
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
