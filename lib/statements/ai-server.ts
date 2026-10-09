import OpenAI from "openai";
import { AI_JSON_SCHEMA, aiResponseSchema, type AiRequest, type AiResponse } from "./ai-contract";

/**
 * Server side of the classifier: one OpenAI call per batch, answers forced into a strict JSON schema
 * and then validated again. Used for every line the built-in rules could not settle with certainty.
 */

export const DEFAULT_MODEL = "gpt-6-luna";

/** Reasoning models (o-series, GPT-5 and later) reject any temperature other than the default. */
export function supportsTemperature(model: string): boolean {
  return !/^(o\d|gpt-[5-9])/.test(model);
}

const SYSTEM_PROMPT = `You classify lines from an Indian bank statement for a personal money manager.
Each line has: id, direction (debit = money left the account, credit = money arrived), amount in rupees, payment mode, a counterparty guess, the bank narration (digits are masked as #), its date and weekday, how many lines in this statement share the same counterparty and direction ("occurrences"), whether those repeat about monthly ("monthly"), and "ruleHint" (what simple keyword rules made of it, which may be wrong).

How to work, for every line:
1. Read the whole narration word by word. Indian narrations pack meaning into short codes: UPI / IMPS / NEFT / RTGS / NACH / ACH / ECS / POS / ATM / BIL / INF / SI / MMT, "Recd", "Sent using", "Paid via", "CR" / "DR", "SAL", "INT", "REV", "CRADJ", "REF", "CHRG", "EMI", "AUTOPAY", "MANDATE", app handles like "@ybl", "@paytm", "@okaxis". Decode them.
2. Identify who the other side is: a company or shop (Pvt Ltd, Enterprises, Stores, Traders, Services, Agency, Medical, Petroleum, Kirana, Wines...), a bank or app, the user's own account, or an individual (a person's first and last name).
3. Use the context: the same payee every month suggests a bill, rent, EMI, salary or subscription; a round amount to a person is more often a loan or repayment than a purchase; a credit that mirrors an earlier debit to the same name suggests a refund or repayment. Context can support a reading the narration already points to. It is never enough on its own.
4. Only then choose the eventType and fields, and put in "evidence" the exact words from the narration that justify them.

Do not anticipate. Base every answer on what the line actually says:
- If the narration names a known merchant, a purpose word (fuel, rent, salary, refund, EMI, recharge, fees...) or an unmistakable code, you may be confident, and "evidence" quotes those words.
- If it does not (for example "UPI/RAJESH KUMAR/#/Payment" or "IMPS/#/Transfer"), you do not know what it was. Say so: pick the most literal type the direction allows (a debit to an unknown individual: EXPENSE with category "Other"; a credit from one: LENDING_REPAYMENT), set confidence 0.5 or lower, set "evidence" to null, and in "reason" say plainly what is missing ("Nothing in the line says what this payment was for"). The person will decide; that is the correct outcome, not a failure.
- Never infer a purpose from the amount, the date or a name alone. Never invent a merchant, a person, a category or a purpose that isn't written in the line.

Choose exactly one eventType per line. It must be consistent with direction:
- EXPENSE (debit): the user bought something. Pick the best category from the list given, reading the shop's name for clues:
  petrol / diesel / fuel / CNG pumps -> Petrol; tolls, parking, cabs, metro -> Transport; kirana, provision or general stores, supermarkets,
  vegetables, fruit, milk, dairy, Zepto / Blinkit / DMart -> Grocery; restaurants, cafes, dhabas, bakeries, sweets, food
  delivery -> Food; wine shops, liquor, beer, bars, pubs -> Alcohol; paan, tobacco, cigarette shops -> Smoking;
  streaming, apps, software, hosting, memberships, anything named "subscription" -> Subscriptions; society maintenance,
  repairs, plumber, electrician -> Maintenance; chemists, medicals, clinics, labs, gyms -> Health; electricity, gas,
  phone, broadband, recharge, insurance -> Bills. Use "Other" only when nothing in the line hints at what it was.
- INCOME (credit): salary, interest, business income, gifts. Refunds, reversals, cashback and "CRADJ" credit adjustments are INCOME with category "Refund"; work or expense reimbursements are INCOME with category "Reimbursement". Never put money that came back under Salary or Other income. Pick from the income categories.
- TRANSFER (debit or credit): between the user's own accounts (e.g. to their own savings, wallet top-up).
- MONEY_LENT (debit): the user gave money to a person to be paid back.
- MONEY_BORROWED (credit): a person gave the user money to be paid back.
- LENDING_REPAYMENT (credit): a person paid the user back.
- BORROWING_REPAYMENT (debit): the user paid back a person.
- REIMBURSEMENT (debit or credit): a work or shared-cost reimbursement.
- INVESTMENT (debit): money into stocks, mutual funds, SIP, NPS, PPF, deposits.
- INVESTMENT_SELL (credit): money back from an investment.
- LOAN_REPAYMENT (debit): EMI or loan instalment. CREDIT_CARD_PAYMENT (debit): credit card bill.
- ASSET_PURCHASE, ASSET_SALE, LOAN_TAKEN, SPLIT_EXPENSE: only when the narration clearly says so.

Rules:
- Set "person" only when the counterparty is clearly an individual; otherwise null. Set "merchant" to a clean business name when there is one.
- A payment to or from an individual is ambiguous by nature. Unless the narration says what it was for, use a LOW confidence (at most 0.6) and say what else it could be in "reason".
- "confidence" is the probability, between 0 and 1, that your eventType AND category are correct. Do not inflate it. Above 0.8 only when "evidence" holds words that settle it. If you are guessing, use 0.5 or lower.
- "reason" is one short sentence in plain English a non-accountant understands. "evidence" is a short exact quote from the narration, or null.
- Return a result for every id, using the same ids.`;

export interface AiServerOptions {
  client: OpenAI;
  model: string;
  timeoutMs?: number;
}

export function createClient(env: Record<string, string | undefined>): { client: OpenAI; model: string } | null {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    client: new OpenAI({ apiKey, baseURL: env.OPENAI_BASE_URL?.trim() || undefined, maxRetries: 1 }),
    model: env.OPENAI_MODEL?.trim() || DEFAULT_MODEL,
  };
}

export async function classifyBatch(request: AiRequest, { client, model, timeoutMs = 45_000 }: AiServerOptions): Promise<AiResponse> {
  const user = JSON.stringify({
    expenseCategories: request.expenseCategories,
    incomeCategories: request.incomeCategories,
    lines: request.items,
  });
  const completion = await client.chat.completions.create(
    {
      model,
      ...(supportsTemperature(model) ? { temperature: 0 } : {}),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: user },
      ],
      response_format: { type: "json_schema", json_schema: { name: "statement_classification", strict: true, schema: AI_JSON_SCHEMA as unknown as Record<string, unknown> } },
    },
    { timeout: timeoutMs },
  );
  const choice = completion.choices[0];
  if (!choice?.message?.content) throw new Error(choice?.message?.refusal ? "The model declined to answer." : "The model returned nothing.");
  if (choice.finish_reason === "length") throw new Error("The model's answer was cut off.");
  const parsed = aiResponseSchema.safeParse(JSON.parse(choice.message.content));
  if (!parsed.success) throw new Error("The model's answer did not match the expected format.");
  // Only answers for lines we asked about.
  const asked = new Set(request.items.map((i) => i.id));
  return { results: parsed.data.results.filter((r) => asked.has(r.id)) };
}
