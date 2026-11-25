"use client";

import { authFetch } from "@/lib/cloud/client";

/**
 * Friday as a live voice assistant, over Deepgram's Voice Agent: one connection that listens (Flux, which knows when
 * you've finished speaking), thinks and speaks, with interruptions built in. The browser streams the microphone as
 * 16 kHz PCM and plays Friday's voice (24 kHz PCM) as it arrives. Thinking runs on the app's own model through
 * /api/voice/llm on the live site (the OpenAI key stays on the server), or on Deepgram's hosted model elsewhere.
 * The Deepgram key never reaches the browser: a short-lived token is minted per conversation.
 */

const AGENT_URL = "wss://agent.deepgram.com/v1/agent/converse";
const IN_RATE = 16000;
const OUT_RATE = 24000;
/** On Deepgram's own models, instructions and figures may be at most this long; on the app's model there's no limit. */
const MANAGED_PROMPT_LIMIT = 24_000;

export type AgentPhase = "connecting" | "listening" | "thinking" | "speaking";

export interface AgentEvents {
  onPhase: (phase: AgentPhase) => void;
  /** A finished line of the conversation (yours or Friday's), for the chat. */
  onText: (role: "user" | "assistant", text: string) => void;
  /** How loud it is right now (you, or Friday), 0 to 1. */
  onLevel: (level: number) => void;
  onError: (message: string) => void;
  onClose: () => void;
}

/** A function Friday can call to look something up; it runs here, in the browser. */
export interface AgentFunction {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => unknown;
}

export interface AgentSession {
  /** Stop Friday talking (you'll be heard again straight away). */
  interrupt: () => void;
  end: () => void;
}

interface Grant {
  token: string;
  llm?: { url: string; pass: string };
}

/** The token (and, on the live site, the pass for Friday's own thinking), from this app's server. */
async function fetchGrant(): Promise<Grant> {
  const res = await authFetch("/api/voice/agent", { method: "POST" });
  const d = (await res.json().catch(() => ({}))) as Grant & { message?: string };
  if (!res.ok || !d.token) throw new Error(d.message ?? "Couldn't start the live assistant.");
  return d;
}

// A token fetched ahead (on opening Friday) so starting to talk doesn't wait for one. Tokens only need to be valid
// when the connection opens, so one younger than 45 seconds (of 60) is used; older ones are fetched afresh.
let ahead: { at: number; grant: Promise<Grant> } | null = null;

/** Fetch a token now, ready for the next conversation. */
export function prefetchAgentGrant() {
  if (ahead && Date.now() - ahead.at < 40_000) return;
  const grant = fetchGrant();
  grant.catch(() => {
    ahead = null;
  });
  ahead = { at: Date.now(), grant };
}

function grant(): Promise<Grant> {
  const ready = ahead && Date.now() - ahead.at < 45_000 ? ahead.grant : null;
  // Each token opens one conversation.
  ahead = null;
  return ready ?? fetchGrant();
}

