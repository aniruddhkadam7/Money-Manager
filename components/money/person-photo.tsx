"use client";

import { useRef, useState, type ReactNode } from "react";
import { Camera, Crop, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { loadPhoto } from "@/lib/profile";
import { PERSON_PHOTO_SIZE, setPersonPhoto, usePersonPhoto } from "@/lib/people-photos";
import { cn } from "@/lib/utils";
import { PartyLogo } from "../brand-logo";
import { PhotoCropper } from "../photo-cropper";

/**
 * A person's picture when one was added for them, else what `PartyLogo` shows (a company's logo, or `fallback`).
 * `className` sizes the picture (default size-9).
 */
export function PersonAvatar({
  person,
  className,
  logoClassName,
  fallback,
}: {
  person: { id: string; name: string };
  className?: string;
  /** Classes for the logo tile when there's no picture. */
  logoClassName?: string;
  fallback: ReactNode;
}) {
  const photo = usePersonPhoto(person.id);
  if (photo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photo} alt={person.name} className={cn("size-9 shrink-0 rounded-full object-cover", className)} />;
  }
  return <PartyLogo name={person.name} className={logoClassName} fallback={fallback} />;
}

/** The person's picture as a button: tapping it shows it large, with add / change / delete underneath. */
export function PersonPhotoButton({
  person,
  fallback,
  className,
  logoClassName,
}: {
  person: { id: string; name: string };
  fallback: ReactNode;
  /** Sizes the picture (default size-9). */
  className?: string;
  logoClassName?: string;
}) {
  const photo = usePersonPhoto(person.id);
  const input = useRef<HTMLInputElement>(null);
  const [viewing, setViewing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  // The picked picture, while it's placed in the frame.
  const [picked, setPicked] = useState<{ img: HTMLImageElement; url: string } | null>(null);
  const initial = person.name.charAt(0).toUpperCase();

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      setPicked(await loadPhoto(file));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Couldn't use that picture.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  /** Re-frames the saved picture: move, zoom or turn it without picking it again. */
  const adjust = async (current: string) => {
    const img = new Image();
    img.src = current;
    try {
      await img.decode();
      setPicked({ img, url: "" });
    } catch {
      window.alert("Couldn't open that picture to adjust it.");
    }
  };
  const done = () => {
    if (picked?.url) URL.revokeObjectURL(picked.url);
    setPicked(null);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setViewing(true)}
        title={photo ? `${person.name}'s photo` : `Add a photo of ${person.name}`}
        aria-label={photo ? `Open ${person.name}'s photo` : `Add a photo of ${person.name}`}
        className="group relative shrink-0 rounded-full transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <PersonAvatar person={person} className={className} logoClassName={logoClassName} fallback={fallback} />
        <span className="absolute bottom-0 right-0 grid size-7 place-items-center rounded-full border-2 border-white bg-slate-700 text-white [&_svg]:size-3.5">
          <Camera />
        </span>
      </button>

      <Dialog
        open={viewing}
        onOpenChange={(open) => {
          setViewing(open);
          setConfirmDelete(false);
        }}
      >
        <DialogContent className="palette-fixed border-slate-800 bg-slate-950 text-white sm:max-w-md [&>button:last-child]:text-slate-400 [&>button:last-child]:hover:bg-slate-800 [&>button:last-child]:hover:text-white">
          <DialogTitle className="truncate text-base">{person.name}</DialogTitle>
          <div className="flex justify-center py-2">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo} alt={person.name} className="size-56 rounded-full object-cover sm:size-64" />
            ) : (
              <span className="grid size-56 place-items-center rounded-full bg-slate-800 text-6xl font-semibold text-slate-300 sm:size-64">{initial}</span>
            )}
          </div>
          {confirmDelete ? (
            <div className="grid gap-3 border-t border-slate-800 pt-4">
              <p className="text-center text-sm text-slate-300">Delete {person.name}&apos;s photo? Their initial will show instead.</p>
              <div className="flex justify-center gap-2">
                <Button variant="ghost" className="text-slate-300 hover:bg-slate-800 hover:text-white" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    setPersonPhoto(person.id, undefined);
                    setConfirmDelete(false);
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex justify-around border-t border-slate-800 pt-3">
              <PhotoAction icon={busy ? <Loader2 className="animate-spin" /> : <Camera />} label={photo ? "Change photo" : "Add photo"} onClick={() => input.current?.click()} disabled={busy} />
              {photo && <PhotoAction icon={<Crop />} label="Adjust" onClick={() => void adjust(photo)} disabled={busy} />}
              {photo && <PhotoAction icon={<Trash2 />} label="Delete" onClick={() => setConfirmDelete(true)} />}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      {picked && (
        <PhotoCropper
          img={picked.img}
          size={PERSON_PHOTO_SIZE}
          onCancel={done}
          onSave={(next) => {
            setPersonPhoto(person.id, next);
            done();
          }}
        />
      )}
    </>
  );
}

function PhotoAction({ icon, label, onClick, disabled }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-1 rounded-lg px-4 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white disabled:opacity-50 [&_svg]:size-5"
    >
      {icon}
      {label}
    </button>
  );
}
