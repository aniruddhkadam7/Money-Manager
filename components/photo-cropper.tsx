"use client";

import { useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cropPhoto } from "@/lib/profile";

/** Side of the square the picture is framed in, in CSS px: fits a phone-width sheet. */
const FRAME = 260;
const MAX_ZOOM = 4;

/**
 * Lets the user place a freshly picked photo before it's saved: drag to move it, pinch / scroll / the slider
 * to zoom, and turn it a quarter at a time. The circle shows what the profile picture will be.
 */
export function PhotoCropper({ img, onSave, onCancel }: { img: HTMLImageElement; onSave: (photo: string) => void; onCancel: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);

  const w = img.naturalWidth;
  const h = img.naturalHeight;
  // Zoom 1 is the smallest the picture can be while still filling the frame.
  const scaleFor = (z: number) => (FRAME / Math.min(w, h)) * z;
  const scale = scaleFor(zoom);

  /** Keeps the picture covering the whole frame: no empty edge can be dragged into view. */
  const clamp = (p: { x: number; y: number }, z: number, r: number) => {
    const s = scaleFor(z);
    const [ew, eh] = r % 2 ? [h, w] : [w, h];
    const mx = Math.max(0, (ew * s - FRAME) / 2);
    const my = Math.max(0, (eh * s - FRAME) / 2);
    return { x: Math.min(mx, Math.max(-mx, p.x)), y: Math.min(my, Math.max(-my, p.y)) };
  };

  const zoomTo = (z: number) => {
    const next = Math.min(MAX_ZOOM, Math.max(1, z));
    setZoom(next);
    // Zooming keeps the same spot in the middle of the frame.
    setOffset((o) => clamp({ x: (o.x * next) / zoom, y: (o.y * next) / zoom }, next, rotation));
  };

  const rotate = () => {
    const next = (rotation + 1) % 4;
    setRotation(next);
    setOffset((o) => clamp({ x: -o.y, y: o.x }, zoom, next));
  };

  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) pinch.current = { distance: distance(), zoom };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      zoomTo((pinch.current.zoom * distance()) / pinch.current.distance);
    } else if (pointers.current.size === 1) {
      setOffset((o) => clamp({ x: o.x + e.clientX - prev.x, y: o.y + e.clientY - prev.y }, zoom, rotation));
    }
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  };
  const onWheel = (e: WheelEvent<HTMLDivElement>) => zoomTo(zoom * Math.exp(-e.deltaY / 500));

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Adjust photo</DialogTitle>
          <DialogDescription>Drag to move, pinch or use the slider to zoom.</DialogDescription>
        </DialogHeader>

        <div
          className="relative mx-auto cursor-grab touch-none select-none overflow-hidden rounded-xl bg-muted active:cursor-grabbing"
          style={{ width: FRAME, height: FRAME }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={img.src}
            alt=""
            draggable={false}
            className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
            style={{
              width: w,
              height: h,
              transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) rotate(${rotation * 90}deg) scale(${scale})`,
            }}
          />
          {/* Dims everything outside the circle the profile picture shows. */}
          <div className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgba(15,23,42,0.55)] ring-2 ring-white/80" />
        </div>

        <div className="flex items-center gap-3">
          <ZoomOut className="size-4 shrink-0 text-muted-foreground" />
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => zoomTo(Number(e.target.value))}
            aria-label="Zoom"
            className="h-2 flex-1 cursor-pointer accent-primary"
          />
          <ZoomIn className="size-4 shrink-0 text-muted-foreground" />
          <Button type="button" variant="outline" size="icon" onClick={rotate} title="Rotate" aria-label="Rotate">
            <RotateCw />
          </Button>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={() => onSave(cropPhoto(img, { frame: FRAME, x: offset.x, y: offset.y, scale, rotation }))}>
            Save photo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
