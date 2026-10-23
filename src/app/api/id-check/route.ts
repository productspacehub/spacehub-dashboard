import { NextResponse } from "next/server";
import { getIdCheckReport } from "@/lib/idCheck";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getIdCheckReport());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
