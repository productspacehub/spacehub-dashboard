import type { CashinBucket, CashinCategory, CashinDayBreakdown } from "@/lib/cashin";

export const CASHIN_CATEGORY_LABELS: Record<CashinCategory, string> = {
  newRent: "New Rent",
  extension: "Extension",
  lateFee: "Late Fee",
  item: "Non-rental Item",
  unclassified: "Tidak Terklasifikasi",
};

// Validated categorical palette (dark mode, surface #33416e) — see the Cash-in
// mockup design notes. Always paired with a visible dot + label, never color alone.
export const CASHIN_CATEGORY_COLORS: Record<CashinCategory, string> = {
  newRent: "#2f8dc4",
  extension: "#7c5ce0",
  lateFee: "#c97728",
  item: "#23976a",
  unclassified: "#5b6690",
};

export const CASHIN_CATEGORY_ORDER: CashinCategory[] = [
  "newRent",
  "extension",
  "lateFee",
  "item",
  "unclassified",
];

// Same labels/order, plus "deposit" — used where deposit transactions need to be
// shown or filtered alongside the five real cash-in categories (e.g. the
// transaction search on /cash-in), never in the chart/legend/totals above, since
// deposit is excluded from cash-in entirely.
export const CASHIN_BUCKET_LABELS: Record<CashinBucket, string> = {
  ...CASHIN_CATEGORY_LABELS,
  deposit: "Security Deposit",
};

// Deliberately not part of the validated categorical palette above — a grey dot
// signals "excluded from cash-in" rather than looking like a sixth real category.
export const CASHIN_BUCKET_COLORS: Record<CashinBucket, string> = {
  ...CASHIN_CATEGORY_COLORS,
  deposit: "#7e8fbf",
};

export const CASHIN_BUCKET_ORDER: CashinBucket[] = [...CASHIN_CATEGORY_ORDER, "deposit"];

export function formatIdr(n: number): string {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 })
    .format(n)
    .replace("IDR", "Rp")
    .replace(/\s/g, "");
}

function formatCompact(n: number): string {
  if (n === 0) return "0";
  return `${n / 1_000_000}jt`;
}

export function CashinDailyChart({ byDay }: { byDay: CashinDayBreakdown[] }) {
  if (byDay.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Belum ada transaksi bulan ini.
      </p>
    );
  }

  const maxDay = Math.max(...byDay.map((d) => d.total), 1);
  // Round up to a multiple of 4 million so each quarter-tick lands on a whole
  // "Xjt" value — a multiple of 3 million would give quarters like 0.75jt.
  const niceMax = Math.ceil(maxDay / 4_000_000) * 4_000_000 || 4_000_000;
  const ticks = [0, niceMax * 0.25, niceMax * 0.5, niceMax * 0.75, niceMax];

  return (
    <div className="flex">
      <div className="relative w-12 shrink-0" style={{ height: 260 }}>
        {ticks.map((t, i) => (
          <span
            key={i}
            className="absolute right-2 text-[10px]"
            style={{ bottom: `calc(${(t / niceMax) * 100}% - 6px)`, color: "var(--text-muted)" }}
          >
            {formatCompact(t)}
          </span>
        ))}
      </div>
      <div className="flex-1 overflow-x-auto">
        <div style={{ minWidth: byDay.length * 34 }}>
          <div className="relative" style={{ height: 260 }}>
            {ticks.map((t, i) => (
              <div
                key={i}
                className="absolute left-0 right-0"
                style={{ bottom: `${(t / niceMax) * 100}%`, borderTop: "1px solid var(--gridline)" }}
              />
            ))}
            <div className="absolute inset-0 flex gap-1">
              {byDay.map((day) => (
                <div
                  key={day.date}
                  className="flex flex-1 flex-col-reverse gap-0.5"
                  style={{ height: "100%" }}
                >
                  {CASHIN_CATEGORY_ORDER.map((category) => {
                    const value = day.totals[category];
                    if (value <= 0) return null;
                    const label = new Date(`${day.date}T00:00:00`).toLocaleDateString("id-ID", {
                      day: "numeric",
                      month: "long",
                    });
                    return (
                      <div
                        key={category}
                        title={`${CASHIN_CATEGORY_LABELS[category]} · ${label} · ${formatIdr(value)}`}
                        style={{
                          height: `${(value / niceMax) * 100}%`,
                          minHeight: 2,
                          background: CASHIN_CATEGORY_COLORS[category],
                          borderRadius: 2,
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-2 flex gap-1">
            {byDay.map((day) => (
              <div
                key={day.date}
                className="flex-1 text-center text-[10px]"
                style={{ color: "var(--text-secondary)" }}
              >
                {new Date(`${day.date}T00:00:00`).getDate()}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
