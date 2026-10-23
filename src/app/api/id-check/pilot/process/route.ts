import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isPilotAllowed, processNextSample } from "@/lib/ktpPilot";

export const dynamic = "force-dynamic";
// One file per request: download + up to five OCR passes.
export const maxDuration = 60;

export async function POST() {
  const session = await auth();
  const email = session?.user?.email;
  if (!isPilotAllowed(email)) {
    return NextResponse.json({ error: "Tidak punya akses ke pilot OCR" }, { status: 403 });
  }
  try {
    const row = await processNextSample(email!);
    return NextResponse.json({ row, sampleFull: row === null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
