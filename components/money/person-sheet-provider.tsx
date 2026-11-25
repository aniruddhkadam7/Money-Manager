"use client";

import { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { PersonSheet } from "./person-sheet";

interface PersonSheetApi {
  /** Shows the person's profile (photo, names, merging, what went between you, their entries) over the page. */
  openPerson: (personId: string) => void;
}

const OpenerContext = createContext<PersonSheetApi | null>(null);
const StateContext = createContext<{ openId: string | null; close: () => void } | null>(null);

/** Tap a person anywhere in the app → their profile. */
export function usePersonSheet(): PersonSheetApi {
  const ctx = useContext(OpenerContext);
  if (!ctx) throw new Error("usePersonSheet must be used within PersonSheetProvider");
  return ctx;
}

/**
 * Holds whose profile is open. Goes above the entry dialog's provider (an entry's details can open a person), while
 * `PersonSheetHost` goes inside it (the profile lists entries that open in the entry dialog).
 */
export function PersonSheetProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const close = useCallback(() => setOpenId(null), []);
  const api = useMemo(() => ({ openPerson: setOpenId }), []);
  const state = useMemo(() => ({ openId, close }), [openId, close]);
  return (
    <OpenerContext.Provider value={api}>
      <StateContext.Provider value={state}>{children}</StateContext.Provider>
    </OpenerContext.Provider>
  );
}

/** Shows the open profile; closes it when a link inside it (All entries…) goes to another page. */
export function PersonSheetHost() {
  return (
    <Suspense fallback={null}>
      <Host />
    </Suspense>
  );
}

function Host() {
  const state = useContext(StateContext);
  const address = usePathname() + "?" + useSearchParams().toString();
  const shownAt = useRef(address);
  const openId = state?.openId ?? null;
  const close = state?.close;

  useEffect(() => {
    if (openId) shownAt.current = address;
    // Only the opening matters here; the address is read as it is at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);
  useEffect(() => {
    if (openId && address !== shownAt.current) close?.();
  }, [address, openId, close]);

  if (!openId || !close) return null;
  return <PersonSheet key={openId} personId={openId} onClose={close} />;
}
