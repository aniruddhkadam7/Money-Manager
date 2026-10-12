"use client";

import { useEffect, useRef, useState, type FormEvent, type MouseEvent, type PointerEvent } from "react";
import { Delete, Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { useAnimate } from "motion/react";
import type { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { LiquidButton } from "@/components/ui/liquid-glass-button";
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

/** The digits with the letters an iPhone keypad prints under them. */
const KEYS: [string, string][] = [
  ["1", ""],
  ["2", "ABC"],
  ["3", "DEF"],
  ["4", "GHI"],
  ["5", "JKL"],
  ["6", "MNO"],
  ["7", "PQRS"],
  ["8", "TUV"],
  ["9", "WXYZ"],
];

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

  // The digits so far and whether a check is running, kept in refs too: fast taps can land before React
  // re-renders, and reading the rendered `code` would drop one of them.
  const codeRef = useRef("");
  const busyRef = useRef(false);
  const setDigits = (c: string) => {
    codeRef.current = c;
    setCode(c);
  };

  const press = (digit: string) => {
    if (disabled || busyRef.current || codeRef.current.length >= length) return;
    const next = codeRef.current + digit;
    setDigits(next);
    if (next.length < length) return;
    busyRef.current = true;
    setBusy(true);
    Promise.resolve(onComplete(next))
      .then((keep) => {
        if (keep === false) {
          animate(dots.current, { x: [0, -8, 8, -5, 5, 0] }, { duration: 0.35 });
          setDigits("");
        }
      })
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
      });
  };
  const back = () => {
    if (disabled || busyRef.current) return;
    setDigits(codeRef.current.slice(0, -1));
  };

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
    // A container, so the keys can shrink to fit a narrow space (the settings dialog on a small phone).
    <div className="@container grid w-full justify-items-center gap-11">
      <div ref={dots} className="flex h-4 items-center gap-5" aria-label={`${code.length} of ${length} digits entered`} role="status">
        {Array.from({ length }, (_, i) => (
          <span
            key={i}
            className={cn("size-4 rounded-full border-[1.5px] border-foreground/70 transition-colors duration-150", i < code.length && "border-foreground bg-foreground")}
          />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-x-[min(1.75rem,7cqi)] gap-y-[min(1.1rem,4.5cqi)]">
        {KEYS.map(([digit, letters]) => (
          <PadKey key={digit} digit={digit} letters={letters} onPress={() => press(digit)} disabled={off} />
        ))}
        <span />
        <PadKey digit="0" onPress={() => press("0")} disabled={off} />
        <button
          type="button"
          {...tapHandlers(back)}
          disabled={off || !code}
          aria-label="Delete last digit"
          className="flex size-[min(5.25rem,26cqi)] touch-manipulation items-center justify-center rounded-full text-foreground/80 transition-opacity duration-300 select-none [-webkit-tap-highlight-color:transparent] active:opacity-40 active:duration-0 disabled:opacity-0"
        >
          {busy ? <Loader2 className="size-6 animate-spin" /> : <Delete className="size-8" strokeWidth={1.6} />}
        </button>
      </div>
    </div>
  );
}

/**
 * A key counts the moment a finger or the mouse goes down, like the iPhone's keypad, rather than on click:
 * a click is lost when the finger slides a little between down and up. Enter or Space on a focused key
 * still works, through the click those fire (detail 0, no pointer).
 */
function tapHandlers(onPress: () => void) {
  return {
    onPointerDown: (e: PointerEvent) => {
      if (e.button !== 0) return;
      // No focus ring or text selection from the tap.
      e.preventDefault();
      onPress();
    },
    onClick: (e: MouseEvent) => {
      if (e.detail === 0) onPress();
    },
  };
}

/**
 * One round glass key, like the app's other liquid glass buttons: the digit, and its letters underneath.
 * Pressed, it lights up at once and fades back slowly on release, like the iPhone's keypad.
 */
function PadKey({ digit, letters, onPress, disabled }: { digit: string; letters?: string; onPress: () => void; disabled?: boolean }) {
  const [pressed, setPressed] = useState(false);
  const release = () => setPressed(false);
  const tap = tapHandlers(onPress);
  return (
    <LiquidButton
      size="icon"
      onClick={tap.onClick}
      onPointerDown={(e) => {
        if (!disabled && e.button === 0) setPressed(true);
        tap.onPointerDown(e);
      }}
      onPointerUp={release}
      onPointerLeave={release}
      onPointerCancel={release}
      disabled={disabled}
      aria-label={digit}
      // touch-manipulation: no double-tap zoom, so tapping the same digit twice quickly counts twice.
      className="size-[min(5.25rem,26cqi)] touch-manipulation rounded-full bg-card/55 text-foreground shadow-sm select-none [-webkit-tap-highlight-color:transparent] hover:scale-100"
    >
      <span
        aria-hidden
        className={cn(
          // Sized to the whole key and centred: the button's content box is only as big as the digit.
          "pointer-events-none absolute top-1/2 left-1/2 size-[min(5.25rem,26cqi)] -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/20 dark:bg-white/35",
          pressed ? "opacity-100 duration-0" : "opacity-0 transition-opacity duration-500 ease-out",
        )}
      />
      <span className="relative flex flex-col items-center leading-none">
        <span className="text-[2.375rem] font-light tabular-nums">{digit}</span>
        {letters ? (
          <span className="mt-0.5 text-[0.65rem] font-semibold tracking-[0.18em] text-foreground/70">{letters}</span>
        ) : (
          digit !== "0" && <span className="mt-0.5 h-[0.65rem]" />
        )}
      </span>
    </LiquidButton>
  );
}

/** Covers the app until the passcode or the account password is entered; the default way shows first. */
export function LockScreen({ user, onUnlock }: { user: User; onUnlock: () => void }) {
  const settings = lockSettings(user);
  const [tooMany, setTooMany] = useState(() => passcodeFails() >= MAX_PASSCODE_TRIES);
  const [method, setMethod] = useState<UnlockMethod>(settings.unlockWith);
  const [error, setError] = useState<string | null>(null);
  // Passcode only: no password on this screen; too many wrong tries leave signing in again as the way back.
  const allowPassword = !settings.passcodeOnly;
  const usePasscode = (method === "passcode" || !allowPassword) && !!settings.passcode && !tooMany;
  const stuck = !allowPassword && tooMany;

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
      setError(allowPassword ? "Too many wrong passcodes. Enter your password to unlock." : "Too many wrong passcodes. Sign out, then sign in with your password.");
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
    // Like the iPhone's own passcode screen: full screen, the keypad in the middle, the two ways out at the bottom.
    <div className="relative flex min-h-dvh flex-col items-center overflow-hidden bg-background px-6 pt-[max(3.5rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <div className="relative flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-10">
        <div className="grid justify-items-center gap-3 text-center">
          <Lock className="size-6 text-foreground/80" strokeWidth={1.8} />
          <h1 className="text-xl font-semibold tracking-tight">{stuck ? "Money Manager is unavailable" : usePasscode ? "Enter Passcode" : "Enter Password"}</h1>
          <p role="alert" className={cn("min-h-5 text-sm", error ? "text-destructive" : "text-muted-foreground")}>
            {error ?? (stuck ? "Too many wrong passcodes. Sign out, then sign in with your password." : "Money Manager is locked")}
          </p>
        </div>

        {stuck ? null : usePasscode ? (
          <PasscodePad length={settings.passcode!.length} onComplete={tryPasscode} />
        ) : (
          <PasswordUnlock user={user} onUnlock={onUnlock} onError={setError} />
        )}
      </div>

      <div className="relative flex w-full max-w-sm items-center justify-between pt-6 text-[15px] font-medium">
        {settings.passcode && allowPassword && !tooMany ? (
          <button type="button" className="px-2 py-2 transition-opacity active:opacity-50" onClick={() => switchTo(usePasscode ? "password" : "passcode")}>
            {usePasscode ? "Use password" : "Use passcode"}
          </button>
        ) : (
          <span />
        )}
        <SignOutButton />
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
    <button
      type="button"
      className="flex items-center gap-1.5 px-2 py-2 transition-opacity active:opacity-50 disabled:opacity-50"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        if (!(await signOut())) setBusy(false);
      }}
    >
      {busy && <Loader2 className="size-4 animate-spin" />} Sign out
    </button>
  );
}
