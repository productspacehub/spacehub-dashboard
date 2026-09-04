"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { Meter } from "@/components/Meter";
import type { StatusBreakdown, UnitsDetail } from "@/lib/storeganise";

type TabState = StatusBreakdown["state"];

const STATUS_LABELS: Record<TabState, string> = {
  available: "Available",
  occupied: "Occupied",
  reserved: "Reserved",
  blocked: "Blocked",
};

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

export default function OccupancyDetailPage() {
  const { data: session } = useSession();
  const [detail, setDetail] = useState<UnitsDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedState, setSelectedState] = useState<TabState>("occupied");
  const [selectedSite, setSelectedSite] = useState<string>("all");
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/occupancy/units", { signal: controller.signal });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error ?? `Request failed with status ${res.status}`);
      }
      setDetail(body as UnitsDetail);
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to load unit data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch, state settles asynchronously in `load`
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  const sites = useMemo(() => {
    if (!detail) return [];
    const map = new Map<string, string>();
    for (const unit of detail.units) map.set(unit.siteId, unit.siteName);
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [detail]);

  const tabCounts = useMemo(() => {
    if (!detail) return null;
    const counts: Partial<Record<TabState, number>> = {};
    for (const b of detail.breakdown) counts[b.state] = b.count;
    return counts;
  }, [detail]);

  const filteredUnits = useMemo(() => {
    if (!detail) return [];
    return detail.units.filter(
      (u) => u.state === selectedState && (selectedSite === "all" || u.siteId === selectedSite)
    );
  }, [detail, selectedState, selectedSite]);

  const showEmailColumn = selectedState === "occupied";
  const showReasonColumn = selectedState === "blocked";
  const showContactColumns = selectedState === "reserved";
  const columnCount =
    2 + (showEmailColumn ? 4 : showReasonColumn ? 1 : showContactColumns ? 3 : 0);

  return (
    <div className="min-h-screen px-6 py-10 sm:px-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image src="/spacehub-logo.webp" alt="SpaceHub" width={121} height={36} priority />
            <span className="hidden h-6 w-px sm:block" style={{ background: "var(--gridline)" }} />
            <h1 className="hidden text-sm font-medium sm:block" style={{ color: "var(--text-secondary)" }}>
              Occupancy Detail
            </h1>
          </div>
          <div className="flex items-baseline gap-4">
            <button
              onClick={load}
              className="text-sm hover:underline"
              style={{ color: "var(--text-secondary)" }}
            >
              Refresh now
            </button>
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

        <Link
          href="/"
          className="mb-6 inline-block text-sm hover:underline"
          style={{ color: "var(--series-1)" }}
        >
          ← Back to summary
        </Link>

        {error && (
          <div
            className="mb-6 rounded-lg border px-4 py-3 text-sm"
            style={{
              borderColor: "var(--status-critical)",
              color: "var(--status-critical)",
              background: "var(--surface-1)",
            }}
          >
            {error}
          </div>
        )}

        {loading && !detail && (
          <p style={{ color: "var(--text-secondary)" }}>Loading unit data…</p>
        )}

        {detail && tabCounts && (
          <>
            <section
              className="mb-8 rounded-2xl border p-6"
              style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}
            >
              <p className="mb-4 text-sm" style={{ color: "var(--text-secondary)" }}>
                Status breakdown — {detail.totalUnits.toLocaleString()} units
                {detail.archivedUnits > 0 &&
                  ` (excludes ${detail.archivedUnits.toLocaleString()} archived)`}
              </p>
              <div className="flex flex-col gap-4">
                {detail.breakdown.map((b) => (
                  <div key={b.state}>
                    <div className="mb-1 flex items-baseline justify-between gap-4">
                      <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                        {STATUS_LABELS[b.state]}
                      </span>
                      <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                        {formatPct(b.percentage)} · {b.count.toLocaleString()} units
                      </span>
                    </div>
                    <Meter value={b.percentage} />
                  </div>
                ))}
              </div>
            </section>

            <section>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(STATUS_LABELS) as TabState[]).map((state) => {
                    const active = state === selectedState;
                    return (
                      <button
                        key={state}
                        onClick={() => setSelectedState(state)}
                        className="rounded-full px-3 py-1.5 text-sm font-medium"
                        style={{
                          background: active ? "var(--series-1)" : "transparent",
                          color: active ? "var(--background)" : "var(--text-secondary)",
                          border: active ? "none" : "1px solid var(--gridline)",
                        }}
                      >
                        {STATUS_LABELS[state]} ({(tabCounts[state] ?? 0).toLocaleString()})
                      </button>
                    );
                  })}
                </div>

                <select
                  value={selectedSite}
                  onChange={(e) => setSelectedSite(e.target.value)}
                  className="rounded-lg border px-3 py-1.5 text-sm"
                  style={{
                    background: "var(--surface-1)",
                    borderColor: "var(--gridline)",
                    color: "var(--text-primary)",
                  }}
                >
                  <option value="all">All sites</option>
                  {sites.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>

              <div
                className="overflow-x-auto rounded-xl border"
                style={{ borderColor: "var(--gridline)", background: "var(--surface-1)" }}
              >
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--gridline)" }}>
                      <th className="px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>
                        Site
                      </th>
                      <th className="px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>
                        Unit
                      </th>
                      {showEmailColumn && (
                        <>
                          <th className="px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>
                            Customer email
                          </th>
                          <th className="px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>
                            Invoice #
                          </th>
                          <th className="px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>
                            Invoice status
                          </th>
                          <th className="px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>
                            Paid on
                          </th>
                        </>
                      )}
                      {showReasonColumn && (
                        <th className="px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>
                          Blocked reason
                        </th>
                      )}
                      {showContactColumns && (
                        <>
                          <th className="px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>
                            Customer name
                          </th>
                          <th className="px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>
                            Phone
                          </th>
                          <th className="px-4 py-3 font-medium" style={{ color: "var(--text-secondary)" }}>
                            Email
                          </th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUnits.map((unit) => (
                      <tr key={unit.id} style={{ borderBottom: "1px solid var(--gridline)" }}>
                        <td className="px-4 py-2" style={{ color: "var(--text-primary)" }}>
                          {unit.siteName}
                        </td>
                        <td className="px-4 py-2" style={{ color: "var(--text-primary)" }}>
                          {unit.name}
                        </td>
                        {showEmailColumn && (
                          <>
                            <td className="px-4 py-2" style={{ color: "var(--text-secondary)" }}>
                              {unit.ownerEmail ?? "—"}
                            </td>
                            <td className="px-4 py-2" style={{ color: "var(--text-secondary)" }}>
                              {unit.latestInvoice?.number ?? "—"}
                            </td>
                            <td className="px-4 py-2" style={{ color: "var(--text-secondary)" }}>
                              {unit.latestInvoice?.state ?? "—"}
                            </td>
                            <td className="px-4 py-2" style={{ color: "var(--text-secondary)" }}>
                              {unit.latestInvoice?.paidAt
                                ? new Date(unit.latestInvoice.paidAt).toLocaleDateString()
                                : "—"}
                            </td>
                          </>
                        )}
                        {showReasonColumn && (
                          <td className="px-4 py-2" style={{ color: "var(--text-secondary)" }}>
                            {unit.blockedReason ?? "—"}
                          </td>
                        )}
                        {showContactColumns && (
                          <>
                            <td className="px-4 py-2" style={{ color: "var(--text-secondary)" }}>
                              {unit.ownerName ?? "—"}
                            </td>
                            <td className="px-4 py-2" style={{ color: "var(--text-secondary)" }}>
                              {unit.ownerPhone ?? "—"}
                            </td>
                            <td className="px-4 py-2" style={{ color: "var(--text-secondary)" }}>
                              {unit.ownerEmail ?? "—"}
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                    {filteredUnits.length === 0 && (
                      <tr>
                        <td
                          colSpan={columnCount}
                          className="px-4 py-6 text-center"
                          style={{ color: "var(--text-muted)" }}
                        >
                          No units in this status.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <p className="mt-8 text-xs" style={{ color: "var(--text-muted)" }}>
              Last updated {new Date(detail.generatedAt).toLocaleTimeString()}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
