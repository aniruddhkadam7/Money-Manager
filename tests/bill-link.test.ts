import { describe, expect, it } from "vitest";
import { billFor, setBillDue, type BillsData } from "@/lib/finance/bills";

const empty: BillsData = { bills: [], overrides: {} };

describe("an entry's bill date", () => {
  it("adds a once-only bill when none is tracked yet", () => {
    const { data, billId } = setBillDue(empty, { name: "Airtel", dueDate: "2026-12-20", amountMinor: 359900 });
    expect(data.bills).toEqual([{ id: billId, name: "Airtel", dueDate: "2026-12-20", repeat: "none", amountMinor: 359900 }]);
  });

  it("updates the bill you already track by name, keeping its repeat", () => {
    const start: BillsData = { ...empty, bills: [{ id: "b1", name: "Airtel ", dueDate: "2026-11-20", repeat: "monthly", day: 20 }] };
    const { data, billId } = setBillDue(start, { name: "airtel", dueDate: "2027-02-12" });
    expect(billId).toBe("b1");
    expect(data.bills).toEqual([{ id: "b1", name: "Airtel ", dueDate: "2027-02-12", repeat: "monthly", day: 12 }]);
  });

  it("follows the link first, so a renamed entry still updates its bill", () => {
    const start: BillsData = { ...empty, bills: [{ id: "b1", name: "Phone plan", dueDate: "2026-11-20", repeat: "none" }] };
    expect(billFor(start, { billId: "b1", name: "Airtel" })?.id).toBe("b1");
    expect(setBillDue(start, { billId: "b1", name: "Airtel", dueDate: "2026-12-01" }).data.bills[0].dueDate).toBe("2026-12-01");
  });

  it("doesn't match very short names to some other bill", () => {
    const start: BillsData = { ...empty, bills: [{ id: "b1", name: "Jio", dueDate: "2026-11-20", repeat: "none" }] };
    expect(billFor(start, { name: "J" })).toBeUndefined();
  });
});
