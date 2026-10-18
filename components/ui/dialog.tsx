"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

/** How far (px) or how fast (px/ms) a sheet has to be pulled down to close rather than spring back. */
const CLOSE_DISTANCE = 110;
const CLOSE_SPEED = 0.6;

/** Whether anything between `el` and the sheet is scrolled down, so the finger should scroll that back up first. */
function scrolledWithin(el: Element | null, sheet: HTMLElement) {
  for (let n = el; n && n !== sheet.parentElement; n = n.parentElement) if (n.scrollTop > 0) return true;
  return false;
}

/**
 * Phones: pull a sheet down with a finger to close it, as on iOS and Android. A pull only starts at the top of the
 * sheet's scroll; it moves the sheet with the finger, then closes past a distance or on a quick flick, and springs
 * back otherwise. It moves the sheet with `translate`, which adds to the `transform` the open/close animations use,
 * so closing slides on from wherever the finger let go.
 */
function useSwipeToClose(sheet: HTMLElement | null, close: () => void) {
  React.useEffect(() => {
    if (!sheet || !window.matchMedia("(max-width: 639.98px)").matches) return;
    let startX = 0;
    let startY = 0;
    let lastY = 0;
    let lastT = 0;
    let speed = 0;
    let dragging = false;
    let blocked = false;

    const move = (dy: number) => (sheet.style.translate = `0 ${dy}px`);
    const onStart = (e: TouchEvent) => {
      startX = e.touches[0].clientX;
      startY = lastY = e.touches[0].clientY;
      lastT = e.timeStamp;
      speed = 0;
      dragging = false;
      blocked = e.touches.length > 1 || scrolledWithin(e.target as Element, sheet);
      sheet.style.transition = "none";
    };
    const onMove = (e: TouchEvent) => {
      if (blocked) return;
      const y = e.touches[0].clientY;
      const dy = y - startY;
      if (!dragging) {
        const dx = Math.abs(e.touches[0].clientX - startX);
        if (Math.max(dx, Math.abs(dy)) < 6) return;
        // Up, sideways, or the sheet is scrolled: it's a scroll, so leave this touch alone.
        if (dy <= dx || sheet.scrollTop > 0) return void (blocked = true);
        dragging = true;
        startY = y;
      }
      e.preventDefault();
      speed = (y - lastY) / Math.max(1, e.timeStamp - lastT);
      lastY = y;
      lastT = e.timeStamp;
      move(Math.max(0, y - startY));
    };
    const onEnd = () => {
      if (!dragging) return;
      dragging = false;
      if (lastY - startY > CLOSE_DISTANCE || speed > CLOSE_SPEED) return close();
      sheet.style.transition = "translate 260ms cubic-bezier(0.32, 0.72, 0, 1)";
      move(0);
    };

    sheet.addEventListener("touchstart", onStart, { passive: true });
    sheet.addEventListener("touchmove", onMove, { passive: false });
    sheet.addEventListener("touchend", onEnd);
    sheet.addEventListener("touchcancel", onEnd);
    return () => {
      sheet.removeEventListener("touchstart", onStart);
      sheet.removeEventListener("touchmove", onMove);
      sheet.removeEventListener("touchend", onEnd);
      sheet.removeEventListener("touchcancel", onEnd);
    };
  }, [sheet, close]);
}

function DialogContent({
  className,
  children,
  ref,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  const [sheet, setSheet] = React.useState<HTMLDivElement | null>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  // Closes the way the ✕ does, so the dialog's own onOpenChange runs.
  const close = React.useCallback(() => closeRef.current?.click(), []);
  useSwipeToClose(sheet, close);
  const setRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      setSheet(node);
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          "fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          // Phones: no blur (redrawing it every frame of the fade stutters); sheet-dim fades it with the sheet (globals.css).
          "sheet-dim max-sm:backdrop-blur-none",
        )}
      />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-5 glass-pop rounded-2xl border p-6 shadow-xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          // Phones: a full-width sheet rising from the bottom, within thumb reach, scrolling when tall.
          "max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-0 max-sm:w-full max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:max-h-[92dvh] max-sm:overflow-y-auto max-sm:overscroll-contain max-sm:rounded-b-none max-sm:rounded-t-3xl max-sm:border-x-0 max-sm:border-b-0 max-sm:p-5 max-sm:pb-[calc(1.5rem+env(safe-area-inset-bottom))] max-sm:data-[state=open]:zoom-in-100 max-sm:data-[state=open]:slide-in-from-bottom max-sm:data-[state=closed]:zoom-out-100 max-sm:data-[state=closed]:slide-out-to-bottom",
          // sheet: the slide up and away on phones (globals.css). Solid, not frosted, there: a big blur sliding across the
          // screen can't keep up, and at 88% white it looked the same.
          "sheet max-sm:will-change-transform max-sm:bg-[var(--glass-solid)] max-sm:[-webkit-backdrop-filter:none] max-sm:[backdrop-filter:none]",
          className,
        )}
        {...props}
        ref={setRefs}
      >
        {/* Phones: the grab handle that says the sheet can be pulled down. */}
        <span aria-hidden className="pointer-events-none absolute left-1/2 top-2 h-1.5 w-10 -translate-x-1/2 rounded-full bg-slate-300 sm:hidden" />
        {children}
        <DialogPrimitive.Close
          ref={closeRef}
          className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Close"
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("grid gap-1.5", className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex justify-end gap-2", className)} {...props} />
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn("text-lg font-semibold", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
