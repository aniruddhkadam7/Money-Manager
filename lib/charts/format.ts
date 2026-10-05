/** Indian-style compact money for chart axes and headlines. Input is paise. */

function trim(n: number, decimals: number): string {
  return n.toFixed(decimals).replace(/\.?0+$/, "");
}

/** ₹850, ₹52K, ₹1.2L, ₹18.4L, ₹2.15Cr. For axes and tight spaces. */
export function formatCompactINR(minor: number): string {
  const rupees = Math.abs(minor) / 100;
  const sign = minor < 0 ? "−" : "";
  if (rupees >= 1e7) return `${sign}₹${trim(rupees / 1e7, 2)}Cr`;
  if (rupees >= 1e5) return `${sign}₹${trim(rupees / 1e5, 1)}L`;
  if (rupees >= 1e3) return `${sign}₹${trim(rupees / 1e3, 1)}K`;
  return `${sign}₹${Math.round(rupees)}`;
}

/** Big, friendly numbers: exact under ₹1L (₹64,200), compact above (₹18.4L). */
export function formatHeadlineINR(minor: number): string {
  const rupees = Math.abs(minor) / 100;
  if (rupees >= 1e5) return formatCompactINR(minor);
  const sign = minor < 0 ? "−" : "";
  return `${sign}₹${Math.round(rupees).toLocaleString("en-IN")}`;
}

/** Exact rupees with Indian grouping: ₹18,42,500. */
export function formatExactINR(minor: number): string {
  const sign = minor < 0 ? "−" : "";
  const abs = Math.abs(minor);
  const text = (abs / 100).toLocaleString("en-IN", {
    minimumFractionDigits: abs % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `${sign}₹${text}`;
}

/** "+₹42,500" / "−₹1,200" / "₹0" */
export function formatSignedINR(minor: number, exact = true): string {
  if (minor === 0) return "₹0";
  const body = exact ? formatExactINR(Math.abs(minor)) : formatCompactINR(Math.abs(minor));
  return `${minor > 0 ? "+" : "−"}${body}`;
}

/** Basis points as a percentage: 4630 -> "46.3%". Pass decimals=0 for "46%". */
export function formatBps(bps: number, decimals = 0): string {
  return `${(bps / 100).toFixed(decimals)}%`;
}
