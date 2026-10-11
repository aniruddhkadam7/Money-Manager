import { describe, expect, it } from "vitest";
import type { User } from "@supabase/supabase-js";
import { lockSettings } from "@/lib/cloud/app-lock";

const passcode = { salt: "ab", hash: "cd", length: 4, iterations: 1 };
const userWith = (app_lock: unknown) => ({ user_metadata: { app_lock } }) as unknown as User;

describe("lockSettings", () => {
  it("takes passcode only, and then always asks for the passcode first", () => {
    expect(lockSettings(userWith({ passcode, unlockWith: "password", passcodeOnly: true }))).toMatchObject({ unlockWith: "passcode", passcodeOnly: true });
  });

  it("allows the password unless passcode only is on", () => {
    const s = lockSettings(userWith({ passcode, unlockWith: "password" }));
    expect(s.passcodeOnly).toBeUndefined();
    expect(s.unlockWith).toBe("password");
  });

  it("ignores passcode only without a passcode, so nobody is shut out", () => {
    expect(lockSettings(userWith({ unlockWith: "passcode", passcodeOnly: true }))).toEqual({ passcode: undefined, unlockWith: "password" });
  });
});
