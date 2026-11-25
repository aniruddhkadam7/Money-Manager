"use client";

/**
 * Whether the page now showing was reached by a step back (or forward) through history: the header's arrow, the
 * browser's Back, a phone's swipe. The browser fires popstate for those; links (Next's router) change the address
 * with history.pushState / replaceState instead, which are watched here too. So "came back" holds from a Back until
 * the next link, however long the page takes to draw.
 * Loaded once for the whole app (the scroll restorer imports it), so it's listening before any page needs to know.
 */
const here = () => location.pathname + location.search;
/** The address a Back landed on; null once a link has been followed since. */
let backTo: string | null = null;

if (typeof window !== "undefined") {
  // The Navigation API's own event comes first of all (React draws the page it goes back to as soon as it hears it):
  // a traverse is a Back or Forward, anything else a link.
  const nav = (window as unknown as { navigation?: EventTarget }).navigation;
  nav?.addEventListener("navigate", (e) => {
    const { navigationType, destination } = e as unknown as { navigationType: string; destination: { url: string } };
    const to = new URL(destination.url);
    if (navigationType === "traverse") backTo = to.pathname + to.search;
    else if (to.pathname + to.search !== here()) backTo = null;
  });
  // Browsers without it (older Safari): popstate, capturing, so it's heard before Next's own listener.
  window.addEventListener("popstate", () => (backTo = here()), { capture: true });
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method].bind(history);
    history[method] = (data: unknown, unused: string, url?: string | URL | null) => {
      if (url != null) {
        const next = new URL(url, location.href);
        // Next tidying its own state keeps the address; only a real change of page counts.
        if (next.pathname + next.search !== here()) backTo = null;
      }
      return original(data, unused, url);
    };
  }
}

/** A Back that only closed a window on this page (see back-close): the page wasn't come back to. */
export function forgetBack() {
  backTo = null;
}

/** Whether the page now showing was reached by going back (and no link has been followed since). */
export function cameBack(): boolean {
  // No comparing with the address bar: React may draw the page before the address has changed.
  if (typeof window === "undefined") return false;
  // Without the Navigation API, React draws the page inside the browser's popstate, before any listener here hears it.
  if ((window as unknown as { event?: Event }).event?.type === "popstate") return true;
  return backTo !== null;
}
