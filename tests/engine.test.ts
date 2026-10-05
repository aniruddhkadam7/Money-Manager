import { describe, expect, it } from "vitest";
import { buildLedger, mulDivRound } from "@/lib/finance/engine";
import { deriveState, netWorthFromEquity, spendingRows } from "@/lib/finance/state";
import { rs, Scenario, startingScenario } from "./helpers";

const D = "2026-10-01";

describe("success criteria: the full story from the spec", () => {
  it("keeps every number right at every step", () => {
    const { s, hdfc } = startingScenario();
    const rahul = s.person("Rahul");
    const fund = s.investment("Index fund");

    // 1. Start
    let st = s.state();
    expect(st.assets.totalMinor).toBe(rs(500_000));
    expect(st.liabilities.totalMinor).toBe(rs(100_000));
    expect(st.netWorthMinor).toBe(rs(400_000));

    // 2. Borrow ₹20,000 from Rahul
    s.ok({ type: "borrow", date: D, personId: rahul.id, accountId: hdfc.id, amountMinor: rs(20_000) });
    st = s.state();
    expect(st.assets.totalMinor).toBe(rs(520_000));
    expect(st.liabilities.totalMinor).toBe(rs(120_000));
    expect(st.netWorthMinor).toBe(rs(400_000));
    expect(s.report().incomeMinor).toBe(0); // borrowing is not income

    // 3. Spend ₹5,000
    s.ok({ type: "expense", date: D, accountId: hdfc.id, amountMinor: rs(5_000), categoryId: "food" });
    st = s.state();
    expect(st.assets.totalMinor).toBe(rs(515_000));
    expect(st.liabilities.totalMinor).toBe(rs(120_000));
    expect(st.netWorthMinor).toBe(rs(395_000));

    // 4. Lend ₹10,000 to Rahul: cash down, receivable up, net worth unchanged
    s.ok({ type: "lend", date: D, personId: rahul.id, accountId: hdfc.id, amountMinor: rs(10_000) });
    st = s.state();
    expect(st.cashMinor).toBe(rs(500_000 + 20_000 - 5_000 - 10_000));
    expect(st.assets.receivablesMinor).toBe(rs(10_000));
    expect(st.netWorthMinor).toBe(rs(395_000));
    expect(s.report().expensesMinor).toBe(rs(5_000)); // lending is not an expense

    // 5. Rahul repays ₹5,000
    s.ok({ type: "repayment_received", date: D, personId: rahul.id, accountId: hdfc.id, amountMinor: rs(5_000) });
    st = s.state();
    expect(st.assets.receivablesMinor).toBe(rs(5_000));
    expect(st.cashMinor).toBe(rs(500_000 + 20_000 - 5_000 - 10_000 + 5_000));
    expect(st.netWorthMinor).toBe(rs(395_000));
    expect(s.report().incomeMinor).toBe(0); // a repayment is not income

    // 6. Invest ₹10,000: value moves from cash into investments
    const cashBefore = st.cashMinor;
    const assetsBefore = st.assets.totalMinor;
    s.ok({ type: "invest", date: D, fromAccountId: hdfc.id, holdingId: fund.id, amountMinor: rs(10_000) });
    st = s.state();
    expect(st.cashMinor).toBe(cashBefore - rs(10_000));
    expect(st.investments.valueMinor).toBe(rs(10_000));
    expect(st.assets.totalMinor).toBe(assetsBefore);
    expect(st.netWorthMinor).toBe(rs(395_000));
    expect(s.report().expensesMinor).toBe(rs(5_000)); // investing is not an expense

    // 7. Investment is now worth ₹11,500: net worth +₹1,500
    s.ok({ type: "update_valuation", date: D, holdingId: fund.id, valueMinor: rs(11_500) });
    st = s.state();
    expect(st.investments.valueMinor).toBe(rs(11_500));
    expect(st.investments.gainMinor).toBe(rs(1_500));
    expect(st.netWorthMinor).toBe(rs(396_500));

    // Rahul: lent 10,000, repaid 5,000, 5,000 left; and borrowed 20,000, nothing repaid
    const rs1 = st.people.find((p) => p.person.id === rahul.id)!;
    expect(rs1.owedToMe).toEqual({ originalMinor: rs(10_000), receivedMinor: rs(5_000), outstandingMinor: rs(5_000) });
    expect(rs1.iOwe).toEqual({ originalMinor: rs(20_000), repaidMinor: 0, outstandingMinor: rs(20_000) });
  });
});

