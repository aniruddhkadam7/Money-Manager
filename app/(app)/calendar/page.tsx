import { Suspense } from "react";
import { CalendarView } from "@/components/calendar/calendar-view";

export const metadata = { title: "Calendar · Money Manager" };

export default function CalendarPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-2xl bg-muted" aria-busy />}>
      <CalendarView />
    </Suspense>
  );
}
