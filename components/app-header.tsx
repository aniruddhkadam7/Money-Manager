"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CalendarDays, FileUp, LayoutDashboard, Plus, RefreshCw, Wallet } from "lucide-react";
import { flush } from "@/lib/cloud/sync";
import { Button } from "@/components/ui/button";
import { LiquidButton, LiquidGlass } from "@/components/ui/liquid-glass-button";
import { cn } from "@/lib/utils";
import { BackButton } from "./back-button";
import { ProfileMenu } from "./profile-menu";
import { useEventDialog } from "./events/event-dialog";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/activity", label: "Activity" },
  { href: "/calendar", label: "Calendar" },
  { href: "/money", label: "Money" },
];

/**
 * Tablet and up: a floating liquid glass bar with the pages, Import and Add; the current page is a glass tab.
 * Phones: a slim full-width top bar (no room to float), and a bottom tab bar (MobileNav) within thumb reach.
 */
export function AppHeader() {
  const pathname = usePathname();
  const { openAdd } = useEventDialog();

  return (
    <>
      <header className="glass-bar sticky top-0 z-40 border-b pt-[env(safe-area-inset-top)] shadow-sm sm:border-0 sm:bg-transparent sm:px-4 sm:pt-3 sm:shadow-none sm:[-webkit-backdrop-filter:none] sm:[backdrop-filter:none] lg:px-6">
        {/* The liquid layers distort what scrolls behind the bar, so the bar itself has no blur of its own (it would hide the effect). */}
        <LiquidGlass
          layersClassName="max-sm:hidden"
          className="mx-auto flex max-w-[2000px] items-center justify-between gap-x-3 px-4 py-2 lg:gap-x-6 sm:rounded-full sm:bg-card/75 sm:py-1.5 sm:pl-3 sm:pr-2 sm:shadow-lg sm:shadow-slate-900/10"
        >
          <div className="flex min-w-0 items-center gap-1 sm:shrink-0">
            <Suspense fallback={null}>
              <BackButton />
            </Suspense>
            <Link href="/" className="flex min-w-0 items-center gap-2 font-semibold">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground sm:rounded-full">
                <Wallet className="size-4" />
              </span>
              {/* Phones sideways and small tablets: the pages and buttons need the room, so the logo stands alone and the bar is tighter. */}
              <span className="truncate font-brand text-xl font-bold leading-none tracking-tight sm:max-lg:sr-only">Money Manager</span>
            </Link>
          </div>

          <nav className="hidden flex-1 items-center gap-1 sm:flex">
            {NAV.map(({ href, label }) =>
              pathname === href ? (
                <LiquidButton key={href} asChild size="sm" className="rounded-full px-2.5 text-sm font-semibold text-foreground lg:px-4">
                  <Link href={href} aria-current="page">
                    {label}
                  </Link>
                </LiquidButton>
              ) : (
                <Link key={href} href={href} className="flex h-8 items-center rounded-full px-2.5 text-sm font-medium text-muted-foreground transition-colors lg:px-4 hover:text-foreground">
                  {label}
                </Link>
              ),
            )}
          </nav>

          <div className="flex items-center gap-2">
            <LiquidButton asChild size="default" className="hidden rounded-full text-foreground sm:inline-flex" data-testid="import-statement">
              <Link href="/import" title="Import statement">
                <FileUp /> <span className="max-md:sr-only">Import</span> <span className="-ml-1 max-lg:hidden">statement</span>
              </Link>
            </LiquidButton>
            <LiquidButton size="default" className="hidden rounded-full font-semibold sm:inline-flex" onClick={() => openAdd()}>
              <Plus /> Add
            </LiquidButton>
            <RefreshButton />
            <ProfileMenu />
          </div>
        </LiquidGlass>
      </header>
      <MobileNav pathname={pathname} onAdd={() => openAdd()} />
    </>
  );
}

const TABS = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  // Activity opens on its calendar; the list is its other view (Calendar / Statement), so the tab stays lit on it too.
  { href: "/calendar", label: "Calendar", icon: CalendarDays, also: "/activity" },
  { href: "/money", label: "Money", icon: Wallet },
  { href: "/import", label: "Import", icon: FileUp },
];

/** Past the top of the page, scrolling down shrinks the bar (as Instagram does); scrolling up or reaching the top brings it back. */
function useCompactOnScroll(pathname: string) {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    setCompact(false);
    // Phones scroll the body (see globals.css), other screens the window; inner scrollers (the account cards) are ignored.
    let last = -1;
    let travel = 0;
    const onScroll = (e: Event) => {
      const el = e.target === document ? document.scrollingElement : e.target;
      if (el !== document.body && el !== document.scrollingElement) return;
      const top = (el as Element).scrollTop;
      if (last < 0) last = top;
      const delta = top - last;
      last = top;
      if (top < 40) {
        travel = 0;
        setCompact(false);
        return;
      }
      // Small wobbles (a finger resting, iOS bounce) don't flip it: it takes a short run in one direction.
      travel = Math.sign(delta) === Math.sign(travel) ? travel + delta : delta;
      if (travel > 12) setCompact(true);
      else if (travel < -12) setCompact(false);
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", onScroll, { capture: true });
  }, [pathname]);
  return compact;
}

