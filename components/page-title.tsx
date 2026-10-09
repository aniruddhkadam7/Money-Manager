import type { ReactNode } from "react";

/** The one-line title every inner page starts with, with optional actions on the right. */
export function PageTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <h1 className="text-lg font-semibold leading-tight tracking-tight">{children}</h1>
      {actions}
    </div>
  );
}
