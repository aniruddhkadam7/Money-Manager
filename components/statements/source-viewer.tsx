"use client";

import { useEffect, useRef, useState } from "react";
import { FileSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { hasStatementFile, isPdfBytes, loadStatementFile, saveStatementFile } from "@/lib/statements/files";
import { fileHash } from "@/lib/statements/fingerprint";
import { loadPdfjs } from "@/lib/statements/browser";
import type { PdfDocLike } from "@/lib/statements/pdf";
import type { StatementRow } from "@/lib/statements/types";
import { useStatements } from "./statements-provider";

const SCALE = 1.5;

/**
 * A button that opens the original statement page with the line highlighted. Statements uploaded before the
 * file was kept ask for the PDF once; it is checked against the import and then remembered.
 */
export function ViewInStatement({ row, className }: { row: StatementRow; className?: string }) {
  const statements = useStatements();
  const record = statements.imports.find((i) => i.id === row.importId);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let live = true;
    hasStatementFile(row.importId).then((ok) => live && setAvailable(ok));
    return () => {
      live = false;
    };
  }, [row.importId]);
  if (available === null) return null;

  const attach = async (file?: File) => {
    if (!file) return;
    const data = new Uint8Array(await file.arrayBuffer());
    if (!isPdfBytes(data)) return setProblem("That isn't a PDF.");
    if (record && fileHash(data) !== record.fileHash) return setProblem("That's a different file from the one you imported.");
    await saveStatementFile(row.importId, data);
    setProblem(null);
    setAvailable(true);
    setOpen(true);
  };

  return (
    <>
      <Button type="button" size="sm" variant="outline" className={className} onClick={() => (available ? setOpen(true) : input.current?.click())} data-testid="view-in-statement">
        <FileSearch /> {available ? "View in statement" : "Select PDF to view line"}
      </Button>
      <input ref={input} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => { void attach(e.target.files?.[0]); e.target.value = ""; }} />
      {problem && <span className="text-xs text-destructive">{problem}</span>}
      {open && <SourceDialog row={row} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Older imports don't record where a line sits; find it on the page by its reference or a distinctive word. */
function locate(items: Array<{ str?: string; transform?: number[] }>, row: StatementRow): number | undefined {
  const words = row.rawDescription.split(/[^A-Za-z0-9]+/).filter((w) => w.length >= 5).sort((a, b) => b.length - a.length);
  const needles = [row.referenceNumber, ...words].filter((n): n is string => !!n);
  for (const n of needles) {
    const hit = items.find((i) => i.str && i.transform && i.str.toLowerCase().includes(n.toLowerCase()));
    if (hit?.transform) return hit.transform[5];
  }
  return undefined;
}

function SourceDialog({ row, onClose }: { row: StatementRow; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<Uint8Array | null>(null);
  const [password, setPassword] = useState<string | undefined>();
  const [askPassword, setAskPassword] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [band, setBand] = useState<{ top: number; height: number } | null>(null);

  useEffect(() => {
    loadStatementFile(row.importId).then((d) => (d ? setData(d) : setError("The original file isn't stored in this browser.")));
  }, [row.importId]);

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    let doc: PdfDocLike | null = null;
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        doc = await pdfjs.getDocument({ data: new Uint8Array(data), password, isEvalSupported: false, useSystemFonts: true, verbosity: 0 }).promise;
        const page = await doc.getPage(Math.min(Math.max(1, row.sourcePage), doc.numPages));
        const viewport = page.getViewport({ scale: SCALE });
        const el = canvas.current;
        const ctx = el?.getContext("2d");
        if (cancelled || !el || !ctx) return;
        el.width = Math.ceil(viewport.width);
        el.height = Math.ceil(viewport.height);
        await page.render({ canvas: el, canvasContext: ctx, viewport }).promise;
        if (cancelled) return;
        const y = row.sourceY ?? locate((await page.getTextContent()).items, row);
        if (cancelled) return;
        if (y !== undefined) {
          const top = (page.view[3] - y) * SCALE;
          setBand({ top: Math.max(0, top - 16), height: 24 });
          requestAnimationFrame(() => scroller.current?.scrollTo({ top: Math.max(0, top - 160), behavior: "smooth" }));
        }
        setAskPassword(false);
      } catch (err) {
        const name = (err as { name?: string })?.name;
        if (name === "PasswordException") {
          setAskPassword(true);
          if (password !== undefined) setError("That password didn't work.");
        } else setError("The statement couldn't be opened.");
      }
    })();
    return () => {
      cancelled = true;
      void doc?.destroy?.();
    };
  }, [data, password, row.sourcePage, row.sourceY]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-4xl grid-rows-[auto_1fr] gap-3">
        <DialogHeader>
          <DialogTitle>
            Line {row.index + 1} · page {row.sourcePage}
          </DialogTitle>
        </DialogHeader>
        {error && !askPassword ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : askPassword ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              setPassword(typed);
            }}
          >
            <Input type="password" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Statement password" autoFocus className="h-9 max-w-xs" />
            <Button type="submit" size="sm">Open</Button>
            {error && <span className="text-xs text-destructive">{error}</span>}
          </form>
        ) : (
          <div ref={scroller} className="min-h-0 overflow-auto rounded-lg border bg-muted/30">
            <div className="relative mx-auto w-fit">
              <canvas ref={canvas} className="block max-w-none" />
              {band && <div className="pointer-events-none absolute inset-x-0 rounded border-2 border-amber-500 bg-amber-300/30" style={{ top: band.top, height: band.height }} data-testid="source-highlight" />}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
