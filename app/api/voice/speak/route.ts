import { handleSpeak } from "@/lib/voice/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function POST(req: Request) {
  return handleSpeak(req);
}
