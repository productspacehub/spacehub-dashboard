"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import type { CohortMode, CohortReport, CohortTable, CurvePoint } from "@/lib/cohort";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const monthLabel = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

const card = { background: "var(--surface-1)", borderColor: "var(--gridline)" };
const HEADLINE_OFFSETS = [1, 3, 6, 12];
// Months reached by fewer cohorts than this swing on a handful of people.
const STABLE_COHORTS = 3;

// One hue, deep → bright on the dark surface. The scale starts at 25%:
// retention rarely goes lower, and 0–100 would squeeze real cells together.
const COLOR_FLOOR = 0.25;
const LO = [0x2a, 0x52, 0x85];
const HI = [0x19, 0xb9, 0xea];
function cellColor(rate: number): string {
  const t = Math.max(0, (rate - COLOR_FLOOR) / (1 - COLOR_FLOOR));
  return `rgb(${LO.map((v, i) => Math.round(v + (HI[i] - v) * t)).join(",")})`;
}

const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

function Section({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
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

function Tooltip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  return (
    <div
      className="pointer-events-none fixed z-10 rounded-lg border px-2.5 py-2 text-xs leading-relaxed whitespace-nowrap shadow-lg"
      style={{ left: x, top: y, background: "var(--background)", borderColor: "var(--gridline)", color: "var(--text-primary)" }}
    >
      {children}
    </div>
  );
}

function RetentionCurve({ points, unitWord }: { points: CurvePoint[]; unitWord: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<{ p: CurvePoint; x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (points.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>
        Belum ada data.
      </p>
    );
  }

  const H = 220;
  const L = 36;
  const R = 12;
  const T = 10;
  const B = 26;
  const x = (k: number) => L + (k / 24) * (width - L - R);
  const y = (v: number) => T + (1 - v) * (H - T - B);
  const path = (pts: CurvePoint[]) => pts.map((p, i) => `${i ? "L" : "M"}${x(p.offset).toFixed(1)},${y(p.rate).toFixed(1)}`).join("");
  const solid = points.filter((p) => p.cohorts >= STABLE_COHORTS);
  const thin = points.filter((p) => p.cohorts < STABLE_COHORTS);
  const lastSolid = solid[solid.length - 1];
  const last = points[points.length - 1];

  return (
    <div ref={boxRef} className="relative">
      <svg width={width} height={H} role="img" aria-label="Kurva retensi rata-rata" className="block overflow-visible">
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={L} x2={width - R} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--baseline)" : "var(--gridline)"} />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">
              {v * 100}%
            </text>
          </g>
        ))}
        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((k) => (
          <text key={k} x={x(k)} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--text-muted)">
            {k}
          </text>
        ))}
        {solid.length > 0 && <path d={path(solid)} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {thin.length > 0 && (
          <path
            d={path(lastSolid ? [lastSolid, ...thin] : thin)}
            fill="none"
            stroke="var(--series-1)"
            strokeWidth={2}
            strokeDasharray="4 4"
            strokeLinecap="round"
            opacity={0.7}
          />
        )}
        {lastSolid && (
          <text
            x={x(lastSolid.offset)}
            y={y(lastSolid.rate) - 12}
            textAnchor={x(lastSolid.offset) > width - 120 ? "end" : "middle"}
            fontSize={11}
            fill="var(--text-secondary)"
          >
            {Math.round(lastSolid.rate * 100)}% di bulan ke-{lastSolid.offset}
          </text>
        )}
        {hover && (
          <>
            <line x1={x(hover.p.offset)} x2={x(hover.p.offset)} y1={T} y2={H - B} stroke="var(--text-secondary)" strokeDasharray="3 3" />
            <circle cx={x(hover.p.offset)} cy={y(hover.p.rate)} r={5} fill="var(--series-1)" stroke="var(--surface-1)" strokeWidth={2} />
          </>
        )}
        <rect
          x={L}
          y={T}
          width={Math.max(0, width - L - R)}
          height={H - T - B}
          fill="transparent"
          onMouseMove={(e) => {
            const box = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
            const k = Math.max(0, Math.min(last.offset, Math.round(((e.clientX - box.left - L) / (width - L - R)) * 24)));
            const p = points.find((q) => q.offset === k);
            if (p) setHover({ p, x: e.clientX, y: e.clientY });
          }}
          onMouseLeave={() => setHover(null)}
        />
      </svg>
      {hover && (
        <Tooltip x={Math.min(hover.x + 14, (typeof window !== "undefined" ? window.innerWidth : 1000) - 200)} y={hover.y + 14}>
          <b>Bulan ke-{hover.p.offset}</b>
          <br />
          {Math.round(hover.p.rate * 100)}% masih menyewa
          <br />
          <span style={{ color: "var(--text-secondary)" }}>
            {hover.p.cohorts} cohort · {hover.p.size} {unitWord} awal
            {hover.p.cohorts < STABLE_COHORTS ? " · belum stabil" : ""}
          </span>
        </Tooltip>
      )}
    </div>
  );
}

