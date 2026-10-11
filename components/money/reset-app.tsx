"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
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

/** "Start over": wipes everything this app stored in the browser, after typing RESET. Opened from the profile's settings. */
export function ResetDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = async () => {
    setBusy(true);
    await resetEverything();
    window.location.href = "/";
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return;
        if (!o) setTyped(""); // a fresh start next time
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset the whole app?</DialogTitle>
          <DialogDescription>
            This can't be undone. Download a backup first.
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
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={reset} disabled={typed.trim().toUpperCase() !== WORD || busy} data-testid="confirm-reset">
            {busy ? "Resetting…" : "Delete everything"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
