import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getPilotSummary, isPilotAllowed } from "@/lib/ktpPilot";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!isPilotAllowed(session?.user?.email)) {
    return NextResponse.json({ error: "Tidak punya akses ke pilot OCR" }, { status: 403 });
  }
  try {
    return NextResponse.json(await getPilotSummary());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
