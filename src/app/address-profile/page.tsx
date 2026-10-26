"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import type { AddressLevel } from "@/lib/addressMatch";
import type { AddressProfile, WordCount } from "@/lib/addressProfile";

const LEVELS: { level: AddressLevel; label: string; hint: string; usable: boolean }[] = [
  { level: "district", label: "Sampai kecamatan", hint: "mis. Tebet, Jakarta Selatan", usable: true },
  { level: "regency", label: "Sampai kota/kabupaten", hint: "mis. Jakarta Selatan, Bogor", usable: true },
  { level: "province", label: "Hanya provinsi", hint: "mis. Jakarta, Yogyakarta", usable: true },
  { level: "foreign", label: "Kemungkinan luar negeri", hint: "menyebut nama negara lain", usable: false },
  { level: "unrecognized", label: "Tidak dikenali", hint: "tidak ada nama wilayah yang cocok", usable: false },
  { level: "empty", label: "Kosong", hint: "alamat tidak diisi", usable: false },
];

const TOP_REGENCIES = 15;
const card = { background: "var(--surface-1)", borderColor: "var(--gridline)" };

function pct(part: number, total: number): string {
  return total > 0 ? `${((part / total) * 100).toFixed(0)}%` : "–";
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

// A ranked bar list: one hue, the value written out on every row (it doubles
// as the table view), bars scaled to the largest row.
function BarList({ rows, total }: { rows: { key: string; label: React.ReactNode; count: number; muted?: boolean }[]; total: number }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((r) => (
        // Fixed-width value column so every row's bar track is the same length.
        <div key={r.key} className="grid items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[minmax(0,14rem)_1fr_6.5rem]">
          <div className="min-w-0" style={{ color: "var(--text-primary)" }}>
            {r.label}
          </div>
          <div className="h-2 rounded-full" style={{ background: "var(--series-1-track)" }}>
            <div
              className="h-2 rounded-full"
              style={{ width: `${(r.count / max) * 100}%`, minWidth: r.count > 0 ? 4 : 0, background: r.muted ? "var(--text-muted)" : "var(--series-1)" }}
            />
          </div>
          <div className="text-right whitespace-nowrap tabular-nums" style={{ color: "var(--text-secondary)" }}>
            {r.count} <span style={{ color: "var(--text-muted)" }}>· {pct(r.count, total)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-bold tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <p className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
        {value}
      </p>
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {sub}
      </p>
    </div>
  );
}

function WordList({ title, words, minAddresses }: { title: string; words: WordCount[]; minAddresses: number }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
        {title}
      </p>
      {words.length === 0 ? (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          Tidak ada kata yang muncul di {minAddresses} alamat atau lebih.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {words.map((w) => (
            <span
              key={w.word}
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs"
              style={{ borderColor: "var(--gridline)", color: "var(--text-primary)" }}
            >
              {w.word}
              <span className="tabular-nums" style={{ color: "var(--text-muted)" }}>
                {w.addresses}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AddressProfilePage() {
  const { data: session } = useSession();
  const [data, setData] = useState<(AddressProfile & { mappingAllowed?: boolean }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAllRegencies, setShowAllRegencies] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const res = await fetch("/api/address-profile", { signal: controller.signal });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Request failed with status ${res.status}`);
      setData(body as AddressProfile & { mappingAllowed?: boolean });
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Gagal memuat profil alamat");
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount, state settles asynchronously in `load`
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  const filled = data ? data.totalTenants - data.byLevel.empty : 0;
  const usable = data ? data.byLevel.district + data.byLevel.regency + data.byLevel.province : 0;
  const cityOrBetter = data ? data.byLevel.district + data.byLevel.regency : 0;
  const regencies = data ? (showAllRegencies ? data.regencies : data.regencies.slice(0, TOP_REGENCIES)) : [];

  return (
    <div className="min-h-screen px-6 py-10 sm:px-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image src="/spacehub-logo.webp" alt="SpaceHub" width={121} height={36} priority />
            <span className="hidden h-6 w-px sm:block" style={{ background: "var(--gridline)" }} />
            <h1 className="hidden text-sm font-medium sm:block" style={{ color: "var(--text-secondary)" }}>
              Profil Alamat Tenant
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
          <Link href="/occupancy" className="text-sm hover:underline" style={{ color: "var(--series-1)" }}>
            ← Back to occupancy
          </Link>
          {data?.mappingAllowed && (
            <Link href="/address-mapping" className="text-sm hover:underline" style={{ color: "var(--series-1)" }}>
              Petakan alamat manual →
            </Link>
          )}
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

        {loading && !data && <p style={{ color: "var(--text-secondary)" }}>Memuat profil alamat…</p>}

        {data && (
          <div style={{ opacity: loading ? 0.5 : 1, transition: "opacity 150ms ease", pointerEvents: loading ? "none" : "auto" }}>
            <p className="mb-6 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
              Pemetaan isi alamat {data.totalTenants} tenant aktif sebelum dibuat laporan demografi. Halaman ini hanya
              menampilkan angka gabungan — tidak ada alamat atau nama tenant yang ditampilkan.
            </p>

            <Section title="Seberapa detail alamat bisa dikenali" subtitle="Tingkat paling detail yang bisa dikenali dari tiap alamat. Biru = bisa dipakai untuk laporan wilayah.">
              <BarList
                total={data.totalTenants}
                rows={LEVELS.map((l) => ({
                  key: l.level,
                  muted: !l.usable,
                  count: data.byLevel[l.level],
                  label: (
                    <>
                      {l.label}
                      <span className="block text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {l.hint}
                      </span>
                    </>
                  ),
                }))}
              />
              <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-4">
                <Stat label="Bisa dipakai" value={pct(usable, data.totalTenants)} sub={`${usable} tenant, minimal provinsi`} />
                <Stat label="Sampai kota/kab." value={pct(cityOrBetter, data.totalTenants)} sub={`${cityOrBetter} tenant`} />
                <Stat label="Sangat pendek" value={String(data.veryShort.total)} sub="alamat 1–2 kata" />
                <Stat label="Ada kode pos" value={pct(data.withPostalCode, filled)} sub={`${data.withPostalCode} dari ${filled} yang terisi`} />
              </div>
              <ul className="mt-5 list-disc space-y-1 pl-5 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                {data.veryShort.total > 0 && (
                  <li>
                    Dari {data.veryShort.total} alamat sangat pendek:{" "}
                    {LEVELS.filter((l) => data.veryShort.byLevel[l.level] > 0)
                      .map((l) => `${l.label.toLowerCase()} ${data.veryShort.byLevel[l.level]}`)
                      .join(" · ")}
                    .
                  </li>
                )}
                <li>
                  {data.ambiguousRegency} alamat hanya menyebut nama yang dipakai kota sekaligus kabupaten (mis.
                  &quot;Bogor&quot;, &quot;Tangerang&quot;), jadi tidak bisa dipastikan yang mana.
                </li>
                <li>
                  {data.provinceConflicts} alamat menyebut provinsi yang berbeda dengan kotanya (mis. &quot;Tangerang
                  Selatan, Jakarta&quot;) — kotanya yang dipakai.
                </li>
                {!data.mapping.available && (
                  <li style={{ color: "var(--status-warning)" }}>Pemetaan manual tidak bisa dimuat — angka di atas hasil pencocokan otomatis saja.</li>
                )}
                {data.mapping.manual + data.mapping.rule > 0 && (
                  <li>
                    Sudah termasuk {data.mapping.manual} alamat yang dipetakan manual dan {data.mapping.rule} lewat aturan.
                  </li>
                )}
                {data.nonTextAddresses > 0 && <li>{data.nonTextAddresses} alamat dari API tidak berbentuk teks biasa dan digabung otomatis.</li>}
              </ul>
            </Section>

            <Section title="Provinsi" subtitle="Termasuk yang provinsinya diketahui dari kota atau kecamatan.">
              <BarList total={data.totalTenants} rows={data.provinces.map((p) => ({ key: p.name, label: p.name, count: p.count }))} />
            </Section>

            <Section title="Kota/kabupaten" subtitle={`${data.regencies.length} kota/kabupaten terdeteksi.`}>
              <BarList
                total={data.totalTenants}
                rows={regencies.map((r) => ({
                  key: r.label,
                  count: r.count,
                  label: (
                    <>
                      {r.label}
                      <span className="block text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {r.provinceName}
                      </span>
                    </>
                  ),
                }))}
              />
              {data.regencies.length > TOP_REGENCIES && (
                <button onClick={() => setShowAllRegencies((v) => !v)} className="mt-4 text-xs hover:underline" style={{ color: "var(--series-1)" }}>
                  {showAllRegencies ? "Tampilkan lebih sedikit" : `Tampilkan semua (${data.regencies.length})`}
                </button>
              )}
            </Section>

            <Section
              title="Kecamatan"
              subtitle={`Hanya kecamatan dengan minimal 3 tenant.${
                data.districtsHidden.areas > 0 ? ` ${data.districtsHidden.areas} kecamatan lain (${data.districtsHidden.tenants} tenant) tidak ditampilkan.` : ""
              }`}
            >
              {data.districts.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  Belum ada kecamatan dengan 3 tenant atau lebih.
                </p>
              ) : (
                <BarList
                  total={data.totalTenants}
                  rows={data.districts.map((d) => ({
                    key: `${d.name}-${d.regencyLabel}`,
                    count: d.count,
                    label: (
                      <>
                        {d.name}
                        <span className="block text-[11px]" style={{ color: "var(--text-muted)" }}>
                          {d.regencyLabel}
                        </span>
                      </>
                    ),
                  }))}
                />
              )}
            </Section>

            <Section
              title="Kata yang sering muncul di alamat yang belum detail"
              subtitle="Hanya kata yang muncul di minimal 5 alamat. Bahan untuk menambah nama area/singkatan (mis. BSD, Bintaro, PIK) supaya lebih banyak alamat bisa dikenali — setelah dikonfirmasi tim yang paham area-areanya."
            >
              <div className="grid gap-6 sm:grid-cols-2">
                <WordList title={`Di alamat yang tidak dikenali (${data.byLevel.unrecognized})`} words={data.words.unrecognized} minAddresses={5} />
                <WordList title={`Di alamat yang hanya terbaca provinsi (${data.byLevel.province})`} words={data.words.provinceOnly} minAddresses={5} />
              </div>
            </Section>

            <section className="rounded-2xl border p-6" style={card}>
              <p className="mb-3 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Bagaimana alamat dikenali
              </p>
              <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                Teks alamat dicocokkan dengan daftar nama wilayah resmi Kemendagri (provinsi, kota/kabupaten, kecamatan)
                plus beberapa singkatan umum (Jaksel, Tangsel, DKI, Jogja, Solo, dll.). Nama setelah &quot;Jl.&quot; atau
                &quot;Kel.&quot; dianggap nama jalan/kelurahan, bukan kota. Kalau beberapa kota disebut, yang paling akhir
                dipakai (alamat biasanya ditulis dari kecil ke besar).
                <br />
                Kecamatan hanya diterima kalau berada di kota yang disebut, unik di provinsi yang disebut, atau — tanpa
                keterangan kota/provinsi — ditulis setelah &quot;Kec.&quot; atau terdiri dari lebih dari satu kata. Jadi
                &quot;Kemang&quot; saja tidak dianggap Kec. Kemang di Kabupaten Bogor. &quot;Yogyakarta&quot; saja dibaca
                sebagai provinsi; &quot;Kota Yogyakarta&quot; sebagai kota.
                <br />
                Ini pencocokan otomatis — sebagian kecil hasil bisa keliru, terutama nama area populer yang kebetulan sama
                dengan nama wilayah resmi di tempat lain (mis. &quot;Kuningan&quot; saja terbaca Kabupaten Kuningan).
                Data wilayah: idn-area-data (Open Database License).
              </p>
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
