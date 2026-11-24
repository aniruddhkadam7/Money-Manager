import { handleVoiceLlm } from "@/lib/voice/llm-proxy";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Friday's thinking for the live voice assistant: called by Deepgram's Voice Agent, OpenAI-compatible. */
export function POST(req: Request) {
  return handleVoiceLlm(req);
}
