import { NextRequest, NextResponse } from "next/server";
import {
  isCurrentJakartaMonth,
  jakartaTodayForCashin,
  monthRange,
  previousMonthKey,
  sameDayLastMonthRange,
} from "@/lib/cashin";
import { getMoveActivityReport, type MoveActivityReport, type MoveActivityTotals } from "@/lib/moveActivity";

export const dynamic = "force-dynamic";

export type MoveActivityResponse = MoveActivityReport & {
  isCurrentMonth: boolean;
  comparison: {
    period: { start: string; end: string };
    totals: MoveActivityTotals | null;
  };
};

// Same period model as /api/cashin (Storeganise keeps full rental/invoice
// history, so any past month can be recomputed on demand — no snapshots).
export async function GET(request: NextRequest) {
  try {
    const today = jakartaTodayForCashin();
    const currentMonthKey = today.slice(0, 7);
    const periodParam = request.nextUrl.searchParams.get("period") ?? "current";

    let targetMonthKey: string;
    if (periodParam === "current") {
      targetMonthKey = currentMonthKey;
    } else if (periodParam === "last") {
      targetMonthKey = previousMonthKey(currentMonthKey);
    } else {
      targetMonthKey = periodParam > currentMonthKey ? currentMonthKey : periodParam;
    }

    const isCurrentMonth = isCurrentJakartaMonth(targetMonthKey);
    const period = isCurrentMonth ? { start: `${targetMonthKey}-01`, end: today } : monthRange(targetMonthKey);

    const comparisonRange = isCurrentMonth
      ? sameDayLastMonthRange(today)
      : monthRange(previousMonthKey(targetMonthKey));

    const [report, comparisonReport] = await Promise.all([
      getMoveActivityReport(period.start, period.end),
      getMoveActivityReport(comparisonRange.start, comparisonRange.end).catch(() => null),
    ]);

    const response: MoveActivityResponse = {
      ...report,
      isCurrentMonth,
      comparison: { period: comparisonRange, totals: comparisonReport?.totals ?? null },
    };
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
