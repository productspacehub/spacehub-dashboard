import type { MoveActivityDayBreakdown } from "@/lib/moveActivity";

export type MoveActivityMetric = "moveIn" | "moveOut" | "extend";

// Validated categorical palette (dark mode, surface #33416e) — Move In and
// Extend reuse Cash-in's New Rent/Extension colors (same underlying concept:
// a new tenant vs. an existing one renewing), Move Out is a new terracotta so
// it doesn't collide with status-critical pink used elsewhere on the page.
export const MOVE_ACTIVITY_COLORS: Record<MoveActivityMetric, string> = {
  moveIn: "#2f8dc4",
  moveOut: "#e0663f",
  extend: "#7c5ce0",
};

export const MOVE_ACTIVITY_LABELS: Record<MoveActivityMetric, string> = {
  moveIn: "Move In",
  moveOut: "Move Out",
  extend: "Extend",
};

function formatDateLabel(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "long" });
}

// Round a max value up to a multiple of 4 so each quarter-tick is a whole
// number — same convention as CashinDailyChart's currency ticks, generalized
// to plain counts.
function quarterCeil(value: number): number {
  return Math.max(1, Math.ceil(value / 4)) * 4;
}

export function MoveActivityChart({ byDay }: { byDay: MoveActivityDayBreakdown[] }) {
  if (byDay.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Belum ada aktivitas bulan ini.
      </p>
    );
  }

  const posMax = quarterCeil(Math.max(...byDay.map((d) => d.moveIn + d.extend), 0));
  const negMax = quarterCeil(Math.max(...byDay.map((d) => d.moveOut), 0));
  const scaleTotal = posMax + negMax;
  const baselinePct = (negMax / scaleTotal) * 100;
  const ticks = [posMax, posMax / 2, 0, -negMax / 2, -negMax];

  return (
    <div>
      <div className="flex">
        <div className="relative w-8 shrink-0" style={{ height: 260 }}>
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute right-2 text-[10px]"
              style={{ bottom: `calc(${((t + negMax) / scaleTotal) * 100}% - 6px)`, color: "var(--text-muted)" }}
            >
              {t > 0 ? `+${t}` : t}
            </span>
          ))}
        </div>
        <div className="flex-1 overflow-x-auto">
          <div style={{ minWidth: byDay.length * 20 }}>
            <div className="relative" style={{ height: 260 }}>
              {ticks.map((t) => (
                <div
                  key={t}
                  className="absolute left-0 right-0"
                  style={{
                    bottom: `${((t + negMax) / scaleTotal) * 100}%`,
                    borderTop: `1px solid ${t === 0 ? "var(--baseline)" : "var(--gridline)"}`,
                  }}
                />
              ))}
              <div className="absolute inset-0 flex gap-1">
                {byDay.map((day) => {
                  const label = formatDateLabel(day.date);
                  const stackTotal = day.moveIn + day.extend;
                  return (
                    <div key={day.date} className="relative flex-1" style={{ height: "100%" }}>
                      {stackTotal > 0 && (
                        <div
                          className="absolute left-0 right-0 flex flex-col-reverse gap-0.5"
                          style={{ bottom: `${baselinePct}%`, height: `${(stackTotal / scaleTotal) * 100}%` }}
                        >
                          {day.moveIn > 0 && (
                            <div
                              title={`${MOVE_ACTIVITY_LABELS.moveIn} · ${label} · ${day.moveIn} unit`}
                              style={{ flexGrow: day.moveIn, background: MOVE_ACTIVITY_COLORS.moveIn, borderRadius: 2 }}
                            />
                          )}
                          {day.extend > 0 && (
                            <div
                              title={`${MOVE_ACTIVITY_LABELS.extend} · ${label} · ${day.extend} invoice`}
                              style={{ flexGrow: day.extend, background: MOVE_ACTIVITY_COLORS.extend, borderRadius: 2 }}
                            />
                          )}
                        </div>
                      )}
                      {day.moveOut > 0 && (
                        <div
                          title={`${MOVE_ACTIVITY_LABELS.moveOut} · ${label} · ${day.moveOut} unit`}
                          className="absolute left-0 right-0"
                          style={{
                            top: `${100 - baselinePct}%`,
                            height: `${(day.moveOut / scaleTotal) * 100}%`,
                            minHeight: 2,
                            background: MOVE_ACTIVITY_COLORS.moveOut,
                            borderRadius: 2,
                          }}
                        />
                      )}
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
      <div className="mt-4 flex flex-wrap gap-4 text-xs" style={{ color: "var(--text-secondary)" }}>
        {(["extend", "moveIn", "moveOut"] as MoveActivityMetric[]).map((metric) => (
          <span key={metric} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: MOVE_ACTIVITY_COLORS[metric] }}
            />
            {MOVE_ACTIVITY_LABELS[metric]}
          </span>
        ))}
      </div>
    </div>
  );
}
