import { Suspense } from "react";
import { MoneyView } from "@/components/money/money-view";

export const metadata = { title: "Money · Money Manager" };

export default function MoneyPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-muted" aria-busy />}>
      <MoneyView />
    </Suspense>
  );
}
