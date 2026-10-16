import type { Member } from "./types";

export interface Weighted {
  member: Member;
  /** Share of the index, %. */
  weight: number;
}

export interface SectorWeight {
  industry: string;
  /** Share of the index, %. */
  weight: number;
  /** The industry's companies, biggest first. */
  companies: Weighted[];
  /** Today's move of the industry within the index, weighted by size, %. */
  changePct: number | null;
  /** The industry's PE within the index (see groupPe). */
  pe: GroupPe;
}

export interface GroupPe {
  /** Null when the group's earnings add up to a loss, or no company had the figures. */
  pe: number | null;
  /** How many of the group's companies had the figures to count. */
  count: number;
  total: number;
}

/**
 * A group's PE, the way an index's is worked out: the companies' total market value ÷ their total
 * earnings over the last four quarters. Each company's earnings = its market value × EPS ÷ price (EPS ×
 * shares). Loss-makers count with their losses, so one company with tiny profits and a huge PE can't
 * swamp the figure as it would an average of PEs. Companies without the figures are left out.
 */
export function groupPe(members: Member[]): GroupPe {
  let value = 0;
  let earnings = 0;
  let count = 0;
  for (const m of members) {
    if (!m.marketCap || !m.price || m.eps === null) continue;
    value += m.marketCap;
    earnings += (m.marketCap * m.eps) / m.price;
    count++;
  }
  return { pe: count && earnings > 0 ? value / earnings : null, count, total: members.length };
}

/**
 * How much of an index each industry makes up: each company's market value ÷ the total of all the
 * index's companies that have one. NSE weights by freely traded shares (and caps the biggest), so this is
 * close to NSE's weights, not equal to them. Companies without a market value are left out.
 */
export function sectorWeights(members: Member[]): { sectors: SectorWeight[]; counted: number } {
  const valued = members.filter((m) => m.marketCap && m.marketCap > 0);
  const total = valued.reduce((a, m) => a + m.marketCap!, 0);
  if (!total) return { sectors: [], counted: 0 };
  const by = new Map<string, Weighted[]>();
  for (const m of valued) {
    const key = m.industry || "Other";
    by.set(key, [...(by.get(key) ?? []), { member: m, weight: (m.marketCap! / total) * 100 }]);
  }
  const sectors = [...by].map(([industry, companies]) => {
    const moving = companies.filter((c) => c.member.changePct !== null);
    const w = moving.reduce((a, c) => a + c.weight, 0);
    return {
      industry,
      weight: companies.reduce((a, c) => a + c.weight, 0),
      companies: companies.sort((a, b) => b.weight - a.weight),
      changePct: w ? moving.reduce((a, c) => a + c.weight * c.member.changePct!, 0) / w : null,
      pe: groupPe(companies.map((c) => c.member)),
    };
  });
  return { sectors: sectors.sort((a, b) => b.weight - a.weight), counted: valued.length };
}
