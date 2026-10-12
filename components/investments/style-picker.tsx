"use client";

import { TRADE_STYLES } from "@/lib/finance/trade-styles";
import type { TradeStyle } from "@/lib/finance/types";
import { cn } from "@/lib/utils";

/** Intraday (MIS) or Longterm (CNC), side by side as on Zerodha's order window. */
export function StylePicker({
  value,
  onChange,
  invalid,
  className,
}: {
  value: TradeStyle | "";
  onChange: (style: TradeStyle) => void;
  invalid?: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Product"
      aria-invalid={invalid}
      className={cn("grid grid-cols-2 gap-1 rounded-xl border p-1", invalid && !value && "border-destructive", className)}
    >
      {TRADE_STYLES.map(({ style, code, label }) => {
        const on = value === style;
        return (
          <button
            key={style}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(style)}
            className={cn(
              "h-9 rounded-lg text-sm font-medium transition-colors",
              on ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {label} <span className={cn("text-xs", on ? "opacity-80" : "opacity-70")}>{code}</span>
          </button>
        );
      })}
    </div>
  );
}
