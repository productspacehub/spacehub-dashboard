import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getIdCheckReport } from "@/lib/idCheck";
import { isPilotAllowed } from "@/lib/ktpPilot";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [report, session] = await Promise.all([getIdCheckReport(), auth()]);
    return NextResponse.json({ ...report, pilotAllowed: isPilotAllowed(session?.user?.email) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
