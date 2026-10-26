import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isMappingAllowed } from "@/lib/addressMapping";
import { getAddressProfile } from "@/lib/addressProfile";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [profile, session] = await Promise.all([getAddressProfile(), auth()]);
    return NextResponse.json({ ...profile, mappingAllowed: isMappingAllowed(session?.user?.email) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