describe("borrowing and lending (examples 1–4)", () => {
  it("borrow then repay: Rahul shows original, repaid, outstanding", () => {
    const { s, hdfc } = startingScenario();
    const rahul = s.person("Rahul");
    s.ok({ type: "borrow", date: D, personId: rahul.id, accountId: hdfc.id, amountMinor: rs(20_000) });
    s.ok({ type: "repayment_made", date: D, personId: rahul.id, accountId: hdfc.id, amountMinor: rs(5_000) });
    const p = s.state().people[0];
    expect(p.iOwe).toEqual({ originalMinor: rs(20_000), repaidMinor: rs(5_000), outstandingMinor: rs(15_000) });
    expect(s.state().netWorthMinor).toBe(rs(400_000)); // principal repayment never changes net worth
    expect(s.report().expensesMinor).toBe(0);
  });

  it("cash flow classifies borrowing as financing, not income", () => {
    const { s, hdfc } = startingScenario();
    const rahul = s.person("Rahul");
    s.ok({ type: "borrow", date: D, personId: rahul.id, accountId: hdfc.id, amountMinor: rs(20_000) });
    s.ok({ type: "repayment_made", date: D, personId: rahul.id, accountId: hdfc.id, amountMinor: rs(5_000) });
    const flow = s.report().cashFlow;
    expect(flow.borrowing).toEqual({ inflowMinor: rs(20_000), outflowMinor: rs(5_000) });
    expect(flow.income).toEqual({ inflowMinor: 0, outflowMinor: 0 });
  });

  it("rejects being repaid more than is owed, or by someone who owes nothing", () => {
    const { s, hdfc } = startingScenario();
    const rahul = s.person("Rahul");
    const amit = s.person("Amit");
    s.ok({ type: "lend", date: D, personId: rahul.id, accountId: hdfc.id, amountMinor: rs(10_000) });
    const tooMuch = s.record({ type: "repayment_received", date: D, personId: rahul.id, accountId: hdfc.id, amountMinor: rs(10_001) });
    expect(tooMuch.ok).toBe(false);
    const nothing = s.record({ type: "repayment_received", date: D, personId: amit.id, accountId: hdfc.id, amountMinor: rs(1) });
    expect(nothing.ok).toBe(false);
    const overPay = s.record({ type: "repayment_made", date: D, personId: rahul.id, accountId: hdfc.id, amountMinor: rs(1) });
    expect(overPay.ok).toBe(false); // can't repay a debt that doesn't exist
  });

  it("rejects a repayment dated before the money was lent", () => {
    const { s, hdfc } = startingScenario();
    const rahul = s.person("Rahul");
    s.ok({ type: "lend", date: "2026-10-10", personId: rahul.id, accountId: hdfc.id, amountMinor: rs(10_000) });
    const early = s.record({ type: "repayment_received", date: "2026-10-05", personId: rahul.id, accountId: hdfc.id, amountMinor: rs(4_000) });
    expect(early.ok).toBe(false);
  });
});

