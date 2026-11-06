"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { DeltaBadge } from "@/components/DeltaBadge";
import { formatIdr } from "@/components/CashinDailyChart";
import { REVENUE_COLORS, REVENUE_LABELS, REVENUE_ORDER as ORDER } from "@/components/revenueStyle";
import type { FlaggedKind, FlaggedLine, RevenueProjection, RevenueReport } from "@/lib/revenueAccrual";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const LONG = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const monthName = (m: string) => `${LONG[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const shortMonth = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1];


const jt = (v: number) => `Rp${(v / 1e6).toLocaleString("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} jt`;
const card = { background: "var(--surface-1)", borderColor: "var(--gridline)" };
const pctChange = (now: number, before: number) => (before > 0 ? ((now - before) / before) * 100 : null);

function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="mb-8 rounded-2xl border p-6" style={card}>
      <p className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        {title}
      </p>
      {subtitle && (
        <p className="mb-4 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
          {subtitle}
        </p>
      )}
      {children}
    </section>
  );
}

function Tile({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "good" | "warning" }) {
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: "var(--gridline)" }}>
      <p className="mb-1 text-[11px] font-bold tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <p
        className="text-lg font-bold"
        style={{ color: tone === "good" ? "var(--status-good)" : tone === "warning" ? "var(--status-warning)" : "var(--text-primary)" }}
      >
        {value}
      </p>
      {note && (
        <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
          {note}
        </p>
      )}
    </div>
  );
}

