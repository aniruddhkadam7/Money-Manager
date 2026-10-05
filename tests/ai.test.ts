import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { redact } from "@/lib/statements/ai-contract";
import { handleAvailability, handleClassify } from "@/lib/statements/ai-route";
import { classifyWithAi, sanitize, type AiOptions } from "@/lib/statements/ai";
import { buildRows } from "@/lib/statements/rows";
import type { StatementRow } from "@/lib/statements/types";

/** A stand-in for api.openai.com: records what it was sent and answers as scripted. */
let server: http.Server;
let baseURL = "";
let received: { url: string; auth: string | undefined; body: any }[] = [];
let respond: (body: any, n: number) => { status?: number; json?: unknown; raw?: string } = () => ({ status: 500 });

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      const body = data ? JSON.parse(data) : {};
      received.push({ url: req.url ?? "", auth: req.headers.authorization, body });
      const r = respond(body, received.length);
      res.statusCode = r.status ?? 200;
      res.setHeader("content-type", "application/json");
      res.end(r.raw ?? JSON.stringify(r.json ?? {}));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(() => server.close());
beforeEach(() => {
  received = [];
  respond = () => ({ status: 500 });
});

const env = { OPENAI_API_KEY: "sk-test-key", OPENAI_BASE_URL: "", OPENAI_MODEL: "test-model" };
const withEnv = () => ({ ...env, OPENAI_BASE_URL: baseURL });

/** Wrap an assistant answer the way chat.completions returns it. */
const completion = (content: unknown, finish = "stop") => ({
  id: "x",
  object: "chat.completion",
  created: 0,
  model: "test-model",
  choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content: typeof content === "string" ? content : JSON.stringify(content) } }],
});

let n = 0;
const mkRow = (desc: string, dir: "debit" | "credit", rupees: number, balance = 123456.78): StatementRow =>
  buildRows(
    {
      parser: "t", warnings: [], ocr: false,
      rows: [{ index: n, page: 1, date: "2026-09-10", rawDescription: desc, debitMinor: dir === "debit" ? rupees * 100 : 0, creditMinor: dir === "credit" ? rupees * 100 : 0, balanceMinor: Math.round(balance * 100), confidence: 1, rawLine: desc, warnings: [] }],
    },
    { importId: "i", accountId: "account-debit", newId: () => `row${n++}` },
  )[0];

const EXP = ["Food", "Shopping", "Transport", "Rent", "Bills", "Entertainment", "Health", "Travel", "Other"];
const INC = ["Salary", "Business", "Interest", "Gift", "Other income"];
const opts = (over: Partial<AiOptions> = {}): AiOptions => ({
  fetchImpl: (url, init) => handleClassify(new Request(`http://localhost${url}`, init), withEnv()),
  expenseCategories: EXP,
  incomeCategories: INC,
  cache: {},
  now: "2026-09-30T00:00:00Z",
  ...over,
});

const answer = (id: string, over: Record<string, unknown> = {}) => ({
  id, eventType: "EXPENSE", category: "Food", merchant: "Dunzo", person: null, holding: null, confidence: 0.9, reason: "Looks like a delivery app.", ...over,
});
/** The fake model answers from whatever lines it was sent. */
const echo = (make: (line: any) => Record<string, unknown>) => (body: any) => {
  const lines = JSON.parse(body.messages[1].content).lines;
  return { json: completion({ results: lines.map(make) }) };
};

describe("redaction", () => {
  it("masks long numbers and masked account numbers", () => {
    expect(redact("UPI-RAHUL-9876543210@ybl-526099991111-UPI")).not.toMatch(/\d{6}/);
    expect(redact("POS 4567XXXXXX1234 SWIGGY")).not.toMatch(/1234/);
    expect(redact("Card ****1234 payment")).not.toMatch(/1234/);
    expect(redact("NEFT 1234 5678 9012 ACME")).not.toMatch(/\d{4} \d{4}/);
    expect(redact("SMS CHARGES 17.70")).toBe("SMS CHARGES 17.70");
  });
});

