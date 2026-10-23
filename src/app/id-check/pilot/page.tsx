"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import type { PilotRow, PilotStatus, PilotSummary, PilotVerdict } from "@/lib/ktpPilot";
import { Meter } from "@/components/Meter";

const STATUS_LABELS: Record<PilotStatus, string> = {
  ok: "NIK terbaca",
  no_nik: "NIK tidak terbaca",
  passport: "Paspor (tidak diproses)",
  unsupported_format: "Format file tidak didukung",
  download_failed: "Gagal mengunduh file",
  unsupported_field: "Bentuk field belum didukung",
};

const PASS_LABELS: Record<string, string> = {
  full: "baca penuh",
  "nik-line": "baris NIK",
  "rotate-90": "diputar 90°",
  "rotate-270": "diputar 270°",
  "rotate-180": "diputar 180°",
};

function pct(part: number, total: number): string {
  return total > 0 ? `${((part / total) * 100).toFixed(0)}%` : "–";
}

function formatDate(iso: string | null): string {
  return iso ? new Date(`${iso}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "–";
}

const card = { background: "var(--surface-1)", borderColor: "var(--gridline)" };

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-bold tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <p className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
        {value}
      </p>
      {sub && (
        <p className="text-xs" style={{ color: "var(--text-muted)" }}>
          {sub}
        </p>
      )}
    </div>
  );
}

function VerdictButtons({ row, onVerdict, busy }: { row: PilotRow; onVerdict: (v: PilotVerdict | null) => void; busy: boolean }) {
  if (row.verdict) {
    return (
      <span className="inline-flex items-center gap-2 text-xs whitespace-nowrap">
        <span style={{ color: row.verdict === "correct" ? "var(--status-good)" : "var(--status-critical)", fontWeight: 600 }}>
          {row.verdict === "correct" ? "✓ Benar" : "✗ Salah"}
        </span>
        <button disabled={busy} onClick={() => onVerdict(null)} className="hover:underline" style={{ color: "var(--text-muted)" }}>
          ubah
        </button>
      </span>
    );
  }
  const btn = "rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-50";
  return (
    <span className="inline-flex gap-2 whitespace-nowrap">
      <button disabled={busy} onClick={() => onVerdict("correct")} className={btn} style={{ background: "rgba(11, 170, 159, 0.16)", color: "var(--status-good)" }}>
        Benar
      </button>
      <button disabled={busy} onClick={() => onVerdict("wrong")} className={btn} style={{ background: "rgba(240, 122, 166, 0.16)", color: "var(--status-critical)" }}>
        Salah
      </button>
    </span>
  );
}

export default function KtpOcrPilotPage() {
  const { data: session } = useSession();
  const [data, setData] = useState<PilotSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/id-check/pilot");
      const body = await res.json();
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!res.ok) throw new Error(body?.error ?? `Request failed with status ${res.status}`);
      setData(body as PilotSummary);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat data pilot");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount, state settles asynchronously in `load`
    load();
  }, [load]);

  // Files are processed strictly one request at a time — each request runs OCR
  // on the server, and parallel requests would just queue behind each other.
  const processBatch = async (count: number) => {
    setRunning({ done: 0, total: count });
    setError(null);
    try {
      for (let i = 0; i < count; i++) {
        const res = await fetch("/api/id-check/pilot/process", { method: "POST" });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? `Request failed with status ${res.status}`);
        if (body.sampleFull) break;
        setRunning({ done: i + 1, total: count });
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memproses file");
    } finally {
      setRunning(null);
      await load();
    }
  };

  const saveVerdict = async (row: PilotRow, verdict: PilotVerdict | null) => {
    setSavingId(row.id);
    try {
      const res = await fetch("/api/id-check/pilot/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: row.id, verdict }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Request failed with status ${res.status}`);
      setData((d) => (d ? { ...d, rows: d.rows.map((r) => (r.id === row.id ? { ...r, verdict } : r)) } : d));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan verifikasi");
    } finally {
      setSavingId(null);
    }
  };

  const readRows = data?.rows.filter((r) => r.status === "ok") ?? [];
  const pending = readRows.filter((r) => !r.verdict);
  const verifiedRows = readRows.filter((r) => r.verdict);
  const otherRows = data?.rows.filter((r) => r.status !== "ok") ?? [];
  const attempted = data ? data.byStatus.ok + data.byStatus.no_nik : 0;
  const unsupportedField = data?.rows.find((r) => r.status === "unsupported_field");
  const full = data ? data.processed >= data.sampleSize : false;

  return (
    <div className="min-h-screen px-6 py-10 sm:px-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image src="/spacehub-logo.webp" alt="SpaceHub" width={121} height={36} priority />
            <span className="hidden h-6 w-px sm:block" style={{ background: "var(--gridline)" }} />
            <h1 className="hidden text-sm font-medium sm:block" style={{ color: "var(--text-secondary)" }}>
              Pilot OCR KTP
            </h1>
          </div>
          <div className="flex items-baseline gap-4">
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

        <Link href="/id-check" className="mb-6 inline-block text-sm hover:underline" style={{ color: "var(--series-1)" }}>
          ← Back to kelengkapan ID
        </Link>

        {forbidden && (
          <div className="rounded-2xl border p-6 text-sm" style={{ ...card, color: "var(--text-secondary)" }}>
            Halaman ini khusus untuk tim pilot OCR. Hubungi admin dashboard kalau Anda perlu akses.
          </div>
        )}

        {error && (
          <div className="mb-6 rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)", background: "var(--surface-1)" }}>
            {error}
          </div>
        )}

        {!forbidden && !data && !error && <p style={{ color: "var(--text-secondary)" }}>Memuat…</p>}

        {data && (
          <>
            {unsupportedField && (
              <div
                className="mb-6 rounded-lg border p-3 text-xs leading-relaxed"
                style={{ borderColor: "var(--status-warning)", background: "rgba(250, 183, 18, 0.08)", color: "var(--text-secondary)" }}
              >
                <b style={{ color: "var(--status-warning)" }}>File KTP belum bisa diunduh:</b> bentuk data field{" "}
                <code>passport-ktp</code> dari Storeganise belum dikenali. Kirimkan teks ini ke tim teknis (tanpa data
                pribadi): <code>{unsupportedField.detail}</code>
              </div>
            )}

            <section className="mb-8 rounded-2xl border p-6" style={card}>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    Sampel {data.processed} dari {data.sampleSize} KTP
                  </p>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    Dipilih acak dari tenant aktif yang sudah upload KTP/paspor
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {running && (
                    <span className="inline-flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current" style={{ borderTopColor: "transparent", color: "var(--series-1)" }} />
                      Memproses {running.done + 1} dari {running.total}…
                    </span>
                  )}
                  {[1, 10].map((n) => (
                    <button
                      key={n}
                      disabled={!!running || full}
                      onClick={() => processBatch(n)}
                      className="rounded-full px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                      style={n === 1 ? { background: "var(--series-1)", color: "var(--background)" } : { border: "1px solid var(--gridline)", color: "var(--text-secondary)" }}
                    >
                      Proses {n} KTP
                    </button>
                  ))}
                </div>
              </div>
              <Meter value={(data.processed / data.sampleSize) * 100} />
              <div className="mt-5 grid grid-cols-2 gap-5 sm:grid-cols-4">
                <Stat label="Terbaca" value={pct(data.byStatus.ok, attempted)} sub={`${data.byStatus.ok} dari ${attempted} KTP`} />
                <Stat label="Akurasi" value={pct(data.correct, data.verified)} sub={`${data.correct} benar dari ${data.verified} diverifikasi`} />
                <Stat label="Benar dari semua" value={pct(data.correct, attempted)} sub="terverifikasi benar ÷ semua KTP" />
                <Stat label="Waktu per file" value={data.avgDurationMs !== null ? `${(data.avgDurationMs / 1000).toFixed(1)} dtk` : "–"} />
              </div>
              {(["passport", "unsupported_format", "download_failed", "unsupported_field"] as const).some((s) => data.byStatus[s] > 0) && (
                <p className="mt-4 text-xs" style={{ color: "var(--text-muted)" }}>
                  Tidak dihitung di atas:{" "}
                  {(["passport", "unsupported_format", "download_failed", "unsupported_field"] as const)
                    .filter((s) => data.byStatus[s] > 0)
                    .map((s) => `${STATUS_LABELS[s]} ${data.byStatus[s]}`)
                    .join(" · ")}
                </p>
              )}
            </section>

            <section className="mb-8 rounded-2xl border p-6" style={card}>
              <p className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Perlu diverifikasi ({pending.length})
              </p>
              <p className="mb-4 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                Buka profil tenant di Storeganise dan lihat foto KTP-nya. Klik <b>Benar</b> hanya kalau tanggal lahir,
                jenis kelamin, kota/kabupaten, serta 4 digit awal dan akhir NIK semuanya cocok dengan KTP.
              </p>
              {pending.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  Tidak ada yang menunggu verifikasi.
                </p>
              ) : (
                <ResultTable rows={pending} savingId={savingId} onVerdict={saveVerdict} />
              )}
            </section>

            {verifiedRows.length > 0 && (
              <section className="mb-8 rounded-2xl border p-6" style={card}>
                <p className="mb-4 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  Sudah diverifikasi ({verifiedRows.length})
                </p>
                <ResultTable rows={verifiedRows} savingId={savingId} onVerdict={saveVerdict} />
              </section>
            )}

            {otherRows.length > 0 && (
              <section className="mb-8 rounded-2xl border p-6" style={card}>
                <p className="mb-4 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  Tidak menghasilkan NIK ({otherRows.length})
                </p>
                <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--gridline)" }}>
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--gridline)" }}>
                        {["Tenant", "Hasil", "Keterangan"].map((h) => (
                          <th key={h} className="px-4 py-3 font-medium whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {otherRows.map((r) => (
                        <tr key={r.id} style={{ borderBottom: "1px solid var(--gridline)" }}>
                          <td className="px-4 py-2 font-semibold whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                            {r.tenantName}
                          </td>
                          <td className="px-4 py-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                            {STATUS_LABELS[r.status]}
                          </td>
                          <td className="px-4 py-2 text-xs" style={{ color: "var(--text-muted)" }}>
                            {r.detail ?? (r.confidence !== null ? `confidence OCR ${Math.round(r.confidence)}` : "–")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section className="rounded-2xl border p-6" style={card}>
              <p className="mb-3 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Tentang pilot ini
              </p>
              <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                Foto KTP diunduh dari Storeganise dan dibaca dengan OCR yang berjalan di server dashboard ini sendiri
                (tesseract.js) — tidak dikirim ke layanan pihak ketiga. Foto tidak disimpan; yang disimpan hanya hasil
                turunan (tanggal lahir, jenis kelamin, kode wilayah, NIK yang disamarkan) dan hasil verifikasi.
                <br />
                <b style={{ color: "var(--text-secondary)" }}>Terbaca</b>: NIK yang strukturnya valid (tanggal lahir
                masuk akal, kode provinsi ada) ditemukan, dibagi semua KTP yang dibaca. Paspor, file non-gambar, dan
                file yang gagal diunduh tidak dihitung.
                <br />
                <b style={{ color: "var(--text-secondary)" }}>Akurasi</b>: dari yang terbaca dan sudah diverifikasi,
                berapa yang benar. <b style={{ color: "var(--text-secondary)" }}>Benar dari semua</b>: perkiraan berapa
                persen KTP yang pada akhirnya menghasilkan data yang benar.
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function ResultTable({ rows, savingId, onVerdict }: { rows: PilotRow[]; savingId: number | null; onVerdict: (row: PilotRow, v: PilotVerdict | null) => void }) {
  return (
    <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--gridline)" }}>
      <table className="w-full text-left text-sm">
        <thead>
          <tr style={{ borderBottom: "1px solid var(--gridline)" }}>
            {["Tenant", "NIK", "Tanggal lahir", "JK", "Kota/Kabupaten", "Verifikasi"].map((h) => (
              <th key={h} className="px-4 py-3 font-medium whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderBottom: "1px solid var(--gridline)" }}>
              <td className="px-4 py-2 font-semibold whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                {r.tenantName}
                <div className="text-[11px] font-normal" style={{ color: "var(--text-muted)" }}>
                  {r.ocrPass ? PASS_LABELS[r.ocrPass] ?? r.ocrPass : ""}
                  {r.confidence !== null ? ` · conf ${Math.round(r.confidence)}` : ""}
                </div>
              </td>
              <td className="px-4 py-2 font-mono text-xs whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                {r.nikMasked}
              </td>
              <td className="px-4 py-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                {formatDate(r.birthDate)}
              </td>
              <td className="px-4 py-2" style={{ color: "var(--text-secondary)" }}>
                {r.sex ?? "–"}
              </td>
              <td className="px-4 py-2" style={{ color: "var(--text-secondary)" }}>
                {r.regencyName ?? `Kode ${r.regencyCode} (tidak dikenal)`}
                <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {r.provinceName}
                </div>
              </td>
              <td className="px-4 py-2">
                <VerdictButtons row={r} busy={savingId === r.id} onVerdict={(v) => onVerdict(r, v)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
