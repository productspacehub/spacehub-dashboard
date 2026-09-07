import { NextResponse } from "next/server";
import { getOccupancySnapshot } from "@/lib/storeganise";
import { getSnapshotByDate, jakartaDaysAgo, type OccupancySnapshotWithDelta } from "@/lib/snapshots";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await getOccupancySnapshot();

    // The "vs yesterday" delta depends on the snapshot database, which is a
    // separate concern from the live Storeganise data above — if it's not
    // reachable (not set up yet, or a transient issue), degrade to no delta
    // rather than failing the whole page.
    let yesterdayBySite = new Map<string, { occupied_units: number }>();
    let yesterdayOverallOccupied: number | null = null;
    try {
      const yesterdayRows = await getSnapshotByDate(jakartaDaysAgo(1));
      if (yesterdayRows.length > 0) {
        yesterdayBySite = new Map(yesterdayRows.map((r) => [r.site_id, r]));
        yesterdayOverallOccupied = yesterdayRows.reduce((sum, r) => sum + r.occupied_units, 0);
      }
    } catch {
      // no history yet / db unavailable — deltas stay null below
    }

    const sites = snapshot.sites.map((site) => {
      const prev = yesterdayBySite.get(site.siteId);
      return {
        ...site,
        occupiedDeltaVsYesterday: prev ? site.occupiedUnits - prev.occupied_units : null,
      };
    });

    const response: OccupancySnapshotWithDelta = {
      ...snapshot,
      sites,
      overall: {
        ...snapshot.overall,
        occupiedDeltaVsYesterday:
          yesterdayOverallOccupied === null
            ? null
            : snapshot.overall.occupiedUnits - yesterdayOverallOccupied,
      },
    };
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
