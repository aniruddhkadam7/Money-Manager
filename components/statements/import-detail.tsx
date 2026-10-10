"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, ChevronDown, FileText, Loader2, ScanText, ShieldAlert, ShieldCheck, Sparkles, Trash2, TriangleAlert, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDisplayDate, formatWeekdayDate } from "@/lib/domain/dates";
import { formatRupees } from "@/lib/finance/describe";
import { statementDirection } from "@/lib/finance/order";
import { looksLikeCardStatement, needsDecision } from "@/lib/statements/pipeline";
import type { StatementRow } from "@/lib/statements/types";
import { cn, scrollPage } from "@/lib/utils";
import { useEventDialog } from "../events/event-dialog";
import { useFinance } from "../finance-provider";
import { useToast } from "../toast";
import { describeClassification, signedAmount, SOURCE_LABEL, STATUS_LABEL } from "./labels";
import { BulkApply, DEFAULT_FILTERS, filtersActive, lineMatches, PartyRanking, rankParties, type PartyFilters } from "./party-filter";
import { ReviewCard } from "./review-card";
import { useStatements, type CommitOutcomeResult } from "./statements-provider";
import { ViewInStatement } from "./source-viewer";

export const STATUS_STYLE: Record<string, string> = {
  UPLOADED: "bg-muted text-muted-foreground",
  PROCESSING: "bg-muted text-muted-foreground",
  REVIEW_REQUIRED: "bg-amber-100 text-amber-900",
  READY_TO_IMPORT: "bg-emerald-100 text-emerald-900",
  IMPORTED: "palette-fixed bg-emerald-600 text-white",
  FAILED: "bg-red-100 text-red-900",
};
export const STATUS_TEXT: Record<string, string> = {
  UPLOADED: "Uploaded",
  PROCESSING: "Processing",
  REVIEW_REQUIRED: "Review required",
  READY_TO_IMPORT: "Ready to import",
  IMPORTED: "Imported",
  FAILED: "Failed",
};

/** How the lists of lines are ordered. */
type RowSort = "statement" | "newest" | "oldest" | "highest" | "lowest" | "name";
const ROW_SORTS: { value: RowSort; label: string }[] = [
  { value: "statement", label: "Statement order" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "highest", label: "Highest amount" },
  { value: "lowest", label: "Lowest amount" },
  { value: "name", label: "Name A–Z" },
];
const nameOf = (r: StatementRow) => (r.normalized.counterparty || r.rawDescription).toLowerCase();
function sortRows(list: StatementRow[], sort: RowSort): StatementRow[] {
  const byIndex = (a: StatementRow, b: StatementRow) => a.index - b.index;
  // Same day: the statement's own order, whichever way it runs.
  const dir = statementDirection(list.map((r) => ({ date: r.transactionDate, line: r.index })));
  const byTime = (a: StatementRow, b: StatementRow) => a.transactionDate.localeCompare(b.transactionDate) || (a.index - b.index) * dir;
  const cmp: Record<RowSort, (a: StatementRow, b: StatementRow) => number> = {
    statement: byIndex,
    newest: (a, b) => byTime(b, a),
    oldest: byTime,
    highest: (a, b) => b.amountMinor - a.amountMinor || byIndex(a, b),
    lowest: (a, b) => a.amountMinor - b.amountMinor || byIndex(a, b),
    name: (a, b) => nameOf(a).localeCompare(nameOf(b)) || byIndex(a, b),
  };
  return [...list].sort(cmp[sort]);
}

/** Which lines a summary tile stands for; the same split the counts use. */
type TileKey = "all" | "import" | "existing" | "duplicates" | "possible" | "review" | "skipped";

const TILE_ROWS: Record<TileKey, (r: StatementRow) => boolean> = {
  all: () => true,
  import: (r) => r.status === "imported" || r.status === "auto" || r.status === "auto_flagged",
  existing: (r) => r.status === "matched_existing" || r.status === "already_imported",
  duplicates: (r) => r.status === "skipped" && r.match?.kind === "in_statement_duplicate",
  possible: (r) => r.status === "possible_duplicate",
  review: (r) => r.status === "review",
  skipped: (r) => r.status === "skipped" && r.match?.kind !== "in_statement_duplicate",
};

