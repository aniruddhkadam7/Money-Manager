"use client";

import { useState } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { indicators, ordinal, reservesVerdict, tally, type Indicator, type Verdict } from "@/lib/market/health";
import type { Economy } from "@/lib/market/types";
import { cn } from "@/lib/utils";
import { ChartCard } from "../charts/primitives";
import { SortSelect, type SortOption } from "./sort";
import { YearBars } from "./year-bars";

export const VERDICT: Record<Verdict, { label: string; dot: string; chip: string; bar: string }> = {
  good: { label: "Healthy", dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700", bar: "bg-emerald-500" },
  watch: { label: "Watch", dot: "bg-amber-500", chip: "bg-amber-50 text-amber-700", bar: "bg-amber-400" },
  weak: { label: "Weak", dot: "bg-rose-500", chip: "bg-rose-50 text-rose-700", bar: "bg-rose-500" },
};

type Status = "loading" | "ready" | "error";

function VerdictChip({ verdict }: { verdict: Verdict | null }) {
  if (!verdict) return <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">Not judged</span>;
  const v = VERDICT[verdict];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold", v.chip)}>
      <span className={cn("size-1.5 rounded-full", v.dot)} />
      {v.label}
    </span>
  );
}

const TREND = {
  better: { icon: ArrowUpRight, tone: "text-emerald-700", word: "better than" },
  worse: { icon: ArrowDownRight, tone: "text-rose-700", word: "worse than" },
  same: { icon: ArrowRight, tone: "text-slate-500", word: "about the same as" },
};

/** One figure: the latest actual year big, its verdict, the chart of the years, and the rule it's judged by. */
function IndicatorCard({ item, world }: { item: Indicator; world?: Indicator }) {
  const latestIndex = item.latest ? item.series.indexOf(item.latest) : item.series.length - 1;
  const [picked, setPicked] = useState(latestIndex);
  const shown = item.series[picked] ?? item.latest;
  const isLatest = shown === item.latest;
  const trend = isLatest && item.trend && item.previous ? TREND[item.trend] : null;
  const worldSame = world?.series.find((w) => w.year === shown?.year);

  return (
    <div className="rounded-2xl border glass p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-medium text-slate-700">{item.label}</p>
        <VerdictChip verdict={item.verdict} />
      </div>
      {shown && (
        <div className="mt-1 flex items-baseline gap-2">
          <span className={cn("text-2xl font-semibold tabular-nums", shown.forecast ? "text-slate-500" : "text-slate-900")}>{item.format(shown.value)}</span>
          <span className="text-xs text-slate-500">{shown.forecast ? `IMF forecast for ${shown.year}` : `in ${shown.year}`}</span>
        </div>
      )}
      <p className="mt-0.5 min-h-4 text-[11px] text-slate-500">
        {trend ? (
          <span className={cn("inline-flex items-center gap-0.5 font-medium", trend.tone)}>
            <trend.icon className="size-3" />
            {item.target !== undefined && item.trend !== "same"
              ? `${item.trend === "better" ? "closer to" : "further from"} the ${item.target}% target than`
              : trend.word}{" "}
            {item.previous!.year} ({item.format(item.previous!.value)})
          </span>
        ) : !isLatest && item.latest ? (
          <button type="button" className="font-medium text-primary" onClick={() => setPicked(latestIndex)}>
            Back to {item.latest.year}
          </button>
        ) : null}
      </p>
      <div className="mt-2">
        <YearBars series={item.series} world={world?.series} zones={item.zones} format={item.format} picked={picked} onPick={setPicked} greyFrom={item.repeatedFrom} />
      </div>
      <p className="mt-2 text-[11px] leading-snug text-slate-500">
        {item.rule}
        {worldSame && ` · World ${worldSame.year}: ${world!.format(worldSame.value)}`}
      </p>
      {item.caveat && <p className="mt-1 text-[11px] leading-snug text-amber-700">{item.caveat}</p>}
    </div>
  );
}

