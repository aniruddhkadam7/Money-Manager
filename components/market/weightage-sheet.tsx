"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { INDICES } from "@/lib/market/catalog";
import { formatPct } from "@/lib/market/format";
import type { Member } from "@/lib/market/types";
import { sectorWeights } from "@/lib/market/weights";
import { cn } from "@/lib/utils";
import { RangeTabs } from "../charts/primitives";
import { peText, type CompanyView } from "./company-sheet";
import { tone } from "./tone";
import { useMembers } from "./use-market";

/** Which sectors make up each index, and how much of it; a sector opens to its companies' shares. */
export function WeightageSheet({ open, start, onClose, onCompany }: { open: boolean; start: string; onClose: () => void; onCompany: (v: CompanyView) => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl sm:max-h-[88dvh] sm:overflow-y-auto [&>*]:min-w-0">{open && <Weightage start={start} onCompany={onCompany} />}</DialogContent>
    </Dialog>
  );
}

function Weightage({ start, onCompany }: { start: string; onCompany: (v: CompanyView) => void }) {
  const [symbol, setSymbol] = useState(start);
  const [openIndustry, setOpenIndustry] = useState<string | null>(null);
  const { data, status, retry } = useMembers(symbol);
  const index = INDICES.find((i) => i.symbol === symbol)!;
  const { sectors, counted } = useMemo(() => sectorWeights(data?.symbol === symbol ? data.members : []), [data, symbol]);

  const open = (m: Member, industry: string, peers: Member[]) => onCompany({ company: m, peers, peerLabel: `${industry} in the ${index.name}` });

  return (
    <>
      <DialogHeader className="pr-8">
        <DialogTitle>Sector weightage</DialogTitle>
        <DialogDescription>How much of the index each sector makes up. Tap a sector for its companies.</DialogDescription>
      </DialogHeader>
      <div className="max-sm:[&>[role=tablist]]:flex max-sm:[&_button]:flex-1">
        <RangeTabs label="Index" value={symbol} options={INDICES.map((i) => ({ value: i.symbol, label: i.name }))} onChange={(v) => (setSymbol(v), setOpenIndustry(null))} />
      </div>

      {status === "error" && !data ? (
        <div className="py-8 text-center text-sm text-slate-500">
          Couldn&apos;t load the {index.name}&apos;s companies.{" "}
          <button type="button" onClick={retry} className="font-medium text-primary">
            Try again
          </button>
        </div>
      ) : !sectors.length ? (
        <div className="grid gap-2" aria-busy>
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className="h-11 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : (
        <ul className="-mx-2 divide-y divide-slate-100">
          {sectors.map((s) => {
            const expanded = openIndustry === s.industry;
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
                      <span className="block h-full rounded-full bg-primary/70" style={{ width: `${(s.weight / sectors[0].weight) * 100}%` }} />
                    </span>
                    <span className={cn("w-14 shrink-0 text-right text-xs tabular-nums", tone(s.changePct))}>{formatPct(s.changePct)}</span>
                  </span>
                </button>
                {expanded && (
                  <ul className="mb-2 ml-7 mr-2 divide-y divide-slate-100 rounded-xl bg-slate-50 px-2">
                    {s.companies.map(({ member: m, weight }) => (
                      <li key={m.symbol}>
                        <button type="button" onClick={() => open(m, s.industry, peers)} className="flex w-full items-center justify-between gap-3 py-2 text-left">
                          <span className="min-w-0 truncate text-sm text-slate-800">{m.name}</span>
                          <span className="flex shrink-0 items-baseline gap-3 tabular-nums">
                            <span className={cn("text-xs", tone(m.changePct))}>{formatPct(m.changePct)}</span>
                            <span className="w-12 text-right text-sm font-medium text-slate-900">{weight.toFixed(1)}%</span>
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
