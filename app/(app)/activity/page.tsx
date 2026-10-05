import { Suspense } from "react";
import { ActivityView } from "@/components/activity/activity-view";

export const metadata = { title: "Activity · Money Manager" };

export default function ActivityPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-muted" aria-busy />}>
      <ActivityView />
    </Suspense>
  );
}