function Tile({ label, value, tone, testId, active, onClick }: { label: string; value: number; tone?: "warn" | "good"; testId: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      disabled={value === 0}
      className={cn(
        "rounded-xl border bg-card px-3 py-2.5 text-left transition",
        value > 0 && "hover:border-foreground/30 hover:bg-muted/40",
        value === 0 && "cursor-default opacity-70",
        tone === "warn" && value > 0 && "border-amber-300 bg-amber-50 hover:bg-amber-100/60",
        active && "border-primary bg-primary/5 ring-2 ring-primary/30 hover:bg-primary/5",
      )}
      data-testid={testId}
    >
      <div className={cn("text-xl font-semibold tabular-nums", tone === "good" && value > 0 && "text-emerald-700")}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </button>
  );
}

function Section({ title, hint, count, children, defaultOpen = true, testId }: { title: string; hint?: string; count: number; children: ReactNode; defaultOpen?: boolean; testId?: string }) {
  if (count === 0) return null;
  return (
    <details open={defaultOpen} className="group" data-testid={testId}>
      <summary className="flex cursor-pointer list-none items-center gap-2 py-2">
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-0 [details:not([open])_&]:-rotate-90" />
        <h3 className="text-base font-semibold">{title}</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">{count}</span>
        {hint && <span className="hidden text-xs text-muted-foreground sm:inline">{hint}</span>}
      </summary>
      <div className="space-y-2 pb-2">{children}</div>
    </details>
  );
}

/** A settled line: what it is, with the full trail (statement -> classification -> match -> decision -> entry) on demand. */
function RowLine({ row }: { row: StatementRow }) {
  const { book } = useFinance();
  const { openDetail } = useEventDialog();
  const [open, setOpen] = useState(false);
  const c = row.classification;
  const event = row.eventId ? book.events.find((e) => e.id === row.eventId) : undefined;
  const statements = useStatements();
  const toast = useToast();
  const bringBack = () => {
    const r = statements.resolve(row.id, { kind: "reopen" });
    toast.show({ message: r.ok ? "Moved to “Needs your decision” at the top: choose what it is, or skip it again." : r.message });
    if (r.ok) scrollPage({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="rounded-xl border bg-card" data-testid="row-line" data-status={row.status}>
      <button className="flex w-full items-center gap-3 px-3 py-2.5 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <div className="w-28 shrink-0 text-xs text-muted-foreground">{formatWeekdayDate(row.transactionDate)}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{row.normalized.counterparty || row.rawDescription}</div>
          <div className="truncate text-xs text-muted-foreground">
            {row.status === "matched_existing" && event
              ? "Matches your entry — nothing new will be added"
              : row.status === "already_imported"
                ? row.match?.reason
                : row.status === "skipped"
                  ? (row.match?.reason ?? "Skipped")
                  : c
                    ? describeClassification(c, row.direction, book.accounts)
                    : STATUS_LABEL[row.status]}
          </div>
        </div>
        <div className={cn("text-sm font-semibold tabular-nums", row.direction === "credit" && "text-emerald-700")}>{signedAmount(row.direction, row.amountMinor)}</div>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <dl className="grid gap-x-6 gap-y-1.5 border-t px-3 py-3 text-xs sm:grid-cols-2" data-testid="row-trail">
          <Item k="As printed by the bank" v={row.rawDescription} mono />
          <Item k="Understood as" v={`${row.normalized.mode ?? "—"} · ${row.normalized.counterparty || "—"}${row.referenceNumber ? ` · ref ${row.referenceNumber}` : ""}`} />
          <Item k="Statement position" v={`line ${row.index + 1}, page ${row.sourcePage}${row.balanceAfterMinor !== undefined ? ` · balance after ${formatRupees(row.balanceAfterMinor)}` : ""}`} />
          <div className="sm:col-span-2">
            <ViewInStatement row={row} className="h-7 px-2 text-xs" />
          </div>
          <Item k="Read confidence" v={`${Math.round(row.extractionConfidence * 100)}%`} />
          {c && <Item k="Classified by" v={`${SOURCE_LABEL[c.source]} · ${Math.round(c.confidence * 100)}% — ${c.reason}`} />}
          {row.match && <Item k="Match" v={`${row.match.kind.replace(/_/g, " ")} (${row.match.level === 1 ? "exact" : row.match.level === 2 ? "strong" : "possible"}) — ${row.match.reason}`} />}
          {row.decision && <Item k="Decision" v={`${row.decision.by === "user" ? "You" : "Automatic"}${row.decision.note ? ` — ${row.decision.note}` : ""}`} />}
          <Item k="Fingerprint" v={row.fingerprint.slice(0, 16) + "…"} mono />
          {event && (
            <div className="sm:col-span-2">
              <Button size="sm" variant="outline" onClick={() => openDetail(event.id)}>
                <FileText /> Open the entry
              </Button>
            </div>
          )}
        </dl>
      )}
      {row.status === "skipped" && (
        <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
          <span className="mr-auto text-xs text-muted-foreground">Not added to your records.</span>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={bringBack} data-testid="bring-back">
            <Undo2 /> Bring back
          </Button>
        </div>
      )}
    </div>
  );
}

