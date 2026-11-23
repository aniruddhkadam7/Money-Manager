import { createHash, pbkdf2Sync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { pbkdf2Sha256, sha256 } from "@/lib/cloud/pbkdf2";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const bytes = (s: string) => new TextEncoder().encode(s);

describe("the passcode hashing used where the browser has none (plain http)", () => {
  it("SHA-256 matches Node's, across block boundaries", () => {
    for (const s of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "x".repeat(200)]) {
      expect(hex(sha256(bytes(s)))).toBe(createHash("sha256").update(s).digest("hex"));
    }
  });

  it("PBKDF2-HMAC-SHA-256 matches Node's, as crypto.subtle's would", () => {
    const salt = Uint8Array.from({ length: 16 }, (_, i) => (i * 37 + 11) & 255);
    for (const [pw, iters] of [["1234", 1], ["1234", 1000], ["987654", 2], ["a-very-long-password-longer-than-sixty-four-bytes-to-hash-the-key-first!!", 3]] as const) {
      expect(hex(pbkdf2Sha256(bytes(pw), salt, iters, 32))).toBe(pbkdf2Sync(pw, Buffer.from(salt), iters, 32, "sha256").toString("hex"));
    }
  });
});