/** Float samples at `from` Hz to 16-bit PCM at `to` Hz (linear interpolation; voice needs no better). */
function toPcm16(input: Float32Array, from: number, to: number): Int16Array<ArrayBuffer> {
  const ratio = from / to;
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

/**
 * Opens a live conversation with Friday. `instructions` are Friday's prompt (with your figures); `functions` are
 * lookups it may call (used on Deepgram's model, where the figures must be short). Call on a tap: iPhone only allows
 * sound after one, and `ctx` must be made then.
 */
export async function startAgent(opts: {
  ctx: AudioContext;
  instructions: string;
  /** Instructions for Deepgram's own model (shorter), when the app's model can't be reached. */
  managedInstructions: string;
  functions: AgentFunction[];
  history: { role: "user" | "assistant"; content: string }[];
  voice?: string;
  events: AgentEvents;
}): Promise<AgentSession> {
  const { ctx, events } = opts;
  events.onPhase("connecting");
  // The token, the microphone and the audio all at once, not one after another.
  const [g, mic] = await Promise.all([
    grant(),
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }),
    ctx.state === "suspended" ? ctx.resume() : Promise.resolve(),
  ]);

  // A temporary token goes as a "bearer" subprotocol; some setups expect "token": try one, then the other.
  const ws = await new Promise<WebSocket>((resolve, reject) => {
    const tryOpen = (scheme: string, next?: string) => {
      const sock = new WebSocket(AGENT_URL, [scheme, g.token]);
      sock.binaryType = "arraybuffer";
      sock.onopen = () => resolve(sock);
      sock.onerror = () => (next ? tryOpen(next) : reject(new Error("Couldn't connect to the live assistant.")));
    };
    tryOpen("bearer", "token");
  });

  let closed = false;
  let speaking = false;
  // Friday's voice: each piece scheduled right after the one before; all stopped at once to interrupt.
  let playAt = 0;
  const playing = new Set<AudioBufferSourceNode>();
  const outGain = ctx.createGain();
  const outMeter = ctx.createAnalyser();
  outMeter.fftSize = 512;
  outGain.connect(outMeter);
  outMeter.connect(ctx.destination);

  const stopVoice = () => {
    for (const s of playing) {
      try {
        s.stop();
      } catch {
        /* already finished */
      }
    }
    playing.clear();
    playAt = 0;
  };

  const playPcm = (buf: ArrayBuffer) => {
    const pcm = new Int16Array(buf);
    if (!pcm.length) return;
    const audio = ctx.createBuffer(1, pcm.length, OUT_RATE);
    const ch = audio.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = audio;
    src.connect(outGain);
    const at = Math.max(ctx.currentTime + 0.02, playAt);
    src.start(at);
    playAt = at + audio.duration;
    playing.add(src);
    src.onended = () => playing.delete(src);
  };

  // The microphone, as 16 kHz PCM. While Friday speaks it sends silence, so Friday doesn't hear itself through the
  // speaker; tap to interrupt, and Friday listens again at once.
  const source = ctx.createMediaStreamSource(mic);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const sink = ctx.createGain();
  sink.gain.value = 0;
  source.connect(proc);
  proc.connect(sink);
  sink.connect(ctx.destination);
  let ready = false;
  proc.onaudioprocess = (e) => {
    if (!ready || closed || ws.readyState !== WebSocket.OPEN) return;
    const input = e.inputBuffer.getChannelData(0);
    const pcm = toPcm16(speaking ? new Float32Array(input.length) : input, ctx.sampleRate, IN_RATE);
    ws.send(pcm);
  };

  // The level for the orb: yours while listening, Friday's while speaking.
  const inMeter = ctx.createAnalyser();
  inMeter.fftSize = 512;
  source.connect(inMeter);
  const meterBuf = new Float32Array(512);
  const meter = setInterval(() => {
    (speaking ? outMeter : inMeter).getFloatTimeDomainData(meterBuf);
    let sum = 0;
    for (const v of meterBuf) sum += v * v;
    events.onLevel(Math.min(1, Math.sqrt(sum / meterBuf.length) * (speaking ? 6 : 12)));
    // Friday has finished once its last piece has played.
    if (speaking && playing.size === 0 && ctx.currentTime > playAt + 0.1 && audioDone) {
      speaking = false;
      audioDone = false;
      events.onPhase("listening");
    }
  }, 80);
  let audioDone = false;

  const own = !!g.llm;
  const settings = {
    type: "Settings",
    audio: { input: { encoding: "linear16", sample_rate: IN_RATE }, output: { encoding: "linear16", sample_rate: OUT_RATE, container: "none" } },
    agent: {
      listen: { provider: { type: "deepgram", model: "flux-general-en", version: "v2", eot_threshold: 0.75, eot_timeout_ms: 4000 } },
      think: own
        ? // The app's own model (gpt-6-luna, short thinking) through this app's server; the figures in full.
          { provider: { type: "open_ai", model: "gpt-6-luna" }, endpoint: { url: g.llm!.url, headers: { authorization: `Bearer ${g.llm!.pass}` } }, prompt: opts.instructions }
        : // Deepgram's hosted model: shorter figures, and lookups for the rest.
          {
            provider: { type: "open_ai", model: "gpt-5.6-luna", reasoning_mode: "low" },
            prompt: opts.managedInstructions.slice(0, MANAGED_PROMPT_LIMIT),
            functions: opts.functions.map(({ name, description, parameters }) => ({ name, description, parameters })),
          },
      speak: { provider: { type: "deepgram", model: opts.voice || "aura-2-thalia-en" } },
      context: { messages: opts.history.slice(-10).map((m) => ({ type: "History", role: m.role, content: m.content })) },
    },
  };

  ws.onmessage = (e) => {
    if (typeof e.data !== "string") {
      if (!speaking) {
        speaking = true;
        events.onPhase("speaking");
      }
      playPcm(e.data as ArrayBuffer);
      return;
    }
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(e.data) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (m.type) {
      case "Welcome":
        ws.send(JSON.stringify(settings));
        break;
      case "SettingsApplied":
        ready = true;
        events.onPhase("listening");
        break;
      case "UserStartedSpeaking":
        // You've cut in: Friday stops at once.
        stopVoice();
        speaking = false;
        audioDone = false;
        events.onPhase("listening");
        break;
      case "AgentThinking":
        events.onPhase("thinking");
        break;
      case "ConversationText":
        if ((m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim()) {
          events.onText(m.role, m.content.trim());
          if (m.role === "user") events.onPhase("thinking");
        }
        break;
      case "AgentAudioDone":
        audioDone = true;
        break;
      case "FunctionCallRequest": {
        for (const f of (m.functions as { id: string; name: string; arguments: string; client_side?: boolean }[]) ?? []) {
          if (f.client_side === false) continue;
          const fn = opts.functions.find((x) => x.name === f.name);
          let result: unknown;
          try {
            result = fn ? fn.run(JSON.parse(f.arguments || "{}") as Record<string, unknown>) : { error: `No such lookup: ${f.name}` };
          } catch (err) {
            result = { error: (err as Error).message };
          }
          ws.send(JSON.stringify({ type: "FunctionCallResponse", id: f.id, name: f.name, content: JSON.stringify(result) }));
        }
        break;
      }
      case "Error":
        events.onError(typeof m.description === "string" && m.description ? m.description : "The live assistant stopped.");
        break;
    }
  };

  const end = () => {
    if (closed) return;
    closed = true;
    clearInterval(meter);
    proc.disconnect();
    source.disconnect();
    stopVoice();
    // Let go of the microphone, so the phone plays sound through the speaker again.
    mic.getTracks().forEach((t) => t.stop());
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  };
  ws.onclose = () => {
    if (!closed) {
      end();
      events.onClose();
    }
  };

  return {
    interrupt: () => {
      stopVoice();
      speaking = false;
      audioDone = false;
      events.onPhase("listening");
    },
    end,
  };
}
