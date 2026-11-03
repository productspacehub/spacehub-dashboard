import { jakartaToday } from "./snapshots";
import { fetchSites, fetchUnits, paginate, pickTitle } from "./storeganise";

// Monthly retention cohorts from Storeganise unit rentals: the current month
// plus the 24 before it, each followed for up to 24 months.
export const MAX_OFFSET = 24;
export const COHORT_COUNT = MAX_OFFSET + 1;

// "customer": a customer counts as staying while they rent at least one unit
// (moving units isn't leaving; leaving and coming back counts as active
// again). "unit": every rental is followed on its own.
export type CohortMode = "customer" | "unit";

export type CohortRental = { id: string; ownerId: string; siteId: string; state: string; startDate?: string; endDate?: string };

// A rental reduced to what the cohort needs. Dates are Jakarta calendar days
// ("YYYY-MM-DD"); end null = still renting.
export type Stay = { ownerId: string; siteId: string; start: string; end: string | null };

export type CohortRow = {
  month: string; // "YYYY-MM"
  size: number;
  // Still renting at the end of month +k (today for the current month);
  // null where that month hasn't happened yet.
  active: (number | null)[];
};

export type CurvePoint = { offset: number; rate: number; cohorts: number; size: number };

export type CohortTable = {
  rows: CohortRow[]; // oldest first
  // Size-weighted retention over every cohort that has reached each month.
  curve: CurvePoint[];
  activeNow: number;
  // Customers/rentals whose first month is before the oldest cohort shown.
  before: number;
};

export type CohortReport = {
  generatedAt: string;
  today: string;
  sites: { id: string; name: string }[];
  // Keyed by site id, plus "all".
  tables: Record<string, Record<CohortMode, CohortTable>>;
  // For the data-quality panel: what Storeganise says is occupied right now,
  // to compare with what the rental dates say.
  occupiedNow: Record<string, { units: number; customers: number }>;
  issues: StayIssues;
};

const monthOf = (date: string) => date.slice(0, 7);

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

function lastDayOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, "0")}`;
}

// Renting at the end of `point`: started on or before it and not yet ended.
// A rental ending on the last day of the month is gone by month end.
const activeAt = (stays: Stay[], point: string) => stays.some((s) => s.start <= point && (s.end === null || s.end > point));

export function buildCohortTable(stays: Stay[], mode: CohortMode, today: string): CohortTable {
  const groups =
    mode === "unit"
      ? stays.map((s) => [s])
      : Array.from(
          stays.reduce((m, s) => m.set(s.ownerId, [...(m.get(s.ownerId) ?? []), s]), new Map<string, Stay[]>()).values()
        );

  const current = monthOf(today);
  const oldest = addMonths(current, -MAX_OFFSET);
  const rowsByMonth = new Map<string, CohortRow>();
  for (let i = 0; i < COHORT_COUNT; i++) {
    const month = addMonths(oldest, i);
    const reached = MAX_OFFSET - i; // offsets that have happened (current month included)
    rowsByMonth.set(month, { month, size: 0, active: Array.from({ length: MAX_OFFSET + 1 }, (_, k) => (k <= reached ? 0 : null)) });
  }

  let activeNow = 0;
  let before = 0;
  for (const group of groups) {
    if (activeAt(group, today)) activeNow += 1;
    const first = group.reduce((min, s) => (s.start < min ? s.start : min), group[0].start);
    // A start date in the future (a booked move-in recorded as occupied) has
    // no cohort yet.
    if (first > today) continue;
    const cohort = monthOf(first);
    if (cohort < oldest) {
      before += 1;
      continue;
    }
    const row = rowsByMonth.get(cohort)!;
    row.size += 1;
    row.active.forEach((v, k) => {
      if (v === null) return;
      const month = addMonths(cohort, k);
      if (activeAt(group, month === current ? today : lastDayOf(month))) row.active[k] = v + 1;
    });
  }

  const rows = Array.from(rowsByMonth.values());
  const curve: CurvePoint[] = [];
  for (let k = 0; k <= MAX_OFFSET; k++) {
    let active = 0;
    let size = 0;
    let cohorts = 0;
    for (const r of rows) {
      if (r.active[k] === null || r.size === 0) continue;
      active += r.active[k]!;
      size += r.size;
      cohorts += 1;
    }
    if (size > 0) curve.push({ offset: k, rate: active / size, cohorts, size });
  }
  return { rows, curve, activeNow, before };
}

export type StayIssues = {
  // Left out: can't be placed in time.
  endedWithoutEndDate: number;
  withoutStartDate: number;
  occupiedWithoutStartDate: number; // of withoutStartDate
  // Occupied but starting after today: no cohort yet, not counted as renting.
  occupiedFutureStart: number;
  // Occupied although their end date has passed: still counted as renting
  // (Storeganise's status wins), listed so the gap with "occupied" can be read.
  occupiedPastEnd: number;
};

// Only rentals that actually moved in: occupied now, or ended. For an
// occupied rental the status is the truth about now — any end date on it
// (planned or already past) is ignored, so it counts up to today. A rental
// without a start date can't be placed; an ended one without an end date
// can't say when it ended — both are left out and counted.
export function toStays(rentals: CohortRental[], today: string): { stays: Stay[]; issues: StayIssues } {
  const stays: Stay[] = [];
  const issues: StayIssues = {
    endedWithoutEndDate: 0,
    withoutStartDate: 0,
    occupiedWithoutStartDate: 0,
    occupiedFutureStart: 0,
    occupiedPastEnd: 0,
  };
  for (const r of rentals) {
    if (!r.startDate) {
      issues.withoutStartDate += 1;
      if (r.state !== "ended") issues.occupiedWithoutStartDate += 1;
      continue;
    }
    const start = r.startDate.slice(0, 10);
    const end = r.endDate ? r.endDate.slice(0, 10) : null;
    if (r.state === "ended") {
      if (!end) {
        issues.endedWithoutEndDate += 1;
        continue;
      }
      stays.push({ ownerId: r.ownerId, siteId: r.siteId, start, end });
      continue;
    }
    if (start > today) issues.occupiedFutureStart += 1;
    if (end && end <= today) issues.occupiedPastEnd += 1;
    stays.push({ ownerId: r.ownerId, siteId: r.siteId, start, end: null });
  }
  return { stays, issues };
}

export async function getCohortReport(): Promise<CohortReport> {
  const [occupied, ended, units, sites] = await Promise.all([
    paginate<CohortRental>("/v1/admin/unit-rentals?state=occupied"),
    paginate<CohortRental>("/v1/admin/unit-rentals?state=ended"),
    fetchUnits(),
    fetchSites(),
  ]);
  const today = jakartaToday();
  const { stays, issues } = toStays([...occupied, ...ended], today);

  const siteIds = Array.from(new Set(stays.map((s) => s.siteId)));
  const nameById = new Map(sites.map((s) => [s.id, pickTitle(s.title, s.code ?? s.id)]));
  const tables: CohortReport["tables"] = {};
  const occupiedNow: CohortReport["occupiedNow"] = {};
  for (const key of ["all", ...siteIds]) {
    const subset = key === "all" ? stays : stays.filter((s) => s.siteId === key);
    tables[key] = { customer: buildCohortTable(subset, "customer", today), unit: buildCohortTable(subset, "unit", today) };
    const occ = key === "all" ? occupied : occupied.filter((r) => r.siteId === key);
    occupiedNow[key] = {
      units: units.filter((u) => u.state === "occupied" && (key === "all" || u.siteId === key)).length,
      customers: new Set(occ.map((r) => r.ownerId)).size,
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    today,
    sites: siteIds.map((id) => ({ id, name: nameById.get(id) ?? id })).sort((a, b) => a.name.localeCompare(b.name)),
    tables,
    occupiedNow,
    issues,
  };
}
