"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import type { AddressLevel } from "@/lib/addressMatch";
import type { AddressProfile, SegmentKey, SegmentProfile, WordCount } from "@/lib/addressProfile";
import type { Segment } from "@/lib/customerAddresses";

const LEVELS: { level: AddressLevel; label: string; hint: string; usable: boolean }[] = [
  { level: "district", label: "Sampai kecamatan", hint: "mis. Tebet, Jakarta Selatan", usable: true },
  { level: "regency", label: "Sampai kota/kabupaten", hint: "mis. Jakarta Selatan, Bogor", usable: true },
  { level: "province", label: "Hanya provinsi", hint: "mis. Jakarta, Yogyakarta", usable: true },
  { level: "foreign", label: "Luar negeri", hint: "rincian negara di bagian Luar negeri", usable: false },
  { level: "unrecognized", label: "Tidak dikenali", hint: "tidak ada nama wilayah yang cocok", usable: false },
  { level: "empty", label: "Kosong", hint: "alamat tidak diisi", usable: false },
];

const SEGMENT_INFO: { key: Segment; label: string; hint: string }[] = [
  { key: "active", label: "Tenant aktif", hint: "punya unit yang sedang disewa" },
  { key: "reserved", label: "Reservasi", hint: "sudah reservasi, belum move-in" },
  { key: "movedOut", label: "Sudah move-out", hint: "pernah sewa, sekarang tidak punya unit" },
  { key: "neverRented", label: "Daftar, belum sewa", hint: "terdaftar tanpa riwayat sewa atau reservasi" },
];
const SEGMENT_LABEL: Record<SegmentKey, string> = {
  all: "Semua",
  active: "Tenant aktif",
  reserved: "Reservasi",
  movedOut: "Sudah move-out",
  neverRented: "Daftar, belum sewa",
};

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

const cityOrBetterOf = (p: SegmentProfile) => p.byLevel.district + p.byLevel.regency;

