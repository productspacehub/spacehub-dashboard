import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isMappingAllowed, searchRegions } from "@/lib/addressMapping";
import { loadRegionIndex } from "@/lib/regions";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!isMappingAllowed(session?.user?.email)) {
    return NextResponse.json({ error: "Tidak punya akses ke pemetaan alamat" }, { status: 403 });
  }
  const q = request.nextUrl.searchParams.get("q") ?? "";
  return NextResponse.json({ results: searchRegions(q.slice(0, 80), await loadRegionIndex()) });
}
