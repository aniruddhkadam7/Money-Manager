import { describe, expect, it } from "vitest";
import { ensurePerson, likelySamePeople, mergePeople, sameishName } from "@/lib/finance/book-ops";
import { deriveState } from "@/lib/finance/state";
import { buildLedger } from "@/lib/finance/engine";
import { rs, startingScenario } from "./helpers";

describe("one person, two spellings", () => {
  it.each([
    ["Govindraj Ingle", "Govindraj Ing", true],
    ["Malu Shivaji Ka", "Malu Shivaji K", true],
    ["Rahul Sharma", "rahul  sharma", true],
    ["Rahul Sharma", "Rahul Verma", false],
    ["Amit", "Amit Kumar", false], // too short to be sure
    ["Raj Kumar", "Rajesh Kumar", false],
  ])("%s / %s -> %s", (a, b, same) => {
    expect(sameishName(a, b)).toBe(same);
  });

  it("imports reuse the person under the shortened name, keeping the fuller one", () => {
    const { s } = startingScenario();
    const first = ensurePerson(s.book, "Govindraj Ing")!;
    const again = ensurePerson(first.book, "Govindraj Ingle")!;
    expect(again.person.id).toBe(first.person.id);
    expect(again.person.name).toBe("Govindraj Ingle");
    expect(again.book.people).toHaveLength(1);
  });

  it("merging puts both names' borrowing and repayments on one person", () => {
    const { s, hdfc } = startingScenario();
    const full = s.person("Govindraj Ingle");
    s.ok({ type: "borrow", date: "2026-09-01", personId: full.id, accountId: hdfc.id, amountMinor: rs(74_000) });
    // Force a second spelling the way older imports did.
    const short = { id: "p-short", name: "Govindraj Ing", createdAt: "2026-01-01T00:00:00Z" };
    s.book = { ...s.book, people: [...s.book.people, short] };
    s.ok({ type: "borrow", date: "2026-09-02", personId: short.id, accountId: hdfc.id, amountMinor: rs(6_000) });
    s.ok({ type: "repayment_made", date: "2026-09-20", personId: short.id, accountId: hdfc.id, amountMinor: rs(10_000), predatesRecords: true }); // as imports record it

    expect(likelySamePeople(s.book).map(([k, d]) => [k.name, d.name])).toEqual([["Govindraj Ingle", "Govindraj Ing"]]);
    const merged = mergePeople(s.book, full.id, short.id);
    if (!merged.ok) throw new Error(merged.issues[0].message);
    const st = deriveState(merged.value, buildLedger(merged.value), "2026-10-01");
    expect(merged.value.people.map((p) => p.name)).not.toContain("Govindraj Ing");
    expect(st.people.find((p) => p.person.id === full.id)!.iOwe.outstandingMinor).toBe(rs(70_000));
  });
});

describe("a card paid beyond its recorded spending", () => {
  it("never lowers liabilities, and isn't counted as something you own: it paid a bill from before your entries", () => {
    const { s, hdfc } = startingScenario();
    const card = s.account({ name: "Credit card", type: "credit_card" });
    const friend = s.person("Govindraj Ingle");
    s.ok({ type: "borrow", date: "2026-09-01", personId: friend.id, accountId: hdfc.id, amountMinor: rs(114_800) });
    // A bill payment from the bank with no card purchases recorded.
    s.ok({ type: "transfer", date: "2026-09-05", fromAccountId: hdfc.id, toAccountId: card.id, amountMinor: rs(13_776) });

    const st = s.state();
    expect(st.liabilities.creditCardsMinor).toBe(0);
    expect(st.liabilities.borrowedMinor).toBe(rs(114_800));
    expect(st.liabilities.totalMinor).toBe(rs(100_000) + rs(114_800)); // home loan + people, nothing taken off
    expect(st.assets.creditBalancesMinor).toBe(0);
    expect(st.netWorthMinor).toBe(st.assets.totalMinor - st.liabilities.totalMinor);
    expect(st.netWorthMinor).toBe(rs(400_000) - rs(13_776)); // the bank money went to clear a debt from before
  });
});

describe("other names", () => {
  it("finds a person by any of their names, and refuses someone else's name", async () => {
    const { setPersonAliases, ensurePerson: ensure } = await import("@/lib/finance/book-ops");
    const { s } = startingScenario();
    const a = ensure(s.book, "Bit Hub Technologies")!;
    const b = ensure(a.book, "Ravi Kumar")!;
    const r = setPersonAliases(b.book, a.person.id, ["BIT HUB TE", "bit hub te", "  "]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.people.find((p) => p.id === a.person.id)?.aliases).toEqual(["BIT HUB TE"]);
    expect(ensure(r.value, "bit hub te")!.person.id).toBe(a.person.id);
    expect(setPersonAliases(r.value, a.person.id, ["Ravi Kumar"]).ok).toBe(false);
  });

  it("payments naming another name count as theirs, and statements find them by it", async () => {
    const { involvesPerson } = await import("@/lib/finance/person-summary");
    const { findPerson } = await import("@/lib/statements/rules");
    const person = { id: "P", name: "Bit Hub Technologies", aliases: ["BIT HUB TE"] };
    const payment = { id: "e", type: "expense", date: "2026-11-03", description: "UPI/BIT HUB TE/1234", accountId: "B", amountMinor: 100, categoryId: "other", createdAt: "", updatedAt: "" } as const;
    expect(involvesPerson(payment, person)).toBe(true);
    expect(findPerson("BIT HUB TE", [person])).toBe("Bit Hub Technologies");
  });

  it("merging keeps the other person's name as another name", async () => {
    const { mergePeople, ensurePerson: ensure } = await import("@/lib/finance/book-ops");
    const { s } = startingScenario();
    const a = ensure(s.book, "Govindraj Ingle")!;
    const b = ensure(a.book, "GOVIND I")!;
    const r = mergePeople(b.book, a.person.id, b.person.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.people).toHaveLength(1);
    expect(r.value.people[0].aliases).toEqual(["GOVIND I"]);
  });
});
