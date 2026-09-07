import { NextRequest, NextResponse } from "next/server";
import { getOccupancySnapshot } from "@/lib/storeganise";
import { ensureSchema, query } from "@/lib/db";

export const dynamic = "force-dynamic";

// Runs once daily (see vercel.json) at 17:00 UTC = 00:00 WIB, so "today" in
// Jakarta time at the moment this runs is effectively the same as "the
// closing occupancy of yesterday" — close enough overnight that we just
// label the row with today's Jakarta date rather than tracking both.
function todayInJakarta(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    await ensureSchema();
    const snapshot = await getOccupancySnapshot();
    const date = todayInJakarta();

    for (const site of snapshot.sites) {
      await query(
        `INSERT INTO occupancy_snapshots
           (snapshot_date, site_id, site_name, total_units, occupied_units, available_units, reserved_units, blocked_units)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (snapshot_date, site_id) DO UPDATE SET
           site_name = EXCLUDED.site_name,
           total_units = EXCLUDED.total_units,
           occupied_units = EXCLUDED.occupied_units,
           available_units = EXCLUDED.available_units,
           reserved_units = EXCLUDED.reserved_units,
           blocked_units = EXCLUDED.blocked_units,
           created_at = now()`,
        [
          date,
          site.siteId,
          site.siteName,
          site.totalUnits,
          site.occupiedUnits,
          site.availableUnits,
          site.reservedUnits,
          site.blockedUnits,
        ]
      );
    }

    return NextResponse.json({ ok: true, date, sites: snapshot.sites.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
