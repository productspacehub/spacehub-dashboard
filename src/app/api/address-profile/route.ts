import { NextResponse } from "next/server";
import { getAddressProfile } from "@/lib/addressProfile";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getAddressProfile());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
