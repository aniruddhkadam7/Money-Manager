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

function SignIn() {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const sb = supabase();
    if (!sb) return;
    setBusy(true);
    setMessage(null);
    const { data, error } =
      mode === "sign-in"
        ? await sb.auth.signInWithPassword({ email, password })
        : await sb.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
    setBusy(false);
    if (error) setMessage({ error: true, text: error.message });
    else if (mode === "sign-up" && !data.session) setMessage({ error: false, text: "Account created. Open the link in the email Supabase sent you, then sign in." });
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
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                minLength={8}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {message && <p className={message.error ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{message.text}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />} {mode === "sign-in" ? "Sign in" : "Create account"}
            </Button>
          </form>
          <button
            type="button"
            className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
            onClick={() => {
              setMode(mode === "sign-in" ? "sign-up" : "sign-in");
              setMessage(null);
            }}
          >
            {mode === "sign-in" ? "First time here? Create your account" : "Already have an account? Sign in"}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
