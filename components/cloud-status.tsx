"use client";

import { useEffect, useState } from "react";
import { cloudConfigured } from "@/lib/cloud/client";
import { onSyncStatus, type SyncStatus } from "@/lib/cloud/sync";

export const SYNC_LABEL: Record<SyncStatus, string> = {
  idle: "Saved to cloud",
  saving: "Saving…",
  error: "Not saved to cloud yet: will retry",
};

export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>("idle");
  useEffect(() => (cloudConfigured ? onSyncStatus(setStatus) : undefined), []);
  return status;
}
