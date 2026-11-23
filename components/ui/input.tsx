import * as React from "react";
import { formatAmountField } from "@/lib/domain/money";
import { cn } from "@/lib/utils";

/** `amount`: a money field. Commas appear as you type (1,00,000), and the decimal keypad opens on phones. */
function Input({ className, type, amount, onChange, ...props }: React.ComponentProps<"input"> & { amount?: boolean }) {
  return (
    <input
      type={type}
      inputMode={amount ? "decimal" : props.inputMode}
      className={cn(
        // 16px text on phones: smaller makes iOS Safari zoom the page on focus.
        "h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-base outline-none sm:h-10 sm:text-sm transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 aria-invalid:border-destructive",
        // iOS Safari gives date pickers their own width and height; reset them so they fit their column like any input.
        (type === "date" || type === "month" || type === "time") &&
          "appearance-none [&::-webkit-date-and-time-value]:min-h-[1.5em] [&::-webkit-date-and-time-value]:text-left",
        className,
      )}
      {...props}
      onChange={
        amount && onChange
          ? (e) => {
              formatAmountField(e.currentTarget);
              onChange(e);
            }
          : onChange
      }
    />
  );
}

export { Input };
