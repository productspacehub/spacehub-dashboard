"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import type { RatePackage } from "@/lib/bookings";

type Row = { packageName: string; price: string };

export default function RatesPage() {
  const { data: session } = useSession();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/rates")
      .then((res) => res.json())
      .then((body: { packages?: RatePackage[] }) => {
        setRows((body.packages ?? []).map((p) => ({ packageName: p.packageName, price: String(p.price) })));
      })
      .catch(() => setError("Gagal memuat rate table"))
      .finally(() => setLoading(false));
  }, []);

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function addRow() {
    setRows((prev) => [...prev, { packageName: "", price: "0" }]);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    for (const row of rows) {
      if (!row.packageName.trim()) {
        setError("Nama package tidak boleh kosong");
        return;
      }
    }

    setSaving(true);
    try {
      const res = await fetch("/api/rates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packages: rows.map((r) => ({ packageName: r.packageName.trim(), price: Number(r.price) || 0 })),
        }),
      });
      const body = (await res.json()) as { packages?: RatePackage[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Gagal menyimpan");
      setRows((body.packages ?? []).map((p) => ({ packageName: p.packageName, price: String(p.price) })));
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen px-6 py-10 sm:px-10">
      <div className="mx-auto max-w-xl">
        <header className="mb-6 flex items-center justify-between gap-4">
          <Image src="/spacehub-logo.webp" alt="SpaceHub" width={121} height={36} priority />
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

        <Link href="/bookings" className="mb-6 inline-block text-sm hover:underline" style={{ color: "var(--series-1)" }}>
          ← Kembali ke daftar booking
        </Link>

        <h1 className="mb-1 text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Rate table — Shared Storage</h1>
        <p className="mb-6 text-sm" style={{ color: "var(--text-secondary)" }}>
          Harga per package (mis. Daily, Weekly). Dipakai untuk mengisi harga otomatis saat membuat booking baru — tetap bisa diubah manual per booking.
        </p>

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
                <p className="mb-4 text-sm" style={{ color: "var(--text-muted)" }}>
                  Belum ada package. Tambahkan mis. &quot;Daily&quot; dan &quot;Weekly&quot; dengan harganya.
                </p>
              )}
              <div className="flex flex-col gap-3">
                {rows.map((row, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <input
                      value={row.packageName}
                      onChange={(e) => updateRow(i, { packageName: e.target.value })}
                      placeholder="Nama package, mis. Daily"
                      className="flex-1 rounded-lg border px-3 py-2 text-sm"
                      style={{ background: "var(--background)", borderColor: "var(--gridline)", color: "var(--text-primary)" }}
                    />
                    <input
                      type="number"
                      min={0}
                      value={row.price}
                      onChange={(e) => updateRow(i, { price: e.target.value })}
                      placeholder="Harga (IDR)"
                      className="w-40 rounded-lg border px-3 py-2 text-sm"
                      style={{ background: "var(--background)", borderColor: "var(--gridline)", color: "var(--text-primary)" }}
                    />
                    <button type="button" onClick={() => removeRow(i)} className="text-sm hover:underline" style={{ color: "var(--status-critical)" }}>
                      Hapus
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addRow} className="mt-4 text-sm hover:underline" style={{ color: "var(--series-1)" }}>
                + Tambah package
              </button>
            </div>

            <div className="flex items-center gap-4">
              <button type="submit" disabled={saving} className="self-start rounded-full px-5 py-2.5 text-sm font-medium disabled:opacity-50" style={{ background: "var(--series-1)", color: "var(--background)" }}>
                {saving ? "Menyimpan…" : "Simpan rate table"}
              </button>
              {savedAt && !saving && <span className="text-xs" style={{ color: "var(--status-good)" }}>Tersimpan.</span>}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
