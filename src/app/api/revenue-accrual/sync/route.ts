import { NextResponse } from "next/server";
import { syncRevenue } from "@/lib/revenueAccrual";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// "Refresh now" on /revenue-accrual, and the first fill after deploy: syncs
// changed invoices for up to ~40s; the page calls again while `pending` > 0.
export async function POST() {
  try {
    return NextResponse.json(await syncRevenue());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