/** A single-number fact (reserves, size): no years to chart. */
function FactCard({ label, value, sub, verdict, rule }: { label: string; value: string; sub: string; verdict?: Verdict | null; rule: string }) {
  return (
    <div className="rounded-2xl border glass p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-medium text-slate-700">{label}</p>
        {verdict !== undefined && <VerdictChip verdict={verdict} />}
      </div>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      <p className="text-xs text-slate-500">{sub}</p>
      <p className="mt-2 text-[11px] leading-snug text-slate-500">{rule}</p>
    </div>
  );
}

/** How to read the charts, said once. */
function Legend() {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2 rounded-sm bg-emerald-500" /> Actual
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2 rounded-sm border border-dashed border-emerald-500 bg-emerald-500/30" /> IMF estimate / forecast
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-3 bg-emerald-500/15 ring-1 ring-emerald-500/40 ring-inset" /> Healthy range
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-0.5 w-3 bg-slate-500" /> World
      </span>
    </p>
  );
}

/**
 * One economy's picture: a one-line count of verdicts (for the latest actual year), then a card per
 * figure. With `world`, each chart carries the world's line to compare.
 */
export function EconomySection({ title, economy, world, status }: { title: string; economy?: Economy; world?: Economy; status: Status }) {
  if (status === "error" && !economy) return <p className="py-6 text-center text-sm text-slate-500">Economic data isn&apos;t available right now.</p>;
  if (!economy)
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className="h-56 animate-pulse rounded-2xl bg-slate-100" />
        ))}
      </div>
    );
  const items = indicators(economy);
  const worldItems = world ? indicators(world) : [];
  const { counts, year } = tally(economy, items);
  const total = counts.good + counts.watch + counts.weak;
  const unjudged = items.filter((i) => i.caveat).map((i) => i.label.toLowerCase());
  const size = economy.gdpSize.filter((v) => !v.forecast).at(-1);
  const reserves = reservesVerdict(economy);

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {total > 0 && (
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {year && <span className="text-slate-500">In {year}:</span>}
              {(["good", "watch", "weak"] as Verdict[]).map((v) => (
                <span key={v} className="flex items-center gap-1.5">
                  <span className={cn("size-2 rounded-full", VERDICT[v].dot)} />
                  <span className="font-semibold tabular-nums text-slate-900">{counts[v]}</span>
                  <span className="text-slate-500">{v === "good" ? "healthy" : v === "watch" ? "to watch" : "weak"}</span>
                </span>
              ))}
            </p>
          )}
          {unjudged.length > 0 && <p className="mt-0.5 text-[11px] text-slate-500">Not judged: {unjudged.join(", ")} (no fresh figure).</p>}
        </div>
        <Legend />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <IndicatorCard key={item.key} item={item} world={item.key === "income" && economy.code !== "WEOWORLD" ? undefined : worldItems.find((w) => w.key === item.key)} />
        ))}
        {economy.reserves && (
          <FactCard
            label="Foreign-exchange reserves"
            value={`${economy.reserves.months.toFixed(1)} months`}
            sub={`of imports covered, ${economy.reserves.year} (World Bank)`}
            verdict={reserves}
            rule={reserves ? "Healthy: 6+ months; 3 months is the usual minimum" : "Matters less for economies whose currency others hold as reserves"}
          />
        )}
        {size && (
          <FactCard
            label="Size of the economy"
            value={size.value >= 1000 ? `$${(size.value / 1000).toFixed(2)} trillion` : `$${Math.round(size.value)} billion`}
            sub={`GDP in ${size.year}${economy.sizeRank ? ` · the world's ${ordinal(economy.sizeRank)} largest` : ""}`}
            rule="For context: not judged"
          />
        )}
      </div>
    </section>
  );
}

export type ScoreSort = "listed" | "health" | "growth" | "inflation" | "debt" | "name";
export const SCORE_SORTS: SortOption<ScoreSort>[] = [
  { value: "listed", label: "Usual order" },
  { value: "health", label: "Healthiest first" },
  { value: "growth", label: "Fastest growth" },
  { value: "inflation", label: "Lowest inflation" },
  { value: "debt", label: "Lowest debt" },
  { value: "name", label: "Name A–Z" },
];