describe("the classification route", () => {
  it("reports availability by whether a key is configured", async () => {
    expect(await (handleAvailability({}) as Response).json()).toEqual({ available: false, model: null });
    expect(await (handleAvailability(env) as Response).json()).toMatchObject({ available: true, model: "test-model" });
  });

  it("refuses without a key, with a clear error", async () => {
    const res = await handleClassify(new Request("http://localhost/x", { method: "POST", body: "{}" }), {});
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("not_configured");
  });

  it("refuses cross-site requests", async () => {
    const res = await handleClassify(new Request("http://localhost/x", { method: "POST", headers: { origin: "https://evil.example", host: "localhost:3000" }, body: "{}" }), withEnv());
    expect(res.status).toBe(403);
    expect(received).toHaveLength(0);
  });

  it("rejects malformed requests before spending anything", async () => {
    for (const body of ["not json", "{}", JSON.stringify({ items: [], expenseCategories: [], incomeCategories: [] })]) {
      const res = await handleClassify(new Request("http://localhost/x", { method: "POST", body }), withEnv());
      expect(res.status).toBe(400);
    }
    expect(received).toHaveLength(0);
  });

  it("calls OpenAI with a strict JSON schema, the configured model and key", async () => {
    respond = echo((l) => answer(l.id));
    const out = await classifyWithAi([mkRow("UPI-DUNZO-DUNZO@AXIS-9988776655", "debit", 300)], opts());
    expect(out.results.size).toBe(1);
    expect(received).toHaveLength(1);
    const r = received[0];
    expect(r.url).toBe("/v1/chat/completions");
    expect(r.auth).toBe("Bearer sk-test-key");
    expect(r.body.model).toBe("test-model");
    expect(r.body.response_format.type).toBe("json_schema");
    expect(r.body.response_format.json_schema.strict).toBe(true);
    expect(r.body.response_format.json_schema.schema.additionalProperties).toBe(false);
    expect(r.body.response_format.json_schema.schema.properties.results.items.required).toContain("eventType");
  });

  it("never sends balances, long reference numbers or the account", async () => {
    respond = echo((l) => answer(l.id));
    await classifyWithAi([mkRow("UPI-DUNZO-DUNZO@AXIS-9988776655-526012345678", "debit", 300, 98765.43)], opts());
    const sent = JSON.stringify(received[0].body);
    expect(sent).not.toMatch(/\d{6,}/);
    expect(sent).not.toMatch(/98765|9876543/);
    expect(sent).not.toContain("account-debit");
  });
});

