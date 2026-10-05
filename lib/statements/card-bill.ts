import { parseAmount, parseStatementDate } from "./parse-values";

/** The bill a credit card statement asks you to pay, as printed in its summary box. */
export interface CardBill {
  statementDate?: string;
  dueDate?: string;
  totalDueMinor?: number;
  minimumDueMinor?: number;
}

type Kind = "statementDate" | "dueDate" | "totalDueMinor" | "minimumDueMinor";

const LABELS: { kind: Kind; re: RegExp }[] = [
  { kind: "minimumDueMinor", re: /minimum\s+(?:amount\s+)?(?:due|payable|payment)|min\.?\s*amt\.?\s*due/gi },
  { kind: "totalDueMinor", re: /total\s+(?:amount\s+)?(?:due|payable)|total\s+dues|total\s+payment\s+due|amount\s+payable/gi },
  { kind: "dueDate", re: /payment\s+due\s+date|due\s+date|pay\s+by\s+date|pay\s+by/gi },
  { kind: "statementDate", re: /statement\s+(?:generation\s+)?date|bill\s+date|statement\s+as\s+on/gi },
];

const DATE = /\b(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?[\s-](?:jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*[\s,-]+\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4})\b/gi;
/** Bill amounts are printed with paise ("3,408.96"); that keeps card numbers and limits' plain digits out. */
const MONEY = /(?:₹|rs\.?|inr)?\s*\d{1,3}(?:,\d{2,3})*\.\d{2}\b|(?:₹|rs\.?|inr)\s*\d[\d,]*/gi;

interface Token {
  at: number;
  end: number;
  kind: "date" | "money";
  value: string | number;
}

const isDateKind = (k: Kind) => k === "statementDate" || k === "dueDate";

/**
 * Reads the bill summary from a card statement's text. Two layouts are common: "Label value" pairs, and a
 * header row of labels with a row of values under it (the values then follow in the labels' order).
 */
export function readCardBill(text: string): CardBill | undefined {
  const t = text.replace(/\s+/g, " ");
  const labels: { kind: Kind; at: number; end: number }[] = [];
  for (const { kind, re } of LABELS) {
    for (const m of t.matchAll(re)) {
      const at = m.index ?? 0;
      // "Payment due date" also contains "due date"; a longer label already covering this spot wins.
      if (labels.some((l) => at >= l.at && at < l.end)) continue;
      labels.push({ kind, at, end: at + m[0].length });
    }
  }
  if (labels.length === 0) return undefined;
  labels.sort((a, b) => a.at - b.at);

  const tokens: Token[] = [];
  for (const m of t.matchAll(DATE)) {
    const iso = parseStatementDate(m[0].replace(/,/g, " "));
    if (iso) tokens.push({ at: m.index ?? 0, end: (m.index ?? 0) + m[0].length, kind: "date", value: iso });
  }
  for (const m of t.matchAll(MONEY)) {
    const at = m.index ?? 0;
    if (tokens.some((d) => at >= d.at && at < d.end)) continue;
    const a = parseAmount(m[0].replace(/\s+/g, ""));
    if (a) tokens.push({ at, end: at + m[0].length, kind: "money", value: a.minor });
  }
  tokens.sort((a, b) => a.at - b.at);

  const bill: CardBill = {};
  const set = (kind: Kind, tok: Token | undefined) => {
    if (!tok || bill[kind] !== undefined) return;
    if (isDateKind(kind) && tok.kind === "date") (bill as Record<Kind, unknown>)[kind] = tok.value;
    if (!isDateKind(kind) && tok.kind === "money") (bill as Record<Kind, unknown>)[kind] = tok.value;
  };

  // Group labels that follow each other with no value between them (a header row).
  let i = 0;
  while (i < labels.length) {
    const run = [labels[i]];
    while (i + run.length < labels.length && !tokens.some((v) => v.at > run[run.length - 1].end && v.at < labels[i + run.length].at)) run.push(labels[i + run.length]);
    const after = tokens.filter((v) => v.at >= run[run.length - 1].end).slice(0, run.length);
    run.forEach((label, k) => {
      const byPosition = after[k];
      const typeOk = byPosition && (isDateKind(label.kind) ? byPosition.kind === "date" : byPosition.kind === "money");
      // Header-row order when it fits; otherwise the first value of the right type after the label.
      set(label.kind, typeOk ? byPosition : tokens.find((v) => v.at >= label.end && (isDateKind(label.kind) ? v.kind === "date" : v.kind === "money")));
    });
    i += run.length;
  }
  return Object.keys(bill).length ? bill : undefined;
}
