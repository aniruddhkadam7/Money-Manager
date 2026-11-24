import { z } from "zod";
import { createClient, supportsTemperature } from "@/lib/statements/ai-server";
import { sameOrigin, signedInAllowed } from "@/lib/statements/ai-route";
import { HEARTBEAT, STREAM_ERROR } from "./stream-markers";
import { ADVISOR_PROMPT, VOICE_PROMPT } from "./prompt";

export { ADVISOR_PROMPT, VOICE_PROMPT };


const MAX_MESSAGES = 30;
const MAX_CHARS = 6000;
// The snapshot carries up to 2,000 entries (a year), so it can be large.
const MAX_SNAPSHOT = 400_000;

const bodySchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(MAX_CHARS) }))
    .min(1)
    .max(MAX_MESSAGES),
  snapshot: z.record(z.string(), z.unknown()),
  /** A spoken conversation: the answer is read aloud, so it's short plain sentences. */
  voice: z.boolean().optional(),
});


const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** Whether the CA can be used (the OpenAI key is set on the server). */
export function advisorAvailability(env: Record<string, string | undefined> = process.env) {
  return json({ available: !!createClient(env) });
}

/**
 * One reply from the CA, streamed as plain text as it's written. Only you (signed in, allowed) and only from this
 * site may use it; nothing of the conversation or the figures is logged.
 */
export async function handleAdvisor(req: Request, env: Record<string, string | undefined> = process.env) {
  if (!sameOrigin(req)) return json({ error: "forbidden", message: "Cross-site requests are not allowed." }, 403);
  if (!(await signedInAllowed(req, env))) return json({ error: "unauthorized", message: "Sign in to talk to Friday." }, 401);
  const configured = createClient(env);
  if (!configured) return json({ error: "not_configured", message: "The AI isn't set up (no OPENAI_API_KEY on the server)." }, 503);

  const text = await req.text();
  if (text.length > MAX_SNAPSHOT + MAX_MESSAGES * MAX_CHARS) return json({ error: "too_large", message: "That conversation is too long. Start a new one." }, 413);
  let parsed;
  try {
    parsed = bodySchema.safeParse(JSON.parse(text));
  } catch {
    return json({ error: "bad_request", message: "Request wasn't valid JSON." }, 400);
  }
  if (!parsed.success) return json({ error: "bad_request", message: "Request didn't match the expected format." }, 400);
  const { messages, snapshot, voice } = parsed.data;
  const figures = JSON.stringify(snapshot);
  if (figures.length > MAX_SNAPSHOT) return json({ error: "too_large", message: "Too many figures to send." }, 413);

  const { client, model } = configured;
  const encoder = new TextEncoder();
  // The response starts at once, and while the AI thinks (it can take a while before its first word) an invisible
  // "still here" goes out every few seconds, so phones and proxies never see an idle line and drop it. An AI error
  // before any words is sent as STREAM_ERROR + message, for the page to show; the page strips HEARTBEAT.
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (text: string) => controller.enqueue(encoder.encode(text));
      let started = false;
      send(HEARTBEAT);
      const beat = setInterval(() => {
        if (!started) send(HEARTBEAT);
      }, 4000);
      try {
        const stream = await client.chat.completions.create({
          model,
          stream: true,
          ...(supportsTemperature(model) ? { temperature: 0.3 } : {}),
          messages: [
            { role: "system", content: ADVISOR_PROMPT },
            { role: "system", content: `SNAPSHOT (today ${String(snapshot.today ?? "")}):\n${figures}` },
            ...(voice ? [{ role: "system" as const, content: VOICE_PROMPT }] : []),
            ...messages,
          ],
        });
        for await (const chunk of stream) {
          const piece = chunk.choices[0]?.delta?.content;
          if (!piece) continue;
          started = true;
          send(piece);
        }
      } catch (err) {
        const status = typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : 0;
        // Kinds only: never the conversation or the figures.
        console.error("advisor: AI request failed", status || (err as Error)?.name);
        if (started) send("\n\n(The answer was cut off. Ask again.)");
        else
          send(
            STREAM_ERROR +
              (status === 401 || status === 403
                ? "The OpenAI key was rejected."
                : status === 429
                  ? "The AI is busy. Try again in a minute."
                  : "The AI couldn't answer just now. Try again."),
          );
      } finally {
        clearInterval(beat);
        controller.close();
      }
    },
  });
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
