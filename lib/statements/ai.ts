import {
  MAX_ITEMS_PER_REQUEST,
  aiResponseSchema,
  redact,
  type AiItem,
  type AiResult,
} from "./ai-contract";
import { isDirectionCompatible } from "./rules";
import { PERSON_EVENTS, type AiCacheEntry, type Classification, type StatementRow } from "./types";

/**
 * Browser side of AI classification. Only lines the rules could not settle are sent, in batches,
 * with account numbers and references masked and never a balance or the PDF. Every answer is
 * validated and sanity-checked; the AI can suggest, it cannot decide what the ledger records.
 */

export const AI_BATCH_SIZE = 25;
export const AI_MAX_CONFIDENCE = 0.97;
/** A payment to or from an individual can't be settled by guessing, however sure the model sounds. */
export const AI_PERSON_MAX_CONFIDENCE = 0.79;

export interface AiOutcome {
  results: Map<string, Classification>;
  /** Cache hits that cost nothing. */
  cached: number;
  /** Set when some or all of the lines could not be classified. */
  note?: string;
  /** Rows we asked about (after de-duplication) / answered. */
  asked: number;
  answered: number;
  updatedCache: Record<string, AiCacheEntry>;
}

export interface AiOptions {
  fetchImpl?: typeof fetch;
  endpoint?: string;
  expenseCategories: string[];
  incomeCategories: string[];
  cache: Record<string, AiCacheEntry>;
  now: string;
  timeoutMs?: number;
  concurrency?: number;
  signal?: AbortSignal;
  /** Every line of the statement, so each question carries how often its payee appears and how regularly. */
  allRows?: StatementRow[];
}

export async function aiAvailable(fetchImpl: typeof fetch = fetch, endpoint = "/api/statement/classify"): Promise<boolean> {
  try {
    const res = await fetchImpl(endpoint, { cache: "no-store" });
    if (!res.ok) return false;
    const data = (await res.json()) as { available?: unknown };
    return data.available === true;
  } catch {
    return false;
  }
}

const groupKey = (r: StatementRow) => (r.normalized.counterpartyKey ? `${r.direction}|${r.normalized.counterpartyKey}` : `row|${r.id}`);

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

interface LineContext {
  occurrences: number;
  monthly: boolean;
}

/** How often each payee (same counterparty and direction) appears in the statement, and whether about monthly. */
export function statementContext(rows: StatementRow[]): Map<string, LineContext> {
  const dates = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.normalized.counterpartyKey) continue;
    const k = groupKey(r);
    dates.set(k, [...(dates.get(k) ?? []), r.transactionDate]);
  }
  const out = new Map<string, LineContext>();
  for (const [k, ds] of dates) {
    const days = [...ds].sort().map((d) => Date.parse(`${d}T00:00:00Z`) / 86_400_000);
    const gaps = days.slice(1).map((d, i) => d - days[i]).filter((g) => g > 0);
    const monthly = gaps.length >= 2 && gaps.filter((g) => g >= 25 && g <= 35).length >= Math.ceil(gaps.length * 0.6);
    out.set(k, { occurrences: ds.length, monthly });
  }
  return out;
}

const hintOf = (c: Classification | undefined): string | null =>
  c ? `${c.eventType}${c.category ? ` · ${c.category}` : ""} (${Math.round(c.confidence * 100)}%)` : null;

function toItem(r: StatementRow, id: string, ctx?: LineContext): AiItem {
  return {
    id,
    direction: r.direction,
    amountRupees: r.amountMinor / 100,
    mode: r.normalized.mode,
    counterparty: redact(r.normalized.counterparty).slice(0, 120),
    text: redact(r.rawDescription),
    date: r.transactionDate,
    weekday: WEEKDAYS[new Date(`${r.transactionDate}T00:00:00Z`).getUTCDay()],
    occurrences: ctx?.occurrences ?? 1,
    monthly: ctx?.monthly ?? false,
    ruleHint: hintOf(r.classification),
  };
}

/** Squeezes text for comparing a quoted phrase with the narration it came from. */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Most an answer with nothing in the line to back it can score: low enough that the person decides. */
export const AI_NO_EVIDENCE_MAX_CONFIDENCE = 0.5;

const matchName = (wanted: string | null, list: string[]): string | null => {
  if (!wanted) return null;
  return list.find((c) => c.toLowerCase() === wanted.trim().toLowerCase()) ?? null;
};

/** Turns one AI answer into a Classification, or null when it is unusable. */
export function sanitize(result: AiResult, row: StatementRow, opts: Pick<AiOptions, "expenseCategories" | "incomeCategories">): Classification | null {
  if (!isDirectionCompatible(result.eventType, row.direction)) return null; // a "debit" can't be salary

  const isPerson = PERSON_EVENTS.includes(result.eventType);
  let confidence = Math.min(result.confidence, AI_MAX_CONFIDENCE);
  // No anticipating: an answer is only as strong as the words in the line that support it.
  if (result.evidence !== undefined) {
    const quote = squash(result.evidence ?? "");
    const line = squash(`${row.rawDescription} ${row.normalized.counterparty}`);
    if (quote.length < 3) confidence = Math.min(confidence, AI_NO_EVIDENCE_MAX_CONFIDENCE);
    else if (!line.includes(quote)) confidence = Math.min(confidence, 0.6); // quoted words that aren't in the line
  }
  if (isPerson) confidence = Math.min(confidence, AI_PERSON_MAX_CONFIDENCE);
  if (isPerson && !result.person && !row.normalized.counterparty) confidence = Math.min(confidence, 0.5);

  let category: string | null = null;
  if (result.eventType === "EXPENSE") category = matchName(result.category, opts.expenseCategories) ?? "Other";
  else if (result.eventType === "INCOME") category = matchName(result.category, opts.incomeCategories) ?? "Other income";
  if (result.eventType === "EXPENSE" && category === "Other" && result.category && !matchName(result.category, opts.expenseCategories)) confidence = Math.min(confidence, 0.85);

  return {
    source: "ai",
    eventType: result.eventType,
    category,
    merchant: result.merchant?.trim() || row.normalized.counterparty || null,
    person: isPerson ? result.person?.trim() || row.normalized.counterparty || null : null,
    counterAccountId: null,
    holding: result.eventType === "INVESTMENT" || result.eventType === "INVESTMENT_SELL" ? result.holding?.trim() || row.normalized.counterparty || null : null,
    confidence: Math.round(confidence * 100) / 100,
    reason: result.evidence ? `${result.reason || "Classified by AI."} (from “${result.evidence}”)` : result.reason || "Classified by AI.",
    alternatives: [],
  };
}

