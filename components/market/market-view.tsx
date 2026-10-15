"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type TouchEvent } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EconomySection, ScoreTable, SCORE_SORTS } from "./economy-health";
import { CATALOG, COMMODITIES, CURRENCY, INDIA, SECTORS, WORLD, YIELDS, type CatalogItem } from "@/lib/market/catalog";
import { formatMonth, formatPe, formatPoints, formatPrice, formatQuoteReturn, formatReturn, updatedAt } from "@/lib/market/format";
import { PERIODS, type Economy, type IndexValuation, type Period, type Quote } from "@/lib/market/types";
import { sparkFor } from "@/lib/market/perf";
import { cn, scrollPage } from "@/lib/utils";
import { ChartCard, RangeTabs } from "../charts/primitives";
import { PageTitle } from "../page-title";
import { QuoteDetail } from "./quote-detail";
import { SectorCompare } from "./sector-compare";
import { SectorSheet } from "./sector-sheet";
import { SectorValuations } from "./sector-valuations";
import { QUOTE_SORTS, sortItems, SortSelect, useSort, type QuoteSort, type SortOption } from "./sort";
import { Sparkline } from "./sparkline";
import { useEconomy, useOverview, useValuation } from "./use-market";

/**
 * Two views, kept apart: Markets (prices that move every day, with the 1D … 1Y period) and Economy
 * (growth, inflation, jobs and interest rates, which change monthly or yearly and have no period).
 */
type Mode = "markets" | "economy";
const MODES: { value: Mode; label: string }[] = [
  { value: "markets", label: "Markets" },
  { value: "economy", label: "Economy" },
];

type Tab = "india" | "sectors" | "world" | "money";
const TABS: { value: Tab; label: string }[] = [
  { value: "india", label: "India" },
  { value: "sectors", label: "Sectors" },
  { value: "world", label: "World" },
  { value: "money", label: "Commodities & FX" },
];
/** Phones show the economy a part at a time, like the market sections; wider screens show it all. */
type EcoTab = "india" | "world" | "rates" | "compare";
const ECO_TABS: { value: EcoTab; label: string }[] = [
  { value: "india", label: "India" },
  { value: "world", label: "World" },
  { value: "rates", label: "Central banks" },
  { value: "compare", label: "Compare" },
];

/** A section tab: on phones text with a bar under the current one, as in a market app; wider, a pill. */
const tabClass = (active: boolean) =>
  cn(
    "shrink-0 text-sm font-medium transition-colors",
    "max-sm:relative max-sm:-mb-px max-sm:select-none max-sm:py-3 max-sm:text-[15px] max-sm:after:absolute max-sm:after:inset-x-0 max-sm:after:bottom-0 max-sm:after:h-[3px] max-sm:after:rounded-full max-sm:after:transition-colors",
    active ? "max-sm:text-slate-900 max-sm:after:bg-primary max-sm:font-semibold" : "max-sm:text-slate-500 max-sm:after:bg-transparent",
    "sm:rounded-full sm:border sm:px-3.5 sm:py-1.5",
    active ? "sm:border-transparent sm:bg-primary sm:text-primary-foreground" : "sm:bg-[var(--glass)] sm:text-slate-600 sm:hover:text-slate-900",
  );

/** The view, tab and period last chosen, kept in this browser only. */
const VIEW_KEY = "mm-market-view";

const HOME = [CATALOG["GOLD-INR"], CATALOG["SILVER-INR"], CATALOG["USDINR=X"], CATALOG["BZ=F"]];

const SECTOR_SORTS: SortOption<QuoteSort>[] = [
  { value: "best", label: "Best return" },
  { value: "worst", label: "Worst return" },
  { value: "name", label: "Name A–Z" },
];

type RateSort = "listed" | "high" | "low" | "recent" | "name";
const RATE_SORTS: SortOption<RateSort>[] = [
  { value: "listed", label: "Usual order" },
  { value: "high", label: "Highest rate" },
  { value: "low", label: "Lowest rate" },
  { value: "recent", label: "Latest move first" },
  { value: "name", label: "Name A–Z" },
];

