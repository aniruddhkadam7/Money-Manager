import { Suspense } from "react";
import { HealthView } from "@/components/health/health-view";

export const metadata = { title: "Money health · Money Manager" };

export default function HealthPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-muted" aria-busy />}>
      <HealthView />
    </Suspense>
  );
}
