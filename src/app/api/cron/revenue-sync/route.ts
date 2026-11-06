import { NextRequest, NextResponse } from "next/server";
import { syncRevenue } from "@/lib/revenueAccrual";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Daily (see vercel.json): picks up invoices created, paid or changed since
// the last run — including late payments for past periods.
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  try {
    return NextResponse.json({ ok: true, ...(await syncRevenue()) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
