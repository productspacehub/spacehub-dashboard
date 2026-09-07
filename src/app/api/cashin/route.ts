import { NextResponse } from "next/server";
import {
  firstOfMonth,
  getCashinReport,
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

    const report = await getCashinReport(mtdStart, today);

    // The pace comparison is a nice-to-have on top of the report above — degrade to
    // no comparison rather than failing the whole request if it errors out. Uses the
    // same full categorization as the MTD report (not just a raw payments sum) so
    // the comparison is apples-to-apples: both sides exclude deposits.
    let paceTotal: number | null = null;
    try {
      paceTotal = (await getCashinReport(paceRange.start, paceRange.end)).total;
    } catch {
      paceTotal = null;
    }

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
