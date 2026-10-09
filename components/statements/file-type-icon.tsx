import { cn } from "@/lib/utils";

/** Label and colour for each kind of statement file the importer accepts. */
const KINDS: { test: RegExp; label: string; color: string }[] = [
  { test: /\.pdf$/i, label: "PDF", color: "#e5252a" },
  { test: /\.(xlsx|xls|xlsm)$/i, label: "XLS", color: "#1d7a45" },
  { test: /\.(csv|tsv)$/i, label: "CSV", color: "#1d7a45" },
  { test: /\.(png|jpe?g|webp)$/i, label: "IMG", color: "#7c3aed" },
];

/** A document icon with its file type on a coloured label, like a file manager shows: red PDF, green XLS, … */
export function FileTypeIcon({ filename, className }: { filename: string; className?: string }) {
  const kind = KINDS.find((k) => k.test.test(filename)) ?? { label: "TXT", color: "#64748b" };
  return (
    <svg viewBox="-0.5 -0.5 33 41" className={cn("h-10 w-8 shrink-0", className)} aria-label={`${kind.label} file`} role="img">
      <path d="M4 0h17l11 11v25a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4V4a4 4 0 0 1 4-4Z" fill="#fff" stroke="#cbd5e1" strokeWidth="1" />
      <path d="M21 0v7a4 4 0 0 0 4 4h7" fill="#f1f5f9" stroke="#cbd5e1" strokeWidth="1" />
      <rect x="0" y="21" width="26" height="12" rx="2.5" fill={kind.color} />
      <text x="13" y="30.2" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#fff" fontFamily="ui-sans-serif, system-ui, sans-serif" letterSpacing="0.3">
        {kind.label}
      </text>
    </svg>
  );
}
