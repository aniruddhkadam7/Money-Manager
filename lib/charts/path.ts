export interface Pt {
  x: number;
  y: number;
}

const f = (n: number) => Math.round(n * 100) / 100;

/**
 * Smooth curve through the points that never overshoots them (monotone cubic,
 * Fritsch–Carlson). A rising series never dips between two points, so the curve
 * can't suggest ups and downs that aren't in the data.
 */
export function monotonePath(pts: Pt[]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${f(pts[0].x)},${f(pts[0].y)}`;
  if (n === 2) return `M${f(pts[0].x)},${f(pts[0].y)}L${f(pts[1].x)},${f(pts[1].y)}`;

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x);
    slope.push(dx[i] === 0 ? 0 : (pts[i + 1].y - pts[i].y) / dx[i]);
  }

  const m: number[] = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const h = Math.hypot(a, b);
    if (h > 3) {
      const t = 3 / h;
      m[i] = t * a * slope[i];
      m[i + 1] = t * b * slope[i];
    }
  }

  let d = `M${f(pts[0].x)},${f(pts[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const c1x = pts[i].x + dx[i] / 3;
    const c1y = pts[i].y + (m[i] * dx[i]) / 3;
    const c2x = pts[i + 1].x - dx[i] / 3;
    const c2y = pts[i + 1].y - (m[i + 1] * dx[i]) / 3;
    d += `C${f(c1x)},${f(c1y)},${f(c2x)},${f(c2y)},${f(pts[i + 1].x)},${f(pts[i + 1].y)}`;
  }
  return d;
}

/** Closes a curve down to `baseY` so it can be filled. */
export function areaPath(pts: Pt[], baseY: number): string {
  if (pts.length === 0) return "";
  const line = monotonePath(pts);
  return `${line}L${f(pts[pts.length - 1].x)},${f(baseY)}L${f(pts[0].x)},${f(baseY)}Z`;
}
