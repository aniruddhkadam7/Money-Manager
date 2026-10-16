const sign = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "");

/** Rupees or index points, Indian grouping, two decimals; a dash when missing. */
export const formatNumber = (v: number | null | undefined, digits = 2) =>
  v == null ? "—" : v.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** "+0.55%" / "−1.2%": the sign spelled out, a true minus. */
export const formatPct = (v: number | null | undefined, digits = 2) => (v == null ? "—" : `${sign(v)}${Math.abs(v).toFixed(digits)}%`);

/** "+126.40" points. */
export const formatChange = (v: number | null | undefined) => (v == null ? "—" : `${sign(v)}${formatNumber(Math.abs(v))}`);

/** Rupees in crore: "₹8,86,287 Cr". */
export function formatCrore(rupees: number | null | undefined): string {
  if (rupees == null) return "—";
  const cr = rupees / 1e7;
  return `₹${cr.toLocaleString("en-IN", { maximumFractionDigits: cr < 100 ? 1 : 0 })} Cr`;
}

/** A ratio such as PE: one decimal (none from 100), a dash when missing. */
export const formatRatio = (v: number | null | undefined) => (v == null ? "—" : v >= 100 ? v.toFixed(0) : v.toFixed(1));

/** A percentage without a sign: "45.6%". */
export const formatShare = (v: number | null | undefined, digits = 1) => (v == null ? "—" : `${v.toFixed(digits)}%`);

/** "2:41 pm" today, "9 Oct, 3:30 pm" before then, India time. */
export function formatTime(seconds: number, now = Date.now() / 1000): string {
  const opts = { timeZone: "Asia/Kolkata" } as const;
  const day = (s: number) => new Date(s * 1000).toLocaleDateString("en-IN", opts);
  return new Date(seconds * 1000).toLocaleString(
    "en-IN",
    day(seconds) === day(now) ? { ...opts, hour: "numeric", minute: "2-digit" } : { ...opts, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" },
  );
}
