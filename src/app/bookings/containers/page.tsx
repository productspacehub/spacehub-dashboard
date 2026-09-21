"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import type { ContainerRow } from "@/lib/bookings";

export default function ContainersPage() {
  const { data: session } = useSession();
  const [containers, setContainers] = useState<ContainerRow[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (query: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const res = await fetch(`/api/containers?q=${encodeURIComponent(query)}`, { signal: controller.signal });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Gagal memuat container");
      setContainers(body.containers ?? []);
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Gagal memuat container");
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => load(q), q ? 300 : 0);
    return () => clearTimeout(id);
  }, [load, q]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newLabel.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/containers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newLabel }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Gagal menambah container");
      setNewLabel("");
      await load(q);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menambah container");
    } finally {
      setCreating(false);
    }
  }

  const freeCount = containers?.filter((c) => c.status === "Free").length ?? 0;

  return (
    <div className="min-h-screen px-6 py-10 sm:px-10">
      <div className="mx-auto max-w-3xl">
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

        <h1 className="mb-1 text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Container — Shared Storage</h1>
        {containers && (
          <p className="mb-6 text-sm" style={{ color: "var(--text-secondary)" }}>
            {freeCount} Free dari {containers.length} container
          </p>
        )}

        {error && (
          <div className="mb-6 rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)", background: "var(--surface-1)" }}>
            {error}
          </div>
        )}

        <form onSubmit={handleCreate} className="mb-6 flex items-center gap-3 rounded-2xl border p-4" style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}>
          <input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Container ID baru, mis. BOX-014"
            className="flex-1 rounded-lg border px-3 py-2 text-sm"
            style={{ background: "var(--background)", borderColor: "var(--gridline)", color: "var(--text-primary)" }}
          />
          <button type="submit" disabled={creating || !newLabel.trim()} className="rounded-full px-4 py-2 text-sm font-medium disabled:opacity-50" style={{ background: "var(--series-1)", color: "var(--background)" }}>
            {creating ? "Menambah…" : "+ Tambah"}
          </button>
        </form>

        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cari Container ID…"
          className="mb-6 w-full rounded-lg border px-4 py-2 text-sm"
          style={{ background: "var(--surface-1)", borderColor: "var(--gridline)", color: "var(--text-primary)" }}
        />

        {loading && !containers && <p style={{ color: "var(--text-secondary)" }}>Loading…</p>}

        {containers && (
          <div style={{ opacity: loading ? 0.5 : 1, transition: "opacity 150ms ease" }}>
            <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--gridline)" }}>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--gridline)" }}>
                    <th className="px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>Container ID</th>
                    <th className="px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>Status</th>
                    <th className="px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>Customer saat ini</th>
                  </tr>
                </thead>
                <tbody>
                  {containers.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center" style={{ color: "var(--text-muted)" }}>
                        Belum ada container.
                      </td>
                    </tr>
                  )}
                  {containers.map((c) => (
                    <tr key={c.id} style={{ borderBottom: "1px solid var(--gridline)" }}>
                      <td className="px-4 py-3 font-semibold" style={{ color: "var(--text-primary)" }}>{c.label}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-medium" style={{ color: c.status === "Free" ? "var(--status-good)" : "var(--status-warning)" }}>
                          {c.status}
                        </span>
                      </td>
                      <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>
                        {c.currentBookingId ? (
                          <Link href={`/bookings/${c.currentBookingId}`} className="hover:underline" style={{ color: "var(--series-1)" }}>
                            {c.currentCustomerName}
                          </Link>
                        ) : (
                          "–"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
