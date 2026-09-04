import { NextResponse } from "next/server";
import { getUnitsDetail } from "@/lib/storeganise";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const detail = await getUnitsDetail();
    return NextResponse.json(detail);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
