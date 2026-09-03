import { NextResponse } from "next/server";
import { getOccupancySnapshot } from "@/lib/storeganise";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await getOccupancySnapshot();
    return NextResponse.json(snapshot);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
