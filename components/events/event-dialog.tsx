"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Copy, FileText, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDisplayDate } from "@/lib/domain/dates";
import { formatRupees } from "@/lib/finance/describe";
import { findSimilar } from "@/lib/finance/similar";
import type { EventType, FinancialEvent } from "@/lib/finance/types";
import { useFinance } from "../finance-provider";
import { PictureIcon } from "../picture-icon";
import { useToast } from "../toast";
import { EffectsPanel } from "./effects-panel";
import { EventForm, type FormPreset } from "./event-form";
import { EVENT_OPTIONS, eventOption } from "./event-meta";

interface EventDialogApi {
  /** Opens "What happened?". Pass a type to skip straight to its form. */
  openAdd: (type?: EventType, preset?: FormPreset) => void;
  /** Shows what an entry changed, with edit and delete. */
  openDetail: (eventId: string) => void;
  /** Opens the entry's form, ready to correct. */
  openEdit: (eventId: string) => void;
  /** A new entry pre-filled from an existing one (dated today). */
  openDuplicate: (eventId: string) => void;
  /** Asks before deleting, then offers Undo. */
  requestDelete: (eventId: string) => void;
}

const EventDialogContext = createContext<EventDialogApi | null>(null);

export function useEventDialog(): EventDialogApi {
  const ctx = useContext(EventDialogContext);
  if (!ctx) throw new Error("useEventDialog must be used within EventDialogProvider");
  return ctx;
}

type View =
  | { kind: "closed" }
  | { kind: "pick" }
  | { kind: "form"; type: EventType; editing?: FinancialEvent; template?: FinancialEvent; preset?: FormPreset; fromPicker: boolean }
  | { kind: "saved"; eventId: string }
  | { kind: "detail"; eventId: string }
  | { kind: "similar"; eventId: string }
  | { kind: "confirmDelete"; eventId: string };

/** Deletes an entry and offers Undo, which puts it back exactly as it was. */
function useDeleteWithUndo() {
  const { book, describer, deleteEvent, restoreEvent } = useFinance();
  const toast = useToast();
  return (eventId: string) => {
    const event = book.events.find((e) => e.id === eventId);
    if (!event) return { ok: false as const, message: "That entry no longer exists." };
    const title = describer.title(event);
    const result = deleteEvent(eventId);
    if (!result.ok) return { ok: false as const, message: result.issues[0]?.message ?? "That can't be deleted." };
    toast.show({
      message: `Deleted “${title}”`,
      actionLabel: "Undo",
      onAction: () => {
        const back = restoreEvent(event);
        if (!back.ok) toast.show({ message: back.issues[0]?.message ?? "Couldn't undo that.", duration: 5000 });
      },
      duration: 8000,
    });
    return { ok: true as const };
  };
}

export function EventDialogProvider({ children }: { children: ReactNode }) {
  const { book, getBook } = useFinance();
  const [view, setView] = useState<View>({ kind: "closed" });

  const openAdd = useCallback((type?: EventType, preset?: FormPreset) => {
    setView(type ? { kind: "form", type, preset, fromPicker: false } : { kind: "pick" });
  }, []);
  const openDetail = useCallback((eventId: string) => setView({ kind: "detail", eventId }), []);
  const openEdit = useCallback(
    (eventId: string) => {
      const event = book.events.find((e) => e.id === eventId);
      if (event) setView({ kind: "form", type: event.type, editing: event, fromPicker: false });
    },
    [book.events],
  );
  const openDuplicate = useCallback(
    (eventId: string) => {
      const event = book.events.find((e) => e.id === eventId);
      if (event) setView({ kind: "form", type: event.type, template: event, fromPicker: false });
    },
    [book.events],
  );
  const requestDelete = useCallback((eventId: string) => setView({ kind: "confirmDelete", eventId }), []);

  const api = useMemo(
    () => ({ openAdd, openDetail, openEdit, openDuplicate, requestDelete }),
    [openAdd, openDetail, openEdit, openDuplicate, requestDelete],
  );
  const close = () => setView({ kind: "closed" });

  return (
    <EventDialogContext.Provider value={api}>
      {children}
      <Dialog open={view.kind !== "closed"} onOpenChange={(open) => !open && close()}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          {view.kind === "pick" && <Picker onPick={(type) => setView({ kind: "form", type, fromPicker: true })} />}

          {view.kind === "form" && (
            <EventForm
              key={`${view.type}-${view.editing?.id ?? view.template?.id ?? "new"}`}
              type={view.type}
              editing={view.editing}
              template={view.template}
              preset={view.preset}
              onBack={view.fromPicker ? () => setView({ kind: "pick" }) : undefined}
              onChangeType={view.editing ? (t) => setView({ ...view, type: t }) : undefined}
              onSaved={(eventId, wasEdit) => {
                if (!wasEdit) return setView({ kind: "saved", eventId });
                // Other entries from the same merchant or person that now differ from this one: offer to match them.
                const edited = getBook().events.find((e) => e.id === eventId);
                const similar = edited ? findSimilar(getBook(), edited) : [];
                setView(similar.length > 0 ? { kind: "similar", eventId } : { kind: "detail", eventId });
              }}
            />
          )}

          {view.kind === "similar" && <SimilarPrompt eventId={view.eventId} onDone={() => setView({ kind: "detail", eventId: view.eventId })} />}

          {view.kind === "saved" && <Saved eventId={view.eventId} onDone={close} onAnother={() => setView({ kind: "pick" })} />}

          {view.kind === "detail" && (
            <Detail
              eventId={view.eventId}
              onClose={close}
              onEdit={(event) => setView({ kind: "form", type: event.type, editing: event, fromPicker: false })}
              onDuplicate={(event) => setView({ kind: "form", type: event.type, template: event, fromPicker: false })}
            />
          )}

          {view.kind === "confirmDelete" && <ConfirmDelete eventId={view.eventId} onClose={close} />}
        </DialogContent>
      </Dialog>
    </EventDialogContext.Provider>
  );
}

