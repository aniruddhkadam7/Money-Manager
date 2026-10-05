# Financial engine

One user action → automatic financial updates.

The user records a real-world **event** once. A deterministic engine turns it into balanced
**ledger postings**, and every number the app shows (balances, net worth, spending, cash flow,
who owes whom) is **derived** from those events. Nothing derived is ever stored or editable.

```
Event (what the user said)  →  engine (pure, no I/O)  →  Ledger (balanced postings)  →  derived state & reports  →  UI
```

Code: `lib/finance/` (pure TypeScript, no React). Tests: `tests/engine.test.ts` (`npm test`).

## Model

- **Account**: bank, cash, credit card, loan, investment. Has a starting balance + date. Balance is never stored.
- **Person**: someone who owes me or whom I owe. Created by typing a name.
- **Event**: one of 12 types (below). Stored as the user entered it.
- **Ledger**: double-entry. Each entry's postings sum to exactly zero (the engine throws if not).
  Ledger ids: `acct:` accounts, `recv:` money owed to me, `pay:` money I owe, `exp:` / `inc:` categories,
  `gain:` investment gains, `eq:opening` starting balances.
- **Net worth** = assets − liabilities, always derived. (It also equals what income, spending and gains explain; a test checks both.)

## What each event does

| Event | Changes | Net worth | Counts as income/expense? |
|---|---|---|---|
| Expense | account −, spending + | − | expense |
| Income | account +, income + | + | income |
| Transfer (incl. paying a card/loan) | one account −, other +/debt − | none | no |
| Lend | account −, **owed to me** + | none | no |
| Borrow | account +, **I owe** + | none | no |
| Got paid back (loan, friend's share, reimbursement) | account +, owed to me − | none | no |
| Paid someone back | account −, I owe − | none | no |
| Split expense | account −total, **my share only** as spending, others' shares owed to me | − my share | only my share |
| Reimbursable expense | account −, owed to me + | none | no (₹0 personal cost) |
| Invest | account −, investment + (cost basis +) | none | no |
| Update investment value | investment ±, gain ± | ± the change | no (a gain) |
| Sell investment | account +proceeds, investment −, gain = proceeds − cost sold | + gain only | no |

Credit cards: the purchase is the expense (liability +). Paying the bill is a transfer (liability −, bank −): never a second expense.

## Editing and deleting

Events are the source of truth; the ledger is rebuilt by replaying them in date order.
So editing or deleting an event recalculates everything that depended on it, and nothing can be orphaned.

Every change goes through `lib/finance/book-ops.ts`: it is applied to a copy, the whole history is replayed,
and if any *other* entry would become invalid (e.g. deleting a loan that a repayment depends on) the change is
**rejected** with a message naming that entry. The original data is never half-changed.

## Rules the engine enforces

- Amounts are whole paise (`Number.isSafeInteger`), > 0, and ≤ ₹1,00,000 crore. Proportional maths uses BigInt.
- A repayment can't exceed what is outstanding *at that date*.
- Shares can't exceed the bill. Transfers need two different accounts. Investments only via invest/sell/value events.
- Future-dated events don't count until their day.

## Not built yet (the engine is ready for them)

- Buy/sell assets (vehicle, property, gold), taking and repaying loans with interest, buy-with-loan in one event.
  Each is a new event type + one `case` in `engine.ts` + a form spec; the ledger, net worth and reports need no changes.
- Bank/UPI sync: a provider transaction should become a *suggested* `EventDraft` (e.g. "Looks like Rahul repaid
  ₹20,000: mark as repayment?") submitted through the same `addEvent`. There must be only one accounting path.
- Storage is the browser (`BookRepository`). Because the engine is pure, the same `Book` can be stored and
  recomputed server-side later.
