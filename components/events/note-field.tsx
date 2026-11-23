"use client";

import { Label } from "@/components/ui/label";

export const NOTE_MAX = 300;

/**
 * Any entry's optional reason, in your own words ("Mom's birthday gift", "booked for the Goa trip"). Saved as the
 * entry's `note`: shown under it in lists and in its details, and found by Activity search.
 */
export function NoteField({ id = "note", value, onChange }: { id?: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>
        Reason <span className="font-normal text-muted-foreground">(optional)</span>
      </Label>
      <textarea
        id={id}
        rows={2}
        maxLength={NOTE_MAX}
        placeholder="Why this? e.g. Mom's birthday gift"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // Matches Input: 16px text on phones so iOS Safari doesn't zoom in on focus.
        className="min-h-16 w-full min-w-0 resize-y rounded-lg border border-input bg-card px-3 py-2 text-base outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
      />
    </div>
  );
}

/** The note to save: trimmed, or left off entirely when blank. */
export const noteOf = (v: string) => (v.trim() ? { note: v.trim() } : {});
