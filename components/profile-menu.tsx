"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Camera, Eye, EyeOff, KeyRound, Loader2, LockKeyhole, LogOut, Monitor, Moon, Pencil, Sun, Trash2 } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { LiquidButton } from "@/components/ui/liquid-glass-button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cloudConfigured, supabase } from "@/lib/cloud/client";
import { changePassword, lockSettings, removePasscode, setPasscode, setUnlockWith, type UnlockMethod } from "@/lib/cloud/app-lock";
import { signOut as signOutAndReload } from "@/lib/cloud/sign-out";
import { formatDisplayDate } from "@/lib/domain/dates";
import { loadPhoto, saveProfile, useProfile, type Profile } from "@/lib/profile";
import { setTheme, useTheme, type ThemeChoice } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { PasscodePad } from "./app-lock";
import { LOGIN_DOMAIN, usernameFor } from "./cloud-gate";
import { SYNC_LABEL, useSyncStatus } from "./cloud-status";
import { PhotoCropper } from "./photo-cropper";

function useSignedInUser(): User | null {
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    const sb = supabase();
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data } = sb.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => data.subscription.unsubscribe();
  }, []);
  return user;
}

interface Identity {
  name: string;
  initials: string;
  username?: string;
  /** Only a real address: the made-up ones behind username-only accounts never receive mail. */
  email?: string;
  joined?: string;
  lastSignIn?: string;
}

function identify(user: User | null, profile: Profile): Identity {
  const email = user?.email ?? "";
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const username = (typeof meta.username === "string" && meta.username) || usernameFor(email);
  const metaName = [meta.full_name, meta.name].find((v): v is string => typeof v === "string" && !!v.trim());
  const name = profile.name ?? metaName ?? username ?? (email.split("@")[0] || "You");
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/);
  const initials = (words.length > 1 ? words[0][0] + words[words.length - 1][0] : name.slice(0, 2)).toUpperCase() || "?";
  return {
    name,
    initials,
    username,
    email: email && !email.toLowerCase().endsWith(`@${LOGIN_DOMAIN}`) ? email : undefined,
    joined: formatDate(user?.created_at),
    lastSignIn: formatDate(user?.last_sign_in_at, true),
  };
}

function formatDate(iso: string | undefined, withTime = false): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}) });
}

function Avatar({ photo, initials, className }: { photo?: string; initials: string; className?: string }) {
  if (photo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photo} alt="" className={cn("rounded-full object-cover", className)} />;
  }
  return <span className={cn("flex items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground", className)}>{initials}</span>;
}

