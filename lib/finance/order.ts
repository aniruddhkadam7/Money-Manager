import type { FinancialEvent } from "./types";

/**
 * Whether a statement lists its lines oldest first (+1) or newest first (-1), read from the lines
 * themselves: across neighbouring lines on different days, which way the dates mostly run.
 */
export function statementDirection(lines: { date: string; line: number }[]): 1 | -1 {
  const sorted = [...lines].sort((a, b) => a.line - b.line);
  let votes = 0;
  for (let i = 1; i < sorted.length; i++) {
    const c = sorted[i].date.localeCompare(sorted[i - 1].date);
    votes += Math.sign(c);
  }
  return votes < 0 ? -1 : 1;
}

/**
 * Oldest-first order for entries, the way the bank statement has them: by day, then — for entries
 * from the same statement on the same day — the order of their lines, then the order they were added.
 * Flip the result for newest first.
 */
export function chronological(events: FinancialEvent[]): (a: FinancialEvent, b: FinancialEvent) => number {
  const linesByImport = new Map<string, { date: string; line: number }[]>();
  for (const e of events)
    for (const s of e.sources ?? []) {
      const list = linesByImport.get(s.importId) ?? [];
      list.push({ date: e.date, line: s.line });
      linesByImport.set(s.importId, list);
    }
  const direction = new Map([...linesByImport].map(([id, lines]) => [id, statementDirection(lines)]));

  return (a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    for (const s of a.sources ?? []) {
      const t = b.sources?.find((x) => x.importId === s.importId);
      if (t && t.line !== s.line) return (s.line - t.line) * direction.get(s.importId)!;
    }
    return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  };
}
