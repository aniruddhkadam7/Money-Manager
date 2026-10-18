"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WEIGHTED } from "@/lib/market/catalog";
import { formatChange, formatNumber, formatPct } from "@/lib/market/format";
import type { IndexQuote, Member } from "@/lib/market/types";
import { sectorWeights } from "@/lib/market/weights";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { peText, type CompanyView } from "./company-sheet";
import { tone } from "./tone";
import { useMembers } from "./use-market";

/**
 * One index opened: where it stands today, the sectors it's made of by weight with each one's move today, and a
 * sector opens to its stocks with their prices.
 */
export function WeightageSheet({ symbol, quote, onClose, onCompany }: { symbol: string | null; quote?: IndexQuote; onClose: () => void; onCompany: (v: CompanyView) => void }) {
  return (
    <Dialog open={!!symbol} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl sm:max-h-[88dvh] sm:overflow-y-auto [&>*]:min-w-0">{symbol && <Weightage key={symbol} symbol={symbol} quote={quote} onCompany={onCompany} />}</DialogContent>
    </Dialog>
  );
}

type Sort = "weight" | "gainers" | "losers";
const SORTS: { value: Sort; label: string }[] = [
  { value: "weight", label: "By weight" },
  { value: "gainers", label: "Gainers" },
  { value: "losers", label: "Losers" },
];
type Show = "all" | "up" | "down";
const SHOWS: { value: Show; label: string }[] = [
  { value: "all", label: "All" },
  { value: "up", label: "Up" },
  { value: "down", label: "Down" },
];

/** Biggest first, or best / worst today first (no figure last either way). */
function byRank<T>(sort: Sort, weight: (x: T) => number, change: (x: T) => number | null) {
  return (a: T, b: T) => {
    if (sort === "weight") return weight(b) - weight(a);
    const ca = change(a);
    const cb = change(b);
    if (ca === null || cb === null) return ca === null ? (cb === null ? 0 : 1) : -1;
    return sort === "gainers" ? cb - ca : ca - cb;
  };
}

