"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Row = { label: string; price: string };

const inputStyle = {
  background: "var(--background)",
  borderColor: "var(--gridline)",
  color: "var(--text-primary)",
} as const;

// Shared UI for any admin-editable "name + price" list (rate packages,
// addon menus) — the two endpoints (/api/rates, /api/addons) use different
// field names for the label (packageName vs name), so this component works
// with a generic {label, price} row and lets the caller translate to/from
// whatever shape its endpoint expects.
export function PriceListEditor({
  title,
  description,
  emptyHint,
  labelPlaceholder,
  apiPath,
  toRows,
  toRequestBody,
  backHref,
  backLabel,
}: {
  title: string;
  description: string;
  emptyHint: string;
  labelPlaceholder: string;
  apiPath: string;
  toRows: (json: unknown) => Row[];
  toRequestBody: (rows: Row[]) => unknown;
  backHref: string;
  backLabel: string;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    fetch(apiPath)
      .then((res) => res.json())
      .then((body) => setRows(toRows(body)))
      .catch(() => setError("Gagal memuat data"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiPath]);

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function addRow() {
    setRows((prev) => [...prev, { label: "", price: "0" }]);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSavedAt(null);

    for (const row of rows) {
      if (!row.label.trim()) {
        setError("Nama tidak boleh kosong");
        return;
      }
    }

    setSaving(true);
    try {
      const res = await fetch(apiPath, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toRequestBody(rows)),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Gagal menyimpan");
      setRows(toRows(body));
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Link href={backHref} className="mb-6 inline-block text-sm hover:underline" style={{ color: "var(--series-1)" }}>
        ← {backLabel}
      </Link>

      <h1 className="mb-1 text-xl font-semibold" style={{ color: "var(--text-primary)" }}>{title}</h1>
      <p className="mb-6 text-sm" style={{ color: "var(--text-secondary)" }}>{description}</p>

      {error && (
        <div className="mb-6 rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)", background: "var(--surface-1)" }}>
          {error}
        </div>
      )}

      {loading ? (
        <p style={{ color: "var(--text-secondary)" }}>Loading…</p>
      ) : (
        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <div className="rounded-2xl border p-6" style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}>
            {rows.length === 0 && (
              <p className="mb-4 text-sm" style={{ color: "var(--text-muted)" }}>{emptyHint}</p>
            )}
            <div className="flex flex-col gap-3">
              {rows.map((row, i) => (
                <div key={i} className="flex items-center gap-3">
                  <input
                    value={row.label}
                    onChange={(e) => updateRow(i, { label: e.target.value })}
                    placeholder={labelPlaceholder}
                    className="flex-1 rounded-lg border px-3 py-2 text-sm"
                    style={inputStyle}
                  />
                  <input
                    type="number"
                    min={0}
                    value={row.price}
                    onChange={(e) => updateRow(i, { price: e.target.value })}
                    placeholder="Harga (IDR)"
                    className="w-40 rounded-lg border px-3 py-2 text-sm"
                    style={inputStyle}
                  />
                  <button type="button" onClick={() => removeRow(i)} className="text-sm hover:underline" style={{ color: "var(--status-critical)" }}>
                    Hapus
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addRow} className="mt-4 text-sm hover:underline" style={{ color: "var(--series-1)" }}>
              + Tambah
            </button>
          </div>

          <div className="flex items-center gap-4">
            <button type="submit" disabled={saving} className="self-start rounded-full px-5 py-2.5 text-sm font-medium disabled:opacity-50" style={{ background: "var(--series-1)", color: "var(--background)" }}>
              {saving ? "Menyimpan…" : "Simpan"}
            </button>
            {savedAt && !saving && <span className="text-xs" style={{ color: "var(--status-good)" }}>Tersimpan.</span>}
          </div>
        </form>
      )}
    </>
  );
}
