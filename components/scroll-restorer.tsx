"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { scrollPage } from "@/lib/utils";

const KEY = "money-manager:scroll";
/** How long to keep trying after going back: the dashboard's charts and cards draw in after the page itself. */
const RESTORE_FOR_MS = 2500;

/** How far down the page is: the window on desktop, the body on touch screens (the scroller there, see globals.css). */
const pageY = () => Math.max(window.scrollY, document.body.scrollTop);
const isPage = (t: EventTarget | null) => t === document || t === document.body || t === document.documentElement;
const here = () => location.pathname + location.search;

const load = (): Record<string, number> => {
  try {
    return JSON.parse(window.sessionStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
};
const store = (positions: Record<string, number>) => {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(positions));
  } catch {
    /* private mode: back still works, it just opens at the top */
  }
};

/*
 * Whether the latest change of address was a step forward (a link, router.push / replace) or a step back or forward
 * through history. Next changes the address with history.pushState / replaceState for the first kind (at the moment
 * it shows the new page), and the browser changes it itself for the second, so watching those two calls tells them
 * apart whatever order Next's handlers and these run in. A replaceState that keeps the address is Next tidying its
 * own state, and is ignored.
 */
let steppedForward = false;
/** While a page is changing, scroll events belong to neither page (the old one being cut short), so none are noted. */
let quietUntil = 0;
let patched = false;
function watchHistory() {
  if (patched) return;
  patched = true;
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method].bind(history);
    history[method] = (data: unknown, unused: string, url?: string | URL | null) => {
      if (url != null) {
        const next = new URL(url, location.href);
        if (next.pathname + next.search !== here()) {
          steppedForward = true;
          quietUntil = performance.now() + 400;
        }
      }
      return original(data, unused, url);
    };
  }
}

/**
 * Going back (the header's arrow, or the browser's / phone's) returns to where you were on that page, not its top.
 * Each address's position is noted as you scroll and as you tap (before a tap can navigate). On a step back, the page
 * is scrolled there again while its content draws in, until it's reached or you scroll yourself.
 */
export function ScrollRestorer() {
  const pathname = usePathname();
  const params = useSearchParams();
  const url = pathname + (params.toString() ? `?${params}` : "");

  useEffect(() => {
    watchHistory();
    const note = () => {
      if (performance.now() < quietUntil) return;
      const positions = load();
      positions[here()] = Math.round(pageY());
      store(positions);
    };
    // Scroll events don't bubble, so the body's (touch screens) is caught on the way down; other scrollers are ignored.
    let pending = 0;
    const onScroll = (e: Event) => {
      if (!isPage(e.target) || pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        note();
      });
    };
    const onTap = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Enter" && e.key !== " ") return;
      note();
    };
    // Back / forward: the address has already changed, and the old page's last scroll events must not be noted under it.
    const onPop = () => (quietUntil = performance.now() + 400);
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("pointerdown", onTap, { capture: true, passive: true });
    window.addEventListener("keydown", onTap, { capture: true, passive: true });
    window.addEventListener("popstate", onPop, { capture: true });
    return () => {
      cancelAnimationFrame(pending);
      document.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("pointerdown", onTap, { capture: true });
      window.removeEventListener("keydown", onTap, { capture: true });
      window.removeEventListener("popstate", onPop, { capture: true });
    };
  }, []);

  useEffect(() => {
    const forward = steppedForward;
    steppedForward = false;
    if (forward) return; // a new page opens at its top (Next does that)
    const target = load()[url];
    if (!target) return;

    // Keep scrolling to the spot while the page grows into it; the person scrolling or tapping takes over.
    quietUntil = performance.now() + RESTORE_FOR_MS;
    let frame = 0;
    let settled = 0;
    const until = performance.now() + RESTORE_FOR_MS;
    const inputs = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    const stop = () => {
      cancelAnimationFrame(frame);
      quietUntil = 0;
      for (const e of inputs) window.removeEventListener(e, stop, { capture: true });
    };
    for (const e of inputs) window.addEventListener(e, stop, { capture: true, passive: true });
    const step = () => {
      scrollPage({ top: target });
      // Reached, and still there a few frames later (nothing above it grew and pushed it down): done.
      settled = Math.abs(pageY() - target) < 2 ? settled + 1 : 0;
      if (settled >= 8 || performance.now() > until) return stop();
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return stop;
  }, [url]);

  return null;
}
