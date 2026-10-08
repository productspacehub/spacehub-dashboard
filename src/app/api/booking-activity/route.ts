import { NextRequest, NextResponse } from "next/server";
import {
  isCurrentJakartaMonth,
  jakartaTodayForCashin,
  monthRange,
  previousMonthKey,
  sameDayLastMonthRange,
} from "@/lib/cashin";
import { getBookingActivityReport, type BookingActivityReport, type BookingModuleTotals } from "@/lib/bookingActivity";

export const dynamic = "force-dynamic";

export type BookingActivityResponse = BookingActivityReport & {
  isCurrentMonth: boolean;
  comparison: {
    period: { start: string; end: string };
    counts: BookingModuleTotals | null;
    revenue: BookingModuleTotals | null;
    totalCount: number | null;
    totalRevenue: number | null;
  };
};

// Same period model as /api/cashin and /api/move-activity — bookings live in
// this app's own Postgres, so any past month can be recomputed on demand.
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
      getBookingActivityReport(period.start, period.end),
      getBookingActivityReport(comparisonRange.start, comparisonRange.end).catch(() => null),
    ]);

    const response: BookingActivityResponse = {
      ...report,
      isCurrentMonth,
      comparison: {
        period: comparisonRange,
        counts: comparisonReport?.counts ?? null,
        revenue: comparisonReport?.revenue ?? null,
        totalCount: comparisonReport?.totalCount ?? null,
        totalRevenue: comparisonReport?.totalRevenue ?? null,
      },
    };
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