const COLUMNS: { key: string; label: string }[] = [
  { key: "growth", label: "Growth" },
  { key: "inflation", label: "Inflation" },
  { key: "jobs", label: "Jobless" },
  { key: "deficit", label: "Budget" },
  { key: "debt", label: "Debt" },
];
const SCORE: Record<Verdict, number> = { good: 2, watch: 1, weak: 0 };

/**
 * Economies side by side on their latest actual figures, each coloured by its verdict. "Healthiest
 * first" orders them by their verdicts added up.
 */
export function ScoreTable({ economies, status, sort, onSort }: { economies: Economy[]; status: Status; sort: ScoreSort; onSort: (s: ScoreSort) => void }) {
  const rows = economies.map((e) => {
    const items = indicators(e);
    const by = Object.fromEntries(items.map((i) => [i.key, i]));
    const judged = items.filter((i) => i.verdict);
    const health = judged.length ? judged.reduce((t, i) => t + SCORE[i.verdict!], 0) / judged.length : -1;
    return { e, by, health };
  });
  const year = Math.max(0, ...rows.flatMap((r) => Object.values(r.by).map((i) => i.latest?.year ?? 0)));
  const val = (r: (typeof rows)[number], key: string) => (r.by[key] as Indicator | undefined)?.latest?.value;
  const sorted =
    sort === "listed"
      ? rows
      : [...rows].sort((a, b) => {
          if (sort === "name") return a.e.name.localeCompare(b.e.name);
          if (sort === "health") return b.health - a.health;
          const [x, y] = [val(a, sort), val(b, sort)];
          if (x === undefined || y === undefined) return x === undefined ? 1 : -1;
          return sort === "growth" ? y - x : x - y;
        });

  return (
    <ChartCard title="Economies compared" className="lg:col-span-2" action={<SortSelect label="Sort economies" value={sort} options={SCORE_SORTS} onChange={onSort} />}>
      {status === "loading" && !economies.length ? (
        <span className="block h-48 animate-pulse rounded-xl bg-slate-100" aria-busy />
      ) : (
        <>
          <div data-swipe-ignore className="-mx-1 overflow-x-auto">
            <table className="w-full min-w-[30rem] text-[13px] sm:text-sm">
              <thead>
                <tr className="text-left text-[11px] font-medium text-slate-500">
                  <th className="px-1 pb-2 font-medium">{year ? `${year}, actual` : "Latest"}</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className="px-1 pb-2 text-right font-medium">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sorted.map(({ e, by }) => (
                  <tr key={e.code} className={cn(e.code === "IND" && "bg-slate-50")}>
                    <td className={cn("px-1 py-2 text-slate-900", e.code === "IND" && "font-semibold")}>{e.name}</td>
                    {COLUMNS.map((c) => {
                      const item = by[c.key] as Indicator | undefined;
                      const v = item?.verdict ? VERDICT[item.verdict] : null;
                      return (
                        <td key={c.key} className="px-1 py-2 text-right tabular-nums">
                          {item?.latest ? (
                            <span
                              className={cn("inline-block rounded-md px-1.5 py-0.5 font-medium", v ? v.chip : "text-slate-400")}
                              title={item.caveat ?? `${item.latest.year}`}
                            >
                              {item.format(item.latest.value)}
                              {item.latest.year !== year && <sup className="ml-0.5 text-[9px]">{String(item.latest.year).slice(2)}</sup>}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            {(["good", "watch", "weak"] as Verdict[]).map((v) => (
              <span key={v} className="flex items-center gap-1.5">
                <span className={cn("size-2 rounded-full", VERDICT[v].dot)} /> {VERDICT[v].label}
              </span>
            ))}
            <span>Grey: not judged (no fresh figure). Budget and debt are shares of GDP.</span>
          </p>
        </>
      )}
    </ChartCard>
  );
}