describe("AI classification of unresolved rows", () => {
  it("returns validated classifications and caps confidence", async () => {
    respond = echo((l) => answer(l.id, { confidence: 1 }));
    const row = mkRow("UPI-DUNZO-DUNZO@AXIS-9988776655", "debit", 300);
    const out = await classifyWithAi([row], opts());
    expect(out.results.get(row.id)).toMatchObject({ source: "ai", eventType: "EXPENSE", category: "Food" });
    expect(out.results.get(row.id)!.confidence).toBeLessThanOrEqual(0.97);
  });

  it("caps anything involving a person below the review line", async () => {
    respond = echo((l) => answer(l.id, { eventType: "MONEY_LENT", category: null, person: "Rahul Sharma", confidence: 0.99 }));
    const row = mkRow("UPI-RAHUL SHARMA-RAHUL.SHARMA@OKSBI-526099991111-UPI", "debit", 2000);
    const out = await classifyWithAi([row], opts());
    expect(out.results.get(row.id)!.confidence).toBeLessThan(0.8);
    expect(out.results.get(row.id)!.person).toBe("Rahul Sharma");
  });

  it("rejects an answer that contradicts the direction", async () => {
    respond = echo((l) => answer(l.id, { eventType: "INCOME", category: "Salary", confidence: 0.99 }));
    const row = mkRow("UPI-DUNZO-DUNZO@AXIS-9988776655", "debit", 300);
    const out = await classifyWithAi([row], opts());
    expect(out.results.has(row.id)).toBe(false);
  });

  it("maps unknown categories to Other and lowers confidence", () => {
    const row = mkRow("UPI-DUNZO-DUNZO@AXIS-9988776655", "debit", 300);
    const c = sanitize({ ...answer(row.id, { category: "Quantum Gadgets", confidence: 0.95 }) } as any, row, { expenseCategories: EXP, incomeCategories: INC })!;
    expect(c.category).toBe("Other");
    expect(c.confidence).toBeLessThanOrEqual(0.85);
  });

  it("asks once per merchant, and remembers merchants (not people)", async () => {
    respond = echo((l) => answer(l.id));
    const a = mkRow("UPI-DUNZO-DUNZO@AXIS-9988776655", "debit", 300);
    const b = mkRow("UPI-DUNZO-DUNZO@AXIS-1122334455", "debit", 450);
    const out = await classifyWithAi([a, b], opts());
    expect(JSON.parse(received[0].body.messages[1].content).lines).toHaveLength(1);
    expect(out.results.get(a.id)).toBeDefined();
    expect(out.results.get(b.id)).toBeDefined();
    const key = Object.keys(out.updatedCache)[0];
    expect(key).toBe("debit|dunzo");

    received = [];
    const again = await classifyWithAi([mkRow("UPI-DUNZO-DUNZO@AXIS-5566778899", "debit", 120)], opts({ cache: out.updatedCache }));
    expect(received).toHaveLength(0);
    expect(again.cached).toBe(1);
    expect([...again.results.values()][0].reason).toContain("remembered");

    // a person is never cached
    respond = echo((l) => answer(l.id, { eventType: "MONEY_LENT", category: null, person: "Rahul Sharma" }));
    const p = await classifyWithAi([mkRow("UPI-RAHUL SHARMA-RAHUL.SHARMA@OKSBI-526099991111-UPI", "debit", 2000)], opts());
    expect(Object.keys(p.updatedCache)).toHaveLength(0);
  });

  it("splits big statements into batches of 25", async () => {
    respond = echo((l) => answer(l.id));
    const rows = Array.from({ length: 60 }, (_, i) => mkRow(`UPI-SHOP${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}-X@AXIS-${i}`, "debit", 10 + i));
    const out = await classifyWithAi(rows, opts());
    expect(received.map((r) => JSON.parse(r.body.messages[1].content).lines.length).sort((a, b) => b - a)).toEqual([25, 25, 10]);
    expect(out.results.size).toBe(60);
  });

  it("degrades gracefully when OpenAI fails: no results, a clear note, no throw", async () => {
    respond = () => ({ status: 500, json: { error: { message: "boom" } } });
    const row = mkRow("UPI-DUNZO-DUNZO@AXIS-9988776655", "debit", 300);
    const out = await classifyWithAi([row], opts());
    expect(out.results.size).toBe(0);
    expect(out.note).toMatch(/AI classification wasn't available/);
  });

  it("degrades gracefully on a malformed or refused answer", async () => {
    const row = mkRow("UPI-DUNZO-DUNZO@AXIS-9988776655", "debit", 300);
    respond = () => ({ json: completion("this is not json") });
    expect((await classifyWithAi([row], opts())).results.size).toBe(0);
    respond = () => ({ json: completion({ results: [{ id: row.id, eventType: "BUY_STUFF" }] }) });
    expect((await classifyWithAi([row], opts())).results.size).toBe(0);
    respond = () => ({ json: completion({ results: [answer(row.id)] }, "length") });
    expect((await classifyWithAi([row], opts())).results.size).toBe(0);
  });

  it("ignores answers for lines it was never asked about", async () => {
    respond = () => ({ json: completion({ results: [answer("someone-else")] }) });
    const row = mkRow("UPI-DUNZO-DUNZO@AXIS-9988776655", "debit", 300);
    const out = await classifyWithAi([row], opts());
    expect(out.results.size).toBe(0);
  });

  it("works with no key configured: rows simply stay unclassified", async () => {
    const row = mkRow("UPI-DUNZO-DUNZO@AXIS-9988776655", "debit", 300);
    const out = await classifyWithAi([row], opts({ fetchImpl: (url, init) => handleClassify(new Request(`http://localhost${url}`, init), {}) }));
    expect(out.results.size).toBe(0);
    expect(out.note).toMatch(/not configured|OPENAI_API_KEY/i);
  });
});

describe("no anticipating: answers rest on the words in the line", () => {
  const cats = { expenseCategories: EXP, incomeCategories: INC };

  it("keeps a confident answer whose evidence is in the narration", () => {
    const row = mkRow("UPI-DUNZO-DUNZO@AXIS-9988776655", "debit", 300);
    const c = sanitize({ ...answer(row.id, { confidence: 0.95 }), evidence: "DUNZO" } as any, row, cats)!;
    expect(c.confidence).toBe(0.95);
    expect(c.reason).toContain("DUNZO");
  });

  it("sends an answer with no evidence to the person", () => {
    const row = mkRow("UPI-RAHUL SHARMA-RAHUL.SHARMA@OKSBI-526099991111-UPI", "debit", 300);
    const c = sanitize({ ...answer(row.id, { confidence: 0.95 }), evidence: null } as any, row, cats)!;
    expect(c.confidence).toBeLessThanOrEqual(0.5);
  });

  it("doesn't trust a quote that isn't in the line", () => {
    const row = mkRow("UPI-DUNZO-DUNZO@AXIS-9988776655", "debit", 300);
    const c = sanitize({ ...answer(row.id, { confidence: 0.95 }), evidence: "grocery order" } as any, row, cats)!;
    expect(c.confidence).toBeLessThanOrEqual(0.6);
  });
});

describe("rule and AI readings combined", () => {
  const base = { source: "rule" as const, merchant: null, person: null, counterAccountId: null, holding: null, alternatives: [] };
  it("agreeing readings keep the stronger confidence; a backed disagreement goes to review", async () => {
    const { combineOpinions } = await import("@/lib/statements/pipeline");
    const rule = { ...base, eventType: "EXPENSE" as const, category: "Food", confidence: 0.86, reason: "Mentions a cafe." };
    const same = combineOpinions(rule, { ...rule, source: "ai", confidence: 0.93, reason: "A cafe." }, 0.8);
    expect(same.confidence).toBe(0.93);
    const other = combineOpinions(rule, { ...rule, source: "ai", category: "Alcohol", confidence: 0.9, reason: "A bar." }, 0.8);
    expect(other.confidence).toBeLessThan(0.8);
    expect(other.reason).toContain("Two readings");
    const weak = combineOpinions(rule, { ...rule, source: "ai", category: "Alcohol", confidence: 0.5, reason: "Unclear." }, 0.8);
    expect(weak).toEqual(rule);
  });
});
