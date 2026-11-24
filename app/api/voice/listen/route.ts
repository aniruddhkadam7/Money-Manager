import { handleListen, voiceAvailability } from "@/lib/voice/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function GET() {
  return voiceAvailability();
}

export function POST(req: Request) {
  return handleListen(req);
}
