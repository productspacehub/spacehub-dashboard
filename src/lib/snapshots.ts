import { ensureSchema, query } from "./db";
import type { OccupancySnapshot, SiteOccupancy, StatusBreakdown, UnitsDetail } from "./storeganise";

export type SnapshotRow = {
  snapshot_date: string;
  site_id: string;
  site_name: string;
  total_units: number;
  occupied_units: number;
  available_units: number;
  reserved_units: number;
  blocked_units: number;
};

export type TrendPoint = {
  date: string;
  occupiedUnits: number;
  totalUnits: number;
};

function jakartaDateString(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

export function jakartaToday(): string {
  return jakartaDateString(new Date());
}

export function jakartaDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return jakartaDateString(d);
}

export async function getSnapshotByDate(date: string): Promise<SnapshotRow[]> {
  await ensureSchema();
  return query<SnapshotRow>(
    `SELECT to_char(snapshot_date, 'YYYY-MM-DD') AS snapshot_date, site_id, site_name, total_units,
            occupied_units, available_units, reserved_units, blocked_units
     FROM occupancy_snapshots
     WHERE snapshot_date = $1`,
    [date]
  );
}

export async function getTrend(days: number): Promise<TrendPoint[]> {
  await ensureSchema();
  const since = jakartaDaysAgo(days);
  // pg parses a bare `date` column into a JS Date (midnight UTC), which then
  // serializes with a time component and can shift a day in a non-UTC viewer
  // timezone — cast to text so the API always returns a plain YYYY-MM-DD.
  const rows = await query<{ snapshot_date: string; occupied: string; total: string }>(
    `SELECT to_char(snapshot_date, 'YYYY-MM-DD') AS snapshot_date,
            SUM(occupied_units) AS occupied,
            SUM(total_units) AS total
     FROM occupancy_snapshots
     WHERE snapshot_date >= $1
     GROUP BY snapshot_date
     ORDER BY snapshot_date ASC`,
    [since]
  );
  return rows.map((r) => ({
    date: r.snapshot_date,
    occupiedUnits: Number(r.occupied),
    totalUnits: Number(r.total),
  }));
}

// "compareTo" preset resolution shared by the summary and detail routes.
export function resolveCompareDate(param: string): string {
  if (param === "yesterday") return jakartaDaysAgo(1);
  if (param === "7d") return jakartaDaysAgo(7);
  if (param === "30d") return jakartaDaysAgo(30);
  return param; // treat anything else as a literal YYYY-MM-DD
}

export type SiteOccupancyWithDelta = SiteOccupancy & { occupiedDeltaVsYesterday: number | null };

export type OccupancySnapshotWithDelta = Omit<OccupancySnapshot, "sites" | "overall"> & {
  sites: SiteOccupancyWithDelta[];
  overall: OccupancySnapshot["overall"] & { occupiedDeltaVsYesterday: number | null };
};

export type StatusBreakdownWithDelta = StatusBreakdown & { delta: number | null };

export type CompareInfo = { requested: string; resolvedDate: string; available: boolean };

export type UnitsDetailWithComparison = Omit<UnitsDetail, "breakdown"> & {
  breakdown: StatusBreakdownWithDelta[];
  trend: TrendPoint[];
  compareTo: CompareInfo;
};
