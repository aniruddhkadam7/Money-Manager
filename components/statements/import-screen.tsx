"use client";

import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FileText, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatDisplayDate } from "@/lib/domain/dates";
import { ImportDetail, STATUS_STYLE, STATUS_TEXT } from "./import-detail";
import { useFinance } from "../finance-provider";
import { useStatements } from "./statements-provider";
import { UploadPanel } from "./upload-panel";
import { cn } from "@/lib/utils";

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
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Import a bank statement</h1>
        <p className="mt-1 text-sm text-muted-foreground">Upload a statement (PDF, Excel, CSV or a photo), check what we found, and add it to your records in one go.</p>
      </div>
      {statements.saveError && <p className="text-sm text-destructive">{statements.saveError}</p>}
      <UploadPanel onDone={open} />

      {statements.imports.length > 0 && (
        <section data-testid="history">
          <h2 className="mb-2 text-base font-semibold">Previous imports</h2>
          <div className="space-y-2">
            {[...statements.imports].sort((x, y) => whenOf(y) - whenOf(x)).map((i) => {
              const account = finance.book.accounts.find((a) => a.id === i.accountId);
              return (
                <Card key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
                  <FileText className="size-5 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{i.filename}</div>
                    <div className="text-xs text-muted-foreground">
                      {account?.name ?? "—"} · {i.periodStart && i.periodEnd ? `${formatDisplayDate(i.periodStart)} – ${formatDisplayDate(i.periodEnd)}` : "no dates"} · {i.counts.transactions} lines
                      {i.status === "IMPORTED" ? ` · ${i.counts.imported} imported` : i.counts.review ? ` · ${i.counts.review} to review` : ""}
                      {i.status === "FAILED" && i.error ? ` · ${i.error}` : ""}
                      {stampOf(i) ? ` · ${i.status === "IMPORTED" ? "Imported" : "Uploaded"} ${stampOf(i)}` : ""}
                    </div>
                  </div>
                  <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", STATUS_STYLE[i.status])}>{STATUS_TEXT[i.status]}</span>
                  {i.status !== "FAILED" && (
                    <button onClick={() => open(i.id)} className="text-sm font-medium text-primary hover:underline" data-testid="open-import">
                      Open
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

/** When the statement was imported (or, if not yet, uploaded), in the person's own time. */
type Stamped = { status: string; importedAt?: string; uploadedAt: string };

const whenOf = (i: Stamped): number => new Date((i.status === "IMPORTED" && i.importedAt) || i.uploadedAt).getTime() || 0;

function stampOf(i: Stamped): string {
  const d = new Date((i.status === "IMPORTED" && i.importedAt) || i.uploadedAt);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
}
