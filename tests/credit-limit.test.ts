import { describe, expect, it } from "vitest";
import { addAccount, updateAccount } from "@/lib/finance/book-ops";
import { startingScenario } from "./helpers";

describe("credit card limit", () => {
  it("keeps a card's limit, clears it when set to zero, and never puts one on another kind of account", () => {
    const { s, hdfc } = startingScenario();
    const added = addAccount(s.book, { name: "ICICI Credit Card", type: "credit_card", openingBalanceMinor: 0, openedOn: "2026-01-01", creditLimitMinor: 6_000_000 });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const card = added.value.account;
    expect(card.creditLimitMinor).toBe(6_000_000);

    const cleared = updateAccount(added.value.book, card.id, { creditLimitMinor: 0 });
    expect(cleared.ok && cleared.value.accounts.find((a) => a.id === card.id)).not.toHaveProperty("creditLimitMinor");

    const bank = updateAccount(s.book, hdfc.id, { creditLimitMinor: 100 });
    expect(bank.ok && bank.value.accounts.find((a) => a.id === hdfc.id)).not.toHaveProperty("creditLimitMinor");
  });
});
