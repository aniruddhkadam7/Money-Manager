import { handleAgentToken } from "@/lib/voice/server";

export const dynamic = "force-dynamic";

/** A short-lived token for the live voice assistant (Deepgram Voice Agent), minted per conversation. */
export function POST(req: Request) {
  return handleAgentToken(req);
}
