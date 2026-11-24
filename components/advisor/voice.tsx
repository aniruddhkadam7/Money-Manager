"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, X } from "lucide-react";
import { record, speak, transcribe, voiceAvailable, voiceSupported, type Recording } from "@/lib/voice/client";
import { startAgent, type AgentFunction, type AgentSession } from "@/lib/voice/agent";
import { ADVISOR_PROMPT, VOICE_PROMPT } from "@/lib/advisor/prompt";
import type { AdvisorSnapshot } from "@/lib/advisor/snapshot";
import { cn } from "@/lib/utils";
import { FridayOrb } from "./friday-orb";

/** Whether this browser can record and the server has voice set up (null while checking). */
export function useVoice(): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    if (!voiceSupported()) {
      setOk(false);
      return;
    }
    let live = true;
    void voiceAvailable().then((v) => live && setOk(v));
    return () => {
      live = false;
    };
  }, []);
  return ok;
}

const micError = (e: unknown) => {
  const name = (e as Error)?.name;
  return name === "NotAllowedError" || name === "SecurityError"
    ? "Microphone access is off. Allow it for this site in your browser settings."
    : name === "NotFoundError"
      ? "No microphone found."
      : ((e as Error)?.message ?? "Couldn't use the microphone.");
};

/**
 * Speech to text: tap and speak, and your words appear in the message box as you go (refined about every second);
 * tap again to stop, and the final words stay there to check and send.
 */
export function DictateButton({
  onText,
  onPartial,
  onError,
  disabled,
}: {
  onText: (text: string) => void;
  /** The words so far, while you're still speaking. */
  onPartial?: (text: string) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const [state, setState] = useState<"idle" | "recording" | "working">("idle");
  const rec = useRef<Recording | null>(null);
  useEffect(() => () => rec.current?.cancel(), []);
  // While recording: the words so far, at most one request at a time, the latest audio each time.
  const live = useRef({ busy: false, last: 0, pending: null as Blob | null, stopped: false });
  const refresh = (soFar: Blob) => {
    const l = live.current;
    l.pending = soFar;
    if (l.busy || l.stopped || Date.now() - l.last < 900) return;
    const audio = l.pending;
    l.pending = null;
    l.busy = true;
    l.last = Date.now();
    void transcribe(audio)
      .then((t) => {
        if (!live.current.stopped && t) onPartial?.(t);
      })
      .catch(() => {})
      .finally(() => {
        live.current.busy = false;
      });
  };

  const toggle = async () => {
    if (state === "recording") {
      rec.current?.stop();
      return;
    }
    if (state !== "idle") return;
    try {
      live.current = { busy: false, last: Date.now(), pending: null, stopped: false };
      const r = await record({ onAudio: onPartial ? refresh : undefined });
      rec.current = r;
      setState("recording");
      const audio = await r.done;
      rec.current = null;
      live.current.stopped = true;
      if (!audio) return setState("idle");
      setState("working");
      const text = await transcribe(audio);
      if (text) onText(text);
      else onError("Didn't catch anything. Try again a little closer to the mic.");
    } catch (e) {
      onError(micError(e));
    }
    setState("idle");
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled || state === "working"}
      aria-label={state === "recording" ? "Stop and write it" : "Speak to type"}
      title={state === "recording" ? "Stop and write it" : "Speak to type"}
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40",
        state === "recording" && "animate-pulse bg-red-500 text-white hover:bg-red-500 hover:text-white",
      )}
      data-testid="dictate"
    >
      {state === "working" ? <Loader2 className="size-5 animate-spin" /> : state === "recording" ? <span className="size-3 rounded-sm bg-current" /> : <Mic className="size-5" />}
    </button>
  );
}

type Phase = "starting" | "listening" | "hearing" | "thinking" | "speaking" | "error";

const PHASE_TEXT: Record<Phase, string> = {
  starting: "Starting…",
  listening: "Listening…",
  hearing: "Getting that…",
  thinking: "Thinking…",
  speaking: "Tap to interrupt",
  error: "",
};

