import { cn } from "@/lib/utils";

/**
 * Friday's mark: a glassy sphere with pink, cyan, violet and mint lights swirling inside it, a pulsing core and a
 * sweeping shimmer; the orb breathes (the look lives in globals.css, .friday-orb). `active` speeds it all up while
 * Friday is answering.
 */
export function FridayOrb({ size = 28, active = false, className }: { size?: number; active?: boolean; className?: string }) {
  return (
    <span aria-hidden data-active={active} className={cn("friday-orb", className)} style={{ width: size, height: size, fontSize: size }}>
      <span className="o-swirl">
        <i className="o-a" />
        <i className="o-b" />
        <i className="o-c" />
        <i className="o-d" />
      </span>
      <i className="o-core" />
      <i className="o-sheen" />
    </span>
  );
}
