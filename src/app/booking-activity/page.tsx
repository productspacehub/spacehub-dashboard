"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import type { BookingActivityResponse } from "@/app/api/booking-activity/route";
import { MODULE_LABELS, MODULE_TYPES } from "@/lib/bookingConstants";
import { BOOKING_MODULE_COLORS, BookingActivityChart } from "@/components/BookingActivityChart";
import { formatIdr } from "@/components/CashinDailyChart";
import { DeltaBadge } from "@/components/DeltaBadge";

// Same poll cadence as the other detail pages — booking data doesn't change
// fast enough to justify polling more often. Use "Refresh now" sooner.
const REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;

function formatDateLabel(dateStr: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("id-ID", opts);
}

function formatPeriodLabel(start: string, end: string): string {
  const startDay = new Date(`${start}T00:00:00`).getDate();
  const endLabel = formatDateLabel(end, { day: "numeric", month: "short", year: "numeric" });
  return `${startDay}–${endLabel}`;
}

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function previousMonthKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const prevMonth = m === 1 ? 12 : m - 1;
  const prevYear = m === 1 ? y - 1 : y;
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
}

function deltaPct(current: number, compare: number | null): number | null {
  if (compare === null || compare <= 0) return null;
  return ((current - compare) / compare) * 100;
}