describe("split expenses and reimbursements (examples 5–6)", () => {
  it("a ₹3,000 bill with ₹2,000 owed by friends is only a ₹1,000 expense", () => {
    const { s, hdfc } = startingScenario();
    const friends = s.person("Friends");
    s.ok({ type: "split_expense", date: D, accountId: hdfc.id, totalMinor: rs(3_000), categoryId: "food", shares: [{ personId: friends.id, amountMinor: rs(2_000) }] });
    const st = s.state();
    expect(s.report().expensesMinor).toBe(rs(1_000));
    expect(s.report().expensesByCategory).toEqual([{ categoryId: "food", amountMinor: rs(1_000) }]);
    expect(st.assets.receivablesMinor).toBe(rs(2_000));
    expect(st.cashMinor).toBe(rs(497_000));
    expect(st.netWorthMinor).toBe(rs(399_000)); // only the personal ₹1,000 reduced net worth

    // The friend pays: expense stays ₹1,000
    s.ok({ type: "repayment_received", date: D, personId: friends.id, accountId: hdfc.id, amountMinor: rs(2_000) });
    expect(s.report().expensesMinor).toBe(rs(1_000));
    expect(s.state().assets.receivablesMinor).toBe(0);
    expect(s.state().cashMinor).toBe(rs(499_000));
    expect(s.report().incomeMinor).toBe(0);
  });

  it("splits between several people and merges repeated names", () => {
    const { s, hdfc } = startingScenario();
    const a = s.person("Asha");
    const b = s.person("Bala");
    s.ok({
      type: "split_expense", date: D, accountId: hdfc.id, totalMinor: rs(4_000), categoryId: "food",
      shares: [{ personId: a.id, amountMinor: rs(1_000) }, { personId: b.id, amountMinor: rs(1_000) }, { personId: a.id, amountMinor: rs(500) }],
    });
    const st = s.state();
    expect(s.report().expensesMinor).toBe(rs(1_500));
    expect(st.people.find((p) => p.person.id === a.id)!.owedToMe.outstandingMinor).toBe(rs(1_500));
  });

  it("rejects shares larger than the bill", () => {
    const { s, hdfc } = startingScenario();
    const f = s.person("Friend");
    const r = s.record({ type: "split_expense", date: D, accountId: hdfc.id, totalMinor: rs(1_000), categoryId: "food", shares: [{ personId: f.id, amountMinor: rs(1_001) }] });
    expect(r.ok).toBe(false);
  });

  it("a fully reimbursable expense has ₹0 personal cost, before and after being reimbursed", () => {
    const { s, hdfc } = startingScenario();
    const company = s.person("Company");
    s.ok({ type: "reimbursable_expense", date: D, accountId: hdfc.id, amountMinor: rs(5_000), categoryId: "travel", personId: company.id });
    expect(s.report().expensesMinor).toBe(0);
    expect(s.state().assets.receivablesMinor).toBe(rs(5_000));
    expect(s.state().netWorthMinor).toBe(rs(400_000));

    s.ok({ type: "repayment_received", date: D, personId: company.id, accountId: hdfc.id, amountMinor: rs(5_000) });
    expect(s.report().expensesMinor).toBe(0);
    expect(s.report().incomeMinor).toBe(0);
    expect(s.state().cashMinor).toBe(rs(500_000));
    expect(s.state().netWorthMinor).toBe(rs(400_000));
  });
});

describe("investments (examples 7–8)", () => {
  it("selling for a gain uses cost basis; only the gain is economic result", () => {
    const { s, hdfc } = startingScenario();
    const fund = s.investment("Fund");
    s.ok({ type: "invest", date: D, fromAccountId: hdfc.id, holdingId: fund.id, amountMinor: rs(10_000) });
    s.ok({ type: "sell_investment", date: D, holdingId: fund.id, toAccountId: hdfc.id, proceedsMinor: rs(12_000) });
    const st = s.state();
    expect(st.investments.valueMinor).toBe(0);
    expect(st.cashMinor).toBe(rs(502_000));
    expect(st.netWorthMinor).toBe(rs(402_000)); // +₹2,000 gain, not +₹12,000
    expect(s.report().incomeMinor).toBe(0); // the sale is not income
    expect(s.report().investmentGainMinor).toBe(rs(2_000));
  });

  it("revalue first, then sell: net worth reflects the gain exactly once", () => {
    const { s, hdfc } = startingScenario();
    const fund = s.investment("Fund");
    s.ok({ type: "invest", date: "2026-10-01", fromAccountId: hdfc.id, holdingId: fund.id, amountMinor: rs(10_000) });
    s.ok({ type: "update_valuation", date: "2026-10-02", holdingId: fund.id, valueMinor: rs(11_500) });
    expect(s.state().netWorthMinor).toBe(rs(401_500));
    s.ok({ type: "sell_investment", date: "2026-10-03", holdingId: fund.id, toAccountId: hdfc.id, proceedsMinor: rs(12_000) });
    expect(s.state().netWorthMinor).toBe(rs(402_000)); // 1,500 booked + 500 more at sale
    expect(s.report().investmentGainMinor).toBe(rs(2_000));
  });

  it("selling at a loss lowers net worth by the loss", () => {
    const { s, hdfc } = startingScenario();
    const fund = s.investment("Fund");
    s.ok({ type: "invest", date: D, fromAccountId: hdfc.id, holdingId: fund.id, amountMinor: rs(10_000) });
    s.ok({ type: "sell_investment", date: D, holdingId: fund.id, toAccountId: hdfc.id, proceedsMinor: rs(8_000) });
    expect(s.state().netWorthMinor).toBe(rs(398_000));
    expect(s.report().investmentGainMinor).toBe(-rs(2_000));
  });

  it("a partial sale consumes cost proportionally", () => {
    const { s, hdfc } = startingScenario();
    const fund = s.investment("Fund");
    s.ok({ type: "invest", date: "2026-10-01", fromAccountId: hdfc.id, holdingId: fund.id, amountMinor: rs(10_000) });
    s.ok({ type: "update_valuation", date: "2026-10-02", holdingId: fund.id, valueMinor: rs(12_000) });
    // sell a quarter (₹3,000 of value) for ₹3,000: cost sold = 2,500
    s.ok({ type: "sell_investment", date: "2026-10-03", holdingId: fund.id, toAccountId: hdfc.id, proceedsMinor: rs(3_000), soldValueMinor: rs(3_000) });
    const h = s.state().investments.holdings[0];
    expect(h.valueMinor).toBe(rs(9_000));
    expect(h.costBasisMinor).toBe(rs(7_500));
    expect(h.gainMinor).toBe(rs(1_500)); // still 3/4 of the original 2,000 gain
    expect(s.state().netWorthMinor).toBe(rs(402_000));
  });

  it("can't sell more than is held, or from an empty holding", () => {
    const { s, hdfc } = startingScenario();
    const fund = s.investment("Fund");
    expect(s.record({ type: "sell_investment", date: D, holdingId: fund.id, toAccountId: hdfc.id, proceedsMinor: rs(100) }).ok).toBe(false);
    s.ok({ type: "invest", date: D, fromAccountId: hdfc.id, holdingId: fund.id, amountMinor: rs(1_000) });
    expect(s.record({ type: "sell_investment", date: D, holdingId: fund.id, toAccountId: hdfc.id, proceedsMinor: rs(100), soldValueMinor: rs(1_001) }).ok).toBe(false);
  });

  it("an investment can't be paid for from a credit card or used as a spending account", () => {
    const s = new Scenario();
    const card = s.account({ name: "Card", type: "credit_card" });
    const fund = s.investment("Fund");
    expect(s.record({ type: "invest", date: D, fromAccountId: card.id, holdingId: fund.id, amountMinor: rs(100) }).ok).toBe(false);
    expect(s.record({ type: "expense", date: D, accountId: fund.id, amountMinor: rs(100), categoryId: "food" }).ok).toBe(false);
  });
});

