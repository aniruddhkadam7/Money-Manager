import { useSyncExternalStore } from "react";

/**
 * Whether this device sends bill notifications. Permission to notify is per browser, so this is kept on the
 * device (like privacy mode), not synced; so is the note of which stage of each bill was already notified.
 */
const ON_KEY = "money-manager:reminders-on";
const SENT_KEY = "money-manager:reminders-sent";
const listeners = new Set<() => void>();

export function remindersOn(): boolean {
  try {
    return window.localStorage.getItem(ON_KEY) === "1";
  } catch {
    return false;
  }
}

function setOn(on: boolean) {
  try {
    window.localStorage.setItem(ON_KEY, on ? "1" : "0");
  } catch {
    // Kept for this visit only.
  }
  for (const l of listeners) l();
}

export function useRemindersOn(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    remindersOn,
    () => false,
  );
}

export type EnableResult = "on" | "denied" | "unsupported";

/** Asks the browser for permission, sets up the notifier, and turns reminders on. */
export async function enableReminders(): Promise<EnableResult> {
  if (typeof Notification === "undefined" || !("serviceWorker" in navigator)) return "unsupported";
  const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
  if (permission !== "granted") return "denied";
  await navigator.serviceWorker.register("/sw.js");
  setOn(true);
  return "on";
}

export function disableReminders() {
  setOn(false);
}

/** The stage already notified for each bill, by reminder id. */
export function readSent(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(SENT_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export function writeSent(sent: Record<string, number>) {
  try {
    window.localStorage.setItem(SENT_KEY, JSON.stringify(sent));
  } catch {
    // Worst case a bill is notified again on the next visit.
  }
}