/** The header's profile picture; opens the profile: photo, personal details and sign-in. */
export function ProfileMenu() {
  const user = useSignedInUser();
  const profile = useProfile();
  const [open, setOpen] = useState(false);
  const me = identify(user, profile);
  const status = useSyncStatus();
  // The header has no cloud icon: a failed save shows as a dot on the picture, with the details in the profile.
  const unsaved = cloudConfigured && status === "error";

  return (
    <>
      <LiquidButton
        size="icon"
        onClick={() => setOpen(true)}
        title={unsaved ? `Profile · ${SYNC_LABEL.error}` : "Profile"}
        aria-label={unsaved ? `Profile. ${SYNC_LABEL.error}` : "Profile"}
        className="size-10 rounded-full p-1"
      >
        <Avatar photo={profile.photo} initials={me.initials} className="size-8 text-xs" />
        {unsaved && <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-amber-500 ring-2 ring-card" />}
      </LiquidButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <ProfileBody me={me} profile={profile} user={user} />
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProfileBody({ me, profile, user }: { me: Identity; profile: Profile; user: User | null }) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      <DialogHeader className="flex flex-row items-center gap-4 space-y-0 pr-6">
        <PhotoPicker me={me} profile={profile} />
        <div className="min-w-0">
          <DialogTitle className="truncate">{me.name}</DialogTitle>
          <DialogDescription className="truncate">{me.email ?? (me.username ? `@${me.username}` : "Your profile")}</DialogDescription>
        </div>
      </DialogHeader>

      {editing ? (
        <DetailsForm profile={profile} defaultName={me.name} onDone={() => setEditing(false)} />
      ) : (
        <Section
          title="Personal details"
          action={
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </Button>
          }
        >
          <Rows
            empty="Add your phone, birthday and other details."
            rows={[
              ["Full name", profile.name],
              ["Phone", profile.phone],
              ["Date of birth", profile.dateOfBirth && formatDisplayDate(profile.dateOfBirth)],
              ["City", profile.city],
              ["Occupation", profile.occupation],
            ]}
          />
        </Section>
      )}

      <AppearanceSection />
      {cloudConfigured && user && <SecuritySection user={user} />}
      {cloudConfigured && <SignInSection me={me} />}
    </>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Rows({ rows, empty }: { rows: [string, ReactNode | undefined][]; empty?: string }) {
  const shown = rows.filter((r) => r[1]);
  if (shown.length === 0) return <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">{empty}</p>;
  return (
    <dl className="divide-y rounded-xl border text-sm">
      {shown.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-4 px-4 py-2.5">
          <dt className="shrink-0 text-muted-foreground">{label}</dt>
          <dd className="min-w-0 truncate text-right font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PhotoPicker({ me, profile }: { me: Identity; profile: Profile }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // The picked picture, while the user places it in the frame.
  const [picked, setPicked] = useState<{ img: HTMLImageElement; url: string } | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      setPicked(await loadPhoto(file));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Couldn't use that picture.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  const done = () => {
    if (picked) URL.revokeObjectURL(picked.url);
    setPicked(null);
  };

  const [viewing, setViewing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setViewing(true)}
        title="Profile photo"
        aria-label="Open profile photo"
        className="shrink-0 rounded-full transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <Avatar photo={profile.photo} initials={me.initials} className="size-16 text-xl" />
      </button>

      {/* Like LinkedIn: tapping the picture shows it large, with what can be done to it underneath. */}
      <Dialog
        open={viewing}
        onOpenChange={(open) => {
          setViewing(open);
          setConfirmDelete(false);
        }}
      >
        <DialogContent className="palette-fixed border-slate-800 bg-slate-950 text-white sm:max-w-md [&>button:last-child]:text-slate-400 [&>button:last-child]:hover:bg-slate-800 [&>button:last-child]:hover:text-white">
          <DialogTitle className="text-base">Profile photo</DialogTitle>
          <div className="flex justify-center py-2">
            <Avatar photo={profile.photo} initials={me.initials} className="size-56 text-6xl sm:size-64" />
          </div>
          {confirmDelete ? (
            <div className="grid gap-3 border-t border-slate-800 pt-4">
              <p className="text-center text-sm text-slate-300">Delete your profile photo? Your initials will show instead.</p>
              <div className="flex justify-center gap-2">
                <Button variant="ghost" className="text-slate-300 hover:bg-slate-800 hover:text-white" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    saveProfile({ ...profile, photo: undefined });
                    setConfirmDelete(false);
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex justify-around border-t border-slate-800 pt-3">
              <PhotoAction icon={busy ? <Loader2 className="animate-spin" /> : <Camera />} label={profile.photo ? "Change photo" : "Add photo"} onClick={() => input.current?.click()} disabled={busy} />
              {profile.photo && <PhotoAction icon={<Trash2 />} label="Delete" onClick={() => setConfirmDelete(true)} />}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      {picked && (
        <PhotoCropper
          img={picked.img}
          onCancel={done}
          onSave={(photo) => {
            saveProfile({ ...profile, photo });
            done();
          }}
        />
      )}
    </>
  );
}

function PhotoAction({ icon, label, onClick, disabled }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-1 rounded-lg px-4 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white disabled:opacity-50 [&_svg]:size-5"
    >
      {icon}
      {label}
    </button>
  );
}

function DetailsForm({ profile, defaultName, onDone }: { profile: Profile; defaultName: string; onDone: () => void }) {
  const [draft, setDraft] = useState<Profile>({ ...profile, name: profile.name ?? defaultName });
  const [error, setError] = useState<string | null>(null);
  const field = (key: keyof Profile) => ({
    id: `profile-${key}`,
    value: draft[key] ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [key]: e.target.value })),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const phone = draft.phone?.trim();
    if (phone && !/^\+?[0-9\s-]{7,15}$/.test(phone)) return setError("Enter the phone number with digits only.");
    saveProfile({ ...draft, name: draft.name?.trim(), phone });
    onDone();
  };

  return (
    <Section title="Personal details">
      <form onSubmit={submit} className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2">
        <FormField label="Full name" className="sm:col-span-2">
          <Input {...field("name")} autoComplete="name" />
        </FormField>
        <FormField label="Phone">
          <Input {...field("phone")} type="tel" autoComplete="tel" inputMode="tel" placeholder="+91 98765 43210" />
        </FormField>
        <FormField label="Date of birth">
          <Input {...field("dateOfBirth")} type="date" autoComplete="bday" />
        </FormField>
        <FormField label="City">
          <Input {...field("city")} autoComplete="address-level2" />
        </FormField>
        <FormField label="Occupation">
          <Input {...field("occupation")} autoComplete="organization-title" />
        </FormField>
        {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit">Save</Button>
        </div>
      </form>
    </Section>
  );
}

function FormField({ label, className, children }: { label: string; className?: string; children: React.ReactElement<{ id: string }> }) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={children.props.id}>{label}</Label>
      {children}
    </div>
  );
}

const THEMES: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Auto", icon: Monitor },
];

