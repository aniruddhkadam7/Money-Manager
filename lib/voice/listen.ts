"use client";

import { liveToken } from "./agent";

/**
 * Live dictation over Deepgram's streaming speech to text: the microphone goes up as 16 kHz PCM while you speak and
 * the words come back as you say them (a guess first, then settled), so they can be shown in the box in real time.
 * Uses the same short-lived token as the live assistant; the Deepgram key never reaches the browser.
 */

const LISTEN_URL = "wss://api.deepgram.com/v1/listen";
const RATE = 16000;

export interface Dictation {
  /** Stop listening; resolves with everything you said. */
  stop: () => Promise<string>;
  /** Stop and drop it. */
  cancel: () => void;
}

function toPcm16(input: Float32Array, from: number): Int16Array<ArrayBuffer> {
  const ratio = from / RATE;
  const out = new Int16Array(new ArrayBuffer(Math.floor(input.length / ratio) * 2));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const j = Math.floor(pos);
    const frac = pos - j;
    const v = (input[j] ?? 0) * (1 - frac) + (input[j + 1] ?? input[j] ?? 0) * frac;
    out[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  }
  return out;
}

/** Starts listening. `onWords` gets all the words so far (settled ones plus the current guess) each time they change. */
export async function startDictation(onWords: (text: string) => void, language = "en-IN"): Promise<Dictation> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  let mic: MediaStream | null = null;
  try {
    const [token, stream] = await Promise.all([
      liveToken(),
      navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }),
      ctx.state === "suspended" ? ctx.resume() : Promise.resolve(),
    ]);
    mic = stream;
    const params = new URLSearchParams({
      model: "nova-3",
      language,
      encoding: "linear16",
      sample_rate: String(RATE),
      channels: "1",
      interim_results: "true",
      smart_format: "true",
      punctuate: "true",
      numerals: "true",
      endpointing: "300",
    });
    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const sock = new WebSocket(`${LISTEN_URL}?${params}`, ["bearer", token]);
      sock.onopen = () => resolve(sock);
      sock.onerror = () => reject(new Error("Couldn't start live dictation."));
    });

    const settled: string[] = [];
    let guess = "";
    const words = () => [...settled, guess].filter(Boolean).join(" ");
    let finalized: (() => void) | null = null;
    ws.onmessage = (e) => {
      if (typeof e.data !== "string") return;
      let m: { type?: string; is_final?: boolean; from_finalize?: boolean; channel?: { alternatives?: { transcript?: string }[] } };
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      if (m.type !== "Results") return;
      const t = m.channel?.alternatives?.[0]?.transcript?.trim() ?? "";
      if (m.is_final) {
        if (t) settled.push(t);
        guess = "";
      } else guess = t;
      onWords(words());
      if (m.from_finalize) finalized?.();
    };

    const source = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const sink = ctx.createGain();
    sink.gain.value = 0;
    source.connect(proc);
    proc.connect(sink);
    sink.connect(ctx.destination);
    proc.onaudioprocess = (e) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(toPcm16(e.inputBuffer.getChannelData(0), ctx.sampleRate));
    };
    // Deepgram closes a connection that hears nothing for a while; a keep-alive holds it open through pauses.
    const keepAlive = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: "KeepAlive" })), 5000);

    let done = false;
    const release = () => {
      clearInterval(keepAlive);
      proc.disconnect();
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => {});
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    };
    return {
      stop: async () => {
        if (done) return words();
        done = true;
        proc.onaudioprocess = null;
        // Ask for the last words now rather than waiting for a pause; give it a moment at most.
        if (ws.readyState === WebSocket.OPEN) {
          await new Promise<void>((resolve) => {
            finalized = resolve;
            ws.send(JSON.stringify({ type: "Finalize" }));
            setTimeout(resolve, 1500);
          });
          try {
            ws.send(JSON.stringify({ type: "CloseStream" }));
          } catch {
            /* closed */
          }
        }
        release();
        // Anything still only guessed counts too.
        return words();
      },
      cancel: () => {
        if (done) return;
        done = true;
        release();
      },
    };
  } catch (e) {
    mic?.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => {});
    throw e;
  }
}