const Item = ({ k, v, mono }: { k: string; v: string; mono?: boolean }) => (
  <div className="min-w-0">
    <dt className="text-muted-foreground">{k}</dt>
    <dd className={cn("break-words", mono && "font-mono text-[11px]")}>{v}</dd>
  </div>
);

export function ImportDetail({ importId, onBack }: { importId: string; onBack: () => void }) {
  const statements = useStatements();
  const finance = useFinance();
  const toast = useToast();
  const record = statements.imports.find((i) => i.id === importId);
  const rows = useMemo(() => statements.rowsOf(importId), [statements, importId]);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<CommitOutcomeResult | null>(null);
  const [justImported, setJustImported] = useState<{ created: number; matched: number } | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [partyFilter, setPartyFilter] = useState<string | null>(null);
  const [tile, setTile] = useState<{ key: TileKey; label: string } | null>(null);
  const [rowSort, setRowSort] = useState<RowSort>("statement");
  const [filters, setFilters] = useState<PartyFilters>(DEFAULT_FILTERS);

  if (!record) {
    return (
      <Card className="p-6">
        <p className="text-sm">That import doesn't exist (it may have been discarded).</p>
        <Button className="mt-3" variant="outline" onClick={onBack}>
          Back to imports
        </Button>
      </Card>
    );
  }

  const account = finance.book.accounts.find((a) => a.id === record.accountId);
  const ready = statements.readinessOf(importId);
  const imported = record.status === "IMPORTED";
  const recon = record.reconciliation;

  const review = rows.filter(needsDecision);
  const flagged = rows.filter((r) => r.status === "auto_flagged");
  // Who appears most among the lines still open, and the optional focus on one of them.
  const open = [...review, ...flagged];
  const filtered = open.filter((r) => lineMatches(r, filters));
  const parties = rankParties(filtered, filters.sort);
  const focus = parties.find((p) => p.key === partyFilter) ?? null;
  const inFocus = new Set(focus?.rows.map((r) => r.id));
  const visible = new Set(filtered.map((r) => r.id));
  const reviewShown = sortRows(review.filter((r) => visible.has(r.id) && (!focus || inFocus.has(r.id))), rowSort);
  const flaggedShown = sortRows(flagged.filter((r) => visible.has(r.id) && (!focus || inFocus.has(r.id))), rowSort);
  const willImport = sortRows(rows.filter((r) => r.status === "auto"), rowSort);
  const alreadyThere = sortRows(rows.filter((r) => r.status === "matched_existing" || r.status === "already_imported"), rowSort);
  const skipped = sortRows(rows.filter((r) => r.status === "skipped"), rowSort);
  // A card statement sitting in a bank or cash account (older imports are recognised by their file name).
  // Entries this import put in your records (imported lines): "Undo import" takes them back out.
  const recordedCount = rows.filter((r) => r.status === "imported").length;
  const hasRecorded = imported || recordedCount > 0;
  // A bank statement (balance on every line) sitting in a card account: its salary became "paid the card".
  const bankInCard = account?.type === "credit_card" && !record.cardStatement && rows.length > 0 && rows.filter((r) => r.balanceAfterMinor !== undefined).length / rows.length >= 0.6;
  const undoOrDiscard = async () => {
    if (!hasRecorded) {
      statements.discard(importId);
      onBack();
      return;
    }
    setUndoing(true);
    const r = await statements.undoImport(importId);
    setUndoing(false);
    toast.show({ message: r.ok ? `Import undone: ${r.removed} ${r.removed === 1 ? "entry" : "entries"} removed. You can import the file again.` : r.message });
    if (r.ok) onBack();
  };
  const wrongAccount = !!account && account.type !== "credit_card" && (record.cardStatement ?? looksLikeCardStatement(record.filename));
  const done = sortRows(rows.filter((r) => r.status === "imported"), rowSort);
  const toCreate = rows.filter((r) => r.status === "auto" || r.status === "auto_flagged").length;
  const toLink = rows.filter((r) => r.status === "matched_existing" && !r.decision?.note && !imported).length;

  const accountNow = finance.state.accounts.find((a) => a.account.id === record.accountId);
  const closing = record.closingBalanceMinor;
  const gap = imported && accountNow && closing !== undefined ? closing - accountNow.balanceMinor : undefined;

  const pick = (key: TileKey, label: string) => ({ active: tile?.key === key, onClick: () => setTile(tile?.key === key ? null : { key, label }) });
  const tileRows = tile ? sortRows(rows.filter(TILE_ROWS[tile.key]), rowSort) : [];

  const doCommit = async () => {
    setCommitting(true);
    setCommitError(null);
    setJustImported(null);
    const res = await statements.commit(importId);
    setCommitting(false);
    if (res.ok) {
      setJustImported({ created: res.created, matched: res.matched });
      scrollPage({ top: 0, behavior: "smooth" });
    }
    if (res.ok) toast.show({ message: `Imported ${res.created} ${res.created === 1 ? "entry" : "entries"}${res.matched ? `, linked ${res.matched} existing` : ""}` });
    else setCommitError(res);
  };

  return (
    <div className="space-y-5" data-testid="import-detail" data-status={record.status}>
      <div>
        <button onClick={onBack} className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> All imports
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-lg font-semibold leading-tight tracking-tight">
              <span className="break-all">{record.filename}</span>
              <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", STATUS_STYLE[record.status])} data-testid="import-status">
                {STATUS_TEXT[record.status]}
              </span>
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {account?.name ?? "Unknown account"}
              {record.bankHint ? ` · ${record.bankHint}` : ""}
              {record.accountMask ? ` · ••${record.accountMask}` : ""}
              {record.periodStart && record.periodEnd ? ` · ${formatDisplayDate(record.periodStart)} – ${formatDisplayDate(record.periodEnd)}` : ""}
              {record.ocr && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                  <ScanText className="size-3" /> scanned (OCR)
                </span>
              )}
              {record.aiUsed && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                  <Sparkles className="size-3" /> AI assisted
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {confirmDiscard ? (
              <>
                <span className="text-sm">{hasRecorded ? `Remove this import and the ${recordedCount} ${recordedCount === 1 ? "entry" : "entries"} it added?` : "Discard this import?"}</span>
                <Button size="sm" variant="destructive" disabled={undoing} onClick={undoOrDiscard} data-testid="confirm-undo">
                  {undoing ? <Loader2 className="animate-spin" /> : null} {hasRecorded ? "Undo import" : "Discard"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirmDiscard(false)}>
                  Keep
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setConfirmDiscard(true)} data-testid="discard">
                <Trash2 /> {hasRecorded ? "Undo import" : "Discard"}
              </Button>
            )}
          </div>
        </div>
      </div>

      {record.error && <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">{record.error}</p>}
      {record.aiNote && (
        <p className="flex gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" data-testid="ai-note">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {record.aiNote}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" data-testid="summary">
        <Tile label="Transactions" value={record.counts.transactions} testId="count-transactions" {...pick("all", "All transactions")} />
        <Tile label={imported ? "Imported" : "Will be imported"} value={imported ? record.counts.imported : toCreate} tone="good" testId="count-import" {...pick("import", imported ? "Imported" : "Will be imported")} />
        <Tile label="Already in your records" value={record.counts.matchedExisting + record.counts.alreadyImported} testId="count-existing" {...pick("existing", "Already in your records")} />
        <Tile label="Duplicates dropped" value={record.counts.duplicates} testId="count-duplicates" {...pick("duplicates", "Duplicates dropped")} />
        <Tile label="Possible duplicates" value={record.counts.possibleDuplicates} tone="warn" testId="count-possible" {...pick("possible", "Possible duplicates")} />
        <Tile label="Need your decision" value={record.counts.review} tone="warn" testId="count-review" {...pick("review", "Need your decision")} />
        <Tile label="Skipped" value={record.counts.skipped} testId="count-skipped" {...pick("skipped", "Skipped")} />
      </div>

      {bankInCard && (
        <Card className="border-rose-300 bg-rose-50 p-4 text-sm text-rose-950" data-testid="bank-in-card">
          <p className="flex items-center gap-2 font-semibold">
            <TriangleAlert className="size-4 shrink-0" /> This is a bank account statement, but it was imported into {account?.name}
          </p>
          <p className="mt-1 text-rose-900/80">
            Money in was recorded as card payments and spending as card purchases. Undo it, then import again into your bank account.
          </p>
          <Button size="sm" variant="destructive" className="mt-3" disabled={undoing} onClick={() => { if (window.confirm(`Remove this import and the ${recordedCount} entries it added? You can then import the file again into your bank account.`)) void undoOrDiscard(); }} data-testid="undo-bank-in-card">
            Undo this import
          </Button>
        </Card>
      )}

      {wrongAccount && (
        <Card className="border-rose-300 bg-rose-50 p-4 text-sm text-rose-950" data-testid="card-in-bank">
          <p className="flex items-center gap-2 font-semibold">
            <TriangleAlert className="size-4 shrink-0" /> This is a credit card statement, but it was imported into {account?.name ?? "a bank account"}
          </p>
          <p className="mt-1 text-rose-900/80">
            Card purchases were recorded as money leaving your bank. Undo it, then import again into your credit card.
          </p>
          <Button
            size="sm"
            variant="destructive"
            className="mt-3"
            disabled={undoing}
            onClick={() => {
              if (window.confirm(`Remove this import and the ${recordedCount} entries it added? You can then import the file again into your credit card.`)) void undoOrDiscard();
            }}
            data-testid="undo-card-in-bank"
          >
            Undo this import
          </Button>
        </Card>
      )}

      {recon && (
        <Card className={cn("p-4", !recon.ok && "border-amber-300")} data-testid="reconciliation" data-ok={recon.ok}>
          <div className="flex flex-wrap items-center gap-2">
            {recon.ok ? <ShieldCheck className="size-5 text-emerald-600" /> : <ShieldAlert className="size-5 text-amber-600" />}
            <h2 className="text-base font-semibold">{recon.ok ? "The statement adds up" : recon.verifiable ? "The statement doesn't add up" : "Can't verify the totals"}</h2>
          </div>
          {recon.openingMinor !== undefined && recon.expectedClosingMinor !== undefined ? (
            <>
              <dl className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-2 text-sm">
                <Fig k="Opening" v={formatRupees(recon.openingMinor)} />
                <Op>+</Op>
                <Fig k="Money in" v={formatRupees(recon.totalCreditsMinor)} />
                <Op>−</Op>
                <Fig k="Money out" v={formatRupees(recon.totalDebitsMinor)} />
                <Op>=</Op>
                <Fig k="Expected" v={formatRupees(recon.expectedClosingMinor)} />
                <span className="mx-1 hidden h-8 w-px bg-border sm:block" />
                <Fig k="Statement closing" v={recon.actualClosingMinor !== undefined ? formatRupees(recon.actualClosingMinor) : "—"} />
                <Fig k="Difference" v={recon.differenceMinor ? formatRupees(recon.differenceMinor) : "None"} bad={!!recon.differenceMinor} />
              </dl>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              Money in {formatRupees(recon.totalCreditsMinor)} · money out {formatRupees(recon.totalDebitsMinor)}
            </p>
          )}
          {!recon.ok && !imported && (
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={!!record.reconciliationOverride} onChange={(e) => statements.setReconciliationOverride(importId, e.target.checked)} data-testid="override" />
              <span>
                <strong className="text-foreground">Import anyway</strong> — I've checked it; some lines may be missing or wrong.
              </span>
            </label>
          )}
        </Card>
      )}

      {imported && (
        <Card className="border-emerald-300 bg-emerald-50 p-4" data-testid="import-result">
          <div className="flex items-center gap-2 text-emerald-900">
            <CheckCircle2 className="size-5" /> <h2 className="text-base font-semibold">Imported {record.importedAt ? `on ${formatDisplayDate(record.importedAt.slice(0, 10))}` : ""}</h2>
          </div>
          <p className="mt-1 text-sm text-emerald-900/80">
            {done.length} new {done.length === 1 ? "entry" : "entries"} added
            {record.counts.matchedExisting ? `, ${record.counts.matchedExisting} linked to entries you already had` : ""}
            {record.counts.alreadyImported ? `, ${record.counts.alreadyImported} already imported before` : ""}.
          </p>
          {accountNow && (
            <p className="mt-2 text-sm" data-testid="ledger-check">
              {account?.name} now shows <strong>{formatRupees(accountNow.balanceMinor)}</strong>
              {closing !== undefined && (gap === 0 ? <> — matches the statement's closing balance. ✓</> : <> — the statement says {formatRupees(closing)}.</>)}
            </p>
          )}
          {gap !== undefined && gap !== 0 && account && account.openingBalanceMinor + gap >= 0 && (
            <div className="mt-2 rounded-lg bg-card p-3 text-sm">
              <p>
                The {formatRupees(Math.abs(gap))} gap usually means a different starting balance. Correct it to match the bank:
              </p>
              <Button
                size="sm"
                className="mt-2"
                onClick={() => {
                  const r = finance.updateAccount(account.id, { openingBalanceMinor: account.openingBalanceMinor + gap });
                  toast.show({ message: r.ok ? `Starting balance of ${account.name} corrected` : (r.issues[0]?.message ?? "Couldn't change it") });
                }}
                data-testid="fix-opening"
              >
                Set starting balance to {formatRupees(account.openingBalanceMinor + gap)}
              </Button>
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <Button asChild size="sm">
              <Link href="/activity">See in Activity</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/">Dashboard</Link>
            </Button>
          </div>
        </Card>
      )}

      {justImported && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900" role="status" data-testid="import-success">
          <CheckCircle2 className="size-5 shrink-0" />
          <p>
            <strong>
              Imported {justImported.created} {justImported.created === 1 ? "entry" : "entries"}
            </strong>
            {justImported.matched ? `, linked ${justImported.matched} to entries you already had` : ""}.
            {ready.ready || imported ? " This statement is done." : ` ${ready.blockers[0]} — they're still below for you to decide.`}
          </p>
          <button className="ml-auto text-xs underline" onClick={() => setJustImported(null)}>
            Dismiss
          </button>
        </div>
      )}

      {commitError && !commitError.ok && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm" role="alert" data-testid="commit-error">
          <p className="font-medium">{commitError.message}</p>
          {commitError.failures.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {commitError.failures.map((f, i) => (
                <li key={i}>{f.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2" data-testid="row-sort">
        {!imported && review.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="mr-auto"
            onClick={() => {
              const r = statements.recheck(importId);
              const parts = [
                r.settled ? `${r.settled} sorted automatically` : "",
                r.changed - r.settled ? `${r.changed - r.settled} got a better suggestion${r.hardToRead ? ` (${r.hardToRead} hard to read from the file, so please check the amount and date)` : ""}` : "",
              ].filter(Boolean);
              toast.show({ message: r.changed ? `Re-checked: ${parts.join(", ")}.` : "Re-checked: nothing more can be read from these lines. They need your answer." });
            }}
            data-testid="recheck"
          >
            <Sparkles /> Re-check lines
          </Button>
        )}
        <span className="text-xs text-muted-foreground max-sm:hidden">Sort lines</span>
        <Select value={rowSort} onValueChange={(v) => setRowSort(v as RowSort)}>
          <SelectTrigger className="h-8 w-44 bg-card text-xs max-sm:w-36" aria-label="Sort lines">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROW_SORTS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {tile ? (
        <div className="space-y-2" data-testid="tile-list">
          <div className="flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2 text-sm">
            <span>
              Showing only <strong>{tile.label}</strong> · {tileRows.length} {tileRows.length === 1 ? "line" : "lines"}
            </span>
            <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setTile(null)}>
              Show everything
            </button>
          </div>
          {tileRows.slice(0, 300).map((r) => (needsDecision(r) ? <ReviewCard key={r.id} row={r} siblings={rows} /> : <RowLine key={r.id} row={r} />))}
          {tileRows.length > 300 && <p className="text-xs text-muted-foreground">Showing the first 300 of {tileRows.length}.</p>}
        </div>
      ) : (
        <>
      {open.length > 0 && (
        <PartyRanking parties={parties} selected={focus?.key ?? null} onSelect={setPartyFilter} filters={filters} onFilters={setFilters} totalLines={open.length} shownLines={reviewShown.length + flaggedShown.length} />
      )}
      {focus && <BulkApply party={focus} onDone={() => setPartyFilter(null)} />}

      <Section title="Needs your decision" hint="One click each — your answers are remembered" count={reviewShown.length} testId="section-review">
        {reviewShown.map((r) => (
          <ReviewCard key={r.id} row={r} siblings={rows} />
        ))}
      </Section>

      {flagged.length > 0 && (
        <Section title="Worth a glance" hint="Will be imported — we're fairly sure" count={flaggedShown.length} testId="section-flagged">
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => (focus || filtersActive(filters) ? flaggedShown.forEach((r) => statements.resolve(r.id, { kind: "accept" })) : statements.acceptAllFlagged(importId))} data-testid="confirm-all">
              <CheckCircle2 /> Looks right — confirm all {flaggedShown.length}
            </Button>
          </div>
          {flaggedShown.map((r) => (
            <ReviewCard key={r.id} row={r} siblings={rows} compact />
          ))}
        </Section>
      )}

      <Section title="Will be imported" hint="Confident matches" count={willImport.length} defaultOpen={review.length === 0} testId="section-auto">
        {willImport.map((r) => (
          <RowLine key={r.id} row={r} />
        ))}
      </Section>

      <Section title="Imported" count={done.length} testId="section-imported">
        {done.map((r) => (
          <RowLine key={r.id} row={r} />
        ))}
      </Section>

      <Section title="Already in your records" hint="Nothing new will be created for these" count={alreadyThere.length} defaultOpen={false} testId="section-existing">
        {alreadyThere.map((r) => (
          <RowLine key={r.id} row={r} />
        ))}
      </Section>

      <Section title="Skipped and duplicates" count={skipped.length} defaultOpen={false} testId="section-skipped">
        {skipped.map((r) => (
          <RowLine key={r.id} row={r} />
        ))}
      </Section>

        </>
      )}

      {!imported && record.status !== "FAILED" && (
        <div
          // Pinned to the bottom on wider screens; on phones the tab bar owns the bottom, so it sits at the end of the page.
          className="flex flex-wrap items-center justify-between gap-3 glass rounded-2xl border p-3 sm:sticky sm:bottom-3 sm:z-30 sm:bg-card/95 sm:shadow-lg sm:backdrop-blur"
          data-testid="import-bar"
        >
          <div className="min-w-0 text-sm">
            {ready.canImportReady ? (
              <span>
                Ready: <strong>{toCreate}</strong> new {toCreate === 1 ? "entry" : "entries"}
                {toLink ? `, ${toLink} linked to existing` : ""}.{" "}
                {ready.ready ? "Nothing else changes." : `${ready.blockers[0]} — they stay here for later.`}
              </span>
            ) : (
              <span className="text-muted-foreground" data-testid="blockers">
                Not yet: {ready.blockers.join(" · ")}
              </span>
            )}
          </div>
          <Button onClick={doCommit} disabled={!ready.canImportReady || committing} data-testid="import-button">
            {committing ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Import {toCreate} {toCreate === 1 ? "entry" : "entries"}
          </Button>
        </div>
      )}
    </div>
  );
}

const Op = ({ children }: { children: ReactNode }) => <span className="pb-0.5 text-base text-muted-foreground">{children}</span>;

const Fig = ({ k, v, bad }: { k: string; v: string; bad?: boolean }) => (
  <div>
    <dt className="text-xs text-muted-foreground">{k}</dt>
    <dd className={cn("font-semibold tabular-nums", bad && "text-destructive")}>{v}</dd>
  </div>
);