async function postBatch(items: AiItem[], opts: AiOptions): Promise<AiResult[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const endpoint = opts.endpoint ?? "/api/statement/classify";
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onAbort);
    try {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items, expenseCategories: opts.expenseCategories, incomeCategories: opts.incomeCategories }),
        signal: controller.signal,
      });
      if (res.status === 503 || res.status === 502 || res.status === 504 || res.status === 429) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        const failure = new Error(body.message ?? `HTTP ${res.status}`);
        lastError = failure;
        if (body.error === "not_configured" || body.error === "auth") throw Object.assign(failure, { fatal: true });
        continue; // retry once
      }
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { fatal: true });
      const parsed = aiResponseSchema.safeParse(await res.json());
      if (!parsed.success) throw Object.assign(new Error("The AI answer was malformed."), { fatal: true });
      return parsed.data.results;
    } catch (err) {
      lastError = err;
      if ((err as { fatal?: boolean }).fatal || opts.signal?.aborted) throw err;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("The AI service didn't respond.");
}

/**
 * Classifies the given rows. Lines that look the same (same counterparty and direction) are asked
 * about once; merchant answers are remembered so the same merchant is never asked about twice.
 * Never throws: failures come back as a `note` and the rows simply stay unclassified.
 */
export async function classifyWithAi(rows: StatementRow[], opts: AiOptions): Promise<AiOutcome> {
  const out: AiOutcome = { results: new Map(), cached: 0, asked: 0, answered: 0, updatedCache: { ...opts.cache } };
  if (rows.length === 0) return out;

  const context = statementContext(opts.allRows ?? rows);

  // Group look-alikes; the first row speaks for the group.
  const groups = new Map<string, StatementRow[]>();
  for (const r of rows) groups.set(groupKey(r), [...(groups.get(groupKey(r)) ?? []), r]);

  const toAsk: { key: string; rep: StatementRow; members: StatementRow[] }[] = [];
  for (const [key, members] of groups) {
    const rep = members[0];
    const hit = opts.cache[key];
    if (hit) {
      for (const m of members) {
        const c = sanitize({ id: m.id, eventType: hit.eventType, category: hit.category, merchant: hit.merchant, person: null, holding: null, confidence: hit.confidence, reason: `${hit.reason} (remembered)` }, m, opts);
        if (c) {
          out.results.set(m.id, c);
          out.cached++;
        }
      }
      if (members.every((m) => out.results.has(m.id))) continue;
    }
    toAsk.push({ key, rep, members });
  }
  out.asked = toAsk.length;
  if (toAsk.length === 0) return out;

  const batches: (typeof toAsk)[] = [];
  for (let i = 0; i < toAsk.length; i += Math.min(AI_BATCH_SIZE, MAX_ITEMS_PER_REQUEST)) batches.push(toAsk.slice(i, i + AI_BATCH_SIZE));

  let failed = 0;
  let firstError = "";
  const run = async (batch: typeof toAsk) => {
    // Short throwaway ids: nothing that identifies a record leaves the device.
    const ids = new Map(batch.map((g, i) => [`q${i + 1}`, g]));
    const items = batch.map((g, i) => toItem(g.rep, `q${i + 1}`, context.get(g.key)));
    try {
      const results = await postBatch(items, opts);
      for (const res of results) {
        const g = ids.get(res.id);
        if (!g) continue;
        out.answered++;
        for (const m of g.members) {
          const c = sanitize(res, m, opts);
          if (!c) continue;
          out.results.set(m.id, c);
        }
        const repC = out.results.get(g.rep.id);
        // Remember merchants, never people: the same name can mean different things between different pairs of people.
        if (repC && !PERSON_EVENTS.includes(repC.eventType) && g.key.indexOf("row|") !== 0) {
          out.updatedCache[g.key] = { eventType: repC.eventType, category: repC.category, merchant: repC.merchant, confidence: repC.confidence, reason: repC.reason, at: opts.now };
        }
      }
    } catch (err) {
      failed++;
      firstError ||= err instanceof Error ? err.message : "The AI service didn't respond.";
    }
  };

  const concurrency = Math.max(1, opts.concurrency ?? 2);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, batches.length) }, async () => {
      while (next < batches.length) await run(batches[next++]);
    }),
  );

  if (failed > 0) {
    out.note = `AI classification wasn't available for ${failed === batches.length ? "any" : "some"} lines (${firstError}). Those lines were classified by rules only and sent to review.`;
  }
  return out;
}