function Picker({ onPick }: { onPick: (type: EventType) => void }) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>What happened?</DialogTitle>
        <DialogDescription>Tell the app once. It updates everything else.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2 sm:grid-cols-2">
        {EVENT_OPTIONS.map((o) => (
          <button
            key={o.type}
            type="button"
            onClick={() => onPick(o.type)}
            className="flex items-start gap-3 rounded-xl border p-3 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          >
            <PictureIcon name={o.picture} className="mt-0.5 size-7" />
            <span>
              <span className="block text-sm font-medium">{o.label}</span>
              <span className="block text-xs text-muted-foreground">{o.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

function Saved({ eventId, onDone, onAnother }: { eventId: string; onDone: () => void; onAnother: () => void }) {
  const { book, describer } = useFinance();
  const event = book.events.find((e) => e.id === eventId);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Saved</DialogTitle>
        <DialogDescription>{event ? describer.title(event) : "Your entry was saved."}</DialogDescription>
      </DialogHeader>
      <EffectsPanel eventId={eventId} />
      <DialogFooter>
        <Button variant="ghost" onClick={onAnother}>
          Add another
        </Button>
        <Button onClick={onDone}>Done</Button>
      </DialogFooter>
    </>
  );
}

function ConfirmDelete({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const { book, describer } = useFinance();
  const deleteWithUndo = useDeleteWithUndo();
  const [error, setError] = useState<string | null>(null);
  const event = book.events.find((e) => e.id === eventId);

  if (!event) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Already gone</DialogTitle>
          <DialogDescription>This entry no longer exists.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Delete this entry?</DialogTitle>
        <DialogDescription>
          {describer.title(event)} · {formatDisplayDate(event.date)}. Its effects are reversed; you can undo right after.
        </DialogDescription>
      </DialogHeader>
      <EffectsPanel eventId={eventId} />
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          onClick={() => {
            const r = deleteWithUndo(eventId);
            if (r.ok) onClose();
            else setError(r.message);
          }}
        >
          <Trash2 /> Delete
        </Button>
      </DialogFooter>
    </>
  );
}

function Detail({
  eventId,
  onClose,
  onEdit,
  onDuplicate,
}: {
  eventId: string;
  onClose: () => void;
  onEdit: (event: FinancialEvent) => void;
  onDuplicate: (event: FinancialEvent) => void;
}) {
  const { book, describer } = useFinance();
  const deleteWithUndo = useDeleteWithUndo();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const event = book.events.find((e) => e.id === eventId);

  if (!event) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Entry removed</DialogTitle>
          <DialogDescription>This entry no longer exists.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </>
    );
  }

  const option = eventOption(event.type);

  function remove() {
    const r = deleteWithUndo(eventId);
    if (r.ok) onClose();
    else {
      setError(r.message);
      setConfirming(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-3">
          <PictureIcon name={option.picture} className="size-8" />
          <div className="min-w-0">
            <DialogTitle className="truncate">{describer.title(event)}</DialogTitle>
            <DialogDescription>
              {option.label} · {formatDisplayDate(event.date)}
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <p className="text-sm text-muted-foreground">{describer.subtitle(event)}</p>

      {event.sources?.map((s) => (
        <p key={s.rowId} className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm" data-testid="event-source">
          <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>
            {s.role === "created" ? "Imported from" : "Confirmed by"} bank statement{" "}
            <Link href={`/import?import=${s.importId}`} onClick={onClose} className="font-medium underline">
              {s.filename}
            </Link>
            , line {s.line}
          </span>
        </p>
      ))}

      <EffectsPanel eventId={eventId} />

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      {confirming ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm">
          <p className="font-medium text-red-900">Delete this entry?</p>
          <p className="mt-0.5 text-red-800">Everything it changed will be reversed automatically. You can undo it right after.</p>
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="destructive" onClick={remove}>
              Delete
            </Button>
          </div>
        </div>
      ) : (
        <DialogFooter className="flex-wrap">
          <Button variant="ghost" className="mr-auto text-destructive hover:text-destructive" onClick={() => setConfirming(true)}>
            <Trash2 /> Delete
          </Button>
          <Button variant="outline" onClick={() => onDuplicate(event)}>
            <Copy /> Duplicate
          </Button>
          <Button onClick={() => onEdit(event)}>
            <Pencil /> Edit
          </Button>
        </DialogFooter>
      )}
    </>
  );
}

/** After an edit: "these other entries look the same. Update them too?" */
function SimilarPrompt({ eventId, onDone }: { eventId: string; onDone: () => void }) {
  const f = useFinance();
  const toast = useToast();
  const edited = f.getBook().events.find((e) => e.id === eventId);
  const matches = useMemo(() => (edited ? findSimilar(f.getBook(), edited) : []), [edited, f]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(matches.map((m) => m.event.id)));
  const [error, setError] = useState<string | null>(null);

  if (!edited || matches.length === 0) return null; // nothing left to offer (the entries changed meanwhile)

  const label = (e: FinancialEvent) => `${eventOption(e.type).label}${"personId" in e ? ` · ${f.book.people.find((p) => p.id === e.personId)?.name ?? ""}` : ""}${"categoryId" in e ? ` · ${f.getCategory(e.categoryId).name}` : ""}`;
  const amount = (e: FinancialEvent) => ("amountMinor" in e ? e.amountMinor : 0);

  function apply() {
    let done = 0;
    const failed: string[] = [];
    for (const m of matches.filter((x) => picked.has(x.event.id))) {
      const r = f.updateEvent(m.event.id, m.draft);
      if (r.ok) done++;
      else failed.push(`${formatDisplayDate(m.event.date)}: ${r.issues[0]?.message ?? "couldn't change"}`);
    }
    if (failed.length) {
      setError(`${done} updated. ${failed.length} couldn't be changed — ${failed.join("; ")}`);
      return;
    }
    toast.show({ message: `Updated ${done} similar ${done === 1 ? "entry" : "entries"}` });
    onDone();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Update similar entries too?</DialogTitle>
        <DialogDescription>
          {matches.length} other {matches.length === 1 ? "entry looks" : "entries look"} like “{f.describer.title(edited)}” but {matches.length === 1 ? "is" : "are"} recorded differently. Make
          {matches.length === 1 ? " it" : " them"} <strong>{label(edited)}</strong> as well? Their amounts, dates and accounts stay as they are.
        </DialogDescription>
      </DialogHeader>

      <ul className="grid max-h-64 gap-1 overflow-y-auto" data-testid="similar-list">
        {matches.map((m) => (
          <li key={m.event.id}>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2 hover:bg-muted/50">
              <input
                type="checkbox"
                className="mt-1"
                checked={picked.has(m.event.id)}
                onChange={(e) => {
                  const next = new Set(picked);
                  if (e.target.checked) next.add(m.event.id);
                  else next.delete(m.event.id);
                  setPicked(next);
                }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{f.describer.title(m.event)}</span>
                <span className="block text-xs text-muted-foreground">
                  {formatDisplayDate(m.event.date)} · now {label(m.event)}
                </span>
              </span>
              <span className="text-sm font-semibold tabular-nums">{formatRupees(amount(m.event))}</span>
            </label>
          </li>
        ))}
      </ul>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

      <DialogFooter>
        <Button variant="ghost" onClick={onDone} data-testid="similar-skip">
          No, just this one
        </Button>
        <Button onClick={apply} disabled={picked.size === 0} data-testid="similar-apply">
          Update {picked.size} {picked.size === 1 ? "entry" : "entries"}
        </Button>
      </DialogFooter>
    </>
  );
}