describe("credit cards and transfers (examples 11–12)", () => {
  it("a card purchase is the expense; paying the bill is not a second expense", () => {
    const s = new Scenario();
    const bank = s.account({ name: "HDFC", type: "bank", openingBalanceMinor: rs(50_000) });
    const card = s.account({ name: "Card", type: "credit_card" });

    s.ok({ type: "expense", date: D, accountId: card.id, amountMinor: rs(5_000), categoryId: "shopping" });
    let st = s.state();
    expect(st.liabilities.creditCardsMinor).toBe(rs(5_000));
    expect(st.cashMinor).toBe(rs(50_000)); // cash unchanged
    expect(st.netWorthMinor).toBe(rs(45_000));
    expect(s.report().expensesMinor).toBe(rs(5_000));

    s.ok({ type: "transfer", date: D, fromAccountId: bank.id, toAccountId: card.id, amountMinor: rs(5_000) });
    st = s.state();
    expect(st.liabilities.creditCardsMinor).toBe(0);
    expect(st.cashMinor).toBe(rs(45_000));
    expect(st.netWorthMinor).toBe(rs(45_000)); // unchanged by paying the bill
    expect(s.report().expensesMinor).toBe(rs(5_000)); // still counted once
    expect(s.report().cashFlow.debt_payment.outflowMinor).toBe(rs(5_000));
  });

  it("a transfer between own accounts changes no income, expense or net worth", () => {
    const s = new Scenario();
    const a = s.account({ name: "HDFC", type: "bank", openingBalanceMinor: rs(100_000) });
    const b = s.account({ name: "ICICI", type: "bank" });
    s.ok({ type: "transfer", date: D, fromAccountId: a.id, toAccountId: b.id, amountMinor: rs(20_000) });
    const st = s.state();
    expect(st.accounts.find((x) => x.account.id === a.id)!.balanceMinor).toBe(rs(80_000));
    expect(st.accounts.find((x) => x.account.id === b.id)!.balanceMinor).toBe(rs(20_000));
    expect(st.assets.totalMinor).toBe(rs(100_000));
    expect(st.netWorthMinor).toBe(rs(100_000));
    expect(s.report().incomeMinor).toBe(0);
    expect(s.report().expensesMinor).toBe(0);
  });

  it("rejects a transfer to the same account", () => {
    const { s, hdfc } = startingScenario();
    expect(s.record({ type: "transfer", date: D, fromAccountId: hdfc.id, toAccountId: hdfc.id, amountMinor: rs(1) }).ok).toBe(false);
  });

  it("paying down a loan lowers the liability but isn't spending", () => {
    const { s, hdfc, loan } = startingScenario();
    s.ok({ type: "transfer", date: D, fromAccountId: hdfc.id, toAccountId: loan.id, amountMinor: rs(15_000) });
    const st = s.state();
    expect(st.liabilities.loansMinor).toBe(rs(85_000));
    expect(st.netWorthMinor).toBe(rs(400_000));
    expect(s.report().expensesMinor).toBe(0);
  });
});

