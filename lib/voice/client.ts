"use client";

import { authFetch } from "@/lib/cloud/client";

/**
 * Friday's voice in the browser: record what you say (stopping on its own when you pause), turn it into text on the
 * server, and read Friday's answer aloud. The Deepgram key never reaches the browser.
 */

/** A recording format this browser can make that Deepgram can read (webm on Chrome/Android, mp4 on iPhone). */
function recordingType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported(t));
}

export const voiceSupported = () => typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

export interface Recording {
  /** Stop now and get what was said so far. */
  stop: () => void;
  /** Stop and throw it away. */
  cancel: () => void;
  /** The audio once it stops (null if cancelled or nothing was said). */
  done: Promise<Blob | null>;
}

export interface RecordOptions {
  /** One AudioContext for the session, made on a tap (iPhone only allows audio after one). Needed for `autoStop`. */
  ctx?: AudioContext;
  /** Stop by itself after this long of quiet following speech (ms). */
  autoStop?: number;
  /** Give up if nothing is said for this long (ms). */
  noSpeechTimeout?: number;
  /** How loud you are right now, 0 to 1, for the picture. */
  onLevel?: (level: number) => void;
}

/** Starts recording from the microphone. */
export async function record(opts: RecordOptions = {}): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const type = recordingType();
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks: Blob[] = [];
  let cancelled = false;
  let heard = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let source: MediaStreamAudioSourceNode | undefined;

  const done = new Promise<Blob | null>((resolve) => {
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      clearInterval(timer);
      source?.disconnect();
      // Let go of the microphone, so the phone plays Friday through the speaker, not the earpiece.
      stream.getTracks().forEach((t) => t.stop());
      resolve(cancelled || chunks.length === 0 || (opts.autoStop && !heard) ? null : new Blob(chunks, { type: rec.mimeType || type || "audio/webm" }));
    };
  });
  const stop = () => rec.state !== "inactive" && rec.stop();
  rec.start(250);

  if (opts.ctx) {
    // Listen to the loudness: speech, then a pause, means you've finished.
    source = opts.ctx.createMediaStreamSource(stream);
    const analyser = opts.ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const started = Date.now();
    let lastLoud = Date.now();
    let floor = 0.01;
    timer = setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      // The room's own noise, learned as it goes, so a fan or traffic doesn't count as talking.
      if (!heard) floor = floor * 0.95 + Math.min(rms, 0.05) * 0.05;
      const loud = rms > Math.max(0.015, floor * 2.5);
      opts.onLevel?.(Math.min(1, rms * 12));
      const now = Date.now();
      if (loud) {
        lastLoud = now;
        if (now - started > 150) heard = true;
      }
      if (opts.autoStop && heard && now - lastLoud > opts.autoStop) stop();
      else if (!heard && opts.noSpeechTimeout && now - started > opts.noSpeechTimeout) stop();
      else if (now - started > 90_000) stop();
    }, 80);
  } else {
    heard = true;
  }

  return {
    stop,
    cancel: () => {
      cancelled = true;
      stop();
    },
    done,
  };
}

async function failureOf(res: Response, fallback: string) {
  const d = (await res.json().catch(() => ({}))) as { message?: string };
  return new Error(d.message ?? fallback);
}

/** What was said in the recording, as text. */
export async function transcribe(audio: Blob): Promise<string> {
  const res = await authFetch("/api/voice/listen", { method: "POST", headers: { "content-type": audio.type.split(";")[0] || "audio/webm" }, body: audio });
  if (!res.ok) throw await failureOf(res, "Couldn't hear that. Try again.");
  return ((await res.json()) as { text?: string }).text ?? "";
}

/** Whether voice is set up on the server. */
export async function voiceAvailable(): Promise<boolean> {
  try {
    const res = await authFetch("/api/voice/listen", { cache: "no-store" });
    return ((await res.json()) as { available?: boolean }).available === true;
  } catch {
    return false;
  }
}

/** Friday's written answer as something to say: no markdown, no tables, rupees said as rupees. */
export function speakable(text: string): string {
  return text
    .split("\n")
    .filter((l) => !/^\s*\|?[\s:|-]+\|?\s*$/.test(l) || !l.includes("-"))
    .map((l) => l.replace(/^\s*#{1,6}\s+/, "").replace(/^\s*[-•*]\s+/, "").replace(/^\s*\|(.*)\|\s*$/, (_, row: string) => row.split("|").map((c) => c.trim()).filter(Boolean).join(", ") + "."))
    .join("\n")
    .replace(/\*\*|__|\*|`/g, "")
    .replace(/[−-]\s?₹\s?([\d,]+(?:\.\d+)?)/g, "minus $1 rupees")
    .replace(/₹\s?([\d,]+(?:\.\d+)?)(\s*(?:lakh|crore|k)\b)?/gi, (_, n: string, unit = "") => `${n}${unit} rupees`)
    .replace(/[—–]/g, ", ")
    .replace(/→/g, " to ")
    .replace(/\n{2,}/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Splits what to say into pieces Deepgram can read in one go, at sentence ends. */
export function speechChunks(text: string, max = 1800): string[] {
  const out: string[] = [];
  let cur = "";
  for (const s of text.match(/[^.!?\n]+[.!?]*\s*|\n/g) ?? [text]) {
    if ((cur + s).length > max && cur) {
      out.push(cur.trim());
      cur = "";
    }
    cur += s.length > max ? s.slice(0, max) : s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

async function fetchSpeech(text: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const res = await authFetch("/api/voice/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }), signal });
  if (!res.ok) throw await failureOf(res, "Couldn't read the answer aloud.");
  return res.arrayBuffer();
}

/**
 * Reads text aloud through the session's AudioContext (made on a tap, so iPhone allows it). Resolves when it's said,
 * or when `signal` stops it. The next piece is fetched while the current one plays.
 */
export async function speak(text: string, ctx: AudioContext, signal: AbortSignal, onLevel?: (level: number) => void): Promise<void> {
  const pieces = speechChunks(speakable(text));
  if (!pieces.length) return;
  if (ctx.state === "suspended") await ctx.resume();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  analyser.connect(ctx.destination);
  const buf = new Float32Array(analyser.fftSize);
  // A piece fetched ahead and then not needed (stopped) mustn't show up as an unhandled error.
  const ahead = (t: string) => {
    const p = fetchSpeech(t, signal);
    p.catch(() => {});
    return p;
  };
  let next = ahead(pieces[0]);
  try {
    for (let i = 0; i < pieces.length; i++) {
      const audio = await ctx.decodeAudioData(await next);
      if (i + 1 < pieces.length) next = ahead(pieces[i + 1]);
      if (signal.aborted) return;
      await new Promise<void>((resolve) => {
        const src = ctx.createBufferSource();
        src.buffer = audio;
        src.connect(analyser);
        const meter = onLevel
          ? setInterval(() => {
              analyser.getFloatTimeDomainData(buf);
              let sum = 0;
              for (const v of buf) sum += v * v;
              onLevel(Math.min(1, Math.sqrt(sum / buf.length) * 6));
            }, 80)
          : undefined;
        const finish = () => {
          clearInterval(meter);
          signal.removeEventListener("abort", stopNow);
          resolve();
        };
        const stopNow = () => {
          try {
            src.stop();
          } catch {
            /* already stopped */
          }
        };
        src.onended = finish;
        signal.addEventListener("abort", stopNow);
        src.start();
      });
      if (signal.aborted) return;
    }
  } finally {
    analyser.disconnect();
    onLevel?.(0);
  }
}
