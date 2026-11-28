/**
 * Your broker's trading account (Kotak Neo): money with the broker for buying shares, not a bank account. Its
 * balance comes from the broker (each sync), never from a bank statement, and it's labelled as a trading account.
 */
export const isBrokerAccount = (a: { name: string; type: string }) => a.type === "bank" && /^kotak\s*neo$/i.test(a.name.trim());
