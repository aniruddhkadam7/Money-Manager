"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Loader2, Wallet } from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
            Couldn&apos;t reach the cloud. Showing the copy saved on this device; changes upload once you&apos;re back online.
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

function SignIn() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const sb = supabase();
    if (!sb) return;
    setBusy(true);
    setError(null);
    try {
      const { error } = await sb.auth.signInWithPassword({ email: loginEmail(username), password });
      if (error) setError(friendlyAuthError(error.message));
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-5">
          <div className="flex items-center gap-2 font-semibold">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Wallet className="size-4" />
            </span>
            Money Manager
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">Username or email</Label>
              <Input
                id="username"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
