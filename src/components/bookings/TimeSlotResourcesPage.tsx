"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import type { ModuleType, ResourceRow } from "@/lib/bookings";

const inputStyle = {
  background: "var(--background)",
  borderColor: "var(--gridline)",
  color: "var(--text-primary)",
} as const;

// Room/studio management for the calendar modules (§7.2) — simpler than
// Container's list: a room has no single current Free/Assigned state (one
// room serves many bookings across a day, just not overlapping ones), so
// there's nothing to show here besides the room names themselves. Actual
// availability is checked per booking attempt (checkResourceConflict).
export function TimeSlotResourcesPage({
  moduleType,
  moduleLabel,
  backHref,
}: {
  moduleType: ModuleType;
  moduleLabel: string;
  backHref: string;
}) {
  const { data: session } = useSession();
  const [resources, setResources] = useState<ResourceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/resources?module=${moduleType}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Gagal memuat ruang");
      setResources(body.resources ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat ruang");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount/module change, state settles asynchronously in `load`
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleType]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/resources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module: moduleType, name: newName }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Gagal menambah ruang");
      setNewName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menambah ruang");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="min-h-screen px-6 py-10 sm:px-10">
      <div className="mx-auto max-w-2xl">
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

        <Link href={backHref} className="mb-6 inline-block text-sm hover:underline" style={{ color: "var(--series-1)" }}>
          ← Kembali ke daftar booking
        </Link>

        <h1 className="mb-1 text-xl font-semibold" style={{ color: "var(--text-primary)" }}>Ruang — {moduleLabel}</h1>
        {resources && (
          <p className="mb-6 text-sm" style={{ color: "var(--text-secondary)" }}>{resources.length} ruang terdaftar</p>
        )}

        {error && (
          <div className="mb-6 rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)", background: "var(--surface-1)" }}>
            {error}
          </div>
        )}

        <form onSubmit={handleCreate} className="mb-6 flex items-center gap-3 rounded-2xl border p-4" style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={`Nama ruang baru, mis. ${moduleLabel} A`}
            className="flex-1 rounded-lg border px-3 py-2 text-sm"
            style={inputStyle}
          />
          <button type="submit" disabled={creating || !newName.trim()} className="rounded-full px-4 py-2 text-sm font-medium disabled:opacity-50" style={{ background: "var(--series-1)", color: "var(--background)" }}>
            {creating ? "Menambah…" : "+ Tambah"}
          </button>
        </form>

        {loading && !resources && <p style={{ color: "var(--text-secondary)" }}>Loading…</p>}

        {resources && (
          <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--gridline)" }}>
            <table className="w-full text-left text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--gridline)" }}>
                  <th className="px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>Nama ruang</th>
                </tr>
              </thead>
              <tbody>
                {resources.length === 0 && (
                  <tr>
                    <td className="px-4 py-8 text-center" style={{ color: "var(--text-muted)" }}>Belum ada ruang.</td>
                  </tr>
                )}
                {resources.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid var(--gridline)" }}>
                    <td className="px-4 py-3 font-semibold" style={{ color: "var(--text-primary)" }}>{r.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
