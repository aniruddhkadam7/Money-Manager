"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { BlurFade } from "@/components/ui/blur-fade";
import { Particles } from "@/components/ui/particles";
import { useProfile } from "@/lib/profile";
import { Avatar, identify } from "./profile-menu";

/** How long the greeting stays at least, so it can be read even when the data is already here. */
const MIN_SHOW_MS = 1800;

function greeting(hour: number): string {
  if (hour < 5) return "Hello";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * Shown straight after signing in with the password: the person's photo and name while their data loads,
 * then it hands over to the app (`onDone`) once the data is `ready` and the greeting has had its moment.
 */
export function WelcomeScreen({ user, ready, onDone }: { user: User | null; ready: boolean; onDone: () => void }) {
  const profile = useProfile();
  const me = identify(user, profile);
  const firstName = me.name.trim().split(/\s+/)[0];
  const [shownLongEnough, setShownLongEnough] = useState(false);
  const [hello] = useState(() => greeting(new Date().getHours()));

  useEffect(() => {
    const t = setTimeout(() => setShownLongEnough(true), MIN_SHOW_MS);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (ready && shownLongEnough) onDone();
  }, [ready, shownLongEnough, onDone]);

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-6" role="status" aria-live="polite">
      <Particles className="absolute inset-0" quantity={120} ease={80} size={0.8} staticity={40} color="#059669" />
      <div className="relative grid justify-items-center gap-5 text-center">
        <BlurFade duration={0.6}>
          <Avatar photo={profile.photo} initials={me.initials} className="size-24 text-2xl ring-4 ring-primary/15 shadow-lg" />
        </BlurFade>
        <BlurFade delay={0.2} duration={0.6}>
          <p className="text-sm font-medium text-muted-foreground">{hello},</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{firstName}</h1>
        </BlurFade>
        <BlurFade delay={0.4} duration={0.6}>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            {ready ? (
              "Welcome back to Money Manager"
            ) : (
              <>
                <Loader2 className="size-4 animate-spin" /> Getting your money ready…
              </>
            )}
          </p>
        </BlurFade>
      </div>
    </div>
  );
}
