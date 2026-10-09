"use client";

import { useMemo } from "react";
import Link from "next/link";
import { FileClock } from "lucide-react";
import { formatDisplayDate } from "@/lib/domain/dates";
import { formatRupees } from "@/lib/finance/describe";
import type { StatementRow } from "@/lib/statements/types";
import { useStatements } from "../statements/statements-provider";

/** Statuses of lines that are in a statement but not (yet) in your records. */
const NOT_RECORDED: Partial<Record<StatementRow["status"], string>> = {
  review: "needs your decision",
  possible_duplicate: "might be a duplicate",
  auto: "ready, not imported yet",
  auto_flagged: "ready, not imported yet",
  pending: "not read yet",
  failed: "couldn't be added",
  skipped: "you skipped it",
};

/**
 * Searching Activity only finds what's recorded. A line still waiting in an imported statement (a salary
 * credit nobody has answered yet, a line you skipped) would seem missing, so matches there are listed too,
 * each linking to its statement.
 */
export function WaitingLines({ query }: { query: string }) {
  const statements = useStatements();
  const q = query.trim().toLowerCase();
  const hits = useMemo(() => {
    if (q.length < 2) return [];
    const files = new Map(statements.imports.map((i) => [i.id, i]));
    return statements.imports
      .flatMap((i) => statements.rowsOf(i.id))
      .filter((r) => NOT_RECORDED[r.status] && files.get(r.importId)?.status !== "FAILED")
      .filter((r) => `${r.rawDescription} ${r.normalized.counterparty}`.toLowerCase().includes(q))
      .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));
  }, [q, statements]);

  if (hits.length === 0) return null;
  const files = new Map(statements.imports.map((i) => [i.id, i.filename]));

  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" data-testid="waiting-lines">
      <p className="flex items-center gap-2 font-semibold">
        <FileClock className="size-4 shrink-0" />
        {hits.length} {hits.length === 1 ? "line" : "lines"} matching “{query.trim()}” {hits.length === 1 ? "is" : "are"} in your statements but not in your records yet
      </p>
      <p className="mt-0.5 text-amber-900/80">They don&apos;t count anywhere until they&apos;re imported. Open the statement to answer them.</p>
      <ul className="mt-2 grid gap-1">
        {hits.slice(0, 12).map((r) => (
          <li key={r.id}>
            <Link href={`/import?import=${r.importId}`} className="flex flex-wrap items-baseline gap-x-2 rounded-lg bg-card px-3 py-1.5 hover:bg-card/90">
              <span className="tabular-nums text-amber-900/70">{formatDisplayDate(r.transactionDate)}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{r.normalized.counterparty || r.rawDescription}</span>
              <span className={r.direction === "credit" ? "font-semibold tabular-nums text-emerald-700" : "font-semibold tabular-nums"}>
                {r.direction === "credit" ? "+" : "−"}
                {formatRupees(r.amountMinor)}
              </span>
              <span className="w-full text-xs text-amber-900/70 sm:w-auto">
                {NOT_RECORDED[r.status]} · {files.get(r.importId)}
              </span>
            </Link>
          </li>
        ))}
        {hits.length > 12 && <li className="px-3 text-xs">…and {hits.length - 12} more</li>}
      </ul>
    </div>
  );
}
