/** Up green, down red, nothing grey. The sign is always written too, so colour is never the only signal. */
export const tone = (v: number | null | undefined) => (v == null ? "text-slate-400" : v > 0 ? "text-emerald-700" : v < 0 ? "text-rose-700" : "text-slate-500");