export default function BookingActivityPage() {
  const { data: session } = useSession();
  const [data, setData] = useState<BookingActivityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<string>("current");
  const [customMonthValue, setCustomMonthValue] = useState<string>(() => previousMonthKey(currentMonthKey()));
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (periodValue: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    try {
      const res = await fetch(`/api/booking-activity?period=${encodeURIComponent(periodValue)}`, {
        signal: controller.signal,
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error ?? `Request failed with status ${res.status}`);
      }
      setData(body as BookingActivityResponse);
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to load booking activity data");
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount/period change + poll, state settles asynchronously in `load`
    load(period);
    const id = setInterval(() => load(period), REFRESH_INTERVAL_MS);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [load, period]);

  const isCustomPeriodActive = period !== "current" && period !== "last";
  const comparisonMonthShort = data ? formatDateLabel(data.comparison.period.start, { month: "long" }) : "";

  return (
    <div className="min-h-screen px-6 py-10 sm:px-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image src="/spacehub-logo.webp" alt="SpaceHub" width={121} height={36} priority />
            <span className="hidden h-6 w-px sm:block" style={{ background: "var(--gridline)" }} />
            <h1 className="hidden text-sm font-medium sm:block" style={{ color: "var(--text-secondary)" }}>
              Booking Activity
            </h1>
          </div>
          <div className="flex items-baseline gap-4">
            <button
              onClick={() => load(period)}
              className="text-sm hover:underline"
              style={{ color: "var(--text-secondary)" }}
            >
              Refresh now
            </button>
            {session?.user?.email && (
              <span className="hidden text-sm sm:inline" style={{ color: "var(--text-muted)" }}>
                {session.user.email}
              </span>
            )}
            <button
              onClick={() => signOut({ redirectTo: "/login" })}
              className="text-sm hover:underline"
              style={{ color: "var(--text-secondary)" }}
            >
              Sign out
            </button>
          </div>
        </header>

        <Link href="/" className="mb-6 inline-block text-sm hover:underline" style={{ color: "var(--series-1)" }}>
          ← Back to summary
        </Link>

        {error && (
          <div
            className="mb-6 rounded-lg border px-4 py-3 text-sm"
            style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)", background: "var(--surface-1)" }}
          >
            {error}
          </div>
        )}

        <div className="mb-2 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setPeriod("current")}
            className="rounded-full px-3 py-1.5 text-sm font-medium"
            style={{
              background: period === "current" ? "var(--series-1)" : "transparent",
              color: period === "current" ? "var(--background)" : "var(--text-secondary)",
              border: period === "current" ? "none" : "1px solid var(--gridline)",
            }}
          >
            Bulan ini
          </button>
          <button
            onClick={() => setPeriod("last")}
            className="rounded-full px-3 py-1.5 text-sm font-medium"
            style={{
              background: period === "last" ? "var(--series-1)" : "transparent",
              color: period === "last" ? "var(--background)" : "var(--text-secondary)",
              border: period === "last" ? "none" : "1px solid var(--gridline)",
            }}
          >
            Bulan lalu
          </button>
          <label
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium"
            style={{
              background: isCustomPeriodActive ? "var(--series-1)" : "transparent",
              color: isCustomPeriodActive ? "var(--background)" : "var(--text-secondary)",
              border: isCustomPeriodActive ? "none" : "1px solid var(--gridline)",
            }}
          >
            Bulan lain:
            <input
              type="month"
              max={currentMonthKey()}
              value={isCustomPeriodActive ? period : customMonthValue}
              onChange={(e) => {
                if (!e.target.value) return;
                setCustomMonthValue(e.target.value);
                setPeriod(e.target.value);
              }}
              style={{ background: "transparent", border: "none", color: "inherit", font: "inherit" }}
            />
          </label>
          {loading && data && (
            <span className="inline-flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
              <span
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current"
                style={{ borderTopColor: "transparent", color: "var(--series-1)" }}
              />
              Memuat…
            </span>
          )}
        </div>
        {data && (
          <p className="mb-6 text-xs" style={{ color: "var(--text-muted)" }}>
            {data.isCurrentMonth
              ? "Bulan berjalan — angka bertambah tiap ada booking baru."
              : "Bulan yang sudah selesai — angka final, tidak akan berubah lagi."}
          </p>
        )}

        {loading && !data && <p style={{ color: "var(--text-secondary)" }}>Loading booking activity data…</p>}

        {data && (
          <div
            style={{
              opacity: loading ? 0.5 : 1,
              transition: "opacity 150ms ease",
              pointerEvents: loading ? "none" : "auto",
            }}
          >
            <section
              className="mb-8 rounded-2xl border p-6"
              style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}
            >
              <p className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                {formatPeriodLabel(data.period.start, data.period.end)}
              </p>
              <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
                {data.isCurrentMonth ? `Dibanding pace ${comparisonMonthShort}` : `Dibanding ${comparisonMonthShort}`}
              </p>
              <div className="grid grid-cols-2 gap-5">
                <div>
                  <p className="mb-2 text-[11px] font-bold tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
                    Revenue
                  </p>
                  <p className="mb-2 text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
                    {formatIdr(data.totalRevenue)}
                  </p>
                  <DeltaBadge value={deltaPct(data.totalRevenue, data.comparison.totalRevenue)} format="percent" />
                  <p className="mt-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
                    vs {data.comparison.totalRevenue !== null ? formatIdr(data.comparison.totalRevenue) : "–"}{" "}
                    {comparisonMonthShort}
                  </p>
                </div>
                <div>
                  <p className="mb-2 text-[11px] font-bold tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
                    Booking Baru
                  </p>
                  <p className="mb-2 text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
                    {data.totalCount}
                  </p>
                  <DeltaBadge value={deltaPct(data.totalCount, data.comparison.totalCount)} format="percent" />
                  <p className="mt-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
                    vs {data.comparison.totalCount ?? "–"} booking {comparisonMonthShort}
                  </p>
                </div>
              </div>
            </section>

            <section
              className="mb-8 rounded-2xl border p-6"
              style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}
            >
              <p className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Booking baru per hari
              </p>
              <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
                {formatPeriodLabel(data.period.start, data.period.end)}, ditumpuk per lini bisnis
              </p>
              <BookingActivityChart byDay={data.byDay} metric="counts" />
            </section>

            <section
              className="mb-8 rounded-2xl border p-6"
              style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}
            >
              <p className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Revenue per hari
              </p>
              <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
                {formatPeriodLabel(data.period.start, data.period.end)}, ditumpuk per lini bisnis
              </p>
              <BookingActivityChart byDay={data.byDay} metric="revenue" />
            </section>

            <section
              className="mb-8 rounded-2xl border p-6"
              style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}
            >
              <p className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Breakdown per lini bisnis
              </p>
              <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
                {formatPeriodLabel(data.period.start, data.period.end)}
              </p>
              <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--gridline)" }}>
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--gridline)" }}>
                      <th className="px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>
                        Lini Bisnis
                      </th>
                      <th className="px-4 py-3 text-right font-medium" style={{ color: "var(--text-secondary)" }}>
                        Booking Baru
                      </th>
                      <th className="px-4 py-3 text-right font-medium" style={{ color: "var(--text-secondary)" }}>
                        Revenue
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byModule.map((m) => (
                      <tr key={m.moduleType} style={{ borderBottom: "1px solid var(--gridline)" }}>
                        <td className="px-4 py-2 font-semibold" style={{ color: "var(--text-primary)" }}>
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="inline-block h-2 w-2 rounded-full"
                              style={{ background: BOOKING_MODULE_COLORS[m.moduleType] }}
                            />
                            {m.moduleLabel}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right" style={{ color: "var(--text-secondary)" }}>
                          {m.count}
                        </td>
                        <td className="px-4 py-2 text-right" style={{ color: "var(--text-secondary)" }}>
                          {formatIdr(m.revenue)}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td className="px-4 py-3 font-semibold" style={{ color: "var(--text-primary)" }}>
                        Total
                      </td>
                      <td className="px-4 py-3 text-right font-semibold" style={{ color: "var(--text-primary)" }}>
                        {data.totalCount}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold" style={{ color: "var(--text-primary)" }}>
                        {formatIdr(data.totalRevenue)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section
              className="rounded-2xl border p-6"
              style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}
            >
              <p className="mb-3 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Bagaimana angka ini dihitung
              </p>
              <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                <b style={{ color: "var(--text-secondary)" }}>Booking Baru</b>: semua booking di 4 lini bisnis (
                {MODULE_TYPES.map((m) => MODULE_LABELS[m]).join(", ")}) yang tanggal mulainya (
                <code>start_date</code>) jatuh pada hari tsb, kecuali yang statusnya <code>Cancelled</code>. Dihitung
                dari tanggal booking-nya berlaku, bukan tanggal entry-nya diketik ke sistem — supaya tidak
                menumpuk semua di satu hari kalau staff input banyak booking sekaligus dalam satu sesi.
                <br />
                <b style={{ color: "var(--text-secondary)" }}>Revenue</b>: harga booking + addon, untuk booking
                yang statusnya bukan <code>Cancelled</code> dan <code>payment_status</code>-nya{" "}
                <code>Paid</code>, memakai basis tanggal yang sama (<code>start_date</code>).
              </p>
              <div
                className="mt-4 rounded-lg border p-3 text-xs leading-relaxed"
                style={{ borderColor: "var(--status-warning)", background: "rgba(250, 183, 18, 0.08)", color: "var(--text-secondary)" }}
              >
                <b style={{ color: "var(--status-warning)" }}>Catatan soal Revenue:</b> data booking tidak
                menyimpan tanggal pembayaran aktual — hanya status Paid/Unpaid. Jadi revenue di sini ditampilkan
                pada hari booking <i>mulai</i>, bukan hari booking itu <i>dibayar</i>. Kalau sebuah booking dibayar
                di hari yang berbeda dari tanggal mulainya, revenue-nya tetap muncul di hari mulai tsb, bukan hari
                pelunasan — berbeda dengan Cash-in (Storeganise) yang memakai tanggal pembayaran riil.
              </div>
            </section>

            <p className="mt-8 text-xs" style={{ color: "var(--text-muted)" }}>
              Last updated {new Date(data.generatedAt).toLocaleTimeString()}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
