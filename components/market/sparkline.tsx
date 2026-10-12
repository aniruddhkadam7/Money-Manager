import { useId } from "react";
import { areaPath, monotonePath } from "@/lib/charts/path";
import { linearScale } from "@/lib/charts/scale";
import { GAIN, LOSS } from "../dashboard/chart-helpers";

/**
 * A small trend line, green when it ends above `base` (where it started, unless given), red when below.
 * `color` overrides that, for lines where up isn't good or bad (an interest rate).
 */
export function Sparkline({
  values,
  base: given,
  color: fixed,
  width = 72,
  height = 28,
}: {
  values: number[];
  base?: number;
  color?: string;
  width?: number;
  height?: number;
}) {
  const gid = useId().replace(/:/g, "");
  if (values.length < 2) return <span style={{ width, height }} className="inline-block shrink-0" aria-hidden />;
  const base = given ?? values[0];
  const min = Math.min(...values, base);
  const max = Math.max(...values, base);
  const x = linearScale(0, values.length - 1, 1, width - 1);
  const y = linearScale(min, max === min ? min + 1 : max, height - 2, 2);
  const pts = values.map((v, i) => ({ x: x(i), y: y(v) }));
  const color = fixed ?? (values[values.length - 1] >= base ? GAIN : LOSS);
  return (
    <svg width={width} height={height} className="block shrink-0 overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.22} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <line x1={0} x2={width} y1={y(base)} y2={y(base)} className="stroke-slate-300" strokeWidth={1} strokeDasharray="2 3" />
      <path d={areaPath(pts, height)} fill={`url(#${gid})`} />
      <path d={monotonePath(pts)} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
