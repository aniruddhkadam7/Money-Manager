import { z } from "zod";
import { ALL_EVENT_TYPES, type StatementEventType } from "./types";

/**
 * The agreement between the browser and the classification route. Both sides validate against it,
 * so a malformed or hostile response can never reach the ledger.
 */

export const MAX_ITEMS_PER_REQUEST = 40;

export const aiItemSchema = z.object({
  id: z.string().min(1).max(80),
  direction: z.enum(["debit", "credit"]),
  amountRupees: z.number().finite().nonnegative().max(1e9),
  mode: z.string().max(20).nullable(),
  counterparty: z.string().max(120),
  text: z.string().max(300),
  /** Context so the model reads the line as part of the statement, not in isolation. */
  date: z.string().max(10).optional(),
  weekday: z.string().max(10).optional(),
  /** How many lines in this statement have the same counterparty and direction, and roughly every how many days. */
  occurrences: z.number().int().nonnegative().max(10_000).optional(),
  monthly: z.boolean().optional(),
  /** What the built-in rules made of it, if anything (a hint, not an answer). */
  ruleHint: z.string().max(120).nullable().optional(),
});
export type AiItem = z.infer<typeof aiItemSchema>;

export const aiRequestSchema = z.object({
  items: z.array(aiItemSchema).min(1).max(MAX_ITEMS_PER_REQUEST),
  expenseCategories: z.array(z.string().max(60)).max(60),
  incomeCategories: z.array(z.string().max(60)).max(30),
});
export type AiRequest = z.infer<typeof aiRequestSchema>;

export const eventTypeSchema = z.enum(ALL_EVENT_TYPES as [StatementEventType, ...StatementEventType[]]);

export const aiResultSchema = z.object({
  id: z.string(),
  eventType: eventTypeSchema,
  category: z.string().max(60).nullable(),
  merchant: z.string().max(120).nullable(),
  person: z.string().max(120).nullable(),
  holding: z.string().max(120).nullable(),
  confidence: z.number().min(0).max(1),
  reason: z.string().max(300),
  /** The exact words of the narration the answer rests on; null when the line itself doesn't say. */
  evidence: z.string().max(200).nullable().optional(),
});
export type AiResult = z.infer<typeof aiResultSchema>;

export const aiResponseSchema = z.object({ results: z.array(aiResultSchema) });
export type AiResponse = z.infer<typeof aiResponseSchema>;

/** The same shape, as the JSON Schema OpenAI's strict structured output requires (every key required; null for "none"). */
export const AI_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["results"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "eventType", "category", "merchant", "person", "holding", "confidence", "reason", "evidence"],
        properties: {
          id: { type: "string" },
          eventType: { type: "string", enum: ALL_EVENT_TYPES },
          category: { type: ["string", "null"] },
          merchant: { type: ["string", "null"] },
          person: { type: ["string", "null"] },
          holding: { type: ["string", "null"] },
          confidence: { type: "number" },
          reason: { type: "string" },
          evidence: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;

/** Removes anything that identifies an account or a transaction before text leaves the device. */
export function redact(text: string): string {
  return text
    .replace(/[xX*•]{2,}\s?\d{2,}/g, "#") // masked card / account numbers: XXXX1234, ****1234
    .replace(/\d[\d\s-]{4,}\d/g, (m) => (m.replace(/\D/g, "").length >= 6 ? "#" : m)) // spaced / dashed long numbers
    .replace(/\d{6,}/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}
