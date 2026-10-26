"use client";

import { useMemo, useState } from "react";
import type { PreviewRow, PreviewStatus } from "@/lib/addressImport";
import { LLM_PROMPT } from "@/lib/addressImportPrompt";
import type { MappingOverview } from "@/lib/addressMapping";

const card = { background: "var(--surface-1)", borderColor: "var(--gridline)" };
const inputStyle = { background: "var(--background)", border: "1px solid var(--gridline)", color: "var(--text-primary)" };
const buttonPrimary = { background: "var(--series-1)", color: "var(--background)" };
const buttonOutline = { border: "1px solid var(--series-1)", color: "var(--series-1)" };

const STATUS: Record<PreviewStatus, { label: string; color: string; order: number }> = {
  ready: { label: "Siap", color: "var(--status-good)", order: 0 },
  conflict: { label: "Bertentangan", color: "var(--status-warning)", order: 1 },
  no_gain: { label: "Tidak menambah detail", color: "var(--text-muted)", order: 2 },
  skipped: { label: "Dilewati", color: "var(--text-muted)", order: 3 },
  duplicate: { label: "Duplikat", color: "var(--text-muted)", order: 4 },
  not_found: { label: "Tidak ada di antrean", color: "var(--text-muted)", order: 5 },
};
const SELECTABLE: PreviewStatus[] = ["ready", "conflict"];

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-4" style={{ borderBottom: "1px solid var(--gridline)" }}>
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold"
        style={{ background: "rgba(25, 185, 234, 0.16)", color: "var(--series-1)" }}
      >
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {title}
        </p>
        {children}
      </div>
    </div>
  );
}

