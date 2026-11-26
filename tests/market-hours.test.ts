import { describe, expect, it } from "vitest";
import { marketOpen, pace } from "@/lib/stocks/market-hours";

// Times in India (UTC+5:30), written as UTC.
const ist = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.parse(`${date}T00:00:00Z`) + ((h * 60 + m) - 330) * 60_000);
};

describe("market hours (India)", () => {
  it("open on a weekday from 9:00 am to 3:45 pm", () => {
    expect(marketOpen(ist("2026-11-26", "09:00"))).toBe(true); // a Thursday
    expect(marketOpen(ist("2026-11-26", "12:30"))).toBe(true);
    expect(marketOpen(ist("2026-11-26", "15:45"))).toBe(true);
  });

  it("closed before and after, at night and at weekends", () => {
    expect(marketOpen(ist("2026-11-26", "08:59"))).toBe(false);
    expect(marketOpen(ist("2026-11-26", "15:46"))).toBe(false);
    expect(marketOpen(ist("2026-11-26", "23:00"))).toBe(false);
    expect(marketOpen(ist("2026-11-28", "11:00"))).toBe(false); // Saturday
    expect(marketOpen(ist("2026-11-29", "11:00"))).toBe(false); // Sunday
  });

  it("paces refreshes: often while open, rarely while closed", () => {
    expect(pace(5, 60, ist("2026-11-26", "10:00"))).toBe(5);
    expect(pace(5, 60, ist("2026-11-28", "10:00"))).toBe(60);
  });
});
