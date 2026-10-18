import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The one-line title every inner page starts with, with optional actions on the right. Phones: the bottom tab bar
 * already names the page, so the title is kept for screen readers only and takes no room; the actions stay.
 */
export function PageTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className={cn("flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2", !actions && "max-sm:sr-only")}>
      <h1 className="text-lg font-semibold leading-tight tracking-tight max-sm:sr-only">{children}</h1>
      {actions}
    </div>
  );
}
