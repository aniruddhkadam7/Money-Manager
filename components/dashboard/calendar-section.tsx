"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CalendarBoard } from "../calendar/calendar-view";
import { ChartCard } from "../charts/primitives";

/** This month day by day: the same calendar as Activity's Calendar view, with a link to it. */
export function CalendarSection() {
  return (
    <ChartCard
      title="Calendar"
      action={
        <Link href="/calendar" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          Open calendar <ArrowRight className="size-3" />
        </Link>
      }
    >
      <CalendarBoard embedded />
    </ChartCard>
  );
}
