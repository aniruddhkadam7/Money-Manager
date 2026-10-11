import { formatDayMonth, formatLongDayMonth, formatMonthYear } from "@/lib/domain/dates";

/** Colours for money coming in (or growing) and going out, shared by the dashboard's charts. */
export const GAIN = "#059669";
export const LOSS = "#e11d48";

/** A chart tooltip's date: "October 4", with the year only when it isn't this year. */
export function dateTitle(date: string, today: string) {
  const year = date.slice(0, 4);
  return { title: formatLongDayMonth(date), sub: year === today.slice(0, 4) ? undefined : year };
}

/** An x-axis label: the day for short spans, the month for longer ones. */
export function axisLabel(date: string, spanDays: number) {
  return spanDays <= 75 ? formatDayMonth(date) : formatMonthYear(date.slice(0, 7));
}
