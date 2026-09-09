"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { signOut, useSession } from "next-auth/react";
import { Meter } from "@/components/Meter";
import { DeltaBadge } from "@/components/DeltaBadge";
import { ModuleCard } from "@/components/ModuleCard";
import { CASHIN_CATEGORY_COLORS, CASHIN_CATEGORY_ORDER, formatIdr } from "@/components/CashinDailyChart";
import type { OccupancySnapshotWithDelta } from "@/lib/snapshots";
import type { CashinResponse } from "@/app/api/cashin/route";

const REFRESH_INTERVAL_MS = 60_000;

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function useAutoRefresh<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(url, { signal: controller.signal });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error ?? `Request failed with status ${res.status}`);
      }
      setData(body as T);
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch + poll, state settles asynchronously in `load`
    load();
    const id = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [load]);

  return { data, error, loading, reload: load };
}

export default function Home() {
  const { data: session } = useSession();
  const occupancy = useAutoRefresh<OccupancySnapshotWithDelta>("/api/occupancy");
  const cashin = useAutoRefresh<CashinResponse>("/api/cashin");

  return (
    <div className="min-h-screen px-6 py-10 sm:px-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image src="/spacehub-logo.webp" alt="SpaceHub" width={121} height={36} priority />
            <span className="hidden h-6 w-px sm:block" style={{ background: "var(--gridline)" }} />
            <h1 className="hidden text-sm font-medium sm:block" style={{ color: "var(--text-secondary)" }}>
              Dashboard
            </h1>
          </div>
          <div className="flex items-baseline gap-4">
            <button
              onClick={() => {
                occupancy.reload();
                cashin.reload();
              }}
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

        <p className="mb-3 text-xs tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
          Ringkasan modul
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ModuleCard label="Occupancy" dotColor="var(--series-1)" href="/occupancy">
            {occupancy.error && (
              <p className="text-xs" style={{ color: "var(--status-critical)" }}>
                {occupancy.error}
              </p>
            )}
            {occupancy.loading && !occupancy.data && (
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                Loading…
              </p>
            )}
            {occupancy.data && (
              <>
                <div className="flex flex-wrap items-baseline gap-2">
                  <p className="text-4xl font-bold" style={{ color: "var(--text-primary)" }}>
                    {formatPct(occupancy.data.overall.occupancyRate)}
                  </p>
                  <DeltaBadge
                    value={occupancy.data.overall.occupiedDeltaVsYesterday}
                    label="unit vs kemarin"
                  />
                </div>
                <Meter value={occupancy.data.overall.occupancyRate} />
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {occupancy.data.overall.occupiedUnits.toLocaleString()} dari{" "}
                  {occupancy.data.overall.totalUnits.toLocaleString()} unit occupied ·{" "}
                  {occupancy.data.sites.length} site
                </p>
              </>
            )}
          </ModuleCard>

          <ModuleCard label="Cash-in" dotColor={CASHIN_CATEGORY_COLORS.newRent} href="/cash-in">
            {cashin.error && (
              <p className="text-xs" style={{ color: "var(--status-critical)" }}>
                {cashin.error}
              </p>
            )}
            {cashin.loading && !cashin.data && (
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                Loading…
              </p>
            )}
            {cashin.data && (
              <>
                <div className="flex flex-wrap items-baseline gap-2">
                  <p className="text-3xl font-bold" style={{ color: "var(--text-primary)" }}>
                    {formatIdr(cashin.data.total)}
                  </p>
                  <DeltaBadge
                    value={cashin.data.comparison.deltaPct}
                    format="percent"
                    label="vs pace bulan lalu"
                  />
                </div>
                <div
                  className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full"
                  style={{ background: "var(--background)" }}
                >
                  {CASHIN_CATEGORY_ORDER.filter((c) => cashin.data!.totals[c] > 0).map((category) => (
                    <div
                      key={category}
                      style={{
                        width: `${(cashin.data!.totals[category] / (cashin.data!.total || 1)) * 100}%`,
                        background: CASHIN_CATEGORY_COLORS[category],
                      }}
                    />
                  ))}
                </div>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  Bulan berjalan · {cashin.data.bySite.length} site
                </p>
              </>
            )}
          </ModuleCard>
        </div>

        {occupancy.data && (
          <p className="mt-8 text-xs" style={{ color: "var(--text-muted)" }}>
            Last updated {new Date(occupancy.data.generatedAt).toLocaleTimeString()} · refreshes every{" "}
            {REFRESH_INTERVAL_MS / 1000}s
          </p>
        )}
      </div>
    </div>
  );
}