/**
 * Talking with Friday, like a phone call: it listens, notices when you stop, answers out loud, and listens again.
 * Tap the orb to cut in while it speaks, or to finish what you're saying sooner. Everything also lands in the chat.
 * `ask` sends a question and resolves with Friday's answer ("" if it failed).
 */
export function VoiceMode({
  ask,
  onClose,
  snapshot,
  history = [],
  onLine,
}: {
  ask: (question: string) => Promise<string>;
  onClose: () => void;
  /** Your figures: given, Friday talks live (Deepgram's Voice Agent); otherwise, or if that can't start, it takes turns. */
  snapshot?: AdvisorSnapshot | null;
  history?: { role: "user" | "assistant"; content: string }[];
  /** A finished line of the live conversation, for the chat. */
  onLine?: (role: "user" | "assistant", text: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>("starting");
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const rec = useRef<Recording | null>(null);
  const speaking = useRef<AbortController | null>(null);
  // Each run of the conversation has a number; ending (or restarting) makes the old run stop at its next step.
  const run = useRef(0);
  // The live conversation, when it could start.
  const live = useRef<AgentSession | null>(null);

  /** Talking live: one connection that listens, notices when you stop, and answers as it thinks. */
  async function startLive(): Promise<boolean> {
    if (!snapshot || !ctx.current) return false;
    try {
      live.current = await startAgent({
        ctx: ctx.current,
        instructions: liveInstructions(snapshot, true),
        managedInstructions: liveInstructions(snapshot, false),
        functions: lookups(snapshot),
        history,
        events: {
          onPhase: (p) => setPhase(p === "connecting" ? "starting" : p),
          onText: (role, text) => {
            if (role === "user") setHeard(text);
            onLine?.(role, text);
          },
          onLevel: setLevel,
          onError: (message) => {
            setError(message);
            setPhase("error");
          },
          onClose: () => {
            live.current = null;
            setError("The live conversation ended.");
            setPhase("error");
          },
        },
      });
      return true;
    } catch {
      live.current = null;
      return false;
    }
  }

  async function loop() {
    const id = ++run.current;
    const live = () => run.current === id;
    while (live()) {
      setPhase("listening");
      setLevel(0);
      let audio: Blob | null;
      try {
        const r = await record({ ctx: ctx.current!, autoStop: 1300, noSpeechTimeout: 15_000, onLevel: setLevel });
        if (!live()) return r.cancel();
        rec.current = r;
        audio = await r.done;
        rec.current = null;
      } catch (e) {
        if (!live()) return;
        setError(micError(e));
        setPhase("error");
        return;
      }
      if (!live()) return;
      if (!audio) continue;
      setPhase("hearing");
      setLevel(0);
      let question = "";
      try {
        question = await transcribe(audio);
      } catch (e) {
        if (!live()) return;
        setError((e as Error).message);
        setPhase("error");
        return;
      }
      if (!live()) return;
      if (!question.trim()) continue;
      setHeard(question);
      setPhase("thinking");
      const answer = await ask(question);
      if (!live()) return;
      if (!answer) {
        setError("Friday couldn't answer. Try again.");
        setPhase("error");
        return;
      }
      setPhase("speaking");
      const controller = new AbortController();
      speaking.current = controller;
      try {
        await speak(answer, ctx.current!, controller.signal, setLevel);
      } catch (e) {
        if (live() && (e as Error).name !== "AbortError") {
          setError((e as Error).message);
          setPhase("error");
          return;
        }
      } finally {
        speaking.current = null;
      }
    }
  }

  const start = () => {
    setError(null);
    // Live if it can be; otherwise the step-by-step way (record, then answer), which needs no live connection.
    void startLive().then((ok) => {
      if (!ok) void loop();
    });
  };

  useEffect(() => {
    // Opened by a tap, so the audio may start now (iPhone needs that).
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx.current = new Ctx();
    void ctx.current.resume();
    start();
    return () => {
      run.current++;
      live.current?.end();
      rec.current?.cancel();
      speaking.current?.abort();
      void ctx.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tapOrb = () => {
    if (live.current) {
      // Live: tap to cut Friday off; it listens again at once.
      if (phase === "speaking") live.current.interrupt();
      return;
    }
    if (phase === "speaking") speaking.current?.abort();
    else if (phase === "listening") rec.current?.stop();
    else if (phase === "error") {
      void ctx.current?.resume();
      start();
    }
  };

  const busy = phase === "thinking" || phase === "hearing";
  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-between bg-background/95 px-6 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(3rem+env(safe-area-inset-top))] backdrop-blur" role="dialog" aria-label="Talking with Friday" data-testid="voice-mode">
      <p className="text-xs font-bold uppercase tracking-wider text-[#0eadff]">Friday</p>
      <div className="grid justify-items-center gap-8">
        <button type="button" onClick={tapOrb} aria-label={PHASE_TEXT[phase] || "Try again"} className="rounded-full transition-transform duration-100" style={{ transform: `scale(${1 + level * 0.35})` }}>
          <FridayOrb size={160} active={phase === "speaking" || busy} />
        </button>
        <div className="grid max-w-md justify-items-center gap-2 text-center">
          {phase === "error" ? (
            <>
              <p className="text-sm text-red-600">{error}</p>
              <button type="button" onClick={tapOrb} className="rounded-full border px-4 py-1.5 text-sm hover:bg-muted">
                Try again
              </button>
            </>
          ) : (
            <p className="flex items-center gap-2 text-base font-medium text-muted-foreground">
              {busy && <Loader2 className="size-4 animate-spin" />}
              {PHASE_TEXT[phase]}
            </p>
          )}
          {heard && phase !== "listening" && <p className="line-clamp-3 text-sm text-muted-foreground">“{heard}”</p>}
        </div>
      </div>
      <button type="button" onClick={onClose} aria-label="End voice chat" className="grid size-14 place-items-center rounded-full bg-red-500 text-white shadow-lg hover:bg-red-600" data-testid="voice-end">
        <X className="size-6" />
      </button>
    </div>
  );
}

/**
 * Friday's instructions for the live conversation: its usual ones, the voice rules, and your figures. On the app's
 * own model they go in full; on Deepgram's hosted model (limited length) the entry list is left out and looked up
 * with find_entries instead.
 */
function liveInstructions(s: AdvisorSnapshot, full: boolean): string {
  const figures = full ? s : { ...s, entries: { columns: s.entries.columns, rows: [], truncated: true, note: "Use find_entries to look entries up." } };
  return `${ADVISOR_PROMPT}\n\n${VOICE_PROMPT}\n\nThis is a live spoken conversation: answer quickly and briefly, then stop and listen.\n\nSNAPSHOT (today ${s.today}):\n${JSON.stringify(figures)}`;
}

/** Lookups Friday may call during a live conversation (run here, on your own figures). */
function lookups(s: AdvisorSnapshot): AgentFunction[] {
  return [
    {
      name: "find_entries",
      description:
        "Find the user's entries (last 12 months) matching words and filters, newest first, with their total. Use it for questions about specific payments, people, shops, categories or dates.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Words to match in who, category or reason, e.g. 'swiggy' or 'Ravi'" },
          kind: { type: "string", description: "Kind of entry, e.g. 'spent', 'income', 'paid back', 'borrowed', 'lent'" },
          from: { type: "string", description: "Earliest date, YYYY-MM-DD" },
          to: { type: "string", description: "Latest date, YYYY-MM-DD" },
        },
      },
      run: (a) => {
        const words = String(a.text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
        const kind = String(a.kind ?? "").toLowerCase();
        const rows = s.entries.rows.filter((r) => {
          const [date, k, , who, category, , reason] = r.map((x) => String(x).toLowerCase());
          return (
            (!a.from || date >= String(a.from)) &&
            (!a.to || date <= String(a.to)) &&
            (!kind || k.includes(kind)) &&
            words.every((w) => `${who} ${category} ${reason}`.includes(w))
          );
        });
        return {
          count: rows.length,
          total: rows.reduce((t, r) => t + (Number(r[2]) || 0), 0),
          entries: rows.slice(0, 25).map((r) => ({ date: r[0], kind: r[1], amount: r[2], who: r[3], category: r[4], reason: r[6] })),
        };
      },
    },
  ];
}
