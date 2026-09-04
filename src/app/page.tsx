"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { Meter } from "@/components/Meter";
import type { OccupancySnapshot } from "@/lib/storeganise";

const REFRESH_INTERVAL_MS = 60_000;

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

export default function Home() {
  const { data: session } = useSession();
  const [snapshot, setSnapshot] = useState<OccupancySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/occupancy", { signal: controller.signal });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error ?? `Request failed with status ${res.status}`);
      }
      setSnapshot(body as OccupancySnapshot);
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to load occupancy data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch + poll, state settles asynchronously in `load`
    load();
    const id = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      clearInterval(id);
      abortRef.current?.abort();
    };
  }, [load]);

  return (
    <div className="min-h-screen px-6 py-10 sm:px-10">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image src="/spacehub-logo.webp" alt="SpaceHub" width={121} height={36} priority />
            <span
              className="hidden h-6 w-px sm:block"
              style={{ background: "var(--gridline)" }}
            />
            <h1
              className="hidden text-sm font-medium sm:block"
              style={{ color: "var(--text-secondary)" }}
            >
              Occupancy Rate
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

        {loading && !snapshot && (
          <p style={{ color: "var(--text-secondary)" }}>Loading occupancy data…</p>
        )}

        {snapshot && (
          <>
            <section
              className="mb-8 rounded-2xl border p-6"
              style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}
            >
              <p className="mb-1 text-sm" style={{ color: "var(--text-secondary)" }}>
                Overall occupancy
              </p>
              <p
                className="mb-4 text-5xl font-semibold"
                style={{ color: "var(--text-primary)" }}
              >
                {formatPct(snapshot.overall.occupancyRate)}
              </p>
              <Meter value={snapshot.overall.occupancyRate} />
              <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
                {snapshot.overall.occupiedUnits.toLocaleString()} of{" "}
                {snapshot.overall.totalUnits.toLocaleString()} units occupied
              </p>
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
                  By site
                </h2>
                <Link
                  href="/occupancy"
                  className="text-sm hover:underline"
                  style={{ color: "var(--series-1)" }}
                >
                  Lihat detail unit →
                </Link>
              </div>
              <div className="flex flex-col gap-3">
                {snapshot.sites.map((site) => (
                  <div
                    key={site.siteId}
                    className="rounded-xl border p-4"
                    style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}
                  >
                    <div className="mb-2 flex items-baseline justify-between gap-4">
                      <span
                        className="truncate font-medium"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {site.siteName}
                      </span>
                      <span
                        className="shrink-0 text-sm"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {formatPct(site.occupancyRate)}
                      </span>
                    </div>
                    <Meter value={site.occupancyRate} />
                    <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                      {site.occupiedUnits.toLocaleString()} occupied ·{" "}
                      {site.availableUnits.toLocaleString()} available ·{" "}
                      {site.reservedUnits.toLocaleString()} reserved ·{" "}
                      {site.blockedUnits.toLocaleString()} blocked
                    </p>
                  </div>
                ))}
                {snapshot.sites.length === 0 && (
                  <p style={{ color: "var(--text-secondary)" }}>No sites found.</p>
                )}
              </div>
            </section>

            <p className="mt-8 text-xs" style={{ color: "var(--text-muted)" }}>
              Last updated {new Date(snapshot.generatedAt).toLocaleTimeString()} · refreshes every{" "}
              {REFRESH_INTERVAL_MS / 1000}s
            </p>
          </>
        )}
      </div>
    </div>
  );
}
