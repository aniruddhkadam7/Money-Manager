"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatDisplayDate, formatMonthLong, monthEnd, shiftMonth } from "@/lib/domain/dates";
import { moneyHealth, type HealthTone } from "@/lib/finance/health";
import { firstActivityDate } from "@/lib/finance/series";
import { useSessionState } from "@/lib/use-session-state";
import { cn } from "@/lib/utils";
import { HealthBreakdown, STATUS, TONE_TEXT, tilesOf, useFixedCostsMonthly, type Tile } from "../dashboard/health-section";
import { MonthStepper } from "../dashboard/period";
import { useFinance } from "../finance-provider";
import { PageTitle } from "../page-title";
import { useStatementGaps } from "../statements/use-statement-checks";

/** How many months the month-by-month view goes back. */
const HISTORY = 12;

/** Soft bars; the month chosen in full colour. */
const BAR: Record<HealthTone, string> = {
  good: "bg-emerald-500/30",
  ok: "bg-amber-500/30",
  bad: "bg-rose-500/30",
  none: "bg-muted-foreground/20",
};
const BAR_ON: Record<HealthTone, string> = {
  good: "bg-emerald-500/80",
  ok: "bg-amber-500/80",
  bad: "bg-rose-500/80",
  none: "bg-muted-foreground/40",
};

/**
 * One money-health ratio on its own page: the ratio for each of the last 12 months (a chart and a list; tap a month
 * to see it), and for the month chosen, every figure behind it. The chips at the top switch between the ratios.
 */
export function HealthView() {
  const params = useSearchParams();
  const key = params.get("r") ?? "runway";
  const { status, book, ledger, today } = useFinance();
  const gaps = useStatementGaps();
  const fixedCosts = useFixedCostsMonthly();
  const first = useMemo(() => firstActivityDate(ledger), [ledger]);
  // The month shown: from the dashboard's switcher (in the link), then yours; kept for Back.
  const [monthsBack, setMonthsBack] = useSessionState(`healthpage:${key}:${params.get("m") ?? 0}`, Math.max(0, Number(params.get("m")) || 0));

  const thisYm = today.slice(0, 7);
  // Each month's figures, newest last, from the first month with entries.
  const history = useMemo(() => {
    if (!first) return [];
    const out: { back: number; ym: string; tiles: Tile[] }[] = [];
    for (let back = HISTORY - 1; back >= 0; back--) {
      const ym = shiftMonth(thisYm, -back);
      if (ym < first.slice(0, 7)) continue;
      const asOf = back === 0 ? today : monthEnd(ym);
      out.push({ back, ym, tiles: tilesOf(moneyHealth(book, ledger, asOf, gaps, fixedCosts), back === 0 ? "This month so far" : formatMonthLong(ym)) });
    }
    return out;
  }, [first, thisYm, today, book, ledger, gaps, fixedCosts]);

  const ym = shiftMonth(thisYm, -monthsBack);
  const asOf = monthsBack > 0 ? monthEnd(ym) : today;
  const selected = useMemo(() => {
    const inHistory = history.find((h) => h.back === monthsBack);
    if (inHistory || !first) return inHistory?.tiles ?? null;
    return tilesOf(moneyHealth(book, ledger, asOf, gaps, fixedCosts), formatMonthLong(ym));
  }, [history, monthsBack, first, book, ledger, asOf, gaps, ym, fixedCosts]);

  if (status === "loading") return <div className="h-64 animate-pulse rounded-2xl bg-muted" aria-busy />;
  if (!first || !selected) {
    return (
      <div className="grid gap-4">
        <PageTitle>Money health</PageTitle>
        <p className="rounded-2xl border p-4 text-sm text-muted-foreground">Record some income and spending to see your money health.</p>
      </div>
    );
  }
  const tile = selected.find((t) => t.key === key) ?? selected[0];
  const series = history.map((h) => ({ ...h, tile: h.tiles.find((t) => t.key === tile.key)! }));
  const nums = series.map((s) => s.tile.num ?? 0);
  const peak = Math.max(1, ...nums.map((n) => Math.abs(n)));
  const hasNegative = nums.some((n) => n < 0);

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4" data-testid="health-page">
      <PageTitle>Money health</PageTitle>

      {/* The ratios, to switch between them. */}
      <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0" aria-label="Ratios">
        {selected.map((t) => (
          <Link
            key={t.key}
            href={`/health?r=${t.key}&m=${monthsBack}`}
            replace
            scroll={false}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
              t.key === tile.key ? "border-foreground bg-foreground text-background" : "bg-card text-muted-foreground hover:bg-muted",
            )}
            aria-current={t.key === tile.key ? "page" : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {/* Month by month. */}
      <section className="rounded-3xl border glass p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{tile.label}, month by month</h2>
        </div>
        <div className={cn("flex h-40 items-stretch gap-1.5", hasNegative && "h-48")} role="img" aria-label={`${tile.label} for each month`}>
          {series.map((s) => {
            const n = s.tile.num ?? 0;
            const h = (Math.abs(n) / peak) * 100;
            const on = s.back === monthsBack;
            return (
              <button
                key={s.ym}
                type="button"
                onClick={() => setMonthsBack(s.back)}
                className={cn("flex min-w-0 flex-1 flex-col items-center rounded-lg px-0.5 pt-1 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring", on && "bg-muted")}
                aria-label={`${formatMonthLong(s.ym)}: ${s.tile.value}`}
                aria-pressed={on}
              >
                <span className={cn("truncate text-[10px] font-medium tabular-nums", on ? "text-foreground" : "text-muted-foreground")}>{s.tile.short}</span>
                {/* Positive values grow up from the middle line when some are negative, else from the bottom. */}
                <span className="relative w-full flex-1">
                  <span
                    className={cn("absolute inset-x-1 rounded-sm", on ? BAR_ON[s.tile.tone] : BAR[s.tile.tone])}
                    style={
                      hasNegative
                        ? n >= 0
                          ? { bottom: "50%", height: `${Math.max(2, h / 2)}%` }
                          : { top: "50%", height: `${Math.max(2, h / 2)}%` }
                        : { bottom: 0, height: `${Math.max(2, h)}%` }
                    }
                  />
                </span>
                <span className={cn("mt-1 text-[10px]", on ? "font-semibold text-foreground" : "text-muted-foreground")}>
                  {new Date(`${s.ym}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short" })}
                </span>
              </button>
            );
          })}
        </div>

        <ul className="mt-4 divide-y">
          {[...series].reverse().map((s) => (
            <li key={s.ym}>
              <button
                type="button"
                onClick={() => {
                  setMonthsBack(s.back);
                  document.getElementById("health-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                className={cn("flex w-full items-center justify-between gap-3 py-2.5 text-left hover:bg-muted/50", s.back === monthsBack && "bg-muted/60")}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{s.back === 0 ? `${formatMonthLong(s.ym)} (so far)` : formatMonthLong(s.ym)}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    <span className={cn("font-medium", TONE_TEXT[s.tile.tone])}>{STATUS[s.tile.tone]}</span> · {s.tile.sub}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">{s.tile.value}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* The month chosen, in full. */}
      <section id="health-detail" className="scroll-mt-20 rounded-3xl border glass p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">How it&apos;s worked out</h2>
          <MonthStepper ym={ym} monthsBack={monthsBack} canGoBack={ym > first.slice(0, 7)} onChange={setMonthsBack} />
        </div>
        <HealthBreakdown key={`${tile.key}-${monthsBack}`} tile={tile} when={monthsBack > 0 ? `As at ${formatDisplayDate(asOf)}` : "As of today"} />
      </section>
    </div>
  );
}