describe("income (example 13)", () => {
  it("salary raises cash, income and net worth", () => {
    const { s, hdfc } = startingScenario();
    s.ok({ type: "income", date: D, accountId: hdfc.id, amountMinor: rs(100_000), categoryId: "salary" });
    expect(s.state().cashMinor).toBe(rs(600_000));
    expect(s.report().incomeMinor).toBe(rs(100_000));
    expect(s.report().savingsMinor).toBe(rs(100_000));
    expect(s.state().netWorthMinor).toBe(rs(500_000));
  });
});

describe("editing and deleting events recalculates every linked effect", () => {
  it("changing a borrow from ₹20,000 to ₹15,000 adjusts the account and the liability", async () => {
    const { updateEvent } = await import("@/lib/finance/book-ops");
    const { s, hdfc } = startingScenario();
    const rahul = s.person("Rahul");
    const borrow = s.ok({ type: "borrow", date: D, personId: rahul.id, accountId: hdfc.id, amountMinor: rs(20_000) });
    const r = updateEvent(s.book, borrow.id, { type: "borrow", date: D, personId: rahul.id, accountId: hdfc.id, amountMinor: rs(15_000) }, s.clock);
    expect(r.ok).toBe(true);
    if (r.ok) s.book = r.value;
    const st = s.state();
    expect(st.cashMinor).toBe(rs(515_000));
    expect(st.liabilities.borrowedMinor).toBe(rs(15_000));
    expect(st.netWorthMinor).toBe(rs(400_000));
  });

  it("deleting an event removes all its effects", async () => {
    const { deleteEvent } = await import("@/lib/finance/book-ops");
    const { s, hdfc } = startingScenario();
    const rahul = s.person("Rahul");
    const borrow = s.ok({ type: "borrow", date: D, personId: rahul.id, accountId: hdfc.id, amountMinor: rs(20_000) });
    const r = deleteEvent(s.book, borrow.id);
    expect(r.ok).toBe(true);
    if (r.ok) s.book = r.value;
    expect(s.state().cashMinor).toBe(rs(500_000));
    expect(s.state().liabilities.borrowedMinor).toBe(0);
    expect(s.ledger.entries.some((e) => e.sourceId === borrow.id)).toBe(false);
  });

  it("refuses to delete or shrink a borrow that later repayments depend on", async () => {
    const { deleteEvent, updateEvent } = await import("@/lib/finance/book-ops");
    const { s, hdfc } = startingScenario();
    const rahul = s.person("Rahul");
    const borrow = s.ok({ type: "borrow", date: "2026-10-01", personId: rahul.id, accountId: hdfc.id, amountMinor: rs(20_000) });
    s.ok({ type: "repayment_made", date: "2026-10-02", personId: rahul.id, accountId: hdfc.id, amountMinor: rs(5_000) });

    expect(deleteEvent(s.book, borrow.id).ok).toBe(false);
    const shrink = updateEvent(s.book, borrow.id, { type: "borrow", date: "2026-10-01", personId: rahul.id, accountId: hdfc.id, amountMinor: rs(3_000) }, s.clock);
    expect(shrink.ok).toBe(false);
    // the book is unchanged
    expect(s.state().liabilities.borrowedMinor).toBe(rs(15_000));
  });

  it("an investment edit flows through the later sale", async () => {
    const { updateEvent } = await import("@/lib/finance/book-ops");
    const { s, hdfc } = startingScenario();
    const fund = s.investment("Fund");
    const buy = s.ok({ type: "invest", date: "2026-10-01", fromAccountId: hdfc.id, holdingId: fund.id, amountMinor: rs(10_000) });
    s.ok({ type: "sell_investment", date: "2026-10-02", holdingId: fund.id, toAccountId: hdfc.id, proceedsMinor: rs(12_000) });
    expect(s.state().netWorthMinor).toBe(rs(402_000));
    const r = updateEvent(s.book, buy.id, { type: "invest", date: "2026-10-01", fromAccountId: hdfc.id, holdingId: fund.id, amountMinor: rs(11_000) }, s.clock);
    expect(r.ok).toBe(true);
    if (r.ok) s.book = r.value;
    expect(s.state().netWorthMinor).toBe(rs(401_000)); // cost 11,000, sold 12,000: gain 1,000
  });

  it("a rejected account change leaves the book alone", async () => {
    const { deleteAccount } = await import("@/lib/finance/book-ops");
    const { s, hdfc } = startingScenario();
    s.ok({ type: "expense", date: D, accountId: hdfc.id, amountMinor: rs(1), categoryId: "food" });
    expect(deleteAccount(s.book, hdfc.id).ok).toBe(false);
  });
});

