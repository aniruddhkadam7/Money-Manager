import { describe, expect, it } from "vitest";
import { addEvent, ensurePerson } from "@/lib/finance/book-ops";
import { buildLedger } from "@/lib/finance/engine";
import { defaultAccounts } from "@/lib/finance/migrate";
import type { Book } from "@/lib/finance/types";
import { buildRows } from "@/lib/statements/rows";
import { classifyByRules, gate, learnRule, relationships, userRuleConfidence, type RuleContext } from "@/lib/statements/rules";
import type { StatementRow, UserRule } from "@/lib/statements/types";

let n = 0;
export const row = (desc: string, dir: "debit" | "credit", amountRupees: number): StatementRow =>
  buildRows(
    {
      parser: "t",
      warnings: [],
      ocr: false,
      rows: [
        {
          index: 0,
          page: 1,
          date: "2026-09-10",
          rawDescription: desc,
          debitMinor: dir === "debit" ? Math.round(amountRupees * 100) : 0,
          creditMinor: dir === "credit" ? Math.round(amountRupees * 100) : 0,
          confidence: 1,
          rawLine: desc,
          warnings: [],
        },
      ],
    },
    { importId: "i", accountId: "account-debit", newId: () => `r${n++}` },
  )[0];

const ctx = (over: Partial<RuleContext> = {}): RuleContext => ({
  userRules: [],
  people: [],
  relationships: [],
  accountIds: { cash: "account-cash", creditCard: "account-credit" },
  ...over,
});

