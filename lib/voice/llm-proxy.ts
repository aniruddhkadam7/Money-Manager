import { checkPass } from "./llm-pass";

/**
 * Friday's thinking for the live voice assistant. Deepgram's Voice Agent calls this like OpenAI's chat completions
 * (server to server, with the conversation pass as its bearer token); it's forwarded to OpenAI with the server's key,
 * as the app's own model (OPENAI_MODEL, e.g. gpt-6-luna) with short thinking (OPENAI_VOICE_REASONING: low by default,
 * medium for more care), and the reply (streamed or not) is passed straight back. Nothing is logged but its status.
 */
export async function handleVoiceLlm(req: Request, env: Record<string, string | undefined> = process.env) {
  const pass = req.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!checkPass(env, pass)) return Response.json({ error: { message: "Not allowed." } }, { status: 401 });
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) return Response.json({ error: { message: "The AI isn't set up." } }, { status: 503 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: { message: "Request wasn't valid JSON." } }, { status: 400 });
  }
  const model = env.OPENAI_MODEL?.trim() || "gpt-6-luna";
  const effort = env.OPENAI_VOICE_REASONING?.trim() || "low";
  const reasoning = /^(o\d|gpt-[5-9])/.test(model);
  // Our model and thinking level, whatever was asked for; reasoning models take no temperature.
  // gpt-6-luna takes no thinking together with function tools on chat completions: a request with tools thinks "none".
  const hasTools = Array.isArray(body.tools) && body.tools.length > 0;
  const forward: Record<string, unknown> = { ...body, model, ...(reasoning ? { reasoning_effort: hasTools ? "none" : effort } : {}) };
  if (reasoning) delete forward.temperature;

  const base = (env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(forward),
    });
  } catch (err) {
    console.error("voice llm: request failed", (err as Error)?.name);
    return Response.json({ error: { message: "The AI couldn't answer just now." } }, { status: 502 });
  }
  if (!res.ok) console.error("voice llm: OpenAI answered", res.status);
  return new Response(res.body, {
    status: res.status,
    headers: { "content-type": res.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
  });
}