/** RELIANCE.NS -> RELIANCE, ^NSEI -> NSEI, USDINR=X -> USDINR: the symbol as people say it. */
function shortSymbol(symbol: string) {
  return symbol.replace(/^\^/, "").replace(/\.(NS|BO)$/, "").replace(/=[XF]$/, "");
}

function subline(q: Quote) {
  if (q.kind === "fund") return q.exchange ?? "Mutual fund";
  if (q.unit) return `per ${q.unit}`;
  if (q.kind === "currency") return q.symbol.endsWith("INR=X") ? `1 ${q.symbol.slice(0, 3)} in rupees` : "Against major currencies";
  if (q.kind === "crypto") return `In ${q.currency === "INR" ? "rupees" : q.currency}`;
  if (q.kind === "yield") return "Yield";
  return [shortSymbol(q.symbol), q.exchange].filter(Boolean).join(" · ");
}

const returnPill = (v: number | null) => (v === null ? "bg-slate-100 text-slate-400" : v > 0 ? "bg-emerald-50 text-emerald-700" : v < 0 ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600");
const returnTone = (v: number | null) => (v === null ? "text-slate-400" : v > 0 ? "text-emerald-700" : v < 0 ? "text-rose-700" : "text-slate-500");

/**
 * How markets and economies are doing, for understanding rather than trading. Markets: India's indices,
 * its sectors (and against the world's), world markets, commodities and currencies, all over one
 * chosen period. Economy: India's figures, economies compared, central banks.
 */
export function MarketView() {
  const [mode, setMode] = useState<Mode>("markets");
  const [tab, setTab] = useState<Tab>("india");
  const [ecoTab, setEcoTab] = useState<EcoTab>("india");
  const [period, setPeriod] = useState<Period>("1m");
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(VIEW_KEY) ?? "{}") as { mode?: Mode; tab?: string; period?: Period };
      if (MODES.some((m) => m.value === saved.mode)) setMode(saved.mode!);
      // "rates" was the old name of the money tab.
      const savedTab = saved.tab === "rates" ? "money" : saved.tab;
      if (TABS.some((t) => t.value === savedTab)) setTab(savedTab as Tab);
      if (PERIODS.some((p) => p.value === saved.period)) setPeriod(saved.period!);
    } catch {
      // Defaults then.
    }
  }, []);
  const remember = (next: { mode?: Mode; tab?: Tab; period?: Period }) => {
    try {
      window.localStorage.setItem(VIEW_KEY, JSON.stringify({ mode: next.mode ?? mode, tab: next.tab ?? tab, period: next.period ?? period }));
    } catch {
      // Not remembered; fine.
    }
  };

  const barRef = useRef<HTMLDivElement>(null);
  /** Just above the bar: where the page scrolls back to when the section changes. */
  const anchorRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const swipe = useRef<{ x: number; y: number; at: number } | null>(null);
  const [enterFrom, setEnterFrom] = useState<"left" | "right" | null>(null);

  // The current tab stays in view in the strip of tabs (phones scroll it sideways).
  useEffect(() => {
    if (mode === "markets") tabRefs.current[tab]?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [tab, mode]);

  /** A quick, mostly sideways swipe over the content moves one section along; not from inside a sideways scroller. */
  const onSwipeStart = (e: TouchEvent) => {
    const t = e.touches[0];
    swipe.current = e.touches.length === 1 && !(e.target as Element).closest("[data-swipe-ignore]") ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
  };
  const onSwipeEnd = (e: TouchEvent) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.5 || Date.now() - start.at > 700) return;
    const step = dx < 0 ? 1 : -1;
    if (mode === "economy") {
      const next = ECO_TABS[ECO_TABS.findIndex((x) => x.value === ecoTab) + step];
      if (next) chooseEcoTab(next.value);
      return;
    }
    const next = TABS[TABS.findIndex((x) => x.value === tab) + step];
    if (next) chooseTab(next.value);
  };

  /** Back to the section's top, just under the pinned bar, if the page had scrolled past it. */
  const toSectionTop = () => {
    const anchor = anchorRef.current;
    const bar = barRef.current;
    if (!anchor || !bar) return;
    const offset = parseFloat(getComputedStyle(bar).top) || 0;
    const gap = anchor.getBoundingClientRect().top - offset;
    if (gap < 0) scrollPage({ top: (document.body.scrollTop || window.scrollY) + gap });
  };
  const chooseEcoTab = (next: EcoTab) => {
    if (next === ecoTab) return;
    toSectionTop();
    const order = (t: EcoTab) => ECO_TABS.findIndex((x) => x.value === t);
    setEnterFrom(order(next) > order(ecoTab) ? "right" : "left");
    setEcoTab(next);
  };
  const chooseTab = (next: Tab) => {
    if (next === tab) return;
    // A new section starts at its top, just under the pinned bar.
    toSectionTop();
    // The new section slides in from the side it sits on, like a phone app's pages.
    const order = (t: Tab) => TABS.findIndex((x) => x.value === t);
    setEnterFrom(order(next) > order(tab) ? "right" : "left");
    setTab(next);
    remember({ tab: next });
  };
  const choosePeriod = (next: Period) => {
    setPeriod(next);
    remember({ period: next });
  };
  const chooseMode = (next: Mode) => {
    if (next === mode) return;
    const order = (m: Mode) => MODES.findIndex((x) => x.value === m);
    setEnterFrom(order(next) > order(mode) ? "right" : "left");
    setMode(next);
    remember({ mode: next });
    scrollPage({ top: 0 });
  };

  // Each half fetches only its own data: the economy figures aren't asked for until Economy is opened.
  const overview = useOverview(mode === "markets");
  const valuation = useValuation(mode === "markets" && (tab === "india" || tab === "sectors"));
  const economy = useEconomy(mode === "economy");
  const [selected, setSelected] = useState<Quote | null>(null);
  const [sector, setSector] = useState<Quote | null>(null);

  const quotes = useMemo(() => {
    const map: Record<string, Quote> = {};
    for (const q of overview.data?.quotes ?? []) map[q.symbol] = q;
    return map;
  }, [overview.data]);
  const failed = useMemo(() => new Set(overview.data?.failed ?? []), [overview.data]);
  const economies = economy.data?.economies ?? [];
  const india = economies.find((e) => e.code === "IND");
  const world = economies.find((e) => e.code === "WEOWORLD");

  const asOf = mode === "markets" ? overview.data?.fetchedAt : economy.data?.fetchedAt;
  const shared = { quotes, failed, period, onOpen: setSelected };
  const [sectorSort, setSectorSort] = useSort("sectors", SECTOR_SORTS, "best");
  const [scoreSort, setScoreSort] = useSort("economies", SCORE_SORTS, "listed");
  const [rateSort, setRateSort] = useSort("rates", RATE_SORTS, "listed");

  return (
    // grid-cols-1 is minmax(0, 1fr): the page never grows wider than the screen to fit a wide child; wide rows scroll inside.
    <div className="grid grid-cols-1 gap-4 sm:gap-5">
      <h1 className="sr-only">Markets and economy</h1>
      <div ref={anchorRef} aria-hidden className="-mb-4 h-0 sm:-mb-5" />
      {/* The page's top, as in a phone market app: which half (a segmented switch) and when its figures are from, then that
          half's own sections. Phones keep it pinned under the header while the page scrolls. */}
      <div
        ref={barRef}
        className={cn(
          "grid grid-cols-1 gap-3",
          // Solid, so the list scrolling underneath doesn't show through the tabs.
          "max-sm:sticky max-sm:top-[calc(env(safe-area-inset-top)+3.0625rem)] max-sm:z-30 max-sm:-mx-4 max-sm:-mt-2 max-sm:gap-2 max-sm:border-b max-sm:bg-[var(--glass-solid)] max-sm:px-4 max-sm:pb-2.5 max-sm:pt-2 max-sm:shadow-sm",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div role="tablist" aria-label="View" className="inline-flex rounded-full bg-slate-100 p-1 max-sm:flex-1">
            {MODES.map((m) => (
              <button
                key={m.value}
                role="tab"
                type="button"
                aria-selected={mode === m.value}
                onClick={() => chooseMode(m.value)}
                className={cn(
                  "select-none rounded-full px-5 py-1.5 text-sm font-semibold transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:flex-1 max-sm:px-2 max-sm:py-2 max-sm:text-[15px]",
                  mode === m.value ? "bg-card text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          {asOf && <span className="text-xs text-slate-500 max-sm:hidden">{mode === "markets" ? "Prices as of" : "Updated"} {updatedAt(asOf / 1000)}</span>}
        </div>

        {mode === "markets" && (
          <div className="flex flex-wrap items-center justify-between gap-3 max-sm:gap-2.5">
            <div
              role="tablist"
              aria-label="Section"
              data-swipe-ignore
              className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] max-sm:w-[calc(100%+2rem)] max-sm:justify-between max-sm:gap-3 max-sm:border-b max-sm:border-slate-200 sm:mx-0 sm:px-0"
            >
              {TABS.map((t) => (
                <button
                  key={t.value}
                  ref={(el) => void (tabRefs.current[t.value] = el)}
                  role="tab"
                  type="button"
                  aria-selected={tab === t.value}
                  onClick={() => chooseTab(t.value)}
                  className={tabClass(tab === t.value)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {/* Phones: a full-width strip under the tabs, five equal buttons big enough for a thumb. */}
            <div className="max-sm:w-full max-sm:[&>[role=tablist]]:flex max-sm:[&>[role=tablist]]:w-full max-sm:[&_button]:flex-1 max-sm:[&_button]:select-none max-sm:[&_button]:py-1.5 max-sm:[&_button]:text-sm max-sm:[&_button]:font-semibold">
              <RangeTabs label="Returns over" value={period} options={PERIODS} onChange={choosePeriod} />
            </div>
          </div>
        )}

        {/* Phones only: the economy a part at a time (wider screens show it all at once). */}
        {mode === "economy" && (
          <div role="tablist" aria-label="Economy section" data-swipe-ignore className="-mx-4 flex overflow-x-auto px-4 [scrollbar-width:none] max-sm:justify-between max-sm:gap-3 max-sm:border-b max-sm:border-slate-200 sm:hidden">
            {ECO_TABS.map((t) => (
              <button key={t.value} role="tab" type="button" aria-selected={ecoTab === t.value} onClick={() => chooseEcoTab(t.value)} className={tabClass(ecoTab === t.value)}>
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {mode === "markets" ? (
        <>
          {/* Phones: swipe sideways for the next or previous section, as in a market app. */}
          <div
            key={tab}
            onTouchStart={onSwipeStart}
            onTouchEnd={onSwipeEnd}
            className={cn("grid grid-cols-1 gap-4 sm:gap-5", enterFrom && "animate-in fade-in-0 duration-300", enterFrom === "right" && "slide-in-from-right-8", enterFrom === "left" && "slide-in-from-left-8")}
          >
            {overview.status === "error" && !overview.data ? (
              <section className="rounded-3xl border glass px-6 py-16 text-center">
                <p className="font-medium text-slate-900">Couldn&apos;t reach the market data.</p>
                <p className="mt-1 text-sm text-slate-500">Check your connection, then try again.</p>
                <Button className="mt-4" onClick={overview.refresh}>
                  Try again
                </Button>
              </section>
            ) : tab === "india" ? (
              <>
                {/* Phones: a sideways strip, like a market app's index ticker (the next tile peeks in). Wider: a grid. */}
                <div
                  data-swipe-ignore
                  className="max-sm:-mx-4 max-sm:flex max-sm:snap-x max-sm:snap-mandatory max-sm:scroll-px-4 max-sm:gap-3 max-sm:overflow-x-auto max-sm:px-4 max-sm:pb-1 max-sm:[scrollbar-width:none] sm:grid sm:grid-cols-3 sm:gap-3 xl:grid-cols-6"
                >
                  {INDIA.map((c) => (
                    <IndexTile key={c.symbol} item={c} quote={quotes[c.symbol]} value={valuation.data?.indices[c.symbol]} failed={failed.has(c.symbol)} period={period} onOpen={setSelected} />
                  ))}
                </div>
                <div className="grid grid-cols-1 items-start gap-4 sm:gap-5 lg:grid-cols-2">
                  <QuoteCard id="home" title="Prices that matter at home" items={HOME} {...shared} />
                  <SectorGlance quotes={quotes} period={period} onOpen={setSector} onAll={() => chooseTab("sectors")} />
                </div>
              </>
            ) : tab === "sectors" ? (
              <div className="grid grid-cols-1 items-start gap-4 sm:gap-5 xl:grid-cols-2">
                <ChartCard
                  title={`How India's sectors did ${PERIODS.find((p) => p.value === period)!.words}`}
                  action={<SortSelect label="Sort sectors" value={sectorSort} options={SECTOR_SORTS} onChange={setSectorSort} />}
                >
                  <SectorBars quotes={quotes} failed={failed} period={period} sort={sectorSort} onOpen={setSector} />
                  <p className="mt-4 text-xs leading-relaxed text-slate-500">
                    Nifty sector indices; tap one for its stocks. Where Yahoo keeps no history for an index, returns beyond today follow an ETF that tracks it, or are rebuilt from the index’s own stocks weighted by company size (close to NSE’s figures, not exact).
                  </p>
                </ChartCard>
                <SectorCompare quotes={quotes} period={period} onOpenSector={setSector} onOpenQuote={setSelected} />
                <SectorValuations data={valuation.data} status={valuation.status} quotes={quotes} onOpenSector={setSector} onOpenQuote={setSelected} />
              </div>
            ) : tab === "world" ? (
              <div className="grid grid-cols-1 items-start gap-4 sm:gap-5 lg:grid-cols-2">
                <QuoteCard id="world" title="World markets" items={WORLD} {...shared} />
                <QuoteCard id="yields" title="Bond yields" items={YIELDS} {...shared} />
              </div>
            ) : (
              <div className="grid grid-cols-1 items-start gap-4 sm:gap-5 lg:grid-cols-2">
                <QuoteCard id="commodities" title="Commodities & crypto" items={COMMODITIES} {...shared} />
                <QuoteCard id="currency" title="Currencies" items={CURRENCY} {...shared} />
              </div>
            )}
          </div>

          <p className="text-center text-xs leading-relaxed text-slate-500">
            {asOf && <span className="sm:hidden">Prices as of {updatedAt(asOf / 1000)}. </span>}
            Yahoo Finance and AMFI (mfapi.in), refreshed about every 30 minutes. For understanding, not trading.
          </p>
        </>
      ) : (
        <>
          {/* Economy: slow-moving pictures, no period to choose. Wider screens show them all; phones one tab at a time,
              swiped between like the market sections. */}
          <div
            key={ecoTab}
            onTouchStart={onSwipeStart}
            onTouchEnd={onSwipeEnd}
            className={cn(
              "grid grid-cols-1 items-start gap-4 sm:gap-5 lg:grid-cols-2 [&>*]:min-w-0",
              enterFrom && "animate-in fade-in-0 duration-300",
              enterFrom === "right" && "slide-in-from-right-8",
              enterFrom === "left" && "slide-in-from-left-8",
            )}
          >
            <div className={cn("lg:col-span-2", ecoTab !== "india" && "max-sm:hidden")}>
              <EconomySection title="How India is doing" economy={india} world={world} status={economy.status} />
            </div>
            <div className={cn("lg:col-span-2", ecoTab !== "world" && "max-sm:hidden")}>
              <EconomySection title="How the world is doing" economy={world} status={economy.status} />
            </div>
            <div className={cn("[&>section]:h-full", ecoTab !== "rates" && "max-sm:hidden")}>
              <ChartCard title="Central bank rates" action={<SortSelect label="Sort central banks" value={rateSort} options={RATE_SORTS} onChange={setRateSort} />}>
                <PolicyRates economies={economies} status={economy.status} sort={rateSort} />
              </ChartCard>
            </div>
            <div className={cn(ecoTab !== "compare" && "max-sm:hidden")}>
              <ScoreTable economies={economies} status={economy.status} sort={scoreSort} onSort={setScoreSort} />
            </div>
          </div>
          <p className="text-center text-xs leading-relaxed text-slate-500">
            Verdicts are about the latest year that has actually happened, never a forecast, and each card shows the rule it was judged by. The rules are common rules of thumb, judged differently for developing and mature economies; they describe, they don't predict. Sources: IMF World Economic Outlook (the current year is its estimate), BIS, World Bank.
            {economy.data?.fromWorldBank?.length
              ? " The IMF couldn't be reached this time, so these figures are the World Bank's: actual years only, no forecasts, and no debt or budget figures where it has none."
              : ""}
          </p>
        </>
      )}

      <SectorSheet sector={sector} valuation={valuation.data} period={period} onPeriod={choosePeriod} onClose={() => setSector(null)} onOpen={setSelected} />
      {/* After the sector sheet, so a stock opened from it shows on top. */}
      <QuoteDetail quote={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

/** Phones: about two and a half tiles across, each snapping into place. */
const TILE = "max-sm:w-[42%] max-sm:min-w-[9.5rem] max-sm:shrink-0 max-sm:snap-start";

function IndexTile({
  item,
  quote,
  value,
  failed,
  period,
  onOpen,
}: {
  item: CatalogItem;
  quote?: Quote;
  /** NSE's PE for the index; only Nifty indices have one. */
  value?: IndexValuation;
  failed: boolean;
  period: Period;
  onOpen: (q: Quote) => void;
}) {
  if (!quote)
    return (
      <div className={cn(TILE, "rounded-2xl border glass p-3 sm:p-4")}>
        <p className="truncate text-xs font-medium text-slate-500">{item.name}</p>
        {failed ? (
          <p className="mt-2 text-sm text-slate-500">Not available</p>
        ) : (
          <div className="mt-2 grid gap-1.5" aria-busy>
            <span className="h-6 w-24 animate-pulse rounded bg-slate-100" />
            <span className="h-4 w-16 animate-pulse rounded bg-slate-100" />
          </div>
        )}
      </div>
    );
  const r = quote.perf[period];
  return (
    <button type="button" onClick={() => onOpen(quote)} className={cn(TILE, "rounded-2xl border glass p-3 text-left transition-transform active:scale-[0.98] sm:p-4")}>
      <p className="truncate text-xs font-medium text-slate-500">{item.name}</p>
      <p className="mt-1 text-lg font-semibold leading-tight tabular-nums text-slate-900 sm:text-xl">{formatPrice(quote.price, quote)}</p>
      <div className="mt-1 flex items-end justify-between gap-2">
        <span className={cn("text-xs font-semibold tabular-nums", returnTone(r))}>{formatQuoteReturn(quote, r)}</span>
        <Sparkline values={sparkFor(quote.spark, period)} width={64} height={24} />
      </div>
      {value?.pe != null && (
        <p className="mt-1 text-[11px] tabular-nums text-slate-500" title="Price ÷ earnings, as NSE publishes it for the index">
          PE {formatPe(value.pe)}
          {value.pb != null && ` · PB ${value.pb.toFixed(1)}`}
        </p>
      )}
    </button>
  );
}

/** A card of quotes with its own sort dropdown (remembered per card). */
function QuoteCard({
  id,
  title,
  items,
  ...list
}: {
  id: string;
  title: string;
  items: CatalogItem[];
  quotes: Record<string, Quote>;
  failed: Set<string>;
  period: Period;
  onOpen: (q: Quote) => void;
}) {
  const [sort, setSort] = useSort(id, QUOTE_SORTS, "listed");
  const sorted = sortItems(items, sort, list.period, (c) => list.quotes[c.symbol], (c) => list.quotes[c.symbol]?.name ?? c.name);
  return (
    <ChartCard
      title={title}
      action={<SortSelect label={`Sort ${title.toLowerCase()}`} value={sort} options={QUOTE_SORTS} onChange={setSort} />}
    >
      <QuoteList items={sorted} {...list} />
    </ChartCard>
  );
}

function QuoteList({
  items,
  quotes,
  failed,
  period,
  onOpen,
}: {
  items: CatalogItem[];
  quotes: Record<string, Quote>;
  failed: Set<string>;
  period: Period;
  onOpen: (q: Quote) => void;
}) {
  return (
    <ul className="-mx-2 divide-y divide-slate-100">
      {items.map((item) => {
        const q = quotes[item.symbol];
        const r = q?.perf[period] ?? null;
        return (
          <li key={item.symbol}>
            <button
              type="button"
              disabled={!q}
              onClick={() => q && onOpen(q)}
              className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-slate-100/70 disabled:hover:bg-transparent"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-900">{q && !CATALOG[item.symbol] ? q.name : item.name}</span>
                <span className="block truncate text-xs text-slate-500">{q ? subline(q) : shortSymbol(item.symbol)}</span>
              </span>
              {/* The smallest phones need the room for the name. */}
              {q && (
                <span className="max-[380px]:hidden">
                  <Sparkline values={sparkFor(q.spark, period)} />
                </span>
              )}
              <span className="w-28 shrink-0 text-right">
                {q ? (
                  <>
                    <span className="block text-sm font-semibold tabular-nums text-slate-900">{formatPrice(q.price, q)}</span>
                    <span className={cn("mt-0.5 inline-block rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums", returnPill(r))}>{formatQuoteReturn(q, r)}</span>
                  </>
                ) : failed.has(item.symbol) ? (
                  <span className="text-xs text-slate-500">Not available</span>
                ) : (
                  <span className="ml-auto block h-4 w-20 animate-pulse rounded bg-slate-100" aria-busy />
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Sectors best to worst over the period, each a bar left (down) or right (up) of zero. */
function SectorBars({
  quotes,
  failed,
  period,
  sort,
  onOpen,
}: {
  quotes: Record<string, Quote>;
  failed: Set<string>;
  period: Period;
  sort: QuoteSort;
  onOpen: (q: Quote) => void;
}) {
  const rows = sortItems(SECTORS, sort, period, (s) => quotes[s.symbol], (s) => s.name).map((s) => ({
    item: s,
    q: quotes[s.symbol],
    r: quotes[s.symbol]?.perf[period] ?? null,
  }));
  const max = Math.max(1, ...rows.map((row) => Math.abs(row.r ?? 0)));
  if (!rows.some((row) => row.q))
    return (
      <div className="grid gap-3" aria-busy>
        {SECTORS.slice(0, 8).map((s) => (
          <span key={s.symbol} className="h-6 animate-pulse rounded bg-slate-100" />
        ))}
      </div>
    );
  return (
    <ul className="-mx-2 grid gap-0.5">
      {rows.map(({ item, q, r }) => (
        <li key={item.symbol}>
          <button
            type="button"
            disabled={!q}
            onClick={() => q && onOpen(q)}
            // Phones: the name gets half the row, so "Public sector banks" fits whole; the bar takes the rest.
            className="grid w-full grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_3.5rem] items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-slate-100/70 active:bg-slate-100 disabled:hover:bg-transparent sm:grid-cols-[10rem_1fr_4.5rem] sm:gap-3"
          >
            <span className="truncate text-sm font-medium text-slate-900">{item.name}</span>
            <span className="relative h-5">
              <span className="absolute inset-y-0 left-1/2 w-px bg-slate-200" />
              {r !== null && (
                <span
                  className={cn("absolute inset-y-0.5 rounded-sm", r >= 0 ? "left-1/2 bg-emerald-500/80" : "right-1/2 bg-rose-500/80")}
                  style={{ width: `${(Math.abs(r) / max) * 50}%` }}
                />
              )}
            </span>
            <span className={cn("text-right text-sm font-semibold tabular-nums", returnTone(r))}>
              {q ? formatReturn(r) : failed.has(item.symbol) ? "n/a" : "…"}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function rateMove(by: number) {
  return `${by < 0 ? "Cut" : "Raised"} ${formatPoints(Math.abs(by)).replace("+", "")}`;
}

function Pending({ status, children }: { status: "loading" | "ready" | "error"; children: ReactNode }) {
  if (status === "error") return <p className="py-6 text-center text-sm text-slate-500">Economic data isn&apos;t available right now.</p>;
  if (status === "loading")
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-busy>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />
        ))}
      </div>
    );
  return <>{children}</>;
}

/** Each central bank's rate, its latest move, and five years of it. */
function PolicyRates({ economies, status, sort }: { economies: Economy[]; status: "loading" | "ready" | "error"; sort: RateSort }) {
  const banks = economies.filter((e) => e.policy);
  if (sort === "high") banks.sort((a, b) => b.policy!.rate - a.policy!.rate);
  else if (sort === "low") banks.sort((a, b) => a.policy!.rate - b.policy!.rate);
  else if (sort === "name") banks.sort((a, b) => a.name.localeCompare(b.name));
  // Latest move first; banks that haven't moved in five years go last.
  else if (sort === "recent") banks.sort((a, b) => (b.policy!.lastChange?.month ?? "").localeCompare(a.policy!.lastChange?.month ?? ""));
  return (
    <Pending status={status}>
      <ul className="-mx-2 divide-y divide-slate-100">
        {banks.map((e) => {
          const p = e.policy!;
          return (
            <li key={e.code} className="flex items-center gap-3 px-2 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-900">{e.name}</span>
                <span className="block truncate text-xs text-slate-500">{p.bank}</span>
              </span>
              <span className="max-[380px]:hidden" title="Last five years">
                <Sparkline values={p.history} color="#64748b" />
              </span>
              <span className="w-32 shrink-0 text-right">
                <span className="block text-sm font-semibold tabular-nums text-slate-900">{p.rate.toFixed(2)}%</span>
                <span className="block text-xs font-medium text-slate-600">{p.lastChange ? rateMove(p.lastChange.by) : "No change in 5 yrs"}</span>
                {p.lastChange && <span className="block text-[11px] text-slate-500">{formatMonth(p.lastChange.month)}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-slate-500">A cut makes loans cheaper (and FDs pay less); a rise does the opposite.</p>
    </Pending>
  );
}

/** The India tab's peek at sectors: the three leading and three lagging over the period, and a way to all of them. */
function SectorGlance({ quotes, period, onOpen, onAll }: { quotes: Record<string, Quote>; period: Period; onOpen: (q: Quote) => void; onAll: () => void }) {
  const ranked = SECTORS.flatMap((s) => {
    const q = quotes[s.symbol];
    const r = q?.perf[period] ?? null;
    return q && r !== null ? [{ s, q, r }] : [];
  }).sort((a, b) => b.r - a.r);
  const words = PERIODS.find((p) => p.value === period)!.words;
  const column = (title: string, rows: typeof ranked) => (
    <div className="min-w-0">
      <p className="mb-1 text-xs font-medium text-slate-500">{title}</p>
      <ul className="space-y-0.5">
        {rows.map(({ s, q, r }) => (
          <li key={s.symbol}>
            <button type="button" onClick={() => onOpen(q)} className="-mx-2 flex w-[calc(100%+1rem)] items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-100/70">
              <span className="min-w-0 truncate text-sm font-medium text-slate-900">{s.name}</span>
              <span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums", returnPill(r))}>{formatReturn(r)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <ChartCard
      title={`Sectors ${words}`}
      action={
        <Button variant="ghost" size="sm" className="rounded-full text-primary" onClick={onAll}>
          All sectors <ChevronRight />
        </Button>
      }
    >
      {ranked.length < 2 ? (
        <div className="grid grid-cols-2 gap-4" aria-busy>
          <span className="h-24 animate-pulse rounded-xl bg-slate-100" />
          <span className="h-24 animate-pulse rounded-xl bg-slate-100" />
        </div>
      ) : (
        // minmax(0, 1fr): a long sector name truncates instead of widening its column (and the page).
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-6">
          {column("Leading", ranked.slice(0, 3))}
          {column("Lagging", ranked.slice(-3).reverse())}
        </div>
      )}
    </ChartCard>
  );
}
