"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, X } from "lucide-react";
import { record, speak, transcribe, voiceAvailable, voiceSupported, type Recording } from "@/lib/voice/client";
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
 * Speech to text only: tap, speak, tap again, and what you said lands in the message box to check and send.
 */
export function DictateButton({ onText, onError, disabled }: { onText: (text: string) => void; onError: (message: string) => void; disabled?: boolean }) {
  const [state, setState] = useState<"idle" | "recording" | "working">("idle");
  const rec = useRef<Recording | null>(null);
  useEffect(() => () => rec.current?.cancel(), []);

  const toggle = async () => {
    if (state === "recording") {
      rec.current?.stop();
      return;
    }
    if (state !== "idle") return;
    try {
      const r = await record();
      rec.current = r;
      setState("recording");
      const audio = await r.done;
      rec.current = null;
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
export function VoiceMode({ ask, onClose }: { ask: (question: string) => Promise<string>; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("starting");
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const rec = useRef<Recording | null>(null);
  const speaking = useRef<AbortController | null>(null);
  // Each run of the conversation has a number; ending (or restarting) makes the old run stop at its next step.
  const run = useRef(0);

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
    void loop();
  };

  useEffect(() => {
    // Opened by a tap, so the audio may start now (iPhone needs that).
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx.current = new Ctx();
    void ctx.current.resume();
    start();
    return () => {
      run.current++;
      rec.current?.cancel();
      speaking.current?.abort();
      void ctx.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tapOrb = () => {
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
