import { NextRequest, NextResponse } from "next/server";
import { getUnitsDetail, type StatusBreakdown } from "@/lib/storeganise";
import {
  getSnapshotByDate,
  getTrend,
  getTrendBySite,
  isDateString,
  resolveCompareDate,
  trendStart,
  type SiteTrend,
  type SnapshotRow,
  type StatusBreakdownWithDelta,
  type TrendPoint,
  type UnitsDetailWithComparison,
} from "@/lib/snapshots";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const detail = await getUnitsDetail();

    const compareToParam = request.nextUrl.searchParams.get("compareTo") ?? "yesterday";
    const resolvedDate = resolveCompareDate(compareToParam);

    // Same fail-soft principle as /api/occupancy: the comparison feature depends
    // on the snapshot database, which is separate from the live Storeganise data
    // above — if it's not reachable, degrade to "no comparison" instead of
    // failing the whole page.
    let breakdown: StatusBreakdownWithDelta[] = detail.breakdown.map((b) => ({
      ...b,
      delta: null,
    }));
    let comparisonAvailable = false;
    let compareRate: number | null = null;
    let trend: TrendPoint[] = [];
    let compareRows: SnapshotRow[] = [];
    let trendBySite = new Map<string, TrendPoint[]>();

    try {
      const since = trendStart(resolvedDate);
      [compareRows, trend, trendBySite] = await Promise.all([
        isDateString(resolvedDate) ? getSnapshotByDate(resolvedDate) : Promise.resolve([]),
        getTrend(since),
        getTrendBySite(since),
      ]);

      if (compareRows.length > 0) {
        comparisonAvailable = true;
        const compareTotals: Record<StatusBreakdown["state"], number> = {
          available: 0,
          occupied: 0,
          reserved: 0,
          blocked: 0,
        };
        for (const row of compareRows) {
          compareTotals.available += row.available_units;
          compareTotals.occupied += row.occupied_units;
          compareTotals.reserved += row.reserved_units;
          compareTotals.blocked += row.blocked_units;
        }
        breakdown = detail.breakdown.map((b) => ({ ...b, delta: b.count - compareTotals[b.state] }));
        const compareTotal = compareRows.reduce((sum, row) => sum + row.total_units, 0);
        compareRate = compareTotal > 0 ? (compareTotals.occupied / compareTotal) * 100 : null;
      }
    } catch {
      // no history yet / db unavailable — breakdown keeps delta: null, trend stays []
    }

    // Live counts per site, same definition as the overall rate (archived
    // units left out), next to that site's snapshot on the comparison date.
    const live = new Map<string, { siteName: string; occupied: number; total: number }>();
    for (const u of detail.units) {
      if (u.state === "archived") continue;
      const entry = live.get(u.siteId) ?? { siteName: u.siteName, occupied: 0, total: 0 };
      entry.total += 1;
      if (u.state === "occupied") entry.occupied += 1;
      live.set(u.siteId, entry);
    }
    const siteTrends: SiteTrend[] = Array.from(live.entries())
      .filter(([, s]) => s.total > 0)
      .map(([siteId, s]) => {
        const row = compareRows.find((r) => r.site_id === siteId);
        return {
          siteId,
          siteName: s.siteName,
          occupiedUnits: s.occupied,
          totalUnits: s.total,
          occupancyRate: (s.occupied / s.total) * 100,
          compare:
            row && row.total_units > 0
              ? {
                  occupiedUnits: row.occupied_units,
                  totalUnits: row.total_units,
                  occupancyRate: (row.occupied_units / row.total_units) * 100,
                }
              : null,
          trend: trendBySite.get(siteId) ?? [],
        };
      })
      .sort((a, b) => b.occupancyRate - a.occupancyRate || a.siteName.localeCompare(b.siteName));

    const response: UnitsDetailWithComparison = {
      ...detail,
      breakdown,
      trend,
      siteTrends,
      compareTo: { requested: compareToParam, resolvedDate, available: comparisonAvailable, occupancyRate: compareRate },
    };
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