export default function AddressImportPanel({
  queueSize,
  batches,
  onChanged,
}: {
  queueSize: number;
  batches: MappingOverview["importBatches"];
  onChanged: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const sorted = useMemo(
    () => (rows ? [...rows].sort((a, b) => STATUS[a.status].order - STATUS[b.status].order || a.line - b.line) : []),
    [rows]
  );
  const counts = useMemo(() => {
    const c = new Map<PreviewStatus, number>();
    for (const r of rows ?? []) c.set(r.status, (c.get(r.status) ?? 0) + 1);
    return c;
  }, [rows]);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(LLM_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Tidak bisa menyalin otomatis — salin manual dari teks prompt di bawah.");
    }
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setText(await file.text());
    setRows(null);
  };

  const preview = async () => {
    setBusy("preview");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/address-mapping/import-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `Request failed with status ${res.status}`);
      const result = body.rows as PreviewRow[];
      setRows(result);
      setChecked(new Set(result.filter((r) => r.status === "ready").map((r) => r.line)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membaca hasil");
      setRows(null);
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    const items = sorted.filter((r) => checked.has(r.line) && r.target && r.hash).map((r) => ({ hash: r.hash, ...r.target }));
    setBusy("apply");
    setError(null);
    try {
      const res = await fetch("/api/address-mapping/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `Request failed with status ${res.status}`);
      setNotice(
        `${body.inserted} alamat dipetakan.` +
          (body.skipped > 0 ? ` ${body.skipped} dilewati karena sudah dipetakan atau sudah tidak ada di antrean.` : "")
      );
      setRows(null);
      setText("");
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setBusy(null);
    }
  };

  const undo = async (batch: string, addresses: number) => {
    if (!window.confirm(`Batalkan impor ini? ${addresses} pemetaan akan dihapus dan alamatnya kembali ke antrean.`)) return;
    setBusy(batch);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/address-mapping/import?batch=${batch}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? `Request failed with status ${res.status}`);
      setNotice(`Impor dibatalkan — ${body.removed} pemetaan dihapus.`);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membatalkan impor");
    } finally {
      setBusy(null);
    }
  };

  const toggle = (line: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });

  return (
    <section className="mb-8 rounded-2xl border p-6" style={card}>
      <p className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        Impor massal lewat LLM
      </p>
      <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
        Petakan banyak alamat sekaligus: unduh antrean, minta LLM menebak wilayahnya, lalu periksa hasilnya di sini sebelum
        disimpan. Dashboard tidak memanggil LLM — Anda yang menjalankannya.
      </p>

      <Step n={1} title="Unduh antrean (CSV)">
        <p className="mb-2 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
          {queueSize} alamat. Nomor rumah/unit/lantai/blok/RT/RW dihapus, kode pos tetap; nama dan kontak tenant tidak ikut.
          Isinya tetap alamat pelanggan — pakai hanya LLM yang disetujui untuk data pelanggan.
        </p>
        <a
          href="/api/address-mapping/export"
          download
          className="inline-block rounded-full px-4 py-1.5 text-sm font-medium"
          style={queueSize === 0 ? { ...buttonOutline, opacity: 0.5, pointerEvents: "none" } : buttonOutline}
        >
          Unduh CSV
        </a>
      </Step>

      <Step n={2} title="Kirim ke LLM bersama prompt ini">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={copyPrompt} className="rounded-full px-4 py-1.5 text-sm font-medium" style={buttonOutline}>
            {copied ? "Tersalin ✓" : "Salin prompt"}
          </button>
          <details className="text-xs" style={{ color: "var(--text-muted)" }}>
            <summary className="cursor-pointer">lihat prompt</summary>
            <pre className="mt-2 whitespace-pre-wrap rounded-lg p-3 font-sans leading-relaxed" style={inputStyle}>
              {LLM_PROMPT}
            </pre>
          </details>
        </div>
      </Step>

      <Step n={3} title="Tempel atau unggah hasilnya">
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setRows(null);
          }}
          rows={6}
          placeholder={"id,kecamatan,kota_kabupaten,provinsi,status\n…"}
          className="w-full rounded-lg px-3 py-2 font-mono text-xs"
          style={inputStyle}
        />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            disabled={!text.trim() || busy !== null}
            onClick={preview}
            className="rounded-full px-4 py-1.5 text-sm font-medium disabled:opacity-50"
            style={buttonPrimary}
          >
            {busy === "preview" ? "Memeriksa…" : "Periksa hasil"}
          </button>
          <label className="cursor-pointer text-xs hover:underline" style={{ color: "var(--series-1)" }}>
            atau unggah file .csv
            <input type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={(e) => readFile(e.target.files?.[0])} />
          </label>
        </div>
      </Step>

      {error && (
        <p className="mt-4 text-xs" style={{ color: "var(--status-critical)" }}>
          {error}
        </p>
      )}
      {notice && (
        <p className="mt-4 text-xs" style={{ color: "var(--status-good)" }}>
          {notice}
        </p>
      )}

      {rows && (
        <div className="mt-4">
          <p className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Periksa sebelum disimpan
          </p>
          <p className="mb-3 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
            {Array.from(counts, ([s, n]) => `${STATUS[s].label}: ${n}`).join(" · ")}. Baris &quot;Siap&quot; sudah dicentang. Baris
            &quot;Bertentangan&quot; menyebut wilayah yang berbeda dari kota/provinsi yang tertulis di alamat — centang hanya kalau
            Anda yakin LLM yang benar.
          </p>
          {rows.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Tidak ada baris data.
            </p>
          ) : (
            <div className="max-h-[32rem] overflow-y-auto rounded-lg border" style={{ borderColor: "var(--gridline)" }}>
              {sorted.map((r) => {
                const selectable = SELECTABLE.includes(r.status);
                return (
                  <label
                    key={r.line}
                    className={`flex gap-3 px-3 py-2.5 text-sm ${selectable ? "cursor-pointer" : ""}`}
                    style={{ borderBottom: "1px solid var(--gridline)", opacity: selectable ? 1 : 0.7 }}
                  >
                    <input
                      type="checkbox"
                      disabled={!selectable}
                      checked={checked.has(r.line)}
                      onChange={() => toggle(r.line)}
                      className="mt-1 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="break-words" style={{ color: "var(--text-primary)" }}>
                        {r.address ?? <span style={{ color: "var(--text-muted)" }}>id {r.id || "(kosong)"}</span>}
                      </p>
                      <p className="mt-0.5 text-xs break-words" style={{ color: "var(--text-muted)" }}>
                        <span className="font-semibold" style={{ color: STATUS[r.status].color }}>
                          {STATUS[r.status].label}
                        </span>
                        {r.label ? ` → ${r.label}` : ""} · LLM: {r.suggestion} · baris {r.line}
                      </p>
                      {r.message && (
                        <p className="text-xs break-words" style={{ color: "var(--text-muted)" }}>
                          {r.message}
                        </p>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              disabled={checked.size === 0 || busy !== null}
              onClick={apply}
              className="rounded-full px-4 py-1.5 text-sm font-medium disabled:opacity-50"
              style={buttonPrimary}
            >
              {busy === "apply" ? "Menyimpan…" : `Simpan ${checked.size} pemetaan`}
            </button>
            <button
              onClick={() => setRows(null)}
              className="rounded-full px-4 py-1.5 text-sm"
              style={{ border: "1px solid var(--gridline)", color: "var(--text-secondary)" }}
            >
              Batal
            </button>
          </div>
        </div>
      )}

      {batches.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            Riwayat impor
          </p>
          {batches.map((b) => (
            <div
              key={b.batch}
              className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm"
              style={{ borderBottom: "1px solid var(--gridline)" }}
            >
              <div className="min-w-0">
                <span style={{ color: "var(--text-primary)" }}>{formatDate(b.createdAt)}</span>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {b.addresses} pemetaan · oleh {b.createdBy}
                </p>
              </div>
              <button
                disabled={busy !== null}
                onClick={() => undo(b.batch, b.addresses)}
                className="text-xs hover:underline disabled:opacity-50"
                style={{ color: "var(--status-critical)" }}
              >
                {busy === b.batch ? "Membatalkan…" : "Batalkan impor ini"}
              </button>
            </div>
          ))}
          <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
            Pemetaan dari impor yang kemudian Anda ubah manual tidak ikut terhapus.
          </p>
        </div>
      )}
    </section>
  );
}
