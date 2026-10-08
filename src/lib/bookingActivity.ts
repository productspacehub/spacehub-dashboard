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

// "Booking baru" = a booking counted on the day it actually starts
// (start_date — a plain DATE column, no timezone conversion needed),
// regardless of payment status — a Pending Payment booking is still a real
// new booking. Cancelled is the one status excluded, the same way Move
// Activity's Move In excludes rentals that never actually happened.
//
// Deliberately NOT grouped by created_at (when the entry was typed into the
// system): staff routinely enter a batch of bookings for several different
// dates in one sitting (e.g. backfilling a day's walk-ins, or onboarding a
// week's worth of reservations at once), which would cluster everything on
// whatever day data entry happened rather than reflecting when the bookings
// themselves are for. start_date matches the day-by-day "activity" reading
// this chart is meant to give, the same basis Move Activity's Move In uses.
//
// Revenue uses the same start_date basis for a consistent single time axis
// across both charts. It still has no equivalent to Cash-in's real payment
// records (this schema has payment_status as a flag, not a timestamped
// payment event), filtered to payment_status = 'Paid' and status <>
// 'Cancelled' — so revenue shows up on the day the booking starts, not
// necessarily the day it was actually paid, if those differ. See the
// methodology note on /booking-activity.
export async function getBookingActivityReport(start: string, end: string): Promise<BookingActivityReport> {
  await ensureSchema();

  const rows = await query<ReportRow>(
    `SELECT
       to_char(b.start_date, 'YYYY-MM-DD') AS day,
       b.module_type,
       COUNT(*) FILTER (WHERE b.status <> 'Cancelled') AS booking_count,
       COALESCE(SUM(b.price + COALESCE(addon_totals.total, 0))
         FILTER (WHERE b.payment_status = 'Paid' AND b.status <> 'Cancelled'), 0) AS revenue
     FROM bookings b
     LEFT JOIN (
       SELECT booking_id, SUM(price * quantity) AS total FROM booking_addons GROUP BY booking_id
     ) addon_totals ON addon_totals.booking_id = b.id
     WHERE b.start_date >= $1::date
       AND b.start_date <= $2::date
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