function TrendChart({ trend, selected, onPick }: { trend: RevenueReport["trend"]; selected: string; onPick: (m: string) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = 260;
  const L = 56;
  const R = 8;
  const T = 10;
  const B = 28;
  const max = Math.max(1, ...trend.map((d) => Math.max(d.total, d.cash))) * 1.1;
  const step = (width - L - R) / trend.length;
  const bw = Math.min(36, step * 0.6);
  const x = (i: number) => L + step * i + step / 2;
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const h = hover ? trend[hover.i] : null;

  return (
    <div ref={boxRef} className="relative">
      <svg width={width} height={H} role="img" aria-label="Tren revenue accrual 12 bulan" className="block overflow-visible">
        {[0, 1, 2, 3, 4].map((t) => (
          <g key={t}>
            <line x1={L} x2={width - R} y1={y((max / 4) * t)} y2={y((max / 4) * t)} stroke={t ? "var(--gridline)" : "var(--baseline)"} />
            <text x={L - 8} y={y((max / 4) * t) + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">
              {Math.round((max / 4) * t / 1e6)} jt
            </text>
          </g>
        ))}
        {trend.map((d, i) => {
          let base = 0;
          const present = ORDER.filter((c) => d.totals[c] !== 0);
          return (
            <g key={d.month} opacity={d.month === selected ? 1 : 0.75}>
              {present.map((c, j) => {
                const v = d.totals[c];
                const top = j === present.length - 1;
                const rect = (
                  <rect
                    key={c}
                    x={x(i) - bw / 2}
                    y={y(base + v)}
                    width={bw}
                    height={Math.max(0, y(base) - y(base + v) - (top ? 0 : 2))}
                    rx={top ? 4 : 0}
                    fill={REVENUE_COLORS[c]}
                  />
                );
                base += v;
                return rect;
              })}
              <text x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill={d.month === selected ? "var(--text-primary)" : "var(--text-muted)"}>
                {shortMonth(d.month)}
              </text>
            </g>
          );
        })}
        <path
          d={trend.map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d.cash)}`).join("")}
          fill="none"
          stroke="var(--text-secondary)"
          strokeWidth={2}
          strokeDasharray="5 4"
        />
        {trend.map((d, i) => (
          <circle key={d.month} cx={x(i)} cy={y(d.cash)} r={3} fill="var(--text-secondary)" stroke="var(--surface-1)" strokeWidth={2} />
        ))}
        {trend.map((d, i) => (
          <rect
            key={`hit-${d.month}`}
            x={x(i) - step / 2}
            y={T}
            width={step}
            height={H - T - B}
            fill="transparent"
            className="cursor-pointer"
            onMouseMove={(e) => setHover({ i, x: e.clientX, y: e.clientY })}
            onMouseLeave={() => setHover(null)}
            onClick={() => onPick(d.month)}
          />
        ))}
      </svg>
      {hover && h && (
        <div
          className="pointer-events-none fixed z-10 rounded-lg border px-2.5 py-2 text-xs leading-relaxed whitespace-nowrap shadow-lg"
          style={{ left: Math.min(hover.x + 14, window.innerWidth - 320), top: hover.y + 14, background: "var(--background)", borderColor: "var(--gridline)" }}
        >
          <b>{monthName(h.month)}</b>
          <br />
          Accrual {formatIdr(h.total)}
          <br />
          <span style={{ color: "var(--text-secondary)" }}>
            {ORDER.filter((c) => h.totals[c] !== 0)
              .map((c) => `${REVENUE_LABELS[c]} ${jt(h.totals[c])}`)
              .join(" · ")}
          </span>
          <br />
          <span style={{ color: "var(--text-secondary)" }}>Uang masuk {formatIdr(h.cash)}</span>
        </div>
      )}
    </div>
  );
}

const FLAG_LABELS: Record<FlaggedKind, string> = {
  rent_no_period: "Sewa tanpa periode",
  qty_mismatch: "Qty ≠ jumlah bulan",
  unclassified: "Tidak terklasifikasi",
};
const FLAG_ORDER: FlaggedKind[] = ["rent_no_period", "qty_mismatch", "unclassified"];

const shortDate = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(2, 4)}`;
// The API's end date is the day after the period (end exclusive); Storeganise's
// own invoice shows the last day, so show that.
const lastDayOf = (endExclusive: string) =>
  new Date(Date.UTC(+endExclusive.slice(0, 4), +endExclusive.slice(5, 7) - 1, +endExclusive.slice(8, 10)) - 86_400_000).toISOString().slice(0, 10);

// The invoice lines behind the data-quality counts, by kind, to look up in
// Storeganise by invoice number.
function FlaggedLines({ lines, counts }: { lines: FlaggedLine[]; counts: Record<FlaggedKind, number> }) {
  const kinds = FLAG_ORDER.filter((k) => counts[k] > 0);
  const [picked, setPicked] = useState<FlaggedKind | null>(null);
  const kind = picked && kinds.includes(picked) ? picked : (kinds[0] ?? null);
  if (!kind) return null;
  const shown = lines.filter((l) => l.kind === kind);
  return (
    <div className="mt-5">
      <p className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        Baris yang perlu dicek
      </p>
      <p className="mb-3 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
        Cari di Storeganise lewat nomor invoice. &quot;Masuk bulan ini&quot; = bagian baris itu yang dihitung di bulan ini.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        {kinds.map((k) => (
          <button
            key={k}
            onClick={() => setPicked(k)}
            className="rounded-full px-3 py-1.5 text-xs font-medium"
            style={{
              background: k === kind ? "var(--series-1)" : "transparent",
              color: k === kind ? "var(--background)" : "var(--text-secondary)",
              border: k === kind ? "none" : "1px solid var(--gridline)",
            }}
          >
            {FLAG_LABELS[k]} ({counts[k]})
          </button>
        ))}
      </div>
      <div className="max-h-96 overflow-auto rounded-lg border" style={{ borderColor: "var(--gridline)" }}>
        <table className="w-full text-left text-xs tabular-nums">
          <thead className="sticky top-0" style={{ background: "var(--surface-1)" }}>
            <tr className="text-[11px] tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
              <th className="px-3 py-2 font-bold">Invoice</th>
              <th className="px-3 py-2 font-bold">Site</th>
              <th className="px-3 py-2 font-bold">Deskripsi</th>
              <th className="px-3 py-2 font-bold">Periode</th>
              <th className="px-3 py-2 text-right font-bold">Qty</th>
              <th className="px-3 py-2 text-right font-bold whitespace-nowrap">Masuk bulan ini</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((l, i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--gridline)", color: "var(--text-primary)" }}>
                <td className="px-3 py-2 font-mono whitespace-nowrap">{l.invoiceSid ? `#${l.invoiceSid.toUpperCase()}` : "–"}</td>
                <td className="px-3 py-2 whitespace-nowrap">{l.siteName}</td>
                <td className="px-3 py-2" style={{ color: "var(--text-secondary)" }}>
                  {l.detail ? l.detail.desc || <i>(kosong)</i> : <i>menunggu sinkronisasi</i>}
                  {l.detail?.type ? <span style={{ color: "var(--text-muted)" }}> · {l.detail.type}</span> : null}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {l.detail?.date ? shortDate(l.detail.date) : "–"}
                  {l.detail?.endDate ? ` – ${shortDate(lastDayOf(l.detail.endDate))}` : ""}
                  {l.detail?.otherDates && Object.keys(l.detail.otherDates).length > 0 && (
                    <span className="block text-[11px] whitespace-normal" style={{ color: "var(--text-muted)" }}>
                      {Object.entries(l.detail.otherDates)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(" · ")}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">{l.detail?.qty ?? "–"}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{formatIdr(l.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length < counts[kind] && (
        <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
          Menampilkan {shown.length} dari {counts[kind]} baris (nilai terbesar dulu).
        </p>
      )}
    </div>
  );
}

const PROJ_COLOR = REVENUE_COLORS.rent;

function ProjectionCard({ p, month }: { p: RevenueProjection; month: string }) {
  const closing = `${Number(p.closingDate.slice(8, 10))} ${LONG[Number(p.closingDate.slice(5, 7)) - 1]}`;
  const segments: [number, string, number][] = [
    [p.realized, PROJ_COLOR, 1],
    [p.expectedFromUnpaid, PROJ_COLOR, 0.55],
    [Math.max(0, p.rest), "var(--text-secondary)", 0.35],
  ];
  const steps: [string, string, number, string, number][] = [
    ["Sudah masuk", "invoice lunas, periode bulan ini", p.realized, PROJ_COLOR, 1],
    [
      "Sudah ditagih, belum dibayar",
      `${formatIdr(p.unpaid)} × ${Math.round(p.collectRate * 100)}% yang biasanya lunas sebelum tutup buku`,
      p.expectedFromUnpaid,
      PROJ_COLOR,
      0.55,
    ],
    ["Perkiraan sisa bulan", "perpanjangan yang belum ditagih, move-in baru, late fee & barang", p.rest, "var(--text-secondary)", 0.35],
  ];
  return (
    <section className="mb-8 rounded-2xl border p-6" style={card}>
      <p className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        Proyeksi saat tutup buku — {monthName(month)}
        <span className="ml-2 rounded-full px-2 py-0.5 align-[2px] text-[11px] font-bold" style={{ background: "rgba(25,185,234,.16)", color: "var(--series-1)" }}>
          PROYEKSI
        </span>
      </p>
      <p className="mb-4 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
        Perkiraan revenue accrual {LONG[Number(month.slice(5, 7)) - 1]} per tanggal {closing} (tutup buku finance). Hari ke-{p.day} sejak awal
        bulan.
      </p>
      {/* An estimate: shown in millions, not to the rupiah. */}
      <p className="text-4xl font-bold" style={{ color: "var(--text-primary)" }}>
        {jt(p.value)}
      </p>
      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
        Kemungkinan{" "}
        <b style={{ color: "var(--text-primary)" }}>
          {jt(p.low)} – {jt(p.high)}
        </b>{" "}
        · berdasarkan seberapa meleset metode ini di {p.monthsUsed} bulan terakhir
      </p>
      <div className="mt-4 mb-4 flex h-3.5 w-full gap-0.5 overflow-hidden rounded-full" style={{ background: "var(--background)" }}>
        {segments
          .filter(([v]) => v > 0)
          .map(([v, color, opacity], i) => (
            <div key={i} style={{ width: `${(v / p.value) * 100}%`, background: color, opacity }} />
          ))}
      </div>
      <table className="w-full text-sm tabular-nums">
        <tbody>
          {steps.map(([label, note, v, color, opacity]) => (
            <tr key={label} style={{ borderTop: "1px solid var(--gridline)" }}>
              <td className="py-2 pr-3">
                <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]" style={{ background: color, opacity }} />
                <span style={{ color: "var(--text-primary)" }}>{label}</span>{" "}
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  — {note}
                </span>
              </td>
              <td className="py-2 text-right whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                {label === "Sudah masuk" ? jt(v) : `${v < 0 ? "−" : "+"}${jt(Math.abs(v))}`}
              </td>
            </tr>
          ))}
          <tr className="font-semibold" style={{ borderTop: "1px solid var(--gridline)", color: "var(--text-primary)" }}>
            <td className="py-2">Proyeksi saat tutup buku</td>
            <td className="py-2 text-right whitespace-nowrap">{jt(p.value)}</td>
          </tr>
        </tbody>
      </table>
      <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
        Perkiraan sisa bulan: pada hari ke-{p.day}, invoice yang sudah ada (lunas + belum dibayar yang nantinya lunas) biasanya baru mencakup{" "}
        {Math.round(p.share * 100)}% dari angka saat tutup buku — rata-rata {p.monthsUsed} bulan terakhir. Hanya untuk semua site.
      </p>
    </section>
  );
}

function Backtest({ p }: { p: RevenueProjection }) {
  return (
    <Section
      title="Seberapa akurat proyeksinya?"
      subtitle={`Metode yang sama dijalankan mundur: proyeksi yang akan muncul pada hari ke-${p.day} tiap bulan (memakai pola bulan-bulan lainnya), dibanding angka saat tutup buku. Rata-rata meleset ${(p.meanAbsError * 100).toFixed(1)}%; rentang di atas memakai selisih terbesar ke atas dan ke bawah.`}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-left text-[11px] font-bold tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
              <th className="pr-2 pb-2">Bulan</th>
              <th className="pr-2 pb-2 text-right">Proyeksi hari ke-{p.day}</th>
              <th className="pr-2 pb-2 text-right">Saat tutup buku</th>
              <th className="pb-2 text-right">Selisih</th>
            </tr>
          </thead>
          <tbody>
            {p.backtest.map((b) => (
              <tr key={b.month} style={{ borderTop: "1px solid var(--gridline)" }}>
                <td className="py-2 pr-2" style={{ color: "var(--text-primary)" }}>
                  {shortMonth(b.month)} {b.month.slice(0, 4)}
                </td>
                <td className="py-2 pr-2 text-right whitespace-nowrap">{jt(b.projected)}</td>
                <td className="py-2 pr-2 text-right whitespace-nowrap">{jt(b.actual)}</td>
                <td
                  className="py-2 text-right whitespace-nowrap"
                  style={{ color: Math.abs(b.error) > 0.04 ? "var(--status-critical)" : "var(--text-muted)" }}
                >
                  {b.error >= 0 ? "+" : ""}
                  {(b.error * 100).toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export default function RevenueAccrualPage() {
  const { data: session } = useSession();
  const [month, setMonth] = useState("current");
  const [site, setSite] = useState("all");
  const [data, setData] = useState<RevenueReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<{ pending: number | null } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autoSynced = useRef(false);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const res = await fetch(`/api/revenue-accrual?month=${month}&site=${site}`, { signal: controller.signal });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Request failed with status ${res.status}`);
      setData(body as RevenueReport);
      setError(null);
      return body as RevenueReport;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return null;
      setError(err instanceof Error ? err.message : "Gagal memuat revenue");
      return null;
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  }, [month, site]);

  // Pulls changed invoices from Storeganise into the dashboard database; on
  // the first fill this takes several rounds, each up to ~40s.
  const sync = useCallback(async () => {
    setSyncing({ pending: null });
    try {
      for (let round = 0; round < 40; round++) {
        const res = await fetch("/api/revenue-accrual/sync", { method: "POST" });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? `Sync failed with status ${res.status}`);
        setSyncing({ pending: body.pending });
        if (body.pending === 0) break;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal sinkronisasi");
    } finally {
      setSyncing(null);
      await load();
    }
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount/filter change, state settles asynchronously in `load`
    load().then((report) => {
      // Never synced, or a first fill left unfinished: continue it now.
      if (report && !autoSynced.current && (!report.sync.lastRun || report.sync.pending > 0)) {
        autoSynced.current = true;
        sync();
      }
    });
    return () => abortRef.current?.abort();
  }, [load, sync]);

  const current = data?.today.slice(0, 7);
  const monthOptions = current ? Array.from({ length: 24 }, (_, i) => addMonths(current, -i)) : [];
  const selected = data?.month ?? "";
  const delta = data ? pctChange(data.total, data.comparison.total) : null;
  const present = data ? ORDER.filter((c) => data.totals[c] !== 0) : [];
  const empty = data && data.sync.invoices === 0;

  return (
    <div className="min-h-screen px-6 py-10 sm:px-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image src="/spacehub-logo.webp" alt="SpaceHub" width={121} height={36} priority />
            <span className="hidden h-6 w-px sm:block" style={{ background: "var(--gridline)" }} />
            <h1 className="hidden text-sm font-medium sm:block" style={{ color: "var(--text-secondary)" }}>
              Revenue (Accrual)
            </h1>
          </div>
          <div className="flex items-baseline gap-4">
            <button
              onClick={() => sync()}
              disabled={!!syncing}
              className="text-sm hover:underline disabled:opacity-50"
              style={{ color: "var(--text-secondary)" }}
            >
              Refresh now
            </button>
            {session?.user?.email && (
              <span className="hidden text-sm sm:inline" style={{ color: "var(--text-muted)" }}>
                {session.user.email}
              </span>
            )}
            <button onClick={() => signOut({ redirectTo: "/login" })} className="text-sm hover:underline" style={{ color: "var(--text-secondary)" }}>
              Sign out
            </button>
          </div>
        </header>

        <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link href="/" className="text-sm hover:underline" style={{ color: "var(--series-1)" }}>
            ← Back to summary
          </Link>
          {(loading || syncing) && data && (
            <span className="inline-flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current" style={{ borderTopColor: "transparent", color: "var(--series-1)" }} />
              {syncing
                ? `Mengambil invoice dari Storeganise…${syncing.pending ? ` ${syncing.pending.toLocaleString()} invoice tersisa` : ""}`
                : "Memuat…"}
            </span>
          )}
        </div>

        {error && (
          <div className="mb-6 rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)", background: "var(--surface-1)" }}>
            {error}
          </div>
        )}

        {loading && !data && <p style={{ color: "var(--text-secondary)" }}>Memuat revenue…</p>}

        {data && (
          <div style={{ opacity: loading ? 0.5 : 1, transition: "opacity 150ms ease" }}>
            {(empty || data.sync.pending > 0) && (
              <div
                className="mb-6 rounded-lg border px-4 py-3 text-xs leading-relaxed"
                style={{ borderColor: "var(--status-warning)", color: "var(--text-secondary)", background: "var(--surface-1)" }}
              >
                <b style={{ color: "var(--status-warning)" }}>Data belum lengkap.</b>{" "}
                {empty
                  ? "Invoice dari Storeganise belum pernah diambil — pengambilan pertama sedang berjalan dan bisa memakan beberapa menit."
                  : `${data.sync.pending.toLocaleString()} invoice belum diambil dari Storeganise — angka di bawah belum final. Biarkan halaman ini terbuka sampai selesai.`}
              </div>
            )}

            <div className="mb-6 flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-full p-[3px]" style={{ border: "1px solid var(--gridline)" }} role="group" aria-label="Periode">
                {[
                  ["current", "Bulan ini"],
                  ["last", "Bulan lalu"],
                ].map(([key, label]) => {
                  const on = key === "current" ? selected === current : selected === addMonths(current!, -1);
                  return (
                    <button
                      key={key}
                      onClick={() => setMonth(key)}
                      className="rounded-full px-3.5 py-1.5 text-sm font-medium"
                      style={{ background: on ? "var(--series-1)" : "transparent", color: on ? "var(--background)" : "var(--text-secondary)" }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <select
                value={selected}
                onChange={(e) => setMonth(e.target.value)}
                aria-label="Bulan"
                className="rounded-lg px-2.5 py-2 text-sm"
                style={{ background: "var(--background)", color: "var(--text-primary)", border: "1px solid var(--gridline)" }}
              >
                {monthOptions.map((m) => (
                  <option key={m} value={m}>
                    {monthName(m)}
                  </option>
                ))}
              </select>
              {data.sites.length > 1 && (
                <select
                  value={site}
                  onChange={(e) => setSite(e.target.value)}
                  aria-label="Site"
                  className="rounded-lg px-2.5 py-2 text-sm"
                  style={{ background: "var(--background)", color: "var(--text-primary)", border: "1px solid var(--gridline)" }}
                >
                  <option value="all">Semua site</option>
                  {data.sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <Section
              title={`Revenue accrual — ${monthName(data.month)}`}
              subtitle={
                data.isCurrentMonth
                  ? "Bulan berjalan (sampai hari ini). Masih bisa bertambah: periode yang dimulai sampai akhir bulan, dan pembayaran terlambat."
                  : "Masih bisa bertambah kalau ada pembayaran terlambat untuk periode di bulan ini."
              }
            >
              <p className="mb-1 text-4xl font-bold" style={{ color: "var(--text-primary)" }}>
                {formatIdr(data.total)}
              </p>
              <DeltaBadge
                value={delta}
                format="percent"
                label={
                  data.comparison.isPace
                    ? `vs pace ${LONG[Number(data.comparison.month.slice(5, 7)) - 1]} (1–${Number(data.comparison.asOf!.slice(8, 10))} ${shortMonth(data.comparison.month)})`
                    : `vs ${LONG[Number(data.comparison.month.slice(5, 7)) - 1]}`
                }
              />
              {data.total > 0 && (
                <div className="mt-4 mb-3 flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full" style={{ background: "var(--background)" }}>
                  {present
                    .filter((c) => data.totals[c] > 0)
                    .map((c) => (
                      <div key={c} style={{ width: `${(data.totals[c] / data.total) * 100}%`, background: REVENUE_COLORS[c] }} />
                    ))}
                </div>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                {present.map((c) => (
                  <span key={c} className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: REVENUE_COLORS[c] }} />
                    {REVENUE_LABELS[c]}
                    <b style={{ color: "var(--text-primary)" }}>{jt(data.totals[c])}</b>
                  </span>
                ))}
              </div>
              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Tile
                  label="Belum dibayar — periode bulan ini"
                  value={formatIdr(data.unpaid.amount)}
                  note={`${data.unpaid.invoices} invoice — belum dihitung; masuk ke ${monthName(data.month)} begitu lunas.`}
                />
                <Tile
                  label="Sudah dibayar untuk bulan-bulan depan"
                  value={formatIdr(data.deferred)}
                  note={`Sewa yang dibayar di muka${data.isCurrentMonth ? "" : ` (per akhir ${monthName(data.month)})`}; masuk revenue di bulan periodenya masing-masing.`}
                />
              </div>
            </Section>

            {data.projection && (
              <>
                <ProjectionCard p={data.projection} month={data.month} />
                <Backtest p={data.projection} />
              </>
            )}
            {!data.projection && data.projectionStatus === "insufficient" && (
              <p className="mb-8 text-xs" style={{ color: "var(--text-muted)" }}>
                Proyeksi saat tutup buku belum tersedia: perlu data minimal 3 bulan yang sudah tutup buku.
              </p>
            )}
            {!data.projection && data.projectionStatus === "site" && (
              <p className="mb-8 text-xs" style={{ color: "var(--text-muted)" }}>
                Proyeksi saat tutup buku hanya tersedia untuk semua site.
              </p>
            )}

            <Section
              title="Tren 12 bulan"
              subtitle="Batang = revenue accrual per bulan, ditumpuk per jenis. Garis putus-putus = uang masuk dari invoice yang lunas di bulan itu (tanpa deposit), sebagai pembanding — bisa sedikit berbeda dari halaman Cash-in. Klik batang untuk memilih bulan."
            >
              <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                {ORDER.filter((c) => c !== "unclassified" || data.trend.some((d) => d.totals.unclassified !== 0)).map((c) => (
                  <span key={c} className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: REVENUE_COLORS[c] }} />
                    {REVENUE_LABELS[c]}
                  </span>
                ))}
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3.5 border-t-2 border-dashed" style={{ borderColor: "var(--text-secondary)" }} />
                  Uang masuk
                </span>
              </div>
              <TrendChart trend={data.trend} selected={data.month} onPick={(m) => setMonth(m)} />
            </Section>

            <Section
              title="Per site"
              subtitle={
                data.isCurrentMonth
                  ? `${monthName(data.month)} sampai hari ini, dibanding ${LONG[Number(data.comparison.month.slice(5, 7)) - 1]} sampai tanggal yang sama. Semua site, tidak terpengaruh filter site.`
                  : `${monthName(data.month)}, dibanding ${LONG[Number(data.comparison.month.slice(5, 7)) - 1]}. Semua site, tidak terpengaruh filter site.`
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead>
                    <tr className="text-left text-[11px] font-bold tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
                      <th className="pr-2 pb-2">Site</th>
                      {ORDER.filter((c) => c !== "unclassified").map((c) => (
                        <th key={c} className="pr-2 pb-2 text-right">
                          {REVENUE_LABELS[c]}
                        </th>
                      ))}
                      <th className="pr-2 pb-2 text-right">Total</th>
                      <th className="pb-2 text-right whitespace-nowrap">vs bln lalu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.bySite.map((s) => {
                      const d = pctChange(s.total, s.comparison);
                      return (
                        <tr key={s.siteId} style={{ borderTop: "1px solid var(--gridline)" }}>
                          <td className="py-2 pr-2" style={{ color: "var(--text-primary)" }}>
                            {s.siteName}
                          </td>
                          {ORDER.filter((c) => c !== "unclassified").map((c) => (
                            <td key={c} className="py-2 pr-2 text-right whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                              {jt(s.totals[c])}
                            </td>
                          ))}
                          <td className="py-2 pr-2 text-right font-semibold whitespace-nowrap">{jt(s.total)}</td>
                          <td
                            className="py-2 text-right whitespace-nowrap"
                            style={{ color: d === null ? "var(--text-muted)" : d >= 0 ? "var(--status-good)" : "var(--status-critical)" }}
                          >
                            {d === null ? "–" : `${d >= 0 ? "+" : ""}${d.toFixed(1)}%`}
                          </td>
                        </tr>
                      );
                    })}
                    {data.bySite.length > 1 && (
                      <tr className="font-semibold" style={{ borderTop: "1px solid var(--gridline)", color: "var(--text-primary)" }}>
                        <td className="py-2 pr-2">Total</td>
                        {ORDER.filter((c) => c !== "unclassified").map((c) => (
                          <td key={c} className="py-2 pr-2 text-right whitespace-nowrap">
                            {jt(data.bySite.reduce((sum, x) => sum + x.totals[c], 0))}
                          </td>
                        ))}
                        <td className="py-2 pr-2 text-right whitespace-nowrap">{jt(data.bySite.reduce((sum, x) => sum + x.total, 0))}</td>
                        <td />
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section title="Cek kualitas data" subtitle={`Baris invoice lunas di ${monthName(data.month)} yang tidak pas dengan aturan di bawah — perlu dicek di Storeganise.`}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Tile
                  label="Sewa tanpa periode"
                  value={`${data.checks.rentNoPeriod} baris`}
                  tone={data.checks.rentNoPeriod ? "warning" : "good"}
                  note="ditaruh di bulan tanggal barisnya"
                />
                <Tile
                  label="Qty ≠ jumlah bulan periode"
                  value={`${data.checks.qtyMismatch} baris`}
                  tone={data.checks.qtyMismatch ? "warning" : "good"}
                  note="dibagi sesuai qty"
                />
                <Tile
                  label="Tidak terklasifikasi"
                  value={data.checks.unclassified.lines ? `${formatIdr(data.checks.unclassified.amount)} · ${data.checks.unclassified.lines} baris` : "0 baris"}
                  tone={data.checks.unclassified.lines ? "warning" : "good"}
                  note="bukan sewa, late fee, barang, atau deposit — tetap dihitung revenue"
                />
              </div>
              <FlaggedLines
                lines={data.checks.lines}
                counts={{
                  rent_no_period: data.checks.rentNoPeriod,
                  qty_mismatch: data.checks.qtyMismatch,
                  unclassified: data.checks.unclassified.lines,
                }}
              />
              <p className="mt-4 text-xs" style={{ color: data.sync.lastError ? "var(--status-critical)" : "var(--text-muted)" }}>
                {data.sync.lastRun
                  ? `Sinkronisasi terakhir ${new Date(data.sync.lastRun).toLocaleString("id-ID")} · ${data.sync.invoices.toLocaleString()} invoice tersimpan.`
                  : "Belum pernah disinkronkan."}
                {data.sync.lastError ? ` Error terakhir: ${data.sync.lastError}` : ""}
              </p>
            </Section>

            <section className="rounded-2xl border p-6" style={card}>
              <p className="mb-3 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Aturan perhitungan
              </p>
              <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                <li>
                  <b>Sewa:</b> penuh di bulan awal periodenya (periode 15 Nov – 14 Des → November). Sewa beberapa bulan dibagi rata per
                  bulan sesuai qty, tiap bagian di bulan awal periodenya.
                </li>
                <li>
                  <b>Late fee &amp; barang:</b> bulan invoice dibuat.
                </li>
                <li>
                  <b>Hanya invoice lunas (paid).</b> Belum dibayar atau batal tidak dihitung. Dibayar terlambat tetap masuk bulan
                  periodenya — angka bulan yang sudah lewat bisa bertambah.
                </li>
                <li>
                  <b>Deposit</b> bukan revenue. Tidak ada refund untuk berhenti di tengah periode. Tanpa PPN (PTKP).
                </li>
                <li>Invoice dari Storeganise diambil otomatis setiap hari (24 bulan terakhir); &quot;Refresh now&quot; mengambil perubahan terbaru.</li>
              </ul>
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
