"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import type { MoveActivityResponse } from "@/app/api/move-activity/route";
import { MOVE_ACTIVITY_COLORS, MOVE_ACTIVITY_LABELS, MoveActivityChart } from "@/components/MoveActivityChart";
import { DeltaBadge } from "@/components/DeltaBadge";

const REFRESH_INTERVAL_MS = 60_000;

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

// Percent delta vs the comparison period — null (badge hidden) when there's
// nothing to divide by, same guard as /cash-in.
function deltaPct(current: number, compare: number | null): number | null {
  if (compare === null || compare <= 0) return null;
  return ((current - compare) / compare) * 100;
}

export default function MoveActivityPage() {
  const { data: session } = useSession();
  const [data, setData] = useState<MoveActivityResponse | null>(null);
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
      const res = await fetch(`/api/move-activity?period=${encodeURIComponent(periodValue)}`, {
        signal: controller.signal,
      });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error ?? `Request failed with status ${res.status}`);
      }
      setData(body as MoveActivityResponse);
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to load move activity data");
    } finally {
      setLoading(false);
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
  const comparison = data?.comparison.totals ?? null;

  return (
    <div className="min-h-screen px-6 py-10 sm:px-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image src="/spacehub-logo.webp" alt="SpaceHub" width={121} height={36} priority />
            <span className="hidden h-6 w-px sm:block" style={{ background: "var(--gridline)" }} />
            <h1 className="hidden text-sm font-medium sm:block" style={{ color: "var(--text-secondary)" }}>
              Move Activity
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
              ? "Bulan berjalan — angka bertambah tiap ada aktivitas baru (move-in, move-out, atau perpanjangan)."
              : "Bulan yang sudah selesai — angka final, tidak akan berubah lagi."}
          </p>
        )}

        {loading && !data && <p style={{ color: "var(--text-secondary)" }}>Loading move activity data…</p>}

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
                {formatPeriodLabel(data.period.start, data.period.end)} · {data.bySite.length} site
              </p>
              <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
                {data.isCurrentMonth ? `Dibanding pace ${comparisonMonthShort}` : `Dibanding ${comparisonMonthShort}`}
              </p>
              <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
                    <span className="h-2 w-2 rounded-full" style={{ background: MOVE_ACTIVITY_COLORS.moveIn }} />
                    {MOVE_ACTIVITY_LABELS.moveIn}
                  </p>
                  <p className="mb-2 text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
                    {data.totals.moveIn}
                  </p>
                  <DeltaBadge value={deltaPct(data.totals.moveIn, comparison?.moveIn ?? null)} format="percent" />
                  <p className="mt-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
                    vs {comparison?.moveIn ?? "–"} unit {comparisonMonthShort}
                  </p>
                </div>
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
                    <span className="h-2 w-2 rounded-full" style={{ background: MOVE_ACTIVITY_COLORS.moveOut }} />
                    {MOVE_ACTIVITY_LABELS.moveOut}
                  </p>
                  <p className="mb-2 text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
                    {data.totals.moveOut}
                  </p>
                  <DeltaBadge value={deltaPct(data.totals.moveOut, comparison?.moveOut ?? null)} format="percent" invert />
                  <p className="mt-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
                    vs {comparison?.moveOut ?? "–"} unit {comparisonMonthShort}
                  </p>
                </div>
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
                    <span className="h-2 w-2 rounded-full" style={{ background: MOVE_ACTIVITY_COLORS.extend }} />
                    {MOVE_ACTIVITY_LABELS.extend}
                  </p>
                  <p className="mb-2 text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
                    {data.totals.extend}
                  </p>
                  <DeltaBadge value={deltaPct(data.totals.extend, comparison?.extend ?? null)} format="percent" />
                  <p className="mt-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
                    vs {comparison?.extend ?? "–"} invoice {comparisonMonthShort}
                  </p>
                </div>
                <div>
                  <p className="mb-2 text-[11px] font-bold tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
                    Net perubahan unit
                  </p>
                  <p
                    className="mb-2 text-3xl font-bold"
                    style={{ color: data.totals.net >= 0 ? "var(--status-good)" : "var(--status-critical)" }}
                  >
                    {data.totals.net > 0 ? `+${data.totals.net}` : data.totals.net}
                  </p>
                  <DeltaBadge value={comparison ? data.totals.net - comparison.net : null} />
                  <p className="mt-1.5 text-xs" style={{ color: "var(--text-muted)" }}>
                    Move In − Move Out
                  </p>
                </div>
              </div>
              {data.skippedExtendCategorization && (
                <p className="mt-4 text-xs" style={{ color: "var(--status-warning)" }}>
                  Extend dilewatkan untuk periode ini karena volume transaksi tinggi — angka Move In/Move Out tetap
                  akurat.
                </p>
              )}
            </section>

            <section
              className="mb-8 rounded-2xl border p-6"
              style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}
            >
              <p className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Move In · Move Out · Extend (harian)
              </p>
              <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
                {formatPeriodLabel(data.period.start, data.period.end)}, digabung dari semua site · Move In
                ditumpuk dengan Extend di atas garis nol
              </p>
              <MoveActivityChart byDay={data.byDay} />
            </section>

            <section
              className="mb-8 rounded-2xl border p-6"
              style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}
            >
              <p className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Breakdown per site
              </p>
              <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
                {formatPeriodLabel(data.period.start, data.period.end)}
              </p>
              <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--gridline)" }}>
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--gridline)" }}>
                      <th className="px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>
                        Site
                      </th>
                      <th className="px-4 py-3 text-right font-medium" style={{ color: "var(--text-secondary)" }}>
                        Move In
                      </th>
                      <th className="px-4 py-3 text-right font-medium" style={{ color: "var(--text-secondary)" }}>
                        Move Out
                      </th>
                      <th className="px-4 py-3 text-right font-medium" style={{ color: "var(--text-secondary)" }}>
                        Net
                      </th>
                      <th className="px-4 py-3 text-right font-medium" style={{ color: "var(--text-secondary)" }}>
                        Extend
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.bySite.map((site) => (
                      <tr key={site.siteId} style={{ borderBottom: "1px solid var(--gridline)" }}>
                        <td className="px-4 py-2 font-semibold" style={{ color: "var(--text-primary)" }}>
                          {site.siteName}
                        </td>
                        <td className="px-4 py-2 text-right" style={{ color: "var(--text-secondary)" }}>
                          {site.moveIn}
                        </td>
                        <td className="px-4 py-2 text-right" style={{ color: "var(--text-secondary)" }}>
                          {site.moveOut}
                        </td>
                        <td
                          className="px-4 py-2 text-right font-semibold"
                          style={{ color: site.net > 0 ? "var(--status-good)" : site.net < 0 ? "var(--status-critical)" : "var(--text-muted)" }}
                        >
                          {site.net > 0 ? `+${site.net}` : site.net === 0 ? "±0" : site.net}
                        </td>
                        <td className="px-4 py-2 text-right" style={{ color: "var(--text-secondary)" }}>
                          {site.extend}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td className="px-4 py-3 font-semibold" style={{ color: "var(--text-primary)" }}>
                        Total
                      </td>
                      <td className="px-4 py-3 text-right font-semibold" style={{ color: "var(--text-primary)" }}>
                        {data.totals.moveIn}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold" style={{ color: "var(--text-primary)" }}>
                        {data.totals.moveOut}
                      </td>
                      <td
                        className="px-4 py-3 text-right font-semibold"
                        style={{ color: data.totals.net >= 0 ? "var(--status-good)" : "var(--status-critical)" }}
                      >
                        {data.totals.net > 0 ? `+${data.totals.net}` : data.totals.net}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold" style={{ color: "var(--text-primary)" }}>
                        {data.totals.extend}
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
                <b style={{ color: "var(--text-secondary)" }}>Move In</b>: unit rental di Storeganise yang tanggal
                mulainya (<code>startDate</code>) jatuh pada hari tsb, dan statusnya menunjukkan sewa memang
                berjalan (bukan reservasi yang batal/hangus).
                <br />
                <b style={{ color: "var(--text-secondary)" }}>Move Out</b>: unit rental yang statusnya{" "}
                <code>ended</code> dengan tanggal berakhir (<code>endDate</code>) jatuh pada hari tsb — diambil
                langsung dari field tanggal-berakhir di record rental itu sendiri.
                <br />
                <b style={{ color: "var(--text-secondary)" }}>Extend</b>: invoice yang <i>bukan</i> invoice
                pertama untuk rental tsb (tenant lama yang membayar lanjut) — memakai logika yang sama dengan
                kategori &quot;Extension&quot; di modul Cash-in.
              </p>
              <div
                className="mt-4 rounded-lg border p-3 text-xs leading-relaxed"
                style={{ borderColor: "var(--status-warning)", background: "rgba(250, 183, 18, 0.08)", color: "var(--text-secondary)" }}
              >
                <b style={{ color: "var(--status-warning)" }}>Catatan soal Move Out:</b> ini pendekatan baru yang
                menggantikan cara lama (Move In dikurangi perubahan occupancy). Angka ini diambil langsung dari
                field status/tanggal-berakhir Storeganise, tapi belum divalidasi ke data production dalam volume
                besar — bandingkan dulu dengan catatan manual untuk beberapa minggu sebelum sepenuhnya
                mengandalkan angka ini.
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
