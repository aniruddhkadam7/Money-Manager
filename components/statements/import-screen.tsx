"use client";

import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronRight, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatDisplayDate } from "@/lib/domain/dates";
import { FileTypeIcon } from "./file-type-icon";
import { ImportDetail, STATUS_STYLE, STATUS_TEXT } from "./import-detail";
import { useFinance } from "../finance-provider";
import { useStatements } from "./statements-provider";
import { UploadPanel } from "./upload-panel";
import { cn } from "@/lib/utils";
import { PageTitle } from "../page-title";

function Screen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const finance = useFinance();
  const statements = useStatements();
  const id = params.get("import");

  const open = (importId: string | null) => router.push(importId ? `${pathname}?import=${importId}` : pathname);

  if (finance.status === "loading" || statements.status === "loading") {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading…
      </div>
    );
  }
  if (finance.status === "error" || statements.status === "error") {
    return <p className="py-16 text-sm text-destructive">Your saved data couldn't be read, so importing is paused to protect it.</p>;
  }
  if (id) return <ImportDetail importId={id} onBack={() => open(null)} />;

  return (
    <div className="mx-auto grid w-full max-w-[1400px] grid-cols-1 gap-4 sm:gap-6">
      <PageTitle>Import statement</PageTitle>
      {statements.saveError && <p className="text-sm text-destructive">{statements.saveError}</p>}
      <UploadPanel onDone={open} />

      {statements.imports.length > 0 && (
        <section data-testid="history">
          <h2 className="mb-2 text-base font-semibold">Previous imports</h2>
          <div className="space-y-2">
            {[...statements.imports].sort((x, y) => whenOf(y) - whenOf(x)).map((i) => {
              const account = finance.book.accounts.find((a) => a.id === i.accountId);
              const failed = i.status === "FAILED";
              const count = i.status === "IMPORTED" ? `${i.counts.imported} transactions` : i.counts.review ? `${i.counts.review} to review` : "";
              const mask = i.accountMask;
              const row = (
                <>
                  <FileTypeIcon filename={i.filename} />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-baseline gap-1.5">
                      <span className="truncate text-sm font-semibold">{account?.name ?? i.bankHint ?? "Statement"}</span>
                      {mask && <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">•• {mask}</span>}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[13px] font-medium text-foreground/80">
                      <CalendarDays className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{i.periodStart && i.periodEnd ? periodOf(i.periodStart, i.periodEnd) : "No dates found"}</span>
                    </div>
                    {failed ? (
                      <div className="truncate text-xs text-destructive">{i.error ?? "Couldn't read this file"}</div>
                    ) : (
                      count && <div className="text-xs text-muted-foreground">{count}</div>
                    )}
                  </div>
                  {i.status !== "IMPORTED" && (
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_STYLE[i.status])}>{STATUS_TEXT[i.status]}</span>
                  )}
                  {!failed && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
                </>
              );
              return (
                <Card key={i.id} className="overflow-hidden p-0" title={i.filename}>
                  {failed ? (
                    <div className="flex items-center gap-3 p-3">{row}</div>
                  ) : (
                    <button
                      onClick={() => open(i.id)}
                      className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-muted/50"
                      data-testid="open-import"
                    >
                      {row}
                    </button>
                  )}
                </Card>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

export function ImportScreen() {
  return (
    <Suspense fallback={null}>
      <Screen />
    </Suspense>
  );
}

/** When the statement was imported (or, if not yet, uploaded): newest first in the list. */
type Stamped = { status: string; importedAt?: string; uploadedAt: string };

const whenOf = (i: Stamped): number => new Date((i.status === "IMPORTED" && i.importedAt) || i.uploadedAt).getTime() || 0;

/** "31 Jul – 25 Aug 2026": the year once when both ends share it. */
function periodOf(start: string, end: string): string {
  const [from, to] = [formatDisplayDate(start), formatDisplayDate(end)];
  return start.slice(0, 4) === end.slice(0, 4) ? `${from.replace(/ \d{4}$/, "")} – ${to}` : `${from} – ${to}`;
}