/** Light, dark, or follow the phone / computer. Saved on this device only. */
function AppearanceSection() {
  const theme = useTheme();
  return (
    <Section title="Appearance">
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-1 rounded-xl border bg-muted p-1">
        {THEMES.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={theme === value}
            onClick={() => setTheme(value)}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium transition-colors",
              theme === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
      </div>
    </Section>
  );
}

function SignInSection({ me }: { me: Identity }) {
  const status = useSyncStatus();
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    setBusy(true);
    if (!(await signOutAndReload())) setBusy(false);
  };

  return (
    <Section title="Sign-in">
      <Rows
        rows={[
          ["Username", me.username],
          ["Email", me.email],
          ["Member since", me.joined],
          ["Last signed in", me.lastSignIn],
          ["Cloud backup", <span key="sync" className={cn(status === "error" && "text-amber-600")}>{SYNC_LABEL[status]}</span>],
        ]}
      />
      <Button variant="outline" onClick={signOut} disabled={busy} className="mt-1 w-full text-destructive hover:text-destructive">
        {busy ? <Loader2 className="animate-spin" /> : <LogOut />} Sign out
      </Button>
    </Section>
  );
}

const UNLOCK_METHODS: { value: UnlockMethod; label: string }[] = [
  { value: "passcode", label: "Passcode" },
  { value: "password", label: "Password" },
];

/**
 * Password and passcode. With a passcode set the app opens locked, and either one unlocks it; the
 * default picks which the lock screen asks for first. Saved to the account, so every device follows it.
 */