describe("undo, rename and delete people", () => {
  it("restoring a deleted entry brings back exactly the same numbers", async () => {
    const { deleteEvent, restoreEvent } = await import("@/lib/finance/book-ops");
    const { s, hdfc } = startingScenario();
    const rahul = s.person("Rahul");
    s.ok({ type: "borrow", date: D, personId: rahul.id, accountId: hdfc.id, amountMinor: rs(20_000) });
    const expense = s.ok({ type: "expense", date: D, accountId: hdfc.id, amountMinor: rs(500), categoryId: "food", description: "Lunch" });
    const before = JSON.stringify(s.state());

    const removed = deleteEvent(s.book, expense.id);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(JSON.stringify(deriveState(removed.value, buildLedger(removed.value), s.today))).not.toBe(before);

    const back = restoreEvent(removed.value, expense);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(JSON.stringify(deriveState(back.value, buildLedger(back.value), s.today))).toBe(before);
    expect(restoreEvent(back.value, expense).ok).toBe(false); // can't restore twice
  });

  it("a restore that would now be invalid is refused", async () => {
    const { deleteEvent, restoreEvent } = await import("@/lib/finance/book-ops");
    const { s, hdfc } = startingScenario();
    const rahul = s.person("Rahul");
    const borrow = s.ok({ type: "borrow", date: D, personId: rahul.id, accountId: hdfc.id, amountMinor: rs(20_000) });
    const removed = deleteEvent(s.book, borrow.id);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    // An entry that points at an account that no longer exists can't be put back.
    const orphan = { ...borrow, accountId: "gone" } as typeof borrow;
    expect(restoreEvent(removed.value, orphan).ok).toBe(false);
  });

  it("renames a person everywhere and rejects duplicates and blanks", async () => {
    const { renamePerson } = await import("@/lib/finance/book-ops");
    const { s, hdfc } = startingScenario();
    const rahul = s.person("Rahul");
    s.person("Amit");
    s.ok({ type: "lend", date: D, personId: rahul.id, accountId: hdfc.id, amountMinor: rs(1_000) });

    expect(renamePerson(s.book, rahul.id, "  ").ok).toBe(false);
    expect(renamePerson(s.book, rahul.id, "amit").ok).toBe(false);
    const ok = renamePerson(s.book, rahul.id, "Rahul Sharma");
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      const st = deriveState(ok.value, buildLedger(ok.value), s.today);
      expect(st.people.find((p) => p.person.id === rahul.id)!.person.name).toBe("Rahul Sharma");
      expect(st.people.find((p) => p.person.id === rahul.id)!.owedToMe.outstandingMinor).toBe(rs(1_000));
    }
  });

  it("deletes a person only when nothing refers to them", async () => {
    const { deletePerson } = await import("@/lib/finance/book-ops");
    const { s, hdfc } = startingScenario();
    const rahul = s.person("Rahul");
    const friends = s.person("Friends");
    const spare = s.person("Spare");
    s.ok({ type: "lend", date: D, personId: rahul.id, accountId: hdfc.id, amountMinor: rs(1_000) });
    s.ok({ type: "split_expense", date: D, accountId: hdfc.id, totalMinor: rs(900), categoryId: "food", shares: [{ personId: friends.id, amountMinor: rs(300) }] });

    expect(deletePerson(s.book, rahul.id).ok).toBe(false);
    expect(deletePerson(s.book, friends.id).ok).toBe(false); // used only inside a split
    const gone = deletePerson(s.book, spare.id);
    expect(gone.ok).toBe(true);
    if (gone.ok) expect(gone.value.people.map((p) => p.name)).toEqual(["Rahul", "Friends"]);
  });
});

