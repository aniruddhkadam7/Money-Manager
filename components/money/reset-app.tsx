"use client";

import { useState } from "react";
import { Download, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { exportBackup, resetEverything } from "@/lib/storage/reset";

const WORD = "RESET";

function downloadBackup() {
  const blob = new Blob([exportBackup()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `money-manager-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** "Start over": wipes everything this app stored in the browser, after typing RESET. */
export function ResetApp() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = async () => {
    setBusy(true);
    await resetEverything();
    window.location.href = "/";
  };

  return (
    <>
      <Card className="border-red-200" data-testid="reset-app">
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Start over</h2>
            <p className="text-sm text-muted-foreground">Remove all entries, accounts, people, categories, imported statements and learned rules from this browser.</p>
          </div>
          <Button variant="outline" className="border-red-300 text-destructive hover:bg-red-50 hover:text-destructive" onClick={() => { setTyped(""); setOpen(true); }}>
            <RotateCcw /> Reset app
          </Button>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset the whole app?</DialogTitle>
            <DialogDescription>
              Everything you've recorded or imported is deleted from this browser and can't be brought back. Download a backup first if you might want it later.
            </DialogDescription>
          </DialogHeader>

          <Button type="button" variant="outline" onClick={downloadBackup}>
            <Download /> Download a backup
          </Button>

          <div className="grid gap-1.5">
            <label htmlFor="reset-confirm" className="text-sm">
              Type <strong>{WORD}</strong> to confirm
            </label>
            <Input id="reset-confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" placeholder={WORD} />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={reset} disabled={typed.trim().toUpperCase() !== WORD || busy} data-testid="confirm-reset">
              {busy ? "Resetting…" : "Delete everything"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
