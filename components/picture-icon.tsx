import {
  ArrowLeftRight,
  BadgeIndianRupee,
  BadgePercent,
  Banknote,
  Briefcase,
  CalendarClock,
  Car,
  ChartColumn,
  Cigarette,
  Clapperboard,
  CreditCard,
  Fuel,
  Gift,
  HandCoins,
  HandHelping,
  HeartPulse,
  House,
  Landmark,
  Lightbulb,
  Percent,
  Plane,
  ReceiptIndianRupee,
  ReceiptText,
  RefreshCcw,
  Repeat,
  Shapes,
  ShoppingBag,
  ShoppingCart,
  Store,
  Tag,
  TrendingUp,
  Undo2,
  Users,
  UtensilsCrossed,
  Wallet,
  Wine,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** Every picture the app uses: a line icon and its own colour, shown on a soft tinted tile. */
const PICTURES = {
  // Spending categories
  food: { Icon: UtensilsCrossed, color: "#f97316" },
  grocery: { Icon: ShoppingCart, color: "#65a30d" },
  shopping: { Icon: ShoppingBag, color: "#ec4899" },
  transport: { Icon: Car, color: "#0ea5e9" },
  petrol: { Icon: Fuel, color: "#dc2626" },
  rent: { Icon: House, color: "#8b5cf6" },
  maintenance: { Icon: Wrench, color: "#0f766e" },
  bills: { Icon: ReceiptText, color: "#ca8a04" },
  emi: { Icon: CalendarClock, color: "#0891b2" },
  subscriptions: { Icon: Repeat, color: "#06b6d4" },
  entertainment: { Icon: Clapperboard, color: "#14b8a6" },
  health: { Icon: HeartPulse, color: "#e11d48" },
  travel: { Icon: Plane, color: "#6366f1" },
  alcohol: { Icon: Wine, color: "#b91c1c" },
  smoking: { Icon: Cigarette, color: "#78716c" },
  jugaad: { Icon: Lightbulb, color: "#a16207" },
  other: { Icon: Shapes, color: "#64748b" },
  custom: { Icon: Tag, color: "#64748b" },
  // Income categories
  income: { Icon: BadgeIndianRupee, color: "#059669" },
  salary: { Icon: Briefcase, color: "#059669" },
  business: { Icon: Store, color: "#0284c7" },
  interest: { Icon: Percent, color: "#7c3aed" },
  gift: { Icon: Gift, color: "#db2777" },
  refund: { Icon: Undo2, color: "#d97706" },
  reimbursement: { Icon: ReceiptIndianRupee, color: "#475569" },
  // Kinds of entry
  transfer: { Icon: ArrowLeftRight, color: "#0284c7" },
  lend: { Icon: HandCoins, color: "#d97706" },
  borrow: { Icon: HandHelping, color: "#7c3aed" },
  repay: { Icon: RefreshCcw, color: "#0d9488" },
  split: { Icon: Users, color: "#ea580c" },
  reimburse: { Icon: ReceiptIndianRupee, color: "#475569" },
  invest: { Icon: TrendingUp, color: "#4f46e5" },
  sell: { Icon: Banknote, color: "#059669" },
  valuation: { Icon: ChartColumn, color: "#9333ea" },
  // Accounts
  bank: { Icon: Landmark, color: "#0369a1" },
  cash: { Icon: Wallet, color: "#16a34a" },
  "credit-card": { Icon: CreditCard, color: "#4f46e5" },
  loan: { Icon: BadgePercent, color: "#dc2626" },
} satisfies Record<string, { Icon: LucideIcon; color: string }>;

export type PictureName = keyof typeof PICTURES;

export const isPictureName = (name: string | undefined): name is PictureName => !!name && name in PICTURES;

/** "#rrggbb" mixed toward white (amount > 0) or black (amount < 0), for the two ends of a gradient. */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  if (Number.isNaN(n)) return hex;
  const mix = (c: number) => Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount));
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Relative luminance 0 (black) … 1 (white). */
function luminance(hex: string): number {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  if (Number.isNaN(n)) return 0;
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** The colour, darkened just enough for a white glyph to stand out on it (3:1, the bar for icons). */
function deepEnough(hex: string): string {
  let c = hex;
  for (let i = 0; i < 8 && 1.05 / (luminance(c) + 0.05) < 3; i++) c = shade(c, -0.08);
  return c;
}

/**
 * App-style icon: a white glyph (lightly filled, so it reads as two-tone) on a vivid gradient squircle in the
 * picture's own colour, with a soft coloured shadow. `tile` is the large list size; otherwise a compact
 * badge (size it with `className`, e.g. "size-8").
 */
export function PictureIcon({
  name,
  color,
  tile = false,
  className,
}: {
  name: PictureName;
  /** Overrides the picture's own colour (a category's chosen colour, for instance). */
  color?: string;
  tile?: boolean;
  className?: string;
}) {
  const picture = PICTURES[name] ?? PICTURES.custom;
  const raw = color ?? picture.color;
  const tint = deepEnough(raw);
  const { Icon } = picture;
  return (
    <span
      aria-hidden
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden text-white",
        tile ? "size-11 rounded-[14px]" : "size-6 rounded-[8px]",
        className,
      )}
      style={{
        background: `linear-gradient(145deg, ${shade(tint, 0.28)} 0%, ${tint} 55%, ${shade(tint, -0.18)} 100%)`,
        boxShadow: tile ? `0 6px 14px -6px ${tint}99, inset 0 1px 0 #ffffff40` : `0 2px 6px -2px ${tint}80, inset 0 1px 0 #ffffff40`,
      }}
    >
      {/* Gloss across the top half, as on a phone's app icons. */}
      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
      <Icon className="relative size-[54%] drop-shadow-[0_1px_1px_rgba(0,0,0,0.18)]" strokeWidth={2.2} fill="rgba(255,255,255,0.22)" />
    </span>
  );
}
