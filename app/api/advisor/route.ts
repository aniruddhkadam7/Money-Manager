import { advisorAvailability, handleAdvisor } from "@/lib/advisor/server";

export const dynamic = "force-dynamic";
// A long answer on a full year of records can take a while: up to 5 minutes, not 1.
export const maxDuration = 300;

export function GET() {
  return advisorAvailability();
}

export function POST(req: Request) {
  return handleAdvisor(req);
}
