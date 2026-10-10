"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Delete, Eye, EyeOff, Loader2, LogOut, Wallet } from "lucide-react";
import { useAnimate } from "motion/react";
import type { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MAX_PASSCODE_TRIES,
  addPasscodeFail,
  checkPasscode,
  checkPassword,
  lockSettings,
  passcodeFails,
  resetFails,
  type UnlockMethod,
} from "@/lib/cloud/app-lock";
import { signOut } from "@/lib/cloud/sign-out";
import { cn } from "@/lib/utils";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/**
 * Dots for the digits typed so far and a phone-style keypad, so a passcode can be typed on an iPhone
 * without the keyboard; a computer's number keys work too. onComplete runs once all digits are in and
 * returns whether to keep them (false clears the dots for another go).
 */
export function PasscodePad({
  length,
  onComplete,
  disabled,
}: {
  length: number;
  onComplete: (code: string) => Promise<boolean | void> | boolean | void;
  disabled?: boolean;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [dots, animate] = useAnimate<HTMLDivElement>();
  const off = disabled || busy;

  const press = (digit: string) => {
    if (off || code.length >= length) return;
    const next = code + digit;
    setCode(next);
    if (next.length < length) return;
    setBusy(true);
    Promise.resolve(onComplete(next))
      .then((keep) => {
        if (keep === false) {
          animate(dots.current, { x: [0, -8, 8, -5, 5, 0] }, { duration: 0.35 });
          setCode("");
        }
      })
      .finally(() => setBusy(false));
  };
  const back = () => !off && setCode((c) => c.slice(0, -1));

  // Typing on a keyboard: the latest press/back are read through a ref so the listener is added once.
  const keys = useRef({ press, back });
  keys.current = { press, back };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^\d$/.test(e.key)) keys.current.press(e.key);
      else if (e.key === "Backspace") keys.current.back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="grid justify-items-center gap-6">
      <div ref={dots} className="flex h-4 items-center gap-3" aria-label={`${code.length} of ${length} digits entered`} role="status">
        {Array.from({ length }, (_, i) => (
          <span
            key={i}
            className={cn("size-3.5 rounded-full border-2 border-foreground/60 transition-colors", i < code.length && "border-foreground bg-foreground")}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {KEYS.map((k) => (
          <PadKey key={k} onClick={() => press(k)} disabled={off}>
            {k}
          </PadKey>
        ))}
        <span />
        <PadKey onClick={() => press("0")} disabled={off}>
          0
        </PadKey>
        <PadKey onClick={back} disabled={off || !code} aria-label="Delete last digit" className="bg-transparent text-muted-foreground">
          {busy ? <Loader2 className="size-5 animate-spin" /> : <Delete className="size-5" />}
        </PadKey>
      </div>
    </div>
  );
}

function PadKey({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "flex size-16 items-center justify-center rounded-full bg-muted text-2xl font-medium tabular-nums transition-colors select-none hover:bg-muted/70 active:bg-foreground/15 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

/** Covers the app until the passcode or the account password is entered; the default way shows first. */
export function LockScreen({ user, onUnlock }: { user: User; onUnlock: () => void }) {
  const settings = lockSettings(user);
  const [tooMany, setTooMany] = useState(() => passcodeFails() >= MAX_PASSCODE_TRIES);
  const [method, setMethod] = useState<UnlockMethod>(settings.unlockWith);
  const [error, setError] = useState<string | null>(null);
  const usePasscode = method === "passcode" && !!settings.passcode && !tooMany;

  const tryPasscode = async (code: string) => {
    if (!settings.passcode) return false;
    if (await checkPasscode(settings.passcode, code)) {
      resetFails();
      onUnlock();
      return true;
    }
    const fails = addPasscodeFail();
    if (fails >= MAX_PASSCODE_TRIES) {
      setTooMany(true);
      setError("Too many wrong passcodes. Enter your password to unlock.");
    } else {
      setError(`Wrong passcode. ${MAX_PASSCODE_TRIES - fails} ${MAX_PASSCODE_TRIES - fails === 1 ? "try" : "tries"} left.`);
    }
    return false;
  };

  const switchTo = (m: UnlockMethod) => {
    setMethod(m);
    setError(null);
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="grid w-full max-w-xs justify-items-center gap-6 text-center">
        <span className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Wallet className="size-5" />
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Money Manager is locked</h1>
          <p className="mt-1 text-sm text-muted-foreground">{usePasscode ? "Enter your passcode." : "Enter your password."}</p>
        </div>

        {usePasscode ? (
          <PasscodePad length={settings.passcode!.length} onComplete={tryPasscode} />
        ) : (
          <PasswordUnlock user={user} onUnlock={onUnlock} onError={setError} />
        )}

        <p role="alert" className="min-h-5 text-sm text-destructive">
          {error}
        </p>

        <div className="grid gap-1">
          {settings.passcode && !tooMany && (
            <Button variant="ghost" size="sm" onClick={() => switchTo(usePasscode ? "password" : "passcode")}>
              {usePasscode ? "Use password instead" : "Use passcode instead"}
            </Button>
          )}
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}

function PasswordUnlock({ user, onUnlock, onError }: { user: User; onUnlock: () => void; onError: (m: string | null) => void }) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    onError(null);
    try {
      await checkPassword(user, password);
      resetFails();
      onUnlock();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't check the password.");
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="grid w-full gap-3 text-left">
      <Label htmlFor="unlock-password" className="sr-only">
        Password
      </Label>
      <div className="relative">
        <Input
          id="unlock-password"
          type={show ? "text" : "password"}
          autoComplete="current-password"
          required
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="h-11 pr-11"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? "Hide password" : "Show password"}
          className="absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
        >
          {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      <Button type="submit" disabled={busy || !password} className="h-11">
        {busy && <Loader2 className="animate-spin" />} Unlock
      </Button>
    </form>
  );
}

function SignOutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        if (!(await signOut())) setBusy(false);
      }}
    >
      {busy ? <Loader2 className="animate-spin" /> : <LogOut />} Sign out
    </Button>
  );
}
