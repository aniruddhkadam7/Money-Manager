import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        // 16px text on phones: smaller makes iOS Safari zoom the page on focus.
        "h-11 w-full min-w-0 rounded-lg border border-input bg-card px-3 text-base outline-none sm:h-10 sm:text-sm transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
