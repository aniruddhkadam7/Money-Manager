"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, Eye, EyeOff, Loader2, Wallet } from "lucide-react";
import { useAnimate } from "motion/react";
import type { Session } from "@supabase/supabase-js";
import { BlurFade } from "@/components/ui/blur-fade";
import { BorderBeam } from "@/components/ui/border-beam";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Particles } from "@/components/ui/particles";
import { cloudConfigured, supabase } from "@/lib/cloud/client";
import { startSync } from "@/lib/cloud/sync";

type Gate = { kind: "checking" } | { kind: "signed-out" } | { kind: "syncing" } | { kind: "ready"; offline: boolean };

/**
 * With Supabase set up, the app needs a sign-in, and the cloud copy of the data is pulled down before
 * any screen reads it. Without Supabase this renders its children straight away.
 */
export function CloudGate({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<Gate>(cloudConfigured ? { kind: "checking" } : { kind: "ready", offline: false });

  useEffect(() => {
    const sb = supabase();
    if (!sb) return;
    let started = false;
    const begin = (session: Session | null) => {
      if (!session) {
        started = false;
        setGate({ kind: "signed-out" });
        return;
      }
      if (started) return;
      started = true;
      setGate({ kind: "syncing" });
      startSync().then((ok) => setGate({ kind: "ready", offline: !ok }));
    };
    sb.auth.getSession().then(({ data }) => begin(data.session));
    const { data } = sb.auth.onAuthStateChange((_event, session) => begin(session));
    return () => data.subscription.unsubscribe();
  }, []);

  if (gate.kind === "ready") {
    return (
      <>
        {gate.offline && (
          <div className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
            Offline: showing this device&apos;s copy. Changes upload when you&apos;re back online.
          </div>
        )}
        {children}
      </>
    );
  }
  if (gate.kind === "signed-out") return <SignIn />;
  return (
    <div className="flex min-h-screen items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> {gate.kind === "syncing" ? "Loading your data…" : "Checking sign-in…"}
    </div>
  );
}

function friendlyAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return "Wrong username or password.";
  if (/rate limit|too many/i.test(message)) return "Too many attempts. Wait a minute and try again.";
  // Safari says "Load failed", Chrome "Failed to fetch": the server couldn't be reached at all.
  if (/load failed|failed to fetch|network|fetch/i.test(message)) {
    return "Couldn't connect to the server. Check your internet (try switching between Wi-Fi and mobile data) and try again.";
  }
  return message;
}

/**
 * Accounts are created by the owner; people sign in with a username or their email. Supabase needs an
 * email behind each account: a username maps to its account's real email when it has one, otherwise to
 * an address on the app's own domain that never receives mail.
 */
export const LOGIN_DOMAIN = "users.whitedotai.in";
const USERNAME_EMAILS: Record<string, string> = {
  aniruddhkadam: "theaniruddhkadam@gmail.com",
  aniruddkadam: "theaniruddhkadam@gmail.com",
};
export const loginEmail = (usernameOrEmail: string): string => {
  const u = usernameOrEmail.trim().toLowerCase();
  if (u.includes("@")) return u;
  return USERNAME_EMAILS[u] ?? `${u}@${LOGIN_DOMAIN}`;
};
/** The username behind a sign-in email, the reverse of loginEmail; undefined for an email-only account. */
export const usernameFor = (email: string): string | undefined => {
  const e = email.toLowerCase();
  if (e.endsWith(`@${LOGIN_DOMAIN}`)) return e.slice(0, -LOGIN_DOMAIN.length - 1);
  return Object.keys(USERNAME_EMAILS).find((u) => USERNAME_EMAILS[u] === e);
};


function SignIn() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [card, animate] = useAnimate<HTMLDivElement>();

  const fail = (message: string) => {
    setError(message);
    animate(card.current, { x: [0, -6, 6, -4, 4, 0] }, { duration: 0.4 });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const sb = supabase();
    if (!sb) return;
    setBusy(true);
    setError(null);
    try {
      const { error } = await sb.auth.signInWithPassword({ email: loginEmail(username), password });
      if (error) fail(friendlyAuthError(error.message));
    } catch {
      fail("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      <Particles className="absolute inset-0" quantity={120} ease={80} size={0.8} staticity={40} color="#059669" />
      <BlurFade className="relative w-full max-w-sm" duration={0.6}>
        <div
          ref={card}
          className="glass relative overflow-hidden rounded-2xl border p-8 text-foreground"
        >
          <BorderBeam size={120} duration={9} colorFrom="#10b981" colorTo="#0ea5e9" />
          <BlurFade delay={0.15} className="mb-8">
            <div className="mb-8 flex items-center gap-2.5 text-sm font-medium text-foreground">
              <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Wallet className="size-3.5" />
              </span>
              <span className="font-brand text-lg font-bold leading-none tracking-tight">Money Manager</span>
            </div>
            <h1 className="text-[1.65rem] leading-tight font-semibold tracking-tight">Welcome back</h1>
            <p className="mt-1.5 text-sm text-muted-foreground">Sign in to your account to continue.</p>
          </BlurFade>
          <form onSubmit={submit} className="space-y-5">
            <BlurFade delay={0.25} className="space-y-2">
              <Label htmlFor="username" className="text-xs font-medium text-muted-foreground">
                Username or email
              </Label>
              <Input
                id="username"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={darkInput}
              />
            </BlurFade>
            <BlurFade delay={0.35} className="space-y-2">
              <Label htmlFor="password" className="text-xs font-medium text-muted-foreground">
                Password
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${darkInput} pr-11`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute top-1/2 right-1.5 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </BlurFade>
            {error && (
              <BlurFade duration={0.25}>
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              </BlurFade>
            )}
            <BlurFade delay={0.45} className="pt-2">
              <Button
                type="submit"
                disabled={busy}
                className="group h-11 w-full font-medium shadow-sm shadow-emerald-600/20 transition-colors hover:bg-primary/90 disabled:opacity-70"
              >
                {busy && <Loader2 className="animate-spin" />}
                {busy ? "Signing in…" : "Sign in"}
                {!busy && <ArrowRight className="size-4 opacity-60 transition-transform duration-300 group-hover:translate-x-0.5" />}
              </Button>
            </BlurFade>
          </form>
        </div>
      </BlurFade>
    </div>
  );
}

const darkInput =
  "h-11 bg-muted/40 transition-colors focus-visible:bg-card";
