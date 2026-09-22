"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import type { BookingCounts, BookingListItem } from "@/lib/bookings";
import { BOOKING_STATUSES, type BookingStatus } from "@/lib/bookingConstants";

type BookingsResponse = { bookings: BookingListItem[]; counts: BookingCounts };

function formatIdr(value: number): string {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "–";
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

const STATUS_COLORS: Record<BookingStatus, string> = {
  "Pending Payment": "var(--status-warning)",
  Confirmed: "var(--series-1)",
  Active: "var(--status-good)",
  Completed: "var(--text-muted)",
  Cancelled: "var(--status-critical)",
  "No-Show": "var(--status-critical)",
};

function StatusBadge({ status }: { status: BookingStatus }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap"
      style={{ background: "var(--background)", color: STATUS_COLORS[status] }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLORS[status] }} />
      {status}
    </span>
  );
}

function OverdueBadge() {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap"
      style={{ background: "var(--status-critical)", color: "var(--background)" }}
    >
      Overdue
    </span>
  );
}

export default function BookingsPage() {
  const { data: session } = useSession();
  const [data, setData] = useState<BookingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<BookingStatus | "all">("all");
  const [q, setQ] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (statusValue: BookingStatus | "all", qValue: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    try {
      const params = new URLSearchParams();
      if (statusValue !== "all") params.set("status", statusValue);
      if (qValue.trim()) params.set("q", qValue.trim());
      const res = await fetch(`/api/bookings?${params.toString()}`, { signal: controller.signal });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Request failed with status ${res.status}`);
      setData(body as BookingsResponse);
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to load bookings");
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => load(status, q), q ? 300 : 0);
    return () => clearTimeout(id);
  }, [load, status, q]);

  const totalCount = data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="min-h-screen px-6 py-10 sm:px-10">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image src="/spacehub-logo.webp" alt="SpaceHub" width={121} height={36} priority />
            <span className="hidden h-6 w-px sm:block" style={{ background: "var(--gridline)" }} />
            <h1 className="hidden text-sm font-medium sm:block" style={{ color: "var(--text-secondary)" }}>
              Bookings — Shared Storage
            </h1>
          </div>
          <div className="flex items-baseline gap-4">
            <Link href="/bookings/containers" className="text-sm hover:underline" style={{ color: "var(--text-secondary)" }}>
              Container
            </Link>
            <Link href="/bookings/rates" className="text-sm hover:underline" style={{ color: "var(--text-secondary)" }}>
              Harga
            </Link>
            {session?.user?.email && (
              <span className="hidden text-sm sm:inline" style={{ color: "var(--text-muted)" }}>
                {session.user.email}
              </span>
            )}
            <button
              onClick={() => signOut({ redirectTo: "/login" })}
              className="text-sm hover:underline"
              style={{ color: "var(--text-secondary)" }}
            >
              Sign out
            </button>
          </div>
        </header>

        <Link href="/" className="mb-6 inline-block text-sm hover:underline" style={{ color: "var(--series-1)" }}>
          ← Back to summary
        </Link>

        <div className="mb-6 flex items-center justify-between gap-4">
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {totalCount} booking total
          </p>
          <Link
            href="/bookings/new"
            className="rounded-full px-4 py-2 text-sm font-medium"
            style={{ background: "var(--series-1)", color: "var(--background)" }}
          >
            + Booking baru
          </Link>
        </div>

        {error && (
          <div
            className="mb-6 rounded-lg border px-4 py-3 text-sm"
            style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)", background: "var(--surface-1)" }}
          >
            {error}
          </div>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setStatus("all")}
            className="rounded-full px-3 py-1.5 text-sm font-medium"
            style={{
              background: status === "all" ? "var(--series-1)" : "transparent",
              color: status === "all" ? "var(--background)" : "var(--text-secondary)",
              border: status === "all" ? "none" : "1px solid var(--gridline)",
            }}
          >
            Semua
          </button>
          {BOOKING_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className="rounded-full px-3 py-1.5 text-sm font-medium"
              style={{
                background: status === s ? "var(--series-1)" : "transparent",
                color: status === s ? "var(--background)" : "var(--text-secondary)",
                border: status === s ? "none" : "1px solid var(--gridline)",
              }}
            >
              {s}
              {data && data.counts[s] > 0 ? ` (${data.counts[s]})` : ""}
            </button>
          ))}
        </div>

        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cari nama atau nomor telepon customer…"
          className="mb-6 w-full rounded-lg border px-4 py-2 text-sm"
          style={{ background: "var(--surface-1)", borderColor: "var(--gridline)", color: "var(--text-primary)" }}
        />

        {loading && !data && <p style={{ color: "var(--text-secondary)" }}>Loading…</p>}

        {data && (
          <div style={{ opacity: loading ? 0.5 : 1, transition: "opacity 150ms ease" }}>
            <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--gridline)" }}>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--gridline)" }}>
                    <th className="px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>Customer</th>
                    <th className="px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>Package</th>
                    <th className="px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>Mulai</th>
                    <th className="px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>Selesai</th>
                    <th className="px-4 py-3 text-right font-medium" style={{ color: "var(--text-secondary)" }}>Harga</th>
                    <th className="px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>Pembayaran</th>
                    <th className="px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>Status</th>
                    <th className="px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>Container</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bookings.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center" style={{ color: "var(--text-muted)" }}>
                        Belum ada booking.
                      </td>
                    </tr>
                  )}
                  {data.bookings.map((b) => (
                    <tr key={b.id} style={{ borderBottom: "1px solid var(--gridline)" }}>
                      <td className="px-4 py-3">
                        <Link href={`/bookings/${b.id}`} className="hover:underline" style={{ color: "var(--text-primary)" }}>
                          <span className="font-semibold">{b.customerName}</span>
                        </Link>
                        <p className="text-xs" style={{ color: "var(--text-muted)" }}>{b.customerPhone}</p>
                      </td>
                      <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>{b.packageType}</td>
                      <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>{formatDate(b.startDate)}</td>
                      <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>{formatDate(b.endDate)}</td>
                      <td className="px-4 py-3 text-right font-medium" style={{ color: "var(--text-primary)" }}>{formatIdr(b.price)}</td>
                      <td className="px-4 py-3">
                        <span
                          className="text-xs font-medium"
                          style={{ color: b.paymentStatus === "Paid" ? "var(--status-good)" : "var(--status-warning)" }}
                        >
                          {b.paymentStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={b.status} />
                          {b.isOverdue && <OverdueBadge />}
                        </div>
                      </td>
                      <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>{b.containerLabel ?? "–"}</td>
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
