import { NextRequest, NextResponse } from "next/server";
import {
  getCashinReport,
  getCashinTotalExcludingDeposit,
  isCurrentJakartaMonth,
  jakartaTodayForCashin,
  monthRange,
  previousMonthKey,
  sameDayLastMonthRange,
  type CashinReport,
} from "@/lib/cashin";

export const dynamic = "force-dynamic";

export type CashinResponse = CashinReport & {
  // Whether the returned period is the in-progress current month (MTD, capped at
  // today) or a closed calendar month — the UI reads this to switch between
  // "bulan ini" / "vs pace" wording and a specific month name / plain "vs <bulan>".
  isCurrentMonth: boolean;
  comparison: {
    period: { start: string; end: string };
    total: number | null;
    deltaPct: number | null;
  };
};

// ?period= accepts "current" (default), "last" (previous full calendar month),
// or a literal "YYYY-MM" for any other month — Storeganise keeps full payment
// history, so any past month can be recomputed on demand the same way as the
// current one, no stored snapshots needed.
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
      // A literal YYYY-MM — clamp a future month to the current one rather than
      // erroring (the UI's month picker already caps at today, this just guards
      // a hand-edited URL).
      targetMonthKey = periodParam > currentMonthKey ? currentMonthKey : periodParam;
    }

    const isCurrentMonth = isCurrentJakartaMonth(targetMonthKey);
    const period = isCurrentMonth ? { start: `${targetMonthKey}-01`, end: today } : monthRange(targetMonthKey);

    // For the in-progress month, the comparison is "pace" — the same day-of-month
    // cutoff last month, since that's the only fair comparison for a partial
    // month. For a closed month, it's simply the full month before it.
    const comparisonRange = isCurrentMonth
      ? sameDayLastMonthRange(today)
      : monthRange(previousMonthKey(targetMonthKey));

    // The main report and the comparison total run concurrently — they're
    // independent date ranges — and the comparison uses the cheaper
    // deposit-excluding total rather than a second full categorization, since
    // it only ever needs one number.
    const [report, comparisonTotal] = await Promise.all([
      getCashinReport(period.start, period.end),
      getCashinTotalExcludingDeposit(comparisonRange.start, comparisonRange.end).catch(() => null),
    ]);

    const deltaPct =
      comparisonTotal !== null && comparisonTotal > 0
        ? ((report.total - comparisonTotal) / comparisonTotal) * 100
        : null;

    const response: CashinResponse = {
      ...report,
      isCurrentMonth,
      comparison: { period: comparisonRange, total: comparisonTotal, deltaPct },
    };
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
