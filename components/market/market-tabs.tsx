"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, LineChart } from "lucide-react";
import { formatTime } from "@/lib/market/format";
import { cn } from "@/lib/utils";
import { PageTitle } from "../page-title";

const PAGES = [
  { href: "/market", label: "Indices", icon: LineChart },
  { href: "/market/sectors", label: "Sectors", icon: BarChart3 },
];

/** Market's two pages, side by side at the top: the indices table and sector performance. */
export function MarketTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Market pages" className="grid grid-cols-2 rounded-full bg-slate-100 p-1 sm:inline-grid sm:w-72">
      {PAGES.map(({ href, label, icon: Icon }) => {
        const on = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={on ? "page" : undefined}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-full py-2 text-sm font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "bg-card text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800",
            )}
          >
            <Icon className={cn("size-4", on ? "text-emerald-700" : "text-slate-400")} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** The top of both Market pages: the title (wider screens), the page switch, and a warning only when prices are old. */
export function MarketHeader({ stale }: { stale?: boolean }) {
  return (
    <div className="grid gap-2">
      <PageTitle>Market</PageTitle>
      <MarketTabs />
      {stale && <p className="text-xs font-medium text-amber-700">Couldn&apos;t refresh, showing older prices.</p>}
    </div>
  );
}

/** Where the prices come from and how old they are: a small note at the foot of the page, out of the way. */
export function MarketSource({ delayMinutes, latest }: { delayMinutes?: number | null; latest: number }) {
  return (
    <p className="text-center text-[11px] text-slate-500">
      Yahoo Finance, {delayMinutes ?? 15} min behind NSE &amp; BSE{latest ? ` · prices to ${formatTime(latest)}` : ""}
    </p>
  );
}
