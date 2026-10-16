"use client";

import { useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatCrore, formatNumber, formatPct, formatRatio } from "@/lib/market/format";
import type { IndexQuote, Member } from "@/lib/market/types";
import { groupPe } from "@/lib/market/weights";
import { cn } from "@/lib/utils";
import { RangeTabs } from "../charts/primitives";
import { peText, type CompanyView } from "./company-sheet";
import { tone } from "./tone";
import { useMembers } from "./use-market";

type Order = "size" | "best" | "worst";
const ORDERS: { value: Order; label: string }[] = [
  { value: "size", label: "Largest" },
  { value: "best", label: "Gainers" },
  { value: "worst", label: "Losers" },
];

/** A sector's companies today; a company opens its ratios and its comparison with the rest. */
export function SectorSheet({ sector, onClose, onCompany }: { sector: IndexQuote | null; onClose: () => void; onCompany: (v: CompanyView) => void }) {
  return (
    <Dialog open={!!sector} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl sm:max-h-[88dvh] sm:overflow-y-auto [&>*]:min-w-0">{sector && <Sector key={sector.symbol} sector={sector} onCompany={onCompany} />}</DialogContent>
    </Dialog>
  );
}

function Sector({ sector, onCompany }: { sector: IndexQuote; onCompany: (v: CompanyView) => void }) {
  const [order, setOrder] = useState<Order>("size");
  const { data, status, retry } = useMembers(sector.symbol);
  const members = useMemo(() => data?.members ?? [], [data]);
  const up = members.filter((m) => (m.changePct ?? 0) > 0).length;
  const down = members.filter((m) => (m.changePct ?? 0) < 0).length;
  const sorted = useMemo(() => {
    const key = (m: Member) => (order === "size" ? m.marketCap : order === "best" ? m.changePct : m.changePct === null ? null : -m.changePct);
    return [...members].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      return ka === null || kb === null ? (ka === kb ? 0 : ka === null ? 1 : -1) : kb - ka;
    });
  }, [members, order]);

  return (
    <>
      <DialogHeader className="pr-8">
        <DialogTitle>{sector.name}</DialogTitle>
        <DialogDescription>
          {members.length ? `${members.length} companies in the Nifty index · ${up} up, ${down} down today` : "The companies in this Nifty index"}
        </DialogDescription>
        <div className="flex flex-wrap items-baseline gap-x-3">
          <p className="text-2xl font-semibold tabular-nums text-slate-900">{formatNumber(sector.price)}</p>
          <p className={cn("text-sm font-semibold tabular-nums", tone(sector.changePct))}>
            {formatPct(sector.changePct)} today · {formatPct(sector.yearChangePct, 1)} in a year
          </p>
          {members.length > 0 && (
            <p className="text-sm text-slate-600" title="The companies' total market value ÷ their total earnings over the last four quarters">
              Sector PE <span className="font-semibold tabular-nums text-slate-900">{peText(groupPe(members))}</span>
            </p>
          )}
        </div>
      </DialogHeader>
      <RangeTabs label="Order" value={order} options={ORDERS} onChange={setOrder} />

      {status === "error" && !data ? (
        <div className="py-8 text-center text-sm text-slate-500">
          Couldn&apos;t load this sector&apos;s companies.{" "}
          <button type="button" onClick={retry} className="font-medium text-primary">
            Try again
          </button>
        </div>
      ) : !data ? (
        <div className="grid gap-2" aria-busy>
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className="h-12 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : (
        <ul className="-mx-2 divide-y divide-slate-100">
          {sorted.map((m) => (
            <li key={m.symbol}>
              <button
                type="button"
                onClick={() => onCompany({ company: m, peers: members, peerLabel: `the ${sector.name} sector` })}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-slate-100/70 active:bg-slate-100"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900">{m.name}</span>
                  <span className="block truncate text-[11px] tabular-nums text-slate-500">
                    {formatCrore(m.marketCap)} · PE {m.eps !== null && m.eps < 0 ? "loss" : formatRatio(m.pe)}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-semibold tabular-nums text-slate-900">{m.price == null ? "—" : `₹${formatNumber(m.price)}`}</span>
                  <span className={cn("text-xs font-semibold tabular-nums", tone(m.changePct))}>{formatPct(m.changePct)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-slate-500">Companies from NSE&apos;s list for the index; prices and figures from Yahoo, about 15 minutes behind. Sector PE is worked out here: the companies&apos; total market value ÷ their total earnings (losses count against).</p>
    </>
  );
}
