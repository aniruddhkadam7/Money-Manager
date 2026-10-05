import { handleAvailability, handleClassify } from "@/lib/statements/ai-route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function GET() {
  return handleAvailability();
}

export function POST(req: Request) {
  return handleClassify(req);
}
