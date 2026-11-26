/**
 * Whether India's stock market is open (NSE/BSE: Monday to Friday, 9:15 am to 3:30 pm India time), with a little
 * margin either side (9:00 am to 3:45 pm) for the pre-open and the last trades to settle. Exchange holidays aren't
 * known here: on one, the app just refreshes as if the market were open (harmless, only a few more calls).
 */
export function marketOpen(now: Date = new Date()): boolean {
  const ist = new Date(now.getTime() + 5.5 * 3600_000);
  const day = ist.getUTCDay();
  if (day === 0 || day === 6) return false;
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return minutes >= 9 * 60 && minutes <= 15 * 60 + 45;
}

/** `open` while the market is open, `closed` otherwise (milliseconds): how often to refresh something. */
export const pace = (open: number, closed: number, now: Date = new Date()) => (marketOpen(now) ? open : closed);