function Weightage({ symbol, quote: q, onCompany }: { symbol: string; quote?: IndexQuote; onCompany: (v: CompanyView) => void }) {
  const [openIndustry, setOpenIndustry] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("weight");
  const [show, setShow] = useState<Show>("all");
  const [query, setQuery] = useState("");
  const { data, status, retry } = useMembers(symbol);
  const index = WEIGHTED.find((i) => i.symbol === symbol)!;
  const { sectors: all, counted } = useMemo(() => sectorWeights(data?.symbol === symbol ? data.members : []), [data, symbol]);

  // The filters pick stocks; a sector stays while it has any, and keeps its whole-sector weight and move.
  const q2 = query.trim().toLowerCase();
  const filtering = show !== "all" || q2 !== "";
  const sectors = useMemo(
    () =>
      all
        .map((s) => ({
          ...s,
          companies: s.companies
            .filter(({ member: m }) => (show === "up" ? (m.changePct ?? 0) > 0 : show === "down" ? (m.changePct ?? 0) < 0 : true))
            .filter(({ member: m }) => !q2 || m.name.toLowerCase().includes(q2) || m.symbol.toLowerCase().includes(q2) || s.industry.toLowerCase().includes(q2))
            .sort(byRank(sort, (c) => c.weight, (c) => c.member.changePct)),
        }))
        .filter((s) => s.companies.length > 0)
        .sort(byRank(sort, (s) => s.weight, (s) => s.changePct)),
    [all, show, q2, sort],
  );

  const open = (m: Member, industry: string, peers: Member[]) => onCompany({ company: m, peers, peerLabel: `${industry} in the ${index.name}` });

  return (
    <>
      <DialogHeader className="pr-8">
        <DialogTitle>{index.name}</DialogTitle>
        <DialogDescription>Its sectors by weight, with today&apos;s move. Tap a sector for its stocks.</DialogDescription>
      </DialogHeader>
      {q && (
        <div className="flex items-baseline justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
          <span className="text-2xl font-semibold tabular-nums text-slate-900">{formatNumber(q.price)}</span>
          <span className={cn("text-sm font-semibold tabular-nums", tone(q.changePct))}>
            {formatChange(q.change)} ({formatPct(q.changePct)})
          </span>
        </div>
      )}
      {/* One row: search, then the sort and the up/down filter as small dropdowns. */}
      <div className="flex items-center gap-1.5">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find stock"
            aria-label="Find a stock or sector"
            className="h-9 w-full rounded-lg border border-input bg-card pl-8 pr-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
          />
        </label>
        <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
          <SelectTrigger aria-label="Sort by" className="h-9 w-auto shrink-0 gap-1 px-2.5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {SORTS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={show} onValueChange={(v) => setShow(v as Show)}>
          <SelectTrigger aria-label="Show" className={cn("h-9 w-auto shrink-0 gap-1 px-2.5", show !== "all" && "border-primary/50 text-primary")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {SHOWS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="-mb-2 flex justify-between px-0 text-[11px] font-medium text-slate-500">
        <span>Sector</span>
        <span>Weight · today</span>
      </div>

      {status === "error" && !data ? (
        <div className="py-8 text-center text-sm text-slate-500">
          Couldn&apos;t load the {index.name}&apos;s companies.{" "}
          <button type="button" onClick={retry} className="font-medium text-primary">
            Try again
          </button>
        </div>
      ) : all.length && !sectors.length ? (
        <p className="py-8 text-center text-sm text-slate-500">No stocks match. Try another filter.</p>
      ) : !sectors.length ? (
        <div className="grid gap-2" aria-busy>
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className="h-11 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : (
        <ul className="-mx-2 divide-y divide-slate-100">
          {sectors.map((s) => {
            // While filtering, every sector left is open, so the matching stocks show straight away.
            const expanded = filtering || openIndustry === s.industry;
            const peers = s.companies.map((c) => c.member);
            return (
              <li key={s.industry}>
                <button type="button" aria-expanded={expanded} onClick={() => setOpenIndustry(expanded ? null : s.industry)} className="w-full rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-slate-100/70 active:bg-slate-100">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-1">
                      <ChevronDown className={cn("size-4 shrink-0 text-slate-400 transition-transform", expanded && "rotate-180")} />
                      <span className="truncate text-sm font-medium text-slate-900">{s.industry}</span>
                      <span className="shrink-0 text-[11px] tabular-nums text-slate-500">
                        {s.companies.length} · PE {peText(s.pe)}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">{s.weight.toFixed(1)}%</span>
                  </span>
                  <span className="mt-1.5 flex items-center gap-2 pl-5">
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <span className="block h-full rounded-full bg-primary/70" style={{ width: `${(s.weight / all[0].weight) * 100}%` }} />
                    </span>
                    <span className={cn("w-14 shrink-0 text-right text-xs tabular-nums", tone(s.changePct))}>{formatPct(s.changePct)}</span>
                  </span>
                </button>
                {expanded && (
                  <ul className="mb-2 ml-7 mr-2 divide-y divide-slate-100 rounded-xl bg-slate-50 px-2">
                    <li className="flex justify-between gap-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                      <span>Stock · weight</span>
                      <span>Price · today</span>
                    </li>
                    {s.companies.map(({ member: m, weight }) => (
                      <li key={m.symbol}>
                        <button type="button" onClick={() => open(m, s.industry, peers)} className="flex w-full items-center justify-between gap-3 py-2 text-left">
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-slate-800">{m.name}</span>
                            <span className="block text-[11px] tabular-nums text-slate-500">{weight.toFixed(1)}% of the index</span>
                          </span>
                          <span className="shrink-0 text-right tabular-nums">
                            <span className="block text-sm font-medium text-slate-900">{m.price ? `₹${formatNumber(m.price)}` : "—"}</span>
                            <span className={cn("block text-xs", tone(m.changePct))}>{formatPct(m.changePct)}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-[11px] leading-relaxed text-slate-500">
        Companies from NSE&apos;s list for the index, grouped by NSE&apos;s industry. Weight = a company&apos;s market value ÷ the total of {counted ? `the ${counted} companies` : "the companies"} with one (Yahoo, about 15 minutes behind). NSE weights by freely traded shares and caps the largest, so its official weights differ somewhat, most for companies whose promoters hold a lot. The figure beside each bar is the sector&apos;s size-weighted move today; PE is the sector&apos;s within the index, total market value ÷ total earnings.
      </p>
    </>
  );
}
