import type { PictureName } from "../picture-icon";
import type { Category } from "@/lib/domain/types";
import type { AccountType, EventType, FinancialEvent } from "@/lib/finance/types";

/** The "What happened?" menu: plain questions, no accounting words. */
export const EVENT_OPTIONS: { type: EventType; label: string; hint: string; picture: PictureName }[] = [
  { type: "expense", label: "Expense", hint: "I spent money", picture: "shopping" },
  { type: "income", label: "Income", hint: "I got paid or earned money", picture: "income" },
  { type: "transfer", label: "Transfer", hint: "Move money between my accounts, or pay a card or loan", picture: "transfer" },
  { type: "lend", label: "Lend money", hint: "I gave someone money", picture: "lend" },
  { type: "borrow", label: "Borrow money", hint: "Someone gave me money", picture: "borrow" },
  { type: "repayment_received", label: "Got paid back", hint: "Someone repaid me", picture: "repay" },
  { type: "repayment_made", label: "Paid someone back", hint: "I repaid what I owe", picture: "repay" },
  { type: "split_expense", label: "Split expense", hint: "I paid, others owe me a share", picture: "split" },
  { type: "reimbursable_expense", label: "Reimbursement", hint: "I paid, someone will pay me back", picture: "reimburse" },
  { type: "invest", label: "Invest", hint: "I put money into an investment", picture: "invest" },
  { type: "sell_investment", label: "Sell investment", hint: "I cashed out an investment", picture: "sell" },
  { type: "update_valuation", label: "Update value", hint: "An investment is worth a different amount now", picture: "valuation" },
];

export const eventOption = (type: EventType) => EVENT_OPTIONS.find((o) => o.type === type)!;

/** Which picture represents an event in lists. Spending and income show their category. */
export function eventPicture(
  event: FinancialEvent,
  getCategory: (id: string) => Category,
): { name: PictureName; color?: string; category?: Category } {
  switch (event.type) {
    case "expense":
    case "income":
    case "split_expense":
    case "reimbursable_expense": {
      const category = getCategory(event.categoryId);
      return { name: "custom", category };
    }
    default: {
      const option = eventOption(event.type);
      return { name: option.picture };
    }
  }
}

export type FieldKey =
  | "amount"
  | "description"
  | "category"
  | "account"
  | "toAccount"
  | "person"
  | "holdingName"
  | "holdingSelect"
  | "soldValue"
  | "shares"
  | "date";

export interface FormSpec {
  fields: FieldKey[];
  labels: Partial<Record<FieldKey, string>>;
  /** Accounts offered for the main account field. */
  accountTypes: AccountType[];
  descriptionRequired?: boolean;
  categoryKind?: "expense" | "income";
}

const MONEY: AccountType[] = ["bank", "cash"];
const SPEND: AccountType[] = ["bank", "cash", "credit_card"];

export const FORM_SPEC: Record<EventType, FormSpec> = {
  expense: {
    fields: ["amount", "description", "category", "account", "date"],
    labels: { account: "Paid from", description: "What was it for?" },
    accountTypes: SPEND,
    descriptionRequired: true,
    categoryKind: "expense",
  },
  income: {
    fields: ["amount", "description", "category", "account", "date"],
    labels: { account: "Received in", description: "From (optional)" },
    accountTypes: MONEY,
    categoryKind: "income",
  },
  transfer: {
    fields: ["amount", "account", "toAccount", "date"],
    labels: { account: "From", toAccount: "To" },
    accountTypes: MONEY,
  },
  lend: {
    fields: ["person", "amount", "account", "date"],
    labels: { person: "Who did you lend to?", account: "Paid from" },
    accountTypes: MONEY,
  },
  borrow: {
    fields: ["person", "amount", "account", "date"],
    labels: { person: "Who did you borrow from?", account: "Received in" },
    accountTypes: MONEY,
  },
  repayment_received: {
    fields: ["person", "amount", "account", "date"],
    labels: { person: "Who paid you back?", account: "Received in" },
    accountTypes: MONEY,
  },
  repayment_made: {
    fields: ["person", "amount", "account", "date"],
    labels: { person: "Who did you pay back?", account: "Paid from" },
    accountTypes: MONEY,
  },
  split_expense: {
    fields: ["amount", "description", "category", "account", "shares", "date"],
    labels: { amount: "Total you paid", account: "Paid from", description: "What was it for?" },
    accountTypes: SPEND,
    descriptionRequired: true,
    categoryKind: "expense",
  },
  reimbursable_expense: {
    fields: ["amount", "description", "category", "person", "account", "date"],
    labels: { person: "Who will pay you back?", account: "Paid from", description: "What was it for?" },
    accountTypes: SPEND,
    descriptionRequired: true,
    categoryKind: "expense",
  },
  invest: {
    fields: ["amount", "holdingName", "account", "date"],
    labels: { holdingName: "Invest in", account: "Paid from" },
    accountTypes: MONEY,
  },
  sell_investment: {
    fields: ["holdingSelect", "amount", "soldValue", "account", "date"],
    labels: { holdingSelect: "Which investment?", amount: "Amount you received", account: "Received in" },
    accountTypes: MONEY,
  },
  update_valuation: {
    fields: ["holdingSelect", "amount", "date"],
    labels: { holdingSelect: "Which investment?", amount: "It is now worth" },
    accountTypes: MONEY,
  },
};
