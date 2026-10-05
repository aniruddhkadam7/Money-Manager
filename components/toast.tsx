"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

interface ToastOptions {
  message: string;
  /** e.g. "Undo" */
  actionLabel?: string;
  onAction?: () => void;
  /** Milliseconds before it goes away. */
  duration?: number;
}

interface ToastApi {
  show: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

/** A single bottom-centre message with an optional action (used for "Undo"). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(ToastOptions & { id: number }) | null>(null);
  const counter = useRef(0);

  const show = useCallback((options: ToastOptions) => {
    counter.current += 1;
    setToast({ ...options, id: counter.current });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.duration ?? 7000);
    return () => clearTimeout(t);
  }, [toast]);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast && (
        <div
          key={toast.id}
          role="status"
          aria-live="polite"
          className="fade-up fixed inset-x-0 bottom-5 z-[70] mx-auto flex w-[calc(100%-2rem)] max-w-md items-center gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white shadow-2xl"
        >
          <span className="flex-1">{toast.message}</span>
          {toast.actionLabel && (
            <button
              type="button"
              className="rounded-lg px-2 py-1 font-semibold text-emerald-300 hover:bg-white/10"
              onClick={() => {
                toast.onAction?.();
                setToast(null);
              }}
            >
              {toast.actionLabel}
            </button>
          )}
          <button type="button" aria-label="Dismiss" className="rounded-md p-1 text-slate-400 hover:text-white" onClick={() => setToast(null)}>
            <X className="size-4" />
          </button>
        </div>
      )}
    </ToastContext.Provider>
  );
}