function SegmentTable({ segments }: { segments: AddressProfile["segments"] }) {
  const rows = [
    ...SEGMENT_INFO.map((s) => ({ ...s, p: segments[s.key]! })),
    { key: "all", label: "Semua", hint: "", p: segments.all! },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] font-bold tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
            <th className="pb-2 font-bold">Kelompok</th>
            <th className="pb-2 text-right font-bold">Orang</th>
            <th className="pb-2 pl-3 text-right font-bold">Alamat terisi</th>
            <th className="pb-2 pl-3 text-right font-bold">Sampai kota/kab.</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map(({ key, label, hint, p }) => {
            const filled = p.total - p.byLevel.empty;
            const total = key === "all";
            return (
              <tr key={key} style={{ borderTop: "1px solid var(--gridline)", fontWeight: total ? 600 : undefined }}>
                <td className="py-2 pr-2" style={{ color: "var(--text-primary)" }}>
                  {label}
                  {hint && (
                    <span className="block text-[11px] font-normal" style={{ color: "var(--text-muted)" }}>
                      {hint}
                    </span>
                  )}
                </td>
                <td className="py-2 text-right" style={{ color: "var(--text-primary)" }}>
                  {p.total}
                </td>
                <td className="py-2 pl-3 text-right whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                  {pct(filled, p.total)} <span className="text-xs" style={{ color: "var(--text-muted)" }}>({filled})</span>
                </td>
                <td className="py-2 pl-3 text-right whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                  {pct(cityOrBetterOf(p), p.total)} <span className="text-xs" style={{ color: "var(--text-muted)" }}>({cityOrBetterOf(p)})</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function AddressProfilePage() {
  const { data: session } = useSession();
  const [data, setData] = useState<(AddressProfile & { mappingAllowed?: boolean }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAllRegencies, setShowAllRegencies] = useState(false);
  const [segment, setSegment] = useState<SegmentKey>("all");
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

  // Falls back to active tenants when the other segments couldn't be read.
  const segmentKey: SegmentKey = data?.segments[segment] ? segment : "active";
  const p = data?.segments[segmentKey];
  const filled = p ? p.total - p.byLevel.empty : 0;
  const usable = p ? p.byLevel.district + p.byLevel.regency + p.byLevel.province : 0;
  const cityOrBetter = p ? cityOrBetterOf(p) : 0;
  const regencies = p ? (showAllRegencies ? p.regencies : p.regencies.slice(0, TOP_REGENCIES)) : [];
  const segmentKeys = (["all", "active", "reserved", "movedOut", "neverRented"] as SegmentKey[]).filter((k) => data?.segments[k]);

  return (
    <div className="min-h-screen px-6 py-10 sm:px-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image src="/spacehub-logo.webp" alt="SpaceHub" width={121} height={36} priority />
            <span className="hidden h-6 w-px sm:block" style={{ background: "var(--gridline)" }} />
            <h1 className="hidden text-sm font-medium sm:block" style={{ color: "var(--text-secondary)" }}>
              Profil Alamat Pelanggan
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

        {data && p && (
          <div style={{ opacity: loading ? 0.5 : 1, transition: "opacity 150ms ease", pointerEvents: loading ? "none" : "auto" }}>
            <p className="mb-6 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
              Isi alamat semua pelanggan yang terdaftar di Storeganise — tenant aktif, reservasi, yang sudah move-out, dan
              yang mendaftar tapi belum pernah sewa. Halaman ini hanya menampilkan angka gabungan — tidak ada alamat atau
              nama pelanggan yang ditampilkan.
            </p>

            {data.others.available ? (
              <>
                <Section
                  title="Kelompok pelanggan"
                  subtitle="Satu orang masuk satu kelompok: unit aktif lebih dulu, lalu reservasi, lalu riwayat sewa. Perhatikan kolom alamat terisi — angka per wilayah di bawah hanya mewakili yang mengisi alamat."
                >
                  <SegmentTable segments={data.segments} />
                  <ul className="mt-4 list-disc space-y-1 pl-5 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                    <li>
                      {data.others.usersInList} user di daftar user Storeganise, {data.others.listWithAddress} di antaranya
                      mengisi alamat.
                    </li>
                    {data.others.staffExcluded > 0 && (
                      <li>
                        {data.others.staffExcluded} akun @spacehub.id tanpa riwayat sewa tidak dihitung (kemungkinan akun staf
                        atau tes).
                      </li>
                    )}
                    {data.others.usersInList > 0 && data.others.listWithAddress === 0 && (
                      <li style={{ color: "var(--status-warning)" }}>
                        Tidak ada satu pun user di daftar yang membawa alamat — kemungkinan daftar user dari API tidak
                        menyertakan field alamat, jadi kelompok selain tenant aktif terlihat kosong.
                      </li>
                    )}
                  </ul>
                </Section>

              </>
            ) : (
              <div className="mb-6 rounded-lg border px-4 py-3 text-xs leading-relaxed" style={{ borderColor: "var(--status-warning)", color: "var(--text-secondary)", background: "var(--surface-1)" }}>
                <b style={{ color: "var(--status-warning)" }}>Hanya tenant aktif.</b> Daftar user atau riwayat rental dari
                Storeganise tidak bisa dibaca, jadi kelompok lain tidak ditampilkan: {data.others.error}
              </div>
            )}

            <div className="mb-4">
              <p className="mb-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Profil per kelompok
              </p>
              <div className="flex flex-wrap gap-2">
                {segmentKeys.map((k) => {
                  const active = k === segmentKey;
                  return (
                    <button
                      key={k}
                      onClick={() => setSegment(k)}
                      className="rounded-full px-3 py-1.5 text-sm font-medium"
                      style={{
                        background: active ? "var(--series-1)" : "transparent",
                        color: active ? "var(--background)" : "var(--text-secondary)",
                        border: active ? "none" : "1px solid var(--gridline)",
                      }}
                    >
                      {SEGMENT_LABEL[k]} ({data.segments[k]!.total})
                    </button>
                  );
                })}
              </div>
            </div>

            <Section
              title={`Seberapa detail alamat bisa dikenali — ${SEGMENT_LABEL[segmentKey].toLowerCase()}`}
              subtitle="Tingkat paling detail yang bisa dikenali dari tiap alamat. Biru = bisa dipakai untuk laporan wilayah."
            >
              <BarList
                total={p.total}
                rows={LEVELS.map((l) => ({
                  key: l.level,
                  muted: !l.usable,
                  count: p.byLevel[l.level],
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
                <Stat label="Bisa dipakai" value={pct(usable, p.total)} sub={`${usable} orang, minimal provinsi`} />
                <Stat label="Sampai kota/kab." value={pct(cityOrBetter, p.total)} sub={`${cityOrBetter} orang`} />
                <Stat label="Sangat pendek" value={String(p.veryShort.total)} sub="alamat 1–2 kata" />
                <Stat label="Ada kode pos" value={pct(p.withPostalCode, filled)} sub={`${p.withPostalCode} dari ${filled} yang terisi`} />
              </div>
              <ul className="mt-5 list-disc space-y-1 pl-5 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                {p.veryShort.total > 0 && (
                  <li>
                    Dari {p.veryShort.total} alamat sangat pendek:{" "}
                    {LEVELS.filter((l) => p.veryShort.byLevel[l.level] > 0)
                      .map((l) => `${l.label.toLowerCase()} ${p.veryShort.byLevel[l.level]}`)
                      .join(" · ")}
                    .
                  </li>
                )}
                <li>
                  {p.ambiguousRegency} alamat hanya menyebut nama yang dipakai kota sekaligus kabupaten (mis.
                  &quot;Bogor&quot;, &quot;Tangerang&quot;), jadi tidak bisa dipastikan yang mana.
                </li>
                <li>
                  {p.provinceConflicts} alamat menyebut provinsi yang berbeda dengan kotanya (mis. &quot;Tangerang
                  Selatan, Jakarta&quot;) — kotanya yang dipakai.
                </li>
                {!data.mappingAvailable && (
                  <li style={{ color: "var(--status-warning)" }}>Pemetaan manual tidak bisa dimuat — angka di atas hasil pencocokan otomatis saja.</li>
                )}
                {p.mapping.manual + p.mapping.rule > 0 && (
                  <li>
                    Sudah termasuk {p.mapping.manual} alamat yang dipetakan manual dan {p.mapping.rule} lewat aturan.
                  </li>
                )}
                {data.nonTextAddresses > 0 && <li>{data.nonTextAddresses} alamat dari API tidak berbentuk teks biasa dan digabung otomatis.</li>}
              </ul>
            </Section>

            <Section title="Provinsi" subtitle="Termasuk yang provinsinya diketahui dari kota atau kecamatan.">
              <BarList total={p.total} rows={p.provinces.map((r) => ({ key: r.name, label: r.name, count: r.count }))} />
            </Section>

            <Section title="Kota/kabupaten" subtitle={`${p.regencies.length} kota/kabupaten terdeteksi.`}>
              <BarList
                total={p.total}
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
              {p.regencies.length > TOP_REGENCIES && (
                <button onClick={() => setShowAllRegencies((v) => !v)} className="mt-4 text-xs hover:underline" style={{ color: "var(--series-1)" }}>
                  {showAllRegencies ? "Tampilkan lebih sedikit" : `Tampilkan semua (${p.regencies.length})`}
                </button>
              )}
            </Section>

            <Section
              title="Kecamatan"
              subtitle={`Hanya kecamatan dengan minimal 3 orang.${
                p.districtsHidden.areas > 0 ? ` ${p.districtsHidden.areas} kecamatan lain (${p.districtsHidden.people} orang) tidak ditampilkan.` : ""
              }`}
            >
              {p.districts.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  Belum ada kecamatan dengan 3 orang atau lebih.
                </p>
              ) : (
                <BarList
                  total={p.total}
                  rows={p.districts.map((d) => ({
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
              title="Luar negeri"
              subtitle={`Negara dari teks alamat atau dari pemetaan manual. Hanya negara dengan minimal 3 orang.${
                p.countriesHidden.countries > 0 ? ` ${p.countriesHidden.countries} negara lain (${p.countriesHidden.people} orang) tidak ditampilkan.` : ""
              }`}
            >
              {p.byLevel.foreign === 0 ? (
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  Tidak ada alamat luar negeri.
                </p>
              ) : (
                <BarList
                  total={p.byLevel.foreign}
                  rows={[
                    ...p.countries.map((c) => ({ key: c.name, label: c.name, count: c.count })),
                    ...(p.countryUnknown > 0 ? [{ key: "unknown", label: "Negara tidak diketahui", count: p.countryUnknown, muted: true }] : []),
                  ]}
                />
              )}
              {p.byLevel.foreign > 0 && (
                <p className="mt-4 text-xs" style={{ color: "var(--text-muted)" }}>
                  Persentase dari {p.byLevel.foreign} alamat luar negeri.
                </p>
              )}
            </Section>

            <Section
              title="Kata yang sering muncul di alamat yang belum detail"
              subtitle="Hanya kata yang muncul di minimal 5 alamat. Bahan untuk menambah nama area/singkatan (mis. BSD, Bintaro, PIK) supaya lebih banyak alamat bisa dikenali — setelah dikonfirmasi tim yang paham area-areanya."
            >
              <div className="grid gap-6 sm:grid-cols-2">
                <WordList title={`Di alamat yang tidak dikenali (${p.byLevel.unrecognized})`} words={p.words.unrecognized} minAddresses={5} />
                <WordList title={`Di alamat yang hanya terbaca provinsi (${p.byLevel.province})`} words={p.words.provinceOnly} minAddresses={5} />
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