function CohortGrid({ table, currentMonth, unitWord }: { table: CohortTable; currentMonth: string; unitWord: string }) {
  const [hover, setHover] = useState<{ month: string; k: number; active: number; size: number; x: number; y: number } | null>(null);
  const rows = [...table.rows].reverse();
  return (
    <>
      <div className="overflow-x-auto rounded-lg" onMouseLeave={() => setHover(null)}>
        <table className="border-separate text-[11px] tabular-nums" style={{ borderSpacing: 2 }}>
          <thead>
            <tr>
              <th className="sticky left-0 z-[2] pr-2.5 text-left font-semibold whitespace-nowrap" style={{ background: "var(--surface-1)", color: "var(--text-muted)" }}>
                Cohort
              </th>
              {Array.from({ length: 25 }, (_, k) => (
                <th key={k} className="px-0.5 py-1 text-center font-semibold" style={{ color: "var(--text-muted)" }}>
                  {k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.month}>
                <td className="sticky left-0 z-[2] pr-2.5 text-xs font-medium whitespace-nowrap" style={{ background: "var(--surface-1)", color: "var(--text-primary)" }}>
                  {monthLabel(r.month)}
                  {r.month === currentMonth && (
                    <span className="ml-1 font-normal" style={{ color: "var(--text-muted)" }}>
                      (berjalan)
                    </span>
                  )}
                  <span className="ml-1.5 font-normal" style={{ color: "var(--text-muted)" }}>
                    {r.size}
                  </span>
                </td>
                {r.active.map((v, k) => {
                  if (v === null || r.size === 0) return <td key={k} className="h-[26px] w-[34px] min-w-[34px]" />;
                  const rate = v / r.size;
                  const bright = rate > 0.72;
                  return (
                    <td
                      key={k}
                      className="h-[26px] w-[34px] min-w-[34px] rounded text-center hover:outline-2 hover:-outline-offset-1 hover:outline-white"
                      style={{ background: cellColor(rate), color: bright ? "var(--background)" : "#ffffff", fontWeight: bright ? 600 : 500 }}
                      onMouseMove={(e) => setHover({ month: r.month, k, active: v, size: r.size, x: e.clientX, y: e.clientY })}
                    >
                      {pct(v, r.size)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
        <span>≤25%</span>
        <span className="h-2 w-40 rounded" style={{ background: `linear-gradient(to right, ${cellColor(COLOR_FLOOR)}, ${cellColor(1)})` }} />
        <span>100%</span>
        <span>· makin terang = makin banyak yang bertahan</span>
      </div>
      {hover && (
        <Tooltip x={Math.min(hover.x + 14, window.innerWidth - 210)} y={hover.y + 14}>
          <b>
            Cohort {monthLabel(hover.month)} · bulan ke-{hover.k}
          </b>
          <br />
          {pct(hover.active, hover.size)}% masih menyewa
          <br />
          <span style={{ color: "var(--text-secondary)" }}>
            {hover.active} dari {hover.size} {unitWord}
          </span>
        </Tooltip>
      )}
    </>
  );
}

export default function CohortPage() {
  const { data: session } = useSession();
  const [data, setData] = useState<CohortReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<CohortMode>("customer");
  const [site, setSite] = useState("all");
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const res = await fetch("/api/cohort", { signal: controller.signal });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Request failed with status ${res.status}`);
      setData(body as CohortReport);
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Gagal memuat data cohort");
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount, state settles asynchronously in `load`
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  const siteKey = data?.tables[site] ? site : "all";
  const table = data?.tables[siteKey]?.[mode];
  const unitWord = mode === "unit" ? "unit" : "pelanggan";
  const currentMonth = data?.today.slice(0, 7) ?? "";
  const newTotal = table ? table.rows.reduce((s, r) => s + r.size, 0) : 0;
  const occupiedNow = data?.occupiedNow[siteKey];
  const compareNow = occupiedNow ? (mode === "unit" ? occupiedNow.units : occupiedNow.customers) : 0;
  const nowGap = table ? Math.abs(table.activeNow - compareNow) : 0;
  const nowOk = table ? nowGap <= Math.max(2, compareNow * 0.02) : true;

  return (
    <div className="min-h-screen px-6 py-10 sm:px-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image src="/spacehub-logo.webp" alt="SpaceHub" width={121} height={36} priority />
            <span className="hidden h-6 w-px sm:block" style={{ background: "var(--gridline)" }} />
            <h1 className="hidden text-sm font-medium sm:block" style={{ color: "var(--text-secondary)" }}>
              Retensi Cohort
            </h1>
          </div>
          <div className="flex items-baseline gap-4">
            <button onClick={() => load()} className="text-sm hover:underline" style={{ color: "var(--text-secondary)" }}>
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
          {loading && data && (
            <span className="inline-flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current" style={{ borderTopColor: "transparent", color: "var(--series-1)" }} />
              Memuat…
            </span>
          )}
        </div>

        {error && (
          <div className="mb-6 rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)", background: "var(--surface-1)" }}>
            {error}
          </div>
        )}

        {loading && !data && <p style={{ color: "var(--text-secondary)" }}>Memuat data cohort…</p>}

        {data && table && occupiedNow && (
          <div style={{ opacity: loading ? 0.5 : 1, transition: "opacity 150ms ease", pointerEvents: loading ? "none" : "auto" }}>
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-full p-[3px]" style={{ border: "1px solid var(--gridline)" }} role="group" aria-label="Hitung per">
                {(["customer", "unit"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className="rounded-full px-3.5 py-1.5 text-sm font-medium"
                    style={{ background: mode === m ? "var(--series-1)" : "transparent", color: mode === m ? "var(--background)" : "var(--text-secondary)" }}
                  >
                    {m === "customer" ? "Per pelanggan" : "Per unit"}
                  </button>
                ))}
              </div>
              {data.sites.length > 1 && (
                <select
                  value={siteKey}
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

            <Section title={`Rata-rata retensi ${unitWord}`} subtitle="Dari semua cohort yang sudah mencapai bulan tersebut, dibobot jumlah awal tiap cohort.">
              <div className="grid grid-cols-2 gap-5 sm:grid-cols-5">
                {HEADLINE_OFFSETS.map((k) => {
                  const p = table.curve.find((c) => c.offset === k);
                  return (
                    <div key={k}>
                      <p className="mb-1 text-[11px] font-bold tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
                        Bulan ke-{k}
                      </p>
                      <p className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
                        {p ? `${Math.round(p.rate * 100)}%` : "–"}
                      </p>
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {p ? `dari ${p.cohorts} cohort${p.cohorts < STABLE_COHORTS ? " · belum stabil" : ""}` : "belum ada cohort"}
                      </p>
                    </div>
                  );
                })}
                <div>
                  <p className="mb-1 text-[11px] font-bold tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
                    {mode === "unit" ? "Sewa unit baru" : "Pelanggan baru"}
                  </p>
                  <p className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
                    {newTotal.toLocaleString()}
                  </p>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {monthLabel(table.rows[0].month)} – {monthLabel(currentMonth)}
                  </p>
                </div>
              </div>
            </Section>

            <Section
              title="Kurva retensi rata-rata"
              subtitle="Persentase yang masih menyewa di akhir bulan ke-n sejak move-in pertama. Garis putus-putus = bulan yang baru dicapai kurang dari 3 cohort, jadi angkanya belum stabil."
            >
              <RetentionCurve points={table.curve} unitWord={unitWord} />
            </Section>

            <Section
              title={`Tabel cohort — per ${unitWord}`}
              subtitle={`Baris = bulan ${mode === "unit" ? "sewa unit dimulai" : "move-in pertama"} (angka kecil = jumlah ${mode === "unit" ? "sewa" : "pelanggan"} baru di bulan itu). Kolom = bulan ke-n sejak itu. Sel = % yang masih menyewa di akhir bulan itu; bulan berjalan dihitung sampai hari ini. Sel kosong = bulan itu belum terjadi.`}
            >
              <CohortGrid table={table} currentMonth={currentMonth} unitWord={unitWord} />
            </Section>

            <Section title="Cek kualitas data" subtitle="Supaya angka di atas bisa dipercaya: dibandingkan dengan data lain dari Storeganise.">
              <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                <div className="rounded-xl border p-3" style={{ borderColor: "var(--gridline)" }}>
                  <p className="mb-1 text-[11px] font-bold tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
                    Masih menyewa hari ini
                  </p>
                  <span className="font-semibold" style={{ color: nowOk ? "var(--status-good)" : "var(--status-warning)" }}>
                    {table.activeNow.toLocaleString()} {unitWord}
                  </span>{" "}
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    · Storeganise saat ini: {compareNow.toLocaleString()} {mode === "unit" ? "unit occupied" : "pelanggan dengan unit occupied"}
                  </span>
                  {!nowOk && (
                    <p className="mt-1 text-xs" style={{ color: "var(--status-warning)" }}>
                      Selisih {nowGap} — tanggal sewa di sebagian rental mungkin tidak cocok dengan statusnya.
                    </p>
                  )}
                </div>
                <div className="rounded-xl border p-3" style={{ borderColor: "var(--gridline)" }}>
                  <p className="mb-1 text-[11px] font-bold tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
                    Rental yang tidak bisa dihitung
                  </p>
                  <span
                    className="font-semibold"
                    style={{ color: data.issues.endedWithoutEndDate + data.issues.withoutStartDate > 0 ? "var(--status-warning)" : "var(--status-good)" }}
                  >
                    {(data.issues.endedWithoutEndDate + data.issues.withoutStartDate).toLocaleString()} rental
                  </span>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {data.issues.endedWithoutEndDate} selesai tanpa tanggal selesai · {data.issues.withoutStartDate} tanpa tanggal mulai — tidak
                    dimasukkan (semua site)
                  </p>
                </div>
                <div className="rounded-xl border p-3" style={{ borderColor: "var(--gridline)" }}>
                  <p className="mb-1 text-[11px] font-bold tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
                    Mulai sebelum {monthLabel(table.rows[0].month)}
                  </p>
                  <span style={{ color: "var(--text-primary)" }}>
                    {table.before.toLocaleString()} {unitWord}
                  </span>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    di luar cohort yang ditampilkan
                  </p>
                </div>
              </div>
            </Section>

            <section className="rounded-2xl border p-6" style={card}>
              <p className="mb-3 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Cara menghitung
              </p>
              <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                <li>
                  <b>Per pelanggan:</b> cohort = bulan move-in pertama pelanggan. Pelanggan dihitung masih menyewa selama punya minimal
                  satu unit aktif — pindah unit tidak dihitung berhenti. Pelanggan yang berhenti lalu kembali menyewa dihitung aktif lagi
                  di bulan dia kembali.
                </li>
                <li>
                  <b>Per unit:</b> setiap sewa unit dihitung sendiri; cohort = bulan sewa itu dimulai. Pindah unit terlihat sebagai satu
                  sewa berhenti + satu sewa baru.
                </li>
                <li>
                  Sumber: unit rental Storeganise berstatus <i>occupied</i> dan <i>ended</i>, memakai tanggal mulai dan tanggal selesai
                  sewa. Rental yang batal sebelum move-in tidak dihitung. Dengan filter site, hanya sewa di site itu yang dilihat.
                </li>
                <li>Cohort bulan berjalan baru berisi yang move-in sampai hari ini. Hanya angka gabungan, tanpa nama pelanggan.</li>
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
