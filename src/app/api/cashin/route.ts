import { NextResponse } from "next/server";
import {
  firstOfMonth,
  getCashinReport,
  getCashinTotalExcludingDeposit,
  jakartaTodayForCashin,
  sameDayLastMonthRange,
  type CashinReport,
} from "@/lib/cashin";

export const dynamic = "force-dynamic";

export type CashinResponse = CashinReport & {
  pace: {
    period: { start: string; end: string };
    total: number | null;
    deltaPct: number | null;
  };
};

export async function GET() {
  try {
    const today = jakartaTodayForCashin();
    const mtdStart = firstOfMonth(today);
    const paceRange = sameDayLastMonthRange(today);

    // Run the MTD report and the pace comparison concurrently — they're
    // independent date ranges, and running them sequentially was doubling this
    // route's latency for no reason. The pace comparison is a nice-to-have on
    // top of the report, so it degrades to no comparison rather than failing
    // the whole request if it errors out.
    const [report, paceTotal] = await Promise.all([
      getCashinReport(mtdStart, today),
      getCashinTotalExcludingDeposit(paceRange.start, paceRange.end).catch(() => null),
    ]);

    const deltaPct =
      paceTotal !== null && paceTotal > 0 ? ((report.total - paceTotal) / paceTotal) * 100 : null;

    const response: CashinResponse = {
      ...report,
      pace: { period: paceRange, total: paceTotal, deltaPct },
    };
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