/** An iOS-like glide: quick to start, long soft settle. */
const EASE = "duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none";

/** The bar's five places, left to right: two tabs, the + button, two tabs. */
const SLOTS = [TABS[0], TABS[1], null, TABS[2], TABS[3]] as const;
const GLIDE = "cubic-bezier(0.32, 0.72, 0, 1)";

/**
 * The iPhone (and Instagram) tab bar: a highlight sits behind the current tab and glides to a newly tapped one. Hold
 * anywhere on the bar and slide: the highlight swells and follows the finger, the tab under it lights up, and letting
 * go opens that tab. Only transform-like properties move, so it stays smooth.
 */
function MobileNav({ pathname, onAdd }: { pathname: string; onAdd: () => void }) {
  const router = useRouter();
  const compact = useCompactOnScroll(pathname);
  const barRef = useRef<HTMLDivElement>(null);
  const slotRefs = useRef<(HTMLElement | null)[]>([]);
  const lensRef = useRef<HTMLSpanElement>(null);
  const drag = useRef<{ id: number; startX: number; on: boolean } | null>(null);
  const swallowClick = useRef(false);
  // A tab let go of (or tapped) shows as current straight away, before its page has loaded.
  const [pending, setPending] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [under, setUnder] = useState<number | null>(null);

  useEffect(() => setPending(null), [pathname]);

  const current = SLOTS.findIndex((t) => t && (pending ? t.href === pending : pathname === t.href || pathname === t.also));

  /** Puts the highlight at x (bar coordinates, unscaled); following the finger it moves at once, otherwise it glides. */
  const place = useCallback((x: number, width: number, follow: boolean) => {
    const lens = lensRef.current;
    if (!lens) return;
    lens.style.transition = follow
      ? `scale 250ms ${GLIDE}, opacity 200ms ease-out`
      : `translate 450ms ${GLIDE}, width 450ms ${GLIDE}, scale 350ms ${GLIDE}, opacity 200ms ease-out`;
    lens.style.translate = `${x}px 0`;
    lens.style.width = `${width}px`;
  }, []);

  const placeAt = useCallback(
    (slot: number) => {
      const el = slotRefs.current[slot];
      if (el) place(el.offsetLeft + 4, el.offsetWidth - 8, false);
    },
    [place],
  );

  // To the current tab: on load (without gliding in from the edge), when the page changes, and when the screen turns.
  useLayoutEffect(() => {
    if (current < 0) return;
    const lens = lensRef.current;
    const first = !!lens && !lens.style.translate;
    placeAt(current);
    if (first) lens.style.transition = "none";
  }, [current, placeAt]);
  useEffect(() => {
    const onResize = () => current >= 0 && placeAt(current);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [current, placeAt]);

  /** The finger's x in the bar's own (unscaled) coordinates: the bar may be shrunk by a transform. */
  const localX = (clientX: number) => {
    const bar = barRef.current!;
    const r = bar.getBoundingClientRect();
    return ((clientX - r.left) * bar.offsetWidth) / r.width;
  };
  const slotAt = (x: number) => slotRefs.current.findIndex((el) => el && x >= el.offsetLeft && x < el.offsetLeft + el.offsetWidth);
  /** The nearest tab to x (the + isn't a tab: letting go over it picks the closer neighbour). */
  const nearestTab = (x: number) => {
    let best = -1;
    let gap = Infinity;
    slotRefs.current.forEach((el, i) => {
      if (!el || !SLOTS[i]) return;
      const d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - x);
      if (d < gap) [best, gap] = [i, d];
    });
    return best;
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag.current = { id: e.pointerId, startX: e.clientX, on: false };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.on) {
      if (Math.abs(e.clientX - d.startX) < 8) return;
      d.on = true;
      setDragging(true);
    }
    const x = localX(e.clientX);
    const el = slotRefs.current[current >= 0 ? current : 0];
    const width = el ? el.offsetWidth - 8 : 64;
    const bar = barRef.current!;
    place(Math.min(Math.max(x - width / 2, 4), bar.offsetWidth - width - 4), width, true);
    const slot = slotAt(x);
    setUnder(slot >= 0 && SLOTS[slot] ? slot : null);
  };
  const onPointerEnd = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.on) return;
    setDragging(false);
    setUnder(null);
    // The click that follows a slide isn't a tap on whatever the finger ended over.
    swallowClick.current = true;
    setTimeout(() => (swallowClick.current = false), 400);
    const slot = e.type === "pointercancel" ? current : nearestTab(localX(e.clientX));
    const target = SLOTS[slot];
    if (slot >= 0) placeAt(slot);
    if (target && slot !== current) {
      setPending(target.href);
      router.push(target.href);
    }
  };

  const tab = (t: (typeof TABS)[number], slot: number) => {
    const { href, label, icon: Icon } = t;
    const lit = dragging ? under === slot : slot === current;
    return (
      <Link
        key={href}
        ref={(el) => void (slotRefs.current[slot] = el)}
        href={href}
        draggable={false}
        aria-current={slot === current ? "page" : undefined}
        onClick={() => slot !== current && setPending(href)}
        className={cn(
          // Positioned above the glass layers (they're positioned too, so they'd otherwise paint over the tabs, as Safari does).
          // No iOS link preview on a long press: holding is how a slide starts.
          "relative z-10 flex min-w-0 flex-1 select-none items-center justify-center text-[11px] font-medium transition-colors duration-200 [-webkit-touch-callout:none]",
          lit ? "text-primary" : "text-muted-foreground",
        )}
      >
        {/* Shrunk, the name fades and the icon slides down to the middle (a transform, so it stays smooth). */}
        <span
          className={cn(
            "flex flex-col items-center gap-0.5 px-2 py-1.5 transition-transform will-change-transform",
            EASE,
            compact && "translate-y-2",
            lit && "font-semibold",
          )}
        >
          <Icon className="size-5" strokeWidth={lit ? 2.4 : 2} />
          <span className={cn("leading-tight transition-opacity duration-200 ease-out motion-reduce:transition-none", compact && "opacity-0")}>
            {label}
          </span>
        </span>
      </Link>
    );
  };

  return (
    // A floating liquid glass pill (like the header from tablet width up). A light blur sits in its own layer behind the glass:
    // on the bar itself it would hide the glass distortion (which iPhones don't draw, so there the blur is what frosts it).
    // It dips 1rem into the home-indicator area (34pt on iPhones as a home-screen app) so it doesn't float high above it.
    <nav aria-label="Main" className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(0.5rem,calc(env(safe-area-inset-bottom)_-_1rem))] sm:hidden">
      {/* touch-none: a drag on the bar slides between tabs instead of moving the page (taps still work). */}
      {/* Shrunk while scrolling down, icons only. Only transform and opacity animate: the phone's graphics chip runs them
          on its own, where changing the size would redo the layout (and the blur) every frame and stutter. */}
      <LiquidGlass
        ref={barRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={(e) => {
          if (!swallowClick.current) return;
          swallowClick.current = false;
          e.preventDefault();
          e.stopPropagation();
        }}
        className={cn(
          "pointer-events-auto mx-auto flex h-16 max-w-[32rem] origin-bottom touch-none select-none items-stretch rounded-full bg-slate-200/75 px-1 dark:bg-card/75 shadow-lg shadow-slate-900/15",
          "transition-transform will-change-transform",
          EASE,
          compact && "scale-[0.86]",
        )}
      >
        <span aria-hidden className="pointer-events-none absolute inset-0 -z-20 rounded-[inherit] [-webkit-backdrop-filter:blur(6px)] [backdrop-filter:blur(6px)]" />
        {/* The highlight behind the current tab; held and slid, it swells a little and follows the finger. */}
        <span
          ref={lensRef}
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-y-1.5 left-0 z-[5] rounded-full shadow-sm shadow-slate-900/10 will-change-[translate] dark:bg-white/10",
            dragging ? "scale-[1.12] bg-white/60" : "scale-100 bg-white/85",
            current < 0 && !dragging && "opacity-0",
          )}
        />
        {tab(TABS[0], 0)}
        {tab(TABS[1], 1)}
        <div ref={(el) => void (slotRefs.current[2] = el)} className="flex flex-1 items-center justify-center">
          {/* White liquid glass, a shade lighter than the bar, centred in it; the green + marks the main action. */}
          <LiquidButton
            size="icon"
            onClick={onAdd}
            aria-label="Add an entry"
            className="z-20 size-12 rounded-full bg-card/85 text-primary shadow-lg shadow-slate-900/15 hover:scale-100 active:scale-95"
          >
            <Plus className="size-7" strokeWidth={2.6} />
          </LiquidButton>
        </div>
        {tab(TABS[2], 3)}
        {tab(TABS[3], 4)}
      </LiquidGlass>
    </nav>
  );
}

/**
 * Phones have no reload button in a home-screen app, and pull-to-refresh is easy to miss: this saves anything
 * waiting to upload, then reloads so the latest data (from other devices too) is shown.
 */
function RefreshButton() {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="sm:hidden"
      aria-label="Refresh"
      title="Refresh"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await flush().catch(() => undefined);
        window.location.reload();
      }}
    >
      <RefreshCw className={cn(busy && "animate-spin")} />
    </Button>
  );
}
