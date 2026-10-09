"use client";

import { useRef, useState, type DragEvent } from "react";
import { CheckCircle2, FileText, Loader2, LockKeyhole, ShieldCheck, Sparkles, TriangleAlert, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { STATEMENT_ACCOUNT_TYPES } from "@/lib/finance/types";
import { AUTO_ACCOUNT, type Progress, type Stage } from "@/lib/statements/pipeline";
import { useFinance } from "../finance-provider";
import { ACCEPTED_EXTENSIONS } from "@/lib/statements/tabular";
import { useStatements, type UploadResult } from "./statements-provider";

const STAGES: { stage: Stage; label: string }[] = [
  { stage: "reading", label: "Reading the file" },
  { stage: "ocr", label: "Reading scanned pages" },
  { stage: "parsing", label: "Finding transactions" },
  { stage: "checking", label: "Checking the totals" },
  { stage: "matching", label: "Looking for duplicates and existing entries" },
  { stage: "classifying", label: "Classifying" },
  { stage: "ai", label: "Asking AI about the unclear ones" },
];

export function UploadPanel({ onDone }: { onDone: (importId: string) => void }) {
  const { book } = useFinance();
  const statements = useStatements();
  const input = useRef<HTMLInputElement>(null);

  const accounts = book.accounts.filter((a) => STATEMENT_ACCOUNT_TYPES.includes(a.type));
  // The statement says which account it is; choosing one by hand is the exception.
  const [accountId, setAccountId] = useState(AUTO_ACCOUNT);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [useAi, setUseAi] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<Extract<UploadResult, { ok: false }> | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const busy = progress !== null;
  const needsPassword = result?.code === "password_required" || result?.code === "password_incorrect";
  const aiAvailable = statements.aiReady === true;

  const choose = (f: File | null | undefined) => {
    if (!f) return;
    setFile(f);
    setResult(null);
    setPassword("");
  };

  const start = async () => {
    if (!file || !accountId || busy) return;
    setResult(null);
    setProgress({ stage: "reading", fraction: 0, label: "Reading the file" });
    const res = await statements.upload({ file, accountId, password: password || undefined, useAi: useAi && aiAvailable, onProgress: setProgress });
    setProgress(null);
    if (res.ok) onDone(res.importId);
    else setResult(res);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    choose(e.dataTransfer.files?.[0]);
  };

  const t = statements.settings;
  const activeIndex = progress ? STAGES.findIndex((s) => s.stage === progress.stage) : -1;

  return (
    <Card className="grid gap-3 p-3 sm:gap-4 sm:p-5" data-testid="upload-panel">
        <div>
          <div
            role="button"
            tabIndex={0}
            onClick={() => !busy && input.current?.click()}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !busy && input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            aria-label="Choose a bank statement file"
            className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed px-4 py-3.5 transition-colors sm:min-h-28 sm:justify-center sm:py-6 ${dragging ? "border-primary bg-primary/5" : "border-input hover:bg-muted/50"} ${busy ? "pointer-events-none opacity-60" : ""}`}
          >
            {file ? (
              <>
                <FileText className="size-7 shrink-0 text-primary" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium" data-testid="chosen-file">{file.name}</div>
                  <div className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB · tap to change</div>
                </div>
              </>
            ) : (
              <>
                <Upload className="size-7 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    <span className="sm:hidden">Choose your bank statement</span>
                    <span className="max-sm:hidden">Drop your bank statement here, or click to choose</span>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    PDF, Excel, CSV or photo · <ShieldCheck className="size-3 shrink-0 text-primary" /> read on this device
                  </div>
                </div>
              </>
            )}
            <input ref={input} type="file" accept={ACCEPTED_EXTENSIONS} className="sr-only" data-testid="file-input" onChange={(e) => choose(e.target.files?.[0])} />
          </div>

          {needsPassword && (
            <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3" data-testid="password-prompt">
              <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
                <LockKeyhole className="size-4" /> {result?.code === "password_incorrect" ? "That password didn't work" : "This file is password-protected"}
              </div>
              <p className="mt-1 text-xs text-amber-900/80">Often your date of birth, customer ID or phone digits. It stays on this device.</p>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && start()} placeholder="PDF password" className="mt-2" aria-label="PDF password" autoFocus />
            </div>
          )}

          {result && !needsPassword && (
            <div className="mt-3 flex gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm" role="alert" data-testid="upload-error" data-code={result.code}>
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
              <div>
                <p>{result.message}</p>
                {result.code === "duplicate_file" && result.importId && (
                  <button className="mt-1 font-medium text-primary underline" onClick={() => onDone(result.importId!)}>
                    Open that import
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Select value={accountId} onValueChange={setAccountId} disabled={busy}>
          <SelectTrigger className="min-w-0 flex-1 basis-56" aria-label="Statement account" data-testid="account-select">
            <SelectValue placeholder="Choose an account" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTO_ACCOUNT}>Account: detect from the statement</SelectItem>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <label
          className="flex items-center gap-2 text-sm font-medium"
          title={aiAvailable ? "Only for lines the rules can't place. AI sees only masked descriptions." : undefined}
        >
          <Sparkles className="size-3.5 text-primary" /> AI for unclear lines
          <Switch checked={useAi && aiAvailable} onCheckedChange={setUseAi} disabled={!aiAvailable || busy} aria-label="Use AI" />
        </label>
        {statements.aiReady === false && <p className="w-full text-xs text-muted-foreground">AI isn&apos;t set up (needs OPENAI_API_KEY), so unclear lines go to review.</p>}
      </div>

      {showAdvanced && (
        <div className="space-y-2 rounded-xl border p-3 text-xs" data-testid="thresholds">
          <label className="flex items-center justify-between gap-3">
            Import without asking at or above
            <span className="flex items-center gap-1">
              <Input type="number" min={50} max={100} value={Math.round(t.autoThreshold * 100)} aria-label="Automatic threshold" className="h-8 w-16" onChange={(e) => statements.updateSettings({ autoThreshold: clamp(Number(e.target.value) / 100, Math.min(1, t.reviewThreshold + 0.01), 1) })} />%
            </span>
          </label>
          <label className="flex items-center justify-between gap-3">
            Import but flag at or above
            <span className="flex items-center gap-1">
              <Input type="number" min={0} max={99} value={Math.round(t.reviewThreshold * 100)} aria-label="Review threshold" className="h-8 w-16" onChange={(e) => statements.updateSettings({ reviewThreshold: clamp(Number(e.target.value) / 100, 0, t.autoThreshold - 0.01) })} />%
            </span>
          </label>
          <p className="text-muted-foreground">Below this, lines wait for you.</p>
        </div>
      )}

      {progress && (
        <div role="status" aria-live="polite" data-testid="progress">
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${Math.max(4, Math.round(progress.fraction * 100))}%` }} />
          </div>
          <ol className="mt-3 grid gap-1.5 sm:grid-cols-2">
            {STAGES.filter((s) => s.stage !== "ai" || (useAi && aiAvailable)).map((s, i) => {
              const state = i < activeIndex ? "done" : i === activeIndex ? "active" : "todo";
              return (
                <li key={s.stage} className={`flex items-center gap-2 text-sm ${state === "todo" ? "text-muted-foreground/60" : ""}`}>
                  {state === "done" ? <CheckCircle2 className="size-4 text-primary" /> : state === "active" ? <Loader2 className="size-4 animate-spin text-primary" /> : <span className="size-4 rounded-full border" />}
                  {state === "active" ? progress.label : s.label}
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <button className="text-xs font-medium text-muted-foreground underline-offset-2 hover:underline" onClick={() => setShowAdvanced((v) => !v)}>
          {showAdvanced ? "Hide" : "Confidence"} settings
        </button>
        <Button onClick={start} disabled={!file || !accountId || busy || (needsPassword && !password)} data-testid="start-import">
          {busy ? <Loader2 className="animate-spin" /> : <Upload />} {busy ? "Working…" : needsPassword ? "Unlock and read" : "Read statement"}
        </Button>
      </div>
    </Card>
  );
}

const clamp = (n: number, lo: number, hi: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo);
