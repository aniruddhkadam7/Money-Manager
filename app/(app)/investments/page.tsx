import { Suspense } from "react";
import { InvestmentsView } from "@/components/investments/investments-view";

export const metadata = { title: "Investments · Money Manager" };

export default function InvestmentsPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-muted" aria-busy />}>
      <InvestmentsView />
    </Suspense>
  );
}
