"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import type { CashinResponse } from "@/app/api/cashin/route";
import {
  CASHIN_CATEGORY_COLORS,
  CASHIN_CATEGORY_LABELS,
  CASHIN_CATEGORY_ORDER,
  CashinDailyChart,
  formatIdr,
} from "@/components/CashinDailyChart";
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

export default function CashinPage() {
  const { data: session } = useSession();
  const [data, setData] = useState<CashinResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/cashin", { signal: controller.signal });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error ?? `Request failed with status ${res.status}`);
      }
      setData(body as CashinResponse);
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to load cash-in data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch + poll, state settles asynchronously in `load`
    load();
    const id = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [load]);

  const bestDay = data?.byDay.reduce(
    (best, d) => (!best || d.total > best.total ? d : best),
    data?.byDay[0]
  );

  const paceMonthLabel = data ? formatDateLabel(data.pace.period.start, { month: "long" }) : "";

  return (
    <div className="min-h-screen px-6 py-10 sm:px-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image src="/spacehub-logo.webp" alt="SpaceHub" width={121} height={36} priority />
            <span className="hidden h-6 w-px sm:block" style={{ background: "var(--gridline)" }} />
            <h1 className="hidden text-sm font-medium sm:block" style={{ color: "var(--text-secondary)" }}>
              Cash-in
            </h1>
          </div>
          <div className="flex items-baseline gap-4">
            <button onClick={load} className="text-sm hover:underline" style={{ color: "var(--text-secondary)" }}>
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

        {loading && !data && <p style={{ color: "var(--text-secondary)" }}>Loading cash-in data…</p>}

        {data && (
          <>
            <section
              className="mb-8 rounded-2xl border p-6"
              style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-6">
                <div>
                  <p className="mb-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                    Total cash-in bulan ini
                  </p>
                  <div className="flex flex-wrap items-baseline gap-3">
                    <p className="text-4xl font-bold" style={{ color: "var(--text-primary)" }}>
                      {formatIdr(data.total)}
                    </p>
                    <DeltaBadge
                      value={data.pace.deltaPct}
                      format="percent"
                      label={`vs pace ${paceMonthLabel}`}
                    />
                  </div>
                  <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                    {formatPeriodLabel(data.period.start, data.period.end)} · {data.bySite.length} site
                  </p>
                </div>
                <div className="flex flex-wrap gap-6">
                  {data.pace.total !== null && (
                    <div>
                      <p className="text-[11px] tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
                        Pace {paceMonthLabel} ({formatPeriodLabel(data.pace.period.start, data.pace.period.end)})
                      </p>
                      <p className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
                        {formatIdr(data.pace.total)}
                      </p>
                    </div>
                  )}
                  <div>
                    <p className="text-[11px] tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
                      Rata-rata / hari
                    </p>
                    <p className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
                      {formatIdr(data.byDay.length > 0 ? data.total / data.byDay.length : 0)}
                    </p>
                  </div>
                  {bestDay && (
                    <div>
                      <p className="text-[11px] tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
                        Hari terbaik
                      </p>
                      <p className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
                        {formatDateLabel(bestDay.date, { day: "numeric", month: "short" })} ·{" "}
                        {formatIdr(bestDay.total)}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section
              className="mb-8 rounded-2xl border p-6"
              style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}
            >
              <p className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Cash-in harian per kategori
              </p>
              <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
                {formatPeriodLabel(data.period.start, data.period.end)}, digabung dari semua site ·{" "}
                {data.uniqueInvoiceCount} invoice unik
                {data.skippedCategorization &&
                  " · kategorisasi dilewati untuk periode ini karena volume transaksi tinggi (total tetap akurat)"}
              </p>
              <CashinDailyChart byDay={data.byDay} />
              <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                {CASHIN_CATEGORY_ORDER.map((category) => {
                  const value = data.totals[category];
                  const pct = data.total > 0 ? (value / data.total) * 100 : 0;
                  return (
                    <div key={category} className="flex items-start gap-2">
                      <span
                        className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: CASHIN_CATEGORY_COLORS[category] }}
                      />
                      <div>
                        <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                          {CASHIN_CATEGORY_LABELS[category]}
                        </p>
                        <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                          {formatIdr(value)} · {pct.toFixed(1)}%
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {data.unclassifiedEntries.length > 0 && (
              <section
                className="mb-8 rounded-2xl border p-6"
                style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}
              >
                <p className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  Detail Tidak Terklasifikasi
                </p>
                <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
                  {data.unclassifiedEntries.length} baris invoice tidak cocok pola kategori manapun — cari nomor
                  invoice-nya di Storeganise untuk lihat detailnya
                </p>
                <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--gridline)" }}>
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--gridline)" }}>
                        <th className="px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>
                          Invoice #
                        </th>
                        <th className="px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>
                          Site
                        </th>
                        <th className="px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>
                          Deskripsi
                        </th>
                        <th className="px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>
                          Tanggal
                        </th>
                        <th className="px-4 py-3 text-right font-medium" style={{ color: "var(--text-secondary)" }}>
                          Jumlah
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.unclassifiedEntries.map((entry, i) => (
                        <tr key={`${entry.invoiceSid}-${i}`} style={{ borderBottom: "1px solid var(--gridline)" }}>
                          <td className="px-4 py-2 font-medium" style={{ color: "var(--text-primary)" }}>
                            {entry.invoiceSid}
                          </td>
                          <td className="px-4 py-2" style={{ color: "var(--text-secondary)" }}>
                            {entry.siteName}
                          </td>
                          <td className="px-4 py-2" style={{ color: "var(--text-secondary)" }}>
                            {entry.desc}
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                            {formatDateLabel(entry.date, { day: "numeric", month: "short" })}
                          </td>
                          <td className="px-4 py-2 text-right whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                            {formatIdr(entry.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section
              className="mb-8 rounded-2xl border p-6"
              style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}
            >
              <p className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Breakdown per site
              </p>
              <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
                Total tiap kategori, {formatPeriodLabel(data.period.start, data.period.end)}
              </p>
              <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--gridline)" }}>
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--gridline)" }}>
                      <th className="px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>
                        Kategori
                      </th>
                      {data.bySite.map((site) => (
                        <th
                          key={site.siteId}
                          className="px-4 py-3 text-right font-medium whitespace-nowrap"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {site.siteName}
                        </th>
                      ))}
                      <th className="px-4 py-3 text-right font-medium" style={{ color: "var(--text-secondary)" }}>
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {CASHIN_CATEGORY_ORDER.map((category) => (
                      <tr key={category} style={{ borderBottom: "1px solid var(--gridline)" }}>
                        <td className="px-4 py-2" style={{ color: "var(--text-primary)" }}>
                          {CASHIN_CATEGORY_LABELS[category]}
                        </td>
                        {data.bySite.map((site) => (
                          <td
                            key={site.siteId}
                            className="px-4 py-2 text-right whitespace-nowrap"
                            style={{ color: "var(--text-secondary)" }}
                          >
                            {formatIdr(site.totals[category])}
                          </td>
                        ))}
                        <td
                          className="px-4 py-2 text-right font-semibold whitespace-nowrap"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {formatIdr(
                            data.bySite.reduce((s, site) => s + site.totals[category], 0)
                          )}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td className="px-4 py-3 font-semibold" style={{ color: "var(--text-primary)" }}>
                        Total
                      </td>
                      {data.bySite.map((site) => (
                        <td
                          key={site.siteId}
                          className="px-4 py-3 text-right font-semibold whitespace-nowrap"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {formatIdr(site.total)}
                        </td>
                      ))}
                      <td className="px-4 py-3 text-right font-semibold whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                        {formatIdr(data.total)}
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
                Bagaimana kategori ini ditentukan
              </p>
              <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                <b style={{ color: "var(--text-secondary)" }}>New Rent</b> vs{" "}
                <b style={{ color: "var(--text-secondary)" }}>Extension</b>: dilihat dari riwayat invoice per
                unit-rental — invoice pertama untuk sebuah rental dihitung sebagai New Rent, invoice berikutnya
                untuk rental yang sama sebagai Extension. Storeganise tidak punya field resmi untuk ini.
                <br />
                <b style={{ color: "var(--text-secondary)" }}>Late Fee</b> dan{" "}
                <b style={{ color: "var(--text-secondary)" }}>Non-rental Item</b> (gembok, boks, dll.): dideteksi
                dari kata kunci di deskripsi baris invoice, karena Storeganise tidak menandainya lewat field
                terpisah.
                <br />
                <b style={{ color: "var(--text-secondary)" }}>Tidak Terklasifikasi</b>: baris invoice yang tidak
                cocok pola manapun, supaya transaksi yang tidak terbaca jelas tidak diam-diam masuk ke kategori
                yang salah.
              </p>
            </section>

            <p className="mt-8 text-xs" style={{ color: "var(--text-muted)" }}>
              Last updated {new Date(data.generatedAt).toLocaleTimeString()}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
