"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export type SearchableOption = {
  value: string;
  label: string;
  /** Shown before the label, in the list and on the button. */
  icon?: React.ReactNode;
  /** Options with the same group are listed together under this heading. */
  group?: string;
  /** Extra words that should also find this option. */
  keywords?: string;
};

/**
 * A dropdown with a search box on top, for lists long enough that scrolling
 * through them is a chore (categories, accounts, people).
 *
 * The dropdown renders via a React portal to escape any CSS stacking context
 * (isolation, z-index, backdrop-filter) on ancestor elements.
 */
export function SearchableSelect({
  id,
  value,
  onValueChange,
  options,
  placeholder = "Search…",
  className,
}: {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const [anchor, setAnchor] = React.useState<DOMRect | null>(null);
  const [mounted, setMounted] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const dropdownRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const listId = React.useId();

  React.useEffect(() => { setMounted(true); }, []);

  const selected = options.find((o) => o.value === value);
  const q = query.trim().toLowerCase();
  const shown = q === "" ? options : options.filter((o) => `${o.label} ${o.group ?? ""} ${o.keywords ?? ""}`.toLowerCase().includes(q));

  const close = (refocus = true) => {
    setOpen(false);
    setQuery("");
    if (refocus) triggerRef.current?.focus();
  };
  const choose = (o: SearchableOption) => {
    onValueChange(o.value);
    close();
  };

  // Close when clicking outside both the trigger and the portal dropdown.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (dropdownRef.current?.contains(e.target as Node)) return;
      close(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Close (not refocus) on any scroll or resize so the popup doesn't drift from the trigger.
  React.useEffect(() => {
    if (!open) return;
    const dismiss = () => close(false);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);

  React.useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown[active]) choose(shown[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      close(false);
    }
  };

  const handleOpen = () => {
    if (open) return close();
    setAnchor(triggerRef.current?.getBoundingClientRect() ?? null);
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };

  // Desktop: fixed, anchored under the trigger. Mobile (< 640 px): centred panel near the top.
  const isMobile = mounted && typeof window !== "undefined" && window.innerWidth < 640;
  const dropdownStyle: React.CSSProperties | undefined =
    anchor && !isMobile
      ? { top: anchor.bottom + 4, left: anchor.left, width: Math.max(anchor.width, 224) }
      : undefined;

  const dropdownContent = open && (
    <div
      ref={dropdownRef}
      style={dropdownStyle}
      className={cn(
        "fixed z-[9999] overflow-hidden rounded-xl border glass-pop shadow-lg animate-in fade-in-0 zoom-in-95",
        !dropdownStyle && "inset-x-4 top-20 w-auto shadow-2xl",
      )}
    >
      <div className="relative border-b">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          autoFocus
          type="text"
          autoComplete="off"
          role="searchbox"
          aria-controls={listId}
          aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="h-11 w-full bg-transparent pl-9 pr-3 text-base outline-none placeholder:text-muted-foreground sm:h-10 sm:text-sm"
        />
      </div>
      <ul ref={listRef} id={listId} role="listbox" className="max-h-72 overflow-y-auto p-1">
        {shown.length === 0 && <li className="px-2.5 py-6 text-center text-sm text-muted-foreground">No matches</li>}
        {shown.map((o, i) => (
          <React.Fragment key={o.value}>
            {o.group && o.group !== shown[i - 1]?.group && (
              <li role="presentation" className="px-2.5 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {o.group}
              </li>
            )}
            <li
              id={`${listId}-${i}`}
              data-index={i}
              role="option"
              aria-selected={o.value === value}
              onPointerMove={() => setActive(i)}
              onClick={() => choose(o)}
              className={cn(
                "relative flex cursor-pointer select-none items-center gap-2 rounded-lg py-2 pl-2.5 pr-8 text-sm",
                i === active && "bg-muted",
              )}
            >
              {o.icon}
              <span className="truncate">{o.label}</span>
              {o.value === value && <Check className="absolute right-2 size-4" />}
            </li>
          </React.Fragment>
        ))}
      </ul>
    </div>
  );

  return (
    <div className={cn("relative min-w-0", className)}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={handleOpen}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 text-left text-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected?.icon}
          <span className="truncate">{selected?.label ?? ""}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </button>

      {mounted && createPortal(dropdownContent, document.body)}
    </div>
  );
}
