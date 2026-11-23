import { advisorAvailability, handleAdvisor } from "@/lib/advisor/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export function GET() {
  return advisorAvailability();
}

export function POST(req: Request) {
  return handleAdvisor(req);
}
