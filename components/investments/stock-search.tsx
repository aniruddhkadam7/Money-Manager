"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { indianShares, type IndianShare } from "@/lib/market/indian-shares";
import { cn } from "@/lib/utils";
import { useSearch } from "../market/use-market";

/**
 * The "Which stock?" box: type a few letters of a company or its symbol and pick from NSE / BSE matches
 * (holdings you already have come first). Anything typed can still be saved as it is.
 */
export function StockSearch({
  id,
  value,
  onChange,
  onPick,
  holdings,
  invalid,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** A listed share was picked (after `onChange` with its symbol). */
  onPick?: (share: IndianShare) => void;
  /** Names already held, offered first. */
  holdings: string[];
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { hits, searching, error } = useSearch(open ? value : "");
  const q = value.trim().toLowerCase();
  // Matches stay listed even when typed out in full: the company name and exchange confirm it's the right one.
  const mine = q ? holdings.filter((n) => n.toLowerCase().includes(q)) : [];
  const shares = indianShares(hits).filter((s) => !holdings.some((n) => n.toLowerCase() === s.symbol.toLowerCase()));
  const show = open && q.length >= 2 && (mine.length > 0 || shares.length > 0 || searching || error);

  const pick = (name: string, share?: IndianShare) => {
    onChange(name);
    if (share) onPick?.(share);
    setOpen(false);
  };
  const row = "flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted";

  return (
    <div className="relative">
      <Input
        id={id}
        autoComplete="off"
        autoFocus={autoFocus}
        maxLength={50}
        placeholder="Search eg: RELIANCE, TCS, INFY"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => e.key === "Escape" && show && (e.stopPropagation(), setOpen(false))}
        role="combobox"
        aria-expanded={show}
        aria-controls={`${id}-list`}
        aria-invalid={invalid}
      />
      {show && (
        // Picking happens on mouse down, before the box loses focus and closes the list.
        <ul
          id={`${id}-list`}
          role="listbox"
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-xl border bg-card py-1 shadow-lg"
          onMouseDown={(e) => e.preventDefault()}
        >
          {mine.map((n) => (
            <li key={`mine-${n}`} role="option" aria-selected={false}>
              <button type="button" className={row} onClick={() => pick(n)}>
                <span className="min-w-0 flex-1 truncate font-semibold">{n}</span>
                <span className="text-xs text-muted-foreground">Holding</span>
              </button>
            </li>
          ))}
          {shares.map((s) => (
            <li key={`${s.exchange}-${s.symbol}`} role="option" aria-selected={false}>
              <button type="button" className={row} onClick={() => pick(s.symbol, s)}>
                <span className="grid min-w-0 flex-1">
                  <span className="truncate font-semibold">{s.symbol}</span>
                  <span className="truncate text-xs text-muted-foreground">{s.name}</span>
                </span>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                    s.exchange === "NSE" ? "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200" : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
                  )}
                >
                  {s.exchange}
                </span>
              </button>
            </li>
          ))}
          {searching && (
            <li className="flex items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Searching NSE and BSE…
            </li>
          )}
          {error && !searching && shares.length === 0 && <li className="px-3 py-2.5 text-sm text-muted-foreground">Search isn&apos;t working right now.</li>}
        </ul>
      )}
    </div>
  );
}
