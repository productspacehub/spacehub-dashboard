import type { BookingActivityDayBreakdown } from "@/lib/bookingActivity";
import { MODULE_LABELS, MODULE_TYPES, type ModuleType } from "@/lib/bookingConstants";
import { formatIdr } from "./CashinDailyChart";

// Validated categorical palette (dark mode, surface #33416e) — kept distinct
// from Cash-in/Move Activity's palette since these are a different data
// source entirely (internal bookings, not Storeganise), but still passes the
// same color-blind-safe checks (see dataviz skill validation).
export const BOOKING_MODULE_COLORS: Record<ModuleType, string> = {
  shared_storage: "#2f8dc4",
  co_working: "#23976a",
  meeting_room: "#c9742f",
  studio: "#8a5cd6",
};

export type BookingActivityMetric = "counts" | "revenue";

function formatCompactIdr(n: number): string {
  if (n === 0) return "0";
  return `${(n / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 1 })}jt`;
}

function quarterCeil(value: number): number {
  return Math.max(1, Math.ceil(value / 4)) * 4;
}

export function BookingActivityLegend() {
  return (
    <div className="flex flex-wrap gap-4 text-xs" style={{ color: "var(--text-secondary)" }}>
      {MODULE_TYPES.map((moduleType) => (
        <span key={moduleType} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: BOOKING_MODULE_COLORS[moduleType] }} />
          {MODULE_LABELS[moduleType]}
        </span>
      ))}
    </div>
  );
}

export function BookingActivityChart({
  byDay,
  metric,
}: {
  byDay: BookingActivityDayBreakdown[];
  metric: BookingActivityMetric;
}) {
  if (byDay.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Belum ada booking bulan ini.
      </p>
    );
  }

  const isRevenue = metric === "revenue";
  const dayTotal = (day: BookingActivityDayBreakdown) =>
    MODULE_TYPES.reduce((s, m) => s + day[metric][m], 0);
  const maxDay = Math.max(...byDay.map(dayTotal), isRevenue ? 0 : 1);
  const niceMax = isRevenue
    ? Math.ceil(maxDay / 4_000_000) * 4_000_000 || 4_000_000
    : quarterCeil(maxDay);
  const ticks = [0, niceMax * 0.25, niceMax * 0.5, niceMax * 0.75, niceMax];

  return (
    <div>
      <div className="flex">
        <div className="relative w-12 shrink-0" style={{ height: 260 }}>
          {ticks.map((t, i) => (
            <span
              key={i}
              className="absolute right-2 text-[10px]"
              style={{ bottom: `calc(${(t / niceMax) * 100}% - 6px)`, color: "var(--text-muted)" }}
            >
              {isRevenue ? formatCompactIdr(t) : Math.round(t)}
            </span>
          ))}
        </div>
        <div className="flex-1 overflow-x-auto">
          <div style={{ minWidth: byDay.length * 20 }}>
            <div className="relative" style={{ height: 260 }}>
              {ticks.map((t, i) => (
                <div
                  key={i}
                  className="absolute left-0 right-0"
                  style={{ bottom: `${(t / niceMax) * 100}%`, borderTop: "1px solid var(--gridline)" }}
                />
              ))}
              <div className="absolute inset-0 flex gap-1">
                {byDay.map((day) => {
                  const label = new Date(`${day.date}T00:00:00`).toLocaleDateString("id-ID", {
                    day: "numeric",
                    month: "long",
                  });
                  return (
                    <div key={day.date} className="flex flex-1 flex-col-reverse gap-0.5" style={{ height: "100%" }}>
                      {MODULE_TYPES.map((moduleType) => {
                        const value = day[metric][moduleType];
                        if (value <= 0) return null;
                        const valueLabel = isRevenue ? formatIdr(value) : `${value} booking`;
                        return (
                          <div
                            key={moduleType}
                            title={`${MODULE_LABELS[moduleType]} · ${label} · ${valueLabel}`}
                            style={{
                              height: `${(value / niceMax) * 100}%`,
                              minHeight: 2,
                              background: BOOKING_MODULE_COLORS[moduleType],
                              borderRadius: 2,
                            }}
                          />
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mt-2 flex gap-1">
              {byDay.map((day) => (
                <div key={day.date} className="flex-1 text-center text-[10px]" style={{ color: "var(--text-secondary)" }}>
                  {new Date(`${day.date}T00:00:00`).getDate()}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-4">
        <BookingActivityLegend />
      </div>
    </div>
  );
}