describe("validation", () => {
  it("rejects zero, negative, fractional-paise and absurd amounts", () => {
    const { s, hdfc } = startingScenario();
    const base = { type: "expense" as const, date: D, accountId: hdfc.id, categoryId: "food" };
    expect(s.record({ ...base, amountMinor: 0 }).ok).toBe(false);
    expect(s.record({ ...base, amountMinor: -100 }).ok).toBe(false);
    expect(s.record({ ...base, amountMinor: 10.5 }).ok).toBe(false);
    expect(s.record({ ...base, amountMinor: Number.NaN }).ok).toBe(false);
    expect(s.record({ ...base, amountMinor: 1e15 }).ok).toBe(false);
  });

  it("rejects impossible dates and unknown accounts or people", () => {
    const { s, hdfc } = startingScenario();
    expect(s.record({ type: "expense", date: "2026-02-31", accountId: hdfc.id, amountMinor: 100, categoryId: "food" }).ok).toBe(false);
    expect(s.record({ type: "expense", date: D, accountId: "nope", amountMinor: 100, categoryId: "food" }).ok).toBe(false);
    expect(s.record({ type: "lend", date: D, personId: "ghost", accountId: hdfc.id, amountMinor: 100 }).ok).toBe(false);
  });

  it("future-dated events don't count until their day", () => {
    const { s, hdfc } = startingScenario();
    s.ok({ type: "expense", date: "2026-12-25", accountId: hdfc.id, amountMinor: rs(1_000), categoryId: "food" });
    expect(s.state("2026-10-04").netWorthMinor).toBe(rs(400_000));
    expect(s.state("2026-12-25").netWorthMinor).toBe(rs(399_000));
  });
});

describe("integrity: the ledger always balances", () => {
  it("every entry sums to zero and net worth equals what equity explains, across random histories", () => {
    // Small deterministic generator so failures are reproducible.
    let seed = 12345;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

    const acceptedByType = new Map<string, number>();
    for (let run = 0; run < 25; run++) {
      const s = new Scenario();
      const bank = s.account({ name: "Bank", type: "bank", openingBalanceMinor: rs(100_000) });
      const bank2 = s.account({ name: "Bank 2", type: "bank" });
      const card = s.account({ name: "Card", type: "credit_card" });
      const loan = s.account({ name: "Loan", type: "loan", openingBalanceMinor: rs(50_000) });
      const people = [s.person("A"), s.person("B")];
      const fund = s.investment("Fund");

      for (let i = 0; i < 60; i++) {
        const date = `2026-0${1 + Math.floor(rand() * 9)}-${String(1 + Math.floor(rand() * 27)).padStart(2, "0")}`;
        const amountMinor = rs(1 + Math.floor(rand() * 5000));
        const p = pick(people);
        const draft = pick([
          () => ({ type: "expense" as const, date, accountId: pick([bank.id, card.id]), amountMinor, categoryId: "food" }),
          () => ({ type: "income" as const, date, accountId: bank.id, amountMinor, categoryId: "salary" }),
          () => ({ type: "transfer" as const, date, fromAccountId: bank.id, toAccountId: pick([bank2.id, card.id, loan.id]), amountMinor }),
          () => ({ type: "lend" as const, date, personId: p.id, accountId: bank.id, amountMinor }),
          () => ({ type: "borrow" as const, date, personId: p.id, accountId: bank.id, amountMinor }),
          () => ({ type: "repayment_received" as const, date, personId: p.id, accountId: bank.id, amountMinor }),
          () => ({ type: "repayment_made" as const, date, personId: p.id, accountId: bank.id, amountMinor }),
          () => ({ type: "split_expense" as const, date, accountId: bank.id, totalMinor: amountMinor * 2, categoryId: "food", shares: [{ personId: p.id, amountMinor }] }),
          () => ({ type: "reimbursable_expense" as const, date, accountId: card.id, amountMinor, categoryId: "travel", personId: p.id }),
          () => ({ type: "invest" as const, date, fromAccountId: bank.id, holdingId: fund.id, amountMinor }),
          () => ({ type: "update_valuation" as const, date, holdingId: fund.id, valueMinor: rs(Math.floor(rand() * 20000)) }),
          () => ({ type: "sell_investment" as const, date, holdingId: fund.id, toAccountId: bank2.id, proceedsMinor: amountMinor }),
        ])();
        const result = s.record(draft); // some are rejected by the engine, which is fine
        if (result.ok) acceptedByType.set(draft.type, (acceptedByType.get(draft.type) ?? 0) + 1);
      }

      const ledger = buildLedger(s.book);
      expect(ledger.issues).toEqual([]); // anything accepted must replay cleanly
      for (const entry of ledger.entries) {
        expect(entry.postings.reduce((t, x) => t + x.amountMinor, 0)).toBe(0);
      }
      const asOf = "2026-12-31";
      const st = s.state(asOf);
      expect(st.netWorthMinor).toBe(st.assets.totalMinor - st.liabilities.totalMinor);
      expect(st.netWorthMinor).toBe(netWorthFromEquity(ledger, asOf));
      // spending rows add up to the period report
      const report = s.report("2026-01-01", asOf);
      expect(spendingRows(ledger.entries).reduce((t, r) => t + r.amountMinor, 0)).toBe(report.expensesMinor);
    }

    // Guard against a vacuous pass: every event type must have been accepted a meaningful number of times.
    const types = ["expense", "income", "transfer", "lend", "borrow", "repayment_received", "repayment_made",
      "split_expense", "reimbursable_expense", "invest", "update_valuation", "sell_investment"];
    for (const t of types) expect(acceptedByType.get(t) ?? 0, `accepted ${t}`).toBeGreaterThan(10);
  });
});

