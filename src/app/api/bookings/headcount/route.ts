import { NextRequest, NextResponse } from "next/server";
import { getActiveHeadcountToday, MODULE_TYPES, type ModuleType } from "@/lib/bookings";

export const dynamic = "force-dynamic";

// Informational only (§7.1: "availability is a headcount check only") —
// counts today's Active bookings for a module, nothing here blocks
// creating another booking even if this number looks "full".
export async function GET(request: NextRequest) {
  try {
    const moduleParam = request.nextUrl.searchParams.get("module");
    const moduleType = moduleParam && (MODULE_TYPES as readonly string[]).includes(moduleParam) ? (moduleParam as ModuleType) : null;
    if (!moduleType) return NextResponse.json({ error: "Modul tidak valid" }, { status: 400 });
    const count = await getActiveHeadcountToday(moduleType);
    return NextResponse.json({ count });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