function SecuritySection({ user }: { user: User }) {
  const settings = lockSettings(user);
  const [editing, setEditing] = useState<"password" | "passcode" | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = async (action: () => Promise<void>, done?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (done) setNotice(done);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const finish = (message: string) => {
    setEditing(null);
    setError(null);
    setNotice(message);
  };

  if (editing === "password") {
    return (
      <Section title="Security">
        <PasswordForm user={user} onCancel={() => setEditing(null)} onDone={() => finish("Password changed.")} />
      </Section>
    );
  }
  if (editing === "passcode") {
    return (
      <Section title="Security">
        <PasscodeForm
          onCancel={() => setEditing(null)}
          onSave={async (code) => {
            await setPasscode(settings, code);
            finish(settings.passcode ? "Passcode changed." : "Passcode set. The app now opens locked.");
          }}
        />
      </Section>
    );
  }

  return (
    <Section title="Security">
      <div className="divide-y rounded-xl border text-sm">
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <span className="flex items-center gap-2 text-muted-foreground">
            <KeyRound className="size-4" /> Password
          </span>
          <Button variant="ghost" size="sm" onClick={() => setEditing("password")}>
            Change
          </Button>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-2.5">
          <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
            <LockKeyhole className="size-4 shrink-0" />
            <span className="truncate">Passcode{settings.passcode ? ` · ${settings.passcode.length} digits` : " · Off"}</span>
          </span>
          <div className="flex shrink-0 gap-1">
            {settings.passcode && (
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirmRemove(true)} disabled={busy}>
                Remove
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setEditing("passcode")} disabled={busy}>
              {settings.passcode ? "Change" : "Set up"}
            </Button>
          </div>
        </div>
        {settings.passcode && (
          <div className="grid gap-2 px-4 py-3">
            <span className="text-muted-foreground">Unlock with</span>
            <div role="radiogroup" aria-label="Unlock with" className="grid grid-cols-2 gap-1 rounded-xl border bg-muted p-1">
              {UNLOCK_METHODS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={settings.unlockWith === value}
                  disabled={busy}
                  onClick={() => settings.unlockWith !== value && run(() => setUnlockWith(settings, value))}
                  className={cn(
                    "rounded-lg py-2 text-sm font-medium transition-colors disabled:opacity-60",
                    settings.unlockWith === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">The lock screen asks for this first. You can always switch to the other one there.</p>
          </div>
        )}
      </div>
      {confirmRemove && (
        <div className="grid gap-3 rounded-xl border p-4 text-sm">
          <p>Remove the passcode? The app will no longer lock when you open it.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={async () => (await run(removePasscode, "Passcode removed.")) && setConfirmRemove(false)}
            >
              {busy && <Loader2 className="animate-spin" />} Remove
            </Button>
          </div>
        </div>
      )}
      {!settings.passcode && !notice && !error && (
        <p className="text-xs text-muted-foreground">Set a passcode to lock the app when you open it. Your password unlocks it too.</p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {notice && <p className="text-sm text-emerald-600">{notice}</p>}
    </Section>
  );
}

function PasswordForm({ user, onCancel, onDone }: { user: User; onCancel: () => void; onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return setError("The new passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      await changePassword(user, current, next);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't change the password.");
      setBusy(false);
    }
  };

  const type = show ? "text" : "password";
  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl border p-4">
      {/* Lets password managers file the new password under the right account. */}
      <input type="text" name="username" autoComplete="username" value={user.email ?? ""} readOnly hidden />
      <FormField label="Current password">
        <Input id="pw-current" type={type} autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
      </FormField>
      <FormField label="New password">
        <Input id="pw-new" type={type} autoComplete="new-password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} />
      </FormField>
      <FormField label="Confirm new password">
        <Input id="pw-confirm" type={type} autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </FormField>
      <p className="text-xs text-muted-foreground">At least 8 characters. You stay signed in on this device.</p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setShow((v) => !v)}>
          {show ? <EyeOff /> : <Eye />} {show ? "Hide" : "Show"}
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />} Change password
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Pick 4 or 6 digits, type the passcode, then type it again to confirm. */
function PasscodeForm({ onCancel, onSave }: { onCancel: () => void; onSave: (code: string) => Promise<void> }) {
  const [length, setLength] = useState<4 | 6>(4);
  const [first, setFirst] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const complete = async (code: string) => {
    if (first === null) {
      setFirst(code);
      setError(null);
      return false;
    }
    if (code !== first) {
      setFirst(null);
      setError("The passcodes didn't match. Start again.");
      return false;
    }
    try {
      await onSave(code);
      return true;
    } catch (e) {
      setFirst(null);
      setError(e instanceof Error ? e.message : "Couldn't save the passcode.");
      return false;
    }
  };

  return (
    <div className="grid justify-items-center gap-4 rounded-xl border p-4">
      <p className="text-sm font-medium">{first === null ? "Enter a new passcode" : "Enter it again to confirm"}</p>
      {first === null && (
        <div role="radiogroup" aria-label="Passcode length" className="grid grid-cols-2 gap-1 rounded-xl border bg-muted p-1 text-sm">
          {([4, 6] as const).map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={length === n}
              onClick={() => setLength(n)}
              className={cn("rounded-lg px-4 py-1.5 font-medium transition-colors", length === n ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}
            >
              {n} digits
            </button>
          ))}
        </div>
      )}
      {/* A new key per step and length clears the dots between them. */}
      <PasscodePad key={`${length}-${first === null ? 1 : 2}`} length={length} onComplete={complete} />
      <p className="min-h-5 text-sm text-destructive">{error}</p>
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
