import { NextRequest, NextResponse } from "next/server";
import { getUnitsDetail, type StatusBreakdown } from "@/lib/storeganise";
import {
  getSnapshotByDate,
  getTrend,
  resolveCompareDate,
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
    let trend: TrendPoint[] = [];

    try {
      const [compareRows, trendPoints] = await Promise.all([getSnapshotByDate(resolvedDate), getTrend(30)]);
      trend = trendPoints;

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
      }
    } catch {
      // no history yet / db unavailable — breakdown keeps delta: null, trend stays []
    }

    const response: UnitsDetailWithComparison = {
      ...detail,
      breakdown,
      trend,
      compareTo: { requested: compareToParam, resolvedDate, available: comparisonAvailable },
    };
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
