"use client";

import { useCallback, useEffect, useRef } from "react";
import { forgetBack } from "./back-navigation";

/**
 * Back closes what's open, one layer at a time (a sheet, then the photo over it…), before it leaves the page, as on
 * any phone app. Each open window adds a history step at the same address (Next keeps its own state on it); Back
 * pops that step and closes the top window. Closing a window another way (✕, a swipe, a button) takes its step out
 * again, so Back never has to be pressed twice for nothing.
 */
interface Layer {
  id: string;
  close: () => void;
}

const stack: Layer[] = [];
/** Steps being taken out after windows closed some other way: their popstate isn't a Back to act on. */
let ignorePops = 0;
/** Windows closed this tick whose steps are still in history; taken out together, so none is left behind. */
let closing: string[] = [];
let closingTimer = 0;
let listening = false;

const stepId = (): string | undefined => (history.state as { __layer?: string } | null)?.__layer;

function onPop() {
  if (ignorePops > 0) {
    ignorePops--;
    forgetBack();
    return;
  }
  const top = stack.pop();
  if (!top) return; // nothing open: an ordinary Back to the previous page
  // Still this page: it shouldn't count as having come back to it.
  forgetBack();
  top.close();
}

function takeOutClosedSteps() {
  closingTimer = 0;
  const ids = closing;
  closing = [];
  const current = stepId();
  // Only when the top step is one of theirs: if a link has moved on to another page, the steps stay (Back from there
  // lands on this page, unchanged).
  if (!current || !ids.includes(current)) return;
  ignorePops++;
  history.go(-ids.length);
}

/**
 * While mounted (a window is open), Back calls `close` instead of leaving the page. Returns `release`, to call as soon
 * as the window starts closing some other way (before its closing animation ends and it unmounts).
 */
export function useBackToClose(close: () => void): () => void {
  const closeRef = useRef(close);
  closeRef.current = close;
  const releaseRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!listening) {
      listening = true;
      // Capturing, so this runs before Next's own listener.
      window.addEventListener("popstate", onPop, { capture: true });
    }
    const id = Math.random().toString(36).slice(2);
    const reuse = closing.length > 0 && closing.includes(stepId() ?? "");
    if (reuse) {
      // One window swapped for another in the same tick (a dialog replaced by the next): it takes over that step.
      closing = closing.filter((x) => x !== stepId());
      history.replaceState({ ...(history.state as object), __layer: id }, "");
    } else {
      history.pushState({ __layer: id }, "");
    }
    stack.push({ id, close: () => closeRef.current() });

    const release = () => {
      const i = stack.findIndex((l) => l.id === id);
      if (i < 0) return; // closed by Back (its step is already gone), or released already
      stack.splice(i, 1);
      closing.push(id);
      if (!closingTimer) closingTimer = window.setTimeout(takeOutClosedSteps, 0);
    };
    releaseRef.current = release;
    return release;
  }, []);

  return useCallback(() => releaseRef.current(), []);
}
