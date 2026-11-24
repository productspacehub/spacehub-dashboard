import { getCashinReport, getCashinTotalExcludingDeposit, sameDayLastMonthRange } from "./cashin";
import { getMoveActivityReport } from "./moveActivity";
import { getBookingActivityReport } from "./bookingActivity";
import { getOccupancySnapshot } from "./storeganise";
import { getSnapshotByDate, jakartaToday } from "./snapshots";

// Data behind the daily Slack digest. This app only computes the numbers;
// productspacehub/spacehub-slack-notifier fetches them from /api/digest each
// morning, formats them and posts to Slack. Every figure comes from the same
// report functions as the home page cards, so the digest and the dashboard
// always agree.
//
// The digest is sent early in the morning, when today has barely started, so
// everything is reported for complete days: "yesterday", and the month to
// date through yesterday (on the 1st, that's the whole previous month), paced
// against the same day-of-month last month, as on the home page.

export type DigestSection<T> = { ok: true; data: T } | { ok: false; error: string };

export type OccupancyDigest = {
  occupancyRate: number; // percent, 0–100
  occupiedUnits: number;
  totalUnits: number;
  // Live now vs the snapshot labelled yesterday: the same "vs kemarin" figure as
  // the home page card. Null when that snapshot isn't there.
  occupiedDeltaVsYesterday: number | null;
  // Sites whose occupied-unit count changed, largest change first.
  siteChanges: { siteName: string; delta: number }[];
};

export type CashinDigest = {
  yesterday: number;
  monthToDate: number;
  paceDeltaPct: number | null;
};

export type MoveActivityDigest = {
  yesterday: { moveIn: number; moveOut: number; net: number };
  monthToDate: { moveIn: number; moveOut: number; net: number };
  // Month-to-date net minus last month's net at the same point (home page card's badge).
  netVsPace: number | null;
};

export type BookingActivityDigest = {
  yesterday: { count: number; revenue: number };
  monthToDate: { count: number; revenue: number };
  revenuePaceDeltaPct: number | null;
};

export type DailyDigest = {
  generatedAt: string;
  today: string; // YYYY-MM-DD, Jakarta
  yesterday: string;
  // Month to date, through yesterday.
  period: { start: string; end: string; monthComplete: boolean };
  comparisonPeriod: { start: string; end: string };
  occupancy: DigestSection<OccupancyDigest>;
  cashin: DigestSection<CashinDigest>;
  moveActivity: DigestSection<MoveActivityDigest>;
  bookingActivity: DigestSection<BookingActivityDigest>;
};

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function pctChange(current: number, previous: number | null): number | null {
  return previous !== null && previous > 0 ? ((current - previous) / previous) * 100 : null;
}

async function section<T>(fn: () => Promise<T>): Promise<DigestSection<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    console.error("Daily digest section failed", error);
    return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

async function occupancyDigest(yesterday: string): Promise<OccupancyDigest> {
  const snapshot = await getOccupancySnapshot();
  // As on /api/occupancy: a missing or unreachable snapshot only drops the deltas.
  const previous = await getSnapshotByDate(yesterday).catch(() => []);
  const previousBySite = new Map(previous.map((r) => [r.site_id, r.occupied_units]));

  const siteChanges = snapshot.sites
    .flatMap((site) => {
      const prev = previousBySite.get(site.siteId);
      const delta = prev === undefined ? 0 : site.occupiedUnits - prev;
      return delta === 0 ? [] : [{ siteName: site.siteName, delta }];
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.siteName.localeCompare(b.siteName));

  return {
    occupancyRate: snapshot.overall.occupancyRate,
    occupiedUnits: snapshot.overall.occupiedUnits,
    totalUnits: snapshot.overall.totalUnits,
    occupiedDeltaVsYesterday:
      previous.length > 0
        ? snapshot.overall.occupiedUnits - previous.reduce((sum, r) => sum + r.occupied_units, 0)
        : null,
    siteChanges,
  };
}

export async function buildDailyDigest(): Promise<DailyDigest> {
  const today = jakartaToday();
  const yesterday = addDays(today, -1);
  const period = { start: `${yesterday.slice(0, 7)}-01`, end: yesterday };
  const comparisonPeriod = sameDayLastMonthRange(yesterday);

  const [occupancy, cashin, moveActivity, bookingActivity] = await Promise.all([
    section(() => occupancyDigest(yesterday)),

    section(async (): Promise<CashinDigest> => {
      const [report, comparisonTotal] = await Promise.all([
        getCashinReport(period.start, period.end),
        getCashinTotalExcludingDeposit(comparisonPeriod.start, comparisonPeriod.end).catch(() => null),
      ]);
      return {
        yesterday: report.byDay.find((d) => d.date === yesterday)?.total ?? 0,
        monthToDate: report.total,
        paceDeltaPct: pctChange(report.total, comparisonTotal),
      };
    }),

    section(async (): Promise<MoveActivityDigest> => {
      const [report, comparison] = await Promise.all([
        getMoveActivityReport(period.start, period.end),
        getMoveActivityReport(comparisonPeriod.start, comparisonPeriod.end).catch(() => null),
      ]);
      const day = report.byDay.find((d) => d.date === yesterday);
      const dayIn = day?.moveIn ?? 0;
      const dayOut = day?.moveOut ?? 0;
      return {
        yesterday: { moveIn: dayIn, moveOut: dayOut, net: dayIn - dayOut },
        monthToDate: { moveIn: report.totals.moveIn, moveOut: report.totals.moveOut, net: report.totals.net },
        netVsPace: comparison ? report.totals.net - comparison.totals.net : null,
      };
    }),

    section(async (): Promise<BookingActivityDigest> => {
      const [report, comparison] = await Promise.all([
        getBookingActivityReport(period.start, period.end),
        getBookingActivityReport(comparisonPeriod.start, comparisonPeriod.end).catch(() => null),
      ]);
      const day = report.byDay.find((d) => d.date === yesterday);
      const sum = (totals: Record<string, number> | undefined) =>
        totals ? Object.values(totals).reduce((s, v) => s + v, 0) : 0;
      return {
        yesterday: { count: sum(day?.counts), revenue: sum(day?.revenue) },
        monthToDate: { count: report.totalCount, revenue: report.totalRevenue },
        revenuePaceDeltaPct: pctChange(report.totalRevenue, comparison?.totalRevenue ?? null),
      };
    }),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    today,
    yesterday,
    period: { ...period, monthComplete: today.slice(0, 7) !== yesterday.slice(0, 7) },
    comparisonPeriod,
    occupancy,
    cashin,
    moveActivity,
    bookingActivity,
  };
}
