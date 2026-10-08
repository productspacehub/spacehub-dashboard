import { ensureSchema, query } from "./db";
import { MODULE_LABELS, MODULE_TYPES, type ModuleType } from "./bookingConstants";

export type BookingModuleTotals = Record<ModuleType, number>;

function emptyModuleTotals(): BookingModuleTotals {
  return { shared_storage: 0, co_working: 0, meeting_room: 0, studio: 0 };
}

export type BookingActivityDayBreakdown = {
  date: string;
  counts: BookingModuleTotals;
  revenue: BookingModuleTotals;
};

export type BookingActivityModuleBreakdown = {
  moduleType: ModuleType;
  moduleLabel: string;
  count: number;
  revenue: number;
};

export type BookingActivityReport = {
  generatedAt: string;
  period: { start: string; end: string };
  counts: BookingModuleTotals;
  revenue: BookingModuleTotals;
  totalCount: number;
  totalRevenue: number;
  byDay: BookingActivityDayBreakdown[];
  byModule: BookingActivityModuleBreakdown[];
};

type ReportRow = {
  day: string;
  module_type: ModuleType;
  booking_count: string;
  revenue: string;
};

// "Booking baru" = a new booking entry, counted on the Jakarta calendar day it
// was created (created_at), regardless of payment status — a Pending Payment
// booking is still a real new booking. Cancelled is the one status excluded,
// the same way Move Activity's Move In excludes rentals that never actually
// happened.
//
// Revenue has no equivalent to Cash-in's real payment records (this schema
// has payment_status as a flag, not a timestamped payment event) — so it's
// also attributed to created_at, filtered to payment_status = 'Paid' and
// status <> 'Cancelled'. This means revenue shows up on the day a booking was
// made, not the day it was actually paid, if those days differ (e.g. created
// today, marked Paid a few days later). See the methodology note on
// /booking-activity.
export async function getBookingActivityReport(start: string, end: string): Promise<BookingActivityReport> {
  await ensureSchema();

  const rows = await query<ReportRow>(
    `SELECT
       to_char(b.created_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS day,
       b.module_type,
       COUNT(*) FILTER (WHERE b.status <> 'Cancelled') AS booking_count,
       COALESCE(SUM(b.price + COALESCE(addon_totals.total, 0))
         FILTER (WHERE b.payment_status = 'Paid' AND b.status <> 'Cancelled'), 0) AS revenue
     FROM bookings b
     LEFT JOIN (
       SELECT booking_id, SUM(price * quantity) AS total FROM booking_addons GROUP BY booking_id
     ) addon_totals ON addon_totals.booking_id = b.id
     WHERE b.created_at AT TIME ZONE 'Asia/Jakarta' >= $1::date
       AND b.created_at AT TIME ZONE 'Asia/Jakarta' < ($2::date + interval '1 day')
     GROUP BY day, b.module_type
     ORDER BY day ASC`,
    [start, end]
  );

  const byDayMap = new Map<string, { counts: BookingModuleTotals; revenue: BookingModuleTotals }>();
  const touchDay = (date: string) => {
    if (!byDayMap.has(date)) byDayMap.set(date, { counts: emptyModuleTotals(), revenue: emptyModuleTotals() });
    return byDayMap.get(date)!;
  };

  const counts = emptyModuleTotals();
  const revenue = emptyModuleTotals();

  for (const row of rows) {
    const day = touchDay(row.day);
    const c = Number(row.booking_count);
    const r = Number(row.revenue);
    day.counts[row.module_type] += c;
    day.revenue[row.module_type] += r;
    counts[row.module_type] += c;
    revenue[row.module_type] += r;
  }

  const byDay: BookingActivityDayBreakdown[] = Array.from(byDayMap.entries())
    .map(([date, v]) => ({ date, counts: v.counts, revenue: v.revenue }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const byModule: BookingActivityModuleBreakdown[] = MODULE_TYPES.map((moduleType) => ({
    moduleType,
    moduleLabel: MODULE_LABELS[moduleType],
    count: counts[moduleType],
    revenue: revenue[moduleType],
  })).sort((a, b) => b.revenue - a.revenue);

  const totalCount = MODULE_TYPES.reduce((s, m) => s + counts[m], 0);
  const totalRevenue = MODULE_TYPES.reduce((s, m) => s + revenue[m], 0);

  return {
    generatedAt: new Date().toISOString(),
    period: { start, end },
    counts,
    revenue,
    totalCount,
    totalRevenue,
    byDay,
    byModule,
  };
}
