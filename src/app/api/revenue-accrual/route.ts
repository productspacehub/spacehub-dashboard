import { NextRequest, NextResponse } from "next/server";
import { getRevenueReport, type RevenueReport } from "@/lib/revenueAccrual";

export const dynamic = "force-dynamic";

export type RevenueAccrualResponse = RevenueReport;

// ?month=current|last|YYYY-MM&site=all|<siteId> — read from the synced tables
// only, so this is cheap enough for the home page card.
export async function GET(request: NextRequest) {
  try {
    const month = request.nextUrl.searchParams.get("month") ?? "current";
    const site = request.nextUrl.searchParams.get("site") ?? "all";
    return NextResponse.json(await getRevenueReport(month, site));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
