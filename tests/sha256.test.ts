import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Bytes, sha256Text } from "@/lib/statements/sha256";

describe("sha256", () => {
  it("matches node's implementation for many lengths", () => {
    for (const n of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 1000, 100_000]) {
      const b = randomBytes(n);
      expect(sha256Bytes(b), `len ${n}`).toBe(createHash("sha256").update(b).digest("hex"));
    }
    expect(sha256Text("héllo ₹")).toBe(createHash("sha256").update("héllo ₹").digest("hex"));
  });
});