describe("mulDivRound", () => {
  it("is exact for large values and rounds half up", () => {
    expect(mulDivRound(10_000_00, 3_000_00, 12_000_00)).toBe(2_500_00);
    expect(mulDivRound(1, 1, 2)).toBe(1);
    expect(mulDivRound(1, 1, 3)).toBe(0);
    expect(mulDivRound(999_999_999_999, 999_999_999_999, 999_999_999_999)).toBe(999_999_999_999);
  });
});

describe("repayments that predate the records", () => {
  it("manual entries stay strict, but a flagged repayment may exceed the recorded balance", () => {
    const { s, hdfc } = startingScenario();
    const amit = s.person("Amit");
    expect(s.record({ type: "repayment_received", date: D, personId: amit.id, accountId: hdfc.id, amountMinor: rs(1_000) }).ok).toBe(false);

    const before = s.state();
    s.ok({ type: "repayment_received", date: D, personId: amit.id, accountId: hdfc.id, amountMinor: rs(1_000), predatesRecords: true });
    const after = s.state();
    expect(after.cashMinor - before.cashMinor).toBe(rs(1_000)); // the money really arrived
    expect(after.assets.receivablesMinor).toBe(0); // nothing negative is invented
    expect(after.netWorthMinor - before.netWorthMinor).toBe(rs(1_000)); // a claim from before tracking, now collected
    expect(buildLedger(s.book).issues).toEqual([]);
  });

  it("only the unrecorded part goes to opening equity", () => {
    const { s, hdfc } = startingScenario();
    const rahul = s.person("Rahul");
    s.ok({ type: "lend", date: D, personId: rahul.id, accountId: hdfc.id, amountMinor: rs(300) });
    const before = s.state();
    s.ok({ type: "repayment_received", date: "2026-10-02", personId: rahul.id, accountId: hdfc.id, amountMinor: rs(1_000), predatesRecords: true });
    const after = s.state();
    expect(after.assets.receivablesMinor).toBe(0);
    expect(after.cashMinor - before.cashMinor).toBe(rs(1_000));
    expect(after.netWorthMinor - before.netWorthMinor).toBe(rs(700));
  });

  it("a flagged repayment you make reduces net worth by the unrecorded part", () => {
    const { s, hdfc } = startingScenario();
    const amit = s.person("Amit");
    const before = s.state();
    s.ok({ type: "repayment_made", date: D, personId: amit.id, accountId: hdfc.id, amountMinor: rs(500), predatesRecords: true });
    const after = s.state();
    expect(before.cashMinor - after.cashMinor).toBe(rs(500));
    expect(before.netWorthMinor - after.netWorthMinor).toBe(rs(500));
    expect(after.liabilities.borrowedMinor).toBe(0);
  });
});