describe("rule classification", () => {
  it.each([
    ["UPI-SWIGGY-SWIGGYUPI@ICICI-640812345678-UPI", "EXPENSE", "Food"],
    ["UPI-AMAZON PAY-AMAZONPAY@APL-640898765432-PAYMENT FROM PHONE", "EXPENSE", "Shopping"],
    ["NETFLIX.COM MUMBAI", "EXPENSE", "Subscriptions"],
    ["UPI-BOOKMYSHOW-BMS@AXIS-123456789", "EXPENSE", "Entertainment"],
    ["UPI-UBER INDIA-UBER@AXIS-111122223333", "EXPENSE", "Transport"],
  ])("%s -> merchant expense", (d, type, category) => {
    const c = classifyByRules(row(d, "debit", 500), ctx())!;
    expect(c.eventType).toBe(type);
    expect(c.category).toBe(category);
    expect(gate(c, 0.95, 0.8)).toBe("auto");
  });

  it("ATM withdrawal is a transfer into cash", () => {
    const c = classifyByRules(row("ATM WDL-HDFC BANK ATM-MUMBAI 123456", "debit", 5000), ctx())!;
    expect(c).toMatchObject({ eventType: "TRANSFER", counterAccountId: "account-cash" });
    expect(c.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it("salary and interest are income", () => {
    expect(classifyByRules(row("NEFT CR-HDFC0000001-ACME TECHNOLOGIES PVT LTD-SALARY SEP 2026-N2522601", "credit", 85000), ctx())).toMatchObject({ eventType: "INCOME", category: "Salary" });
    expect(classifyByRules(row("INT.PD:01-07-2026 TO 30-09-2026", "credit", 120), ctx())).toMatchObject({ eventType: "INCOME", category: "Interest" });
  });

  it("bank charges, card bills, SIPs", () => {
    expect(classifyByRules(row("SMS CHARGES Q3 + GST", "debit", 17.7), ctx())).toMatchObject({ eventType: "EXPENSE", category: "Bills" });
    expect(classifyByRules(row("CREDIT CARD PAYMENT BILLDESK", "debit", 7500), ctx())).toMatchObject({ eventType: "CREDIT_CARD_PAYMENT", counterAccountId: "account-credit" });
    expect(classifyByRules(row("ACH D- ZERODHA BROKING-SIP", "debit", 10000), ctx())).toMatchObject({ eventType: "INVESTMENT", holding: "Zerodha" });
  });

  it("a refund is flagged, not trusted", () => {
    const c = classifyByRules(row("AMAZON REFUND 4455667", "credit", 799), ctx())!;
    expect(c.eventType).toBe("INCOME");
    expect(gate(c, 0.95, 0.8)).toBe("auto_flagged");
  });

  it("an unknown person is NEVER auto-processed", () => {
    const debit = classifyByRules(row("UPI-RAHUL SHARMA-RAHUL.SHARMA@OKSBI-526099991111-UPI", "debit", 2000), ctx())!;
    const credit = classifyByRules(row("UPI-RAHUL SHARMA-RAHUL.SHARMA@OKSBI-526099991112-UPI", "credit", 2000), ctx())!;
    for (const c of [debit, credit]) {
      expect(c.confidence).toBeLessThan(0.8);
      expect(gate(c, 0.95, 0.8)).toBe("review");
      expect(c.alternatives.length).toBeGreaterThan(1);
    }
    expect(debit.eventType).toBe("MONEY_LENT");
    expect(credit.eventType).toBe("LENDING_REPAYMENT");
  });

  it("rent to a person is an expense, flagged", () => {
    const c = classifyByRules(row("UPI-AMIT KUMAR-AMIT.KUMAR@OKHDFCBANK-526012345678-RENT SEP", "debit", 18000), ctx())!;
    expect(c).toMatchObject({ eventType: "EXPENSE", category: "Rent" });
    expect(gate(c, 0.95, 0.8)).toBe("auto_flagged");
  });

  it("an unknown single word is left for the AI", () => {
    expect(classifyByRules(row("UPI-DUNZO-DUNZO@AXIS-9988776655", "debit", 300), ctx())).toBeNull();
  });

  it("a known relationship corroborates a repayment", () => {
    let book: Book = { accounts: defaultAccounts("2026-01-01"), people: [], events: [] };
    const p = ensurePerson(book, "Rahul Sharma")!;
    book = p.book;
    const r = addEvent(book, { type: "lend", date: "2026-08-01", personId: p.person.id, accountId: "account-debit", amountMinor: 200000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rels = relationships(r.value, buildLedger(r.value));
    expect(rels[0]).toMatchObject({ name: "Rahul Sharma", owedToMeMinor: 200000 });
    const c = classifyByRules(row("UPI-RAHUL SHARMA-RAHUL.SHARMA@OKSBI-526099991112-UPI", "credit", 2000), ctx({ people: r.value.people, relationships: rels }))!;
    expect(c).toMatchObject({ eventType: "LENDING_REPAYMENT", source: "relationship", person: "Rahul Sharma" });
    expect(c.confidence).toBeGreaterThanOrEqual(0.9);
    expect(c.confidence).toBeLessThan(0.95); // still shown for a glance
  });
});

describe("learning from corrections", () => {
  const now = "2026-09-30T00:00:00Z";
  const dunzo = () => row("UPI-DUNZO-DUNZO@AXIS-9988776655", "debit", 300);
  const food = { source: "user" as const, eventType: "EXPENSE" as const, category: "Food", merchant: null, person: null, counterAccountId: null, holding: null, confidence: 1, reason: "", alternatives: [] };

  it("one confirmation of a merchant is enough to automate it", () => {
    const rules = learnRule([], dunzo(), food, now);
    const c = classifyByRules(dunzo(), ctx({ userRules: rules }))!;
    expect(c).toMatchObject({ source: "user_rule", eventType: "EXPENSE", category: "Food" });
    expect(gate(c, 0.95, 0.8)).toBe("auto");
  });

  it("a person rule needs two confirmations for full trust", () => {
    const rahul = row("UPI-RAHUL SHARMA-RAHUL.SHARMA@OKSBI-526099991111-UPI", "debit", 2000);
    const lent = { ...food, eventType: "MONEY_LENT" as const, category: null, person: "Rahul Sharma" };
    let rules = learnRule([], rahul, lent, now);
    expect(gate(classifyByRules(rahul, ctx({ userRules: rules }))!, 0.95, 0.8)).toBe("auto_flagged");
    rules = learnRule(rules, rahul, lent, now);
    expect(gate(classifyByRules(rahul, ctx({ userRules: rules }))!, 0.95, 0.8)).toBe("auto");
  });

  it("contradictions lower confidence, and eventually replace the rule", () => {
    let rules: UserRule[] = learnRule([], dunzo(), food, now);
    rules = learnRule(rules, dunzo(), food, now);
    rules = learnRule(rules, dunzo(), food, now); // 3 confirmations
    const shopping = { ...food, category: "Shopping" };
    rules = learnRule(rules, dunzo(), shopping, now);
    expect(rules[0]).toMatchObject({ category: "Food", contradictions: 1 });
    expect(userRuleConfidence(rules[0])).toBeLessThan(0.98);
    rules = learnRule(rules, dunzo(), shopping, now);
    rules = learnRule(rules, dunzo(), shopping, now);
    expect(rules[0]).toMatchObject({ category: "Shopping", confirmations: 1, contradictions: 0 });
  });

  it("a rule is per direction", () => {
    const rules = learnRule([], dunzo(), food, now);
    expect(classifyByRules(row("UPI-DUNZO-DUNZO@AXIS-9988776655", "credit", 300), ctx({ userRules: rules }))?.source).not.toBe("user_rule");
  });
});

describe("subscriptions in statements", () => {
  it("files Apple Media and LinkedIn under Subscriptions, but card-bill payments to CRED are not one", () => {
    expect(classifyByRules(row("UPI/Apple Media /ABC/615290634276/Paid via CRE", "debit", 1999), ctx())).toMatchObject({ eventType: "EXPENSE", category: "Subscriptions" });
    expect(classifyByRules(row("UPI/LinkedIn Singapore/UTIB/123456789012/Paid via CRE", "debit", 999), ctx())).toMatchObject({ category: "Subscriptions" });
    expect(classifyByRules(row("UPI/Dreamplug Serv/UTIB/663322393495/payment on C", "debit", 399), ctx())?.category).not.toBe("Subscriptions");
  });
});

describe("shop keywords pick the category", () => {
  it.each([
    ["UPI/SHREE BALAJI PETROL PUMP/412345678901/Payment", "Petrol"],
    ["UPI/NAYARA ENERGY/412345678902/fuel", "Petrol"],
    ["UPI/GANESH KIRANA STORES/412345678903/UPI", "Grocery"],
    ["UPI/BLINKIT/412345678904/order", "Grocery"],
    ["UPI/SAI WINES/412345678905/Payment", "Alcohol"],
    ["UPI/RAJU PAN SHOP/412345678906/Payment", "Smoking"],
    ["UPI/HOSTINGER/412345678907/subscription", "Subscriptions"],
    ["UPI/HOTEL SAGAR RESTAURANT/412345678908/UPI", "Food"],
    ["UPI/OM MEDICAL STORE/412345678909/UPI", "Health"],
  ])("%s -> %s", (desc, category) => {
    const c = classifyByRules(row(desc, "debit", 500), ctx());
    expect(c?.eventType).toBe("EXPENSE");
    expect(c?.category).toBe(category);
  });
});

describe("trade labels the bank prints after the merchant's name", () => {
  it.each([
    ["UPI/KAI AS MANDAL Restaurants/YESB/123456789012/Paid via", "Food"],
    ["UPI/MOR A TEA CENTER Restaurants/YESB/123456789013/UPI", "Food"],
    ["UPI/SHREE HOTEL/YESB/123456789014/UPI", "Food"],
    ["UPI/JAY EEP ENTERPRIS S Stationery/YESB/123456789015/Paid", "Shopping"],
    ["UPI/OM SAI Grocery Stores, Supermarkets/YESB/123456789016/UPI", "Grocery"],
    ["UPI/NEW LIFE Drug Stores and Pharmacies/YESB/123456789017/UPI", "Health"],
    ["UPI/RAJ AUTO Service Stations/YESB/123456789018/UPI", "Petrol"],
    ["UPI/GANESH BAKERIES/YESB/123456789019/UPI", "Food"],
  ])("%s -> %s", (desc, category) => {
    const c = classifyByRules(row(desc, "debit", 60), ctx());
    expect(c?.eventType).toBe("EXPENSE");
    expect(c?.category).toBe(category);
  });
});

describe("credit card bill payments", () => {
  it.each([
    "UPI/Dreamplug Serv/UTIB/663322393495/payment on C",
    "UPI/CRED/YESB/123456789012/payment on CRED",
    "NEFT/HDFC CREDIT CARD/BILL PAYMENT",
    "BILLDESK/SBI CARD/AUTOPAY",
  ])("%s is paying a card, not spending", (desc) => {
    const c = classifyByRules(row(desc, "debit", 13_776), ctx());
    expect(c?.eventType).toBe("CREDIT_CARD_PAYMENT");
  });
});

describe("money from a company", () => {
  it.each([
    "NEFT CR-HDFC0000001-INVECTO TECHNOLOGIES PVT LTD-N252260123456789",
    "IMPS/P2A/INVECTO TECHNOLOGIES/123456789012",
  ])("%s is suggested as salary, for you to confirm", (desc) => {
    const c = classifyByRules(row(desc, "credit", 58_060), ctx());
    expect(c).toMatchObject({ eventType: "INCOME", category: "Salary" });
    expect(c!.confidence).toBeLessThan(0.8); // waits for one click; "Yes, always" makes it automatic
  });
  it("a refund from a company stays a refund", () => {
    expect(classifyByRules(row("NEFT/FLIPKART INTERNET PVT LTD/REFUND", "credit", 999), ctx())?.category).toBe("Refund");
  });
});
