"use client";

import { useEffect, useState } from "react";
import { CloudAlert, CloudCheck, Loader2, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cloudConfigured, supabase } from "@/lib/cloud/client";
import { onSyncStatus, stopSync, type SyncStatus } from "@/lib/cloud/sync";

const LABEL: Record<SyncStatus, string> = {
  idle: "Saved to cloud",
  saving: "Saving…",
  error: "Not saved to cloud yet: will retry",
};

/** Cloud save state and sign-out. Renders nothing when the app runs without Supabase. */
export function CloudStatus() {
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [busy, setBusy] = useState(false);

  useEffect(() => (cloudConfigured ? onSyncStatus(setStatus) : undefined), []);
  if (!cloudConfigured) return null;

  const signOut = async () => {
    setBusy(true);
    try {
      await stopSync();
    } catch {
      setBusy(false);
      window.alert("Some changes haven't reached the cloud yet, so signing out now would lose them. Check your connection and try again.");
      return;
    }
    await supabase()?.auth.signOut();
    window.location.href = "/";
  };

  const Icon = status === "saving" ? Loader2 : status === "error" ? CloudAlert : CloudCheck;
  return (
    <>
      <span title={LABEL[status]} aria-label={LABEL[status]} className={status === "error" ? "text-amber-600" : "text-muted-foreground"}>
        <Icon className={status === "saving" ? "size-4 animate-spin" : "size-4"} />
      </span>
      <Button variant="ghost" size="icon" onClick={signOut} disabled={busy} title="Sign out" aria-label="Sign out">
        <LogOut />
      </Button>
    </>
  );
}
