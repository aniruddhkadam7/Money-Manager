"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCrore, formatNumber, formatPct, formatRatio, formatShare } from "@/lib/market/format";
import type { Member } from "@/lib/market/types";
import { groupPe, type GroupPe } from "@/lib/market/weights";
import { cn } from "@/lib/utils";
import { tone } from "./tone";
import { useRatios } from "./use-market";

export interface CompanyView {
  company: Member;
  /** The companies it's compared with (it included): the rest of its sector. */
  peers: Member[];
  /** What the peers are, e.g. "IT" or "Financial Services in the Nifty 50". */
  peerLabel: string;
}

/** A company's important ratios, and a table of it beside the other companies in its sector. */
export function CompanySheet({ view, onClose }: { view: CompanyView | null; onClose: () => void }) {
  return (
    <Dialog open={!!view} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-4 sm:max-w-3xl sm:max-h-[90dvh] sm:overflow-y-auto [&>*]:min-w-0">{view && <Company key={view.company.symbol} {...view} />}</DialogContent>
    </Dialog>
  );
}

/** The middle value of the ones present; null if none. */
function median(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

const isLoss = (m: Member) => m.eps !== null && m.eps < 0;

/** A group's PE as shown: "Loss" when its companies lost money together, a dash without figures. */
export const peText = (g: GroupPe) => (g.pe === null ? (g.count ? "Loss" : "—") : formatRatio(g.pe));

function Company({ company: c, peers, peerLabel }: CompanyView) {
  const ratios = useRatios(c.symbol);
  const r = ratios.data;
  const pending = ratios.status === "loading" ? "…" : "—";
  const industry = groupPe(peers.filter((p) => p.industry === c.industry));
  const vsIndustry = c.pe !== null && industry.pe !== null ? (c.pe / industry.pe - 1) * 100 : null;
  const items: [string, string, string?][] = [
    ["Market value", formatCrore(c.marketCap)],
    ["PE", isLoss(c) ? "Loss" : formatRatio(c.pe), "Price ÷ last four quarters' earnings per share"],
    ["Industry PE", peText(industry), `${c.industry}: total market value ÷ total earnings of the ${industry.count} of ${industry.total} companies here with figures`],
    ["PE vs industry", vsIndustry === null ? "—" : `${formatPct(vsIndustry, 0)} ${vsIndustry >= 0 ? "above" : "below"}`],
    ["PB", formatRatio(c.pb), "Price ÷ book value per share"],
    ["Dividend yield", formatShare(c.dividendYield, 2), "Last 12 months' dividends ÷ price"],
    ["EPS (TTM)", c.eps == null ? "—" : `₹${formatNumber(c.eps)}`],
    ["ROE", r ? formatShare(r.roe) : pending, "Net profit ÷ shareholders' equity"],
    ["ROA", r ? formatShare(r.roa) : pending, "Net profit ÷ total assets"],
    ["Operating margin", r ? formatShare(r.operatingMargin) : pending],
    ["Net margin", r ? formatShare(r.profitMargin) : pending],
    ["Debt ÷ equity", r ? (r.debtToEquity == null ? "—" : `${r.debtToEquity.toFixed(2)}×`) : pending, "Less meaningful for banks and lenders, whose business is borrowing"],
    ["Current ratio", r ? (r.currentRatio == null ? "—" : `${r.currentRatio.toFixed(2)}×`) : pending, "Current assets ÷ current liabilities"],
    ["EV / EBITDA", r ? formatRatio(r.evToEbitda) : pending],
    ["Revenue growth", r ? formatPct(r.revenueGrowth, 1) : pending, "Latest quarter against the same quarter a year before"],
    ["Profit growth", r ? formatPct(r.earningsGrowth, 1) : pending, "Latest quarter against the same quarter a year before"],
    ["52-week high", c.yearHigh == null ? "—" : `₹${formatNumber(c.yearHigh)}`],
    ["52-week low", c.yearLow == null ? "—" : `₹${formatNumber(c.yearLow)}`],
    ["1-year change", formatPct(c.yearChangePct, 1)],
  ];

  return (
    <>
      <DialogHeader className="pr-8">
        <DialogTitle className="leading-snug">{c.name}</DialogTitle>
        <DialogDescription>
          {c.symbol.replace(/\.NS$/, "")} · NSE · {c.industry}
        </DialogDescription>
        <div className="flex flex-wrap items-baseline gap-x-3">
          <p className="text-3xl font-semibold tracking-tight tabular-nums text-slate-900">{c.price == null ? "—" : `₹${formatNumber(c.price)}`}</p>
          <p className={cn("text-sm font-semibold tabular-nums", tone(c.changePct))}>{formatPct(c.changePct)} today</p>
        </div>
      </DialogHeader>

      <section>
        <h3 className="mb-1.5 text-sm font-semibold text-slate-900">Important ratios</h3>
        <dl className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
          {items.map(([label, value, title]) => (
            <div key={label} title={title} className="flex items-baseline justify-between gap-2 border-b border-slate-100 py-1.5">
              <dt className="text-xs text-slate-500">{label}</dt>
              <dd className="text-right text-sm font-medium tabular-nums text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>
        {ratios.status === "error" && <p className="mt-2 text-xs text-slate-500">ROE, margins, debt and growth couldn&apos;t be loaded from Yahoo just now.</p>}
      </section>

      <Comparison company={c} peers={peers} label={peerLabel} />

      <p className="text-[11px] leading-relaxed text-slate-500">
        Yahoo Finance, about 15 minutes behind NSE; ratios use the last twelve months. Industry PE is worked out here across the {c.industry} companies in {peerLabel}, the way an index&apos;s is: their total market value ÷ their total earnings (losses count against), not an average of their PEs. A lower PE than the industry isn&apos;t automatically cheap: growth, debt and profit quality differ between companies.
      </p>
    </>
  );
}

type Col = "name" | "price" | "changePct" | "marketCap" | "pe" | "pb" | "dividendYield" | "yearChangePct";
const COLS: { key: Col; label: string; numeric: boolean }[] = [
  { key: "name", label: "Company", numeric: false },
  { key: "price", label: "Price", numeric: true },
  { key: "changePct", label: "Today", numeric: true },
  { key: "marketCap", label: "Mkt cap", numeric: true },
  { key: "pe", label: "PE", numeric: true },
  { key: "pb", label: "PB", numeric: true },
  { key: "dividendYield", label: "Div. yield", numeric: true },
  { key: "yearChangePct", label: "1 year", numeric: true },
];

function cell(m: Member, key: Col) {
  switch (key) {
    case "price":
      return formatNumber(m.price);
    case "changePct":
      return <span className={tone(m.changePct)}>{formatPct(m.changePct)}</span>;
    case "marketCap":
      return formatCrore(m.marketCap);
    case "pe":
      return isLoss(m) ? "Loss" : formatRatio(m.pe);
    case "pb":
      return formatRatio(m.pb);
    case "dividendYield":
      return formatShare(m.dividendYield, 2);
    case "yearChangePct":
      return <span className={tone(m.yearChangePct)}>{formatPct(m.yearChangePct, 1)}</span>;
    default:
      return m.name;
  }
}

/** The company beside its peers; tap a heading to sort by it. The median row is the middle company on each figure. */
function Comparison({ company, peers, label }: { company: Member; peers: Member[]; label: string }) {
  const [sort, setSort] = useState<{ key: Col; desc: boolean }>({ key: "marketCap", desc: true });
  const rows = useMemo(() => {
    const value = (m: Member) => (sort.key === "name" ? m.name : m[sort.key]);
    return [...peers].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
      const d = typeof va === "string" ? va.localeCompare(vb as string) : va - (vb as number);
      return sort.desc ? -d : d;
    });
  }, [peers, sort]);
  const med = (key: Exclude<Col, "name">) => median(peers.map((p) => p[key]));

  return (
    <section>
      <h3 className="mb-1.5 text-sm font-semibold text-slate-900">Compared with {label}</h3>
      {/* Phones: the table scrolls sideways inside its box, the company column stays put. */}
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[38rem] text-sm tabular-nums">
          <thead>
            <tr className="border-b border-slate-200 text-[11px] text-slate-500">
              {COLS.map((col) => (
                <th key={col.key} className={cn("py-1.5 font-medium", col.numeric ? "px-2 text-right" : "sticky left-0 z-10 bg-[var(--glass-solid)] pr-2 text-left")}>
                  <button
                    type="button"
                    onClick={() => setSort((s) => ({ key: col.key, desc: s.key === col.key ? !s.desc : col.numeric }))}
                    className={cn("inline-flex items-center gap-0.5", sort.key === col.key && "font-semibold text-slate-900")}
                  >
                    {col.label}
                    {sort.key === col.key && (sort.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((m) => {
              const me = m.symbol === company.symbol;
              return (
                <tr key={m.symbol} className={cn(me && "bg-primary/5 font-semibold")}>
                  {COLS.map((col) => (
                    <td key={col.key} className={cn("py-1.5", col.numeric ? "px-2 text-right" : cn("sticky left-0 max-w-[10rem] truncate pr-2", me ? "bg-[color-mix(in_oklab,var(--glass-solid),var(--primary)_5%)]" : "bg-[var(--glass-solid)]"))}>
                      {cell(m, col.key)}
                    </td>
                  ))}
                </tr>
              );
            })}
            <tr className="border-t-2 border-slate-200 text-slate-600">
              <td className="sticky left-0 bg-[var(--glass-solid)] py-1.5 pr-2 text-xs font-medium">Median</td>
              <td className="px-2 text-right">—</td>
              <td className={cn("px-2 text-right", tone(med("changePct")))}>{formatPct(med("changePct"))}</td>
              <td className="px-2 text-right">{formatCrore(med("marketCap"))}</td>
              <td className="px-2 text-right">{formatRatio(med("pe"))}</td>
              <td className="px-2 text-right">{formatRatio(med("pb"))}</td>
              <td className="px-2 text-right">{formatShare(med("dividendYield"), 2)}</td>
              <td className={cn("px-2 text-right", tone(med("yearChangePct")))}>{formatPct(med("yearChangePct"), 1)}</td>
            </tr>
            <tr className="text-slate-600">
              <td className="sticky left-0 bg-[var(--glass-solid)] py-1.5 pr-2 text-xs font-medium">Group PE</td>
              <td colSpan={3} />
              <td className="px-2 text-right font-semibold text-slate-900">{peText(groupPe(peers))}</td>
              <td colSpan={3} />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-[11px] text-slate-500">Tap a heading to sort. Loss-makers have no PE and are left out of its median. Group PE: everyone in the table together, total market value ÷ total earnings.</p>
    </section>
  );
}
