"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import type { IdCheckDiagnostics, IdCheckReport, IdCheckTenant } from "@/lib/idCheck";
import { Meter } from "@/components/Meter";

function pct(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}

function TenantTable({ tenants }: { tenants: IdCheckTenant[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--gridline)" }}>
      <table className="w-full text-left text-sm">
        <thead>
          <tr style={{ borderBottom: "1px solid var(--gridline)" }}>
            {["Nama", "Site", "Unit", "Telepon", "Email"].map((h) => (
              <th key={h} className="px-4 py-3 font-medium whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tenants.map((t) => (
            <tr key={t.ownerId} style={{ borderBottom: "1px solid var(--gridline)" }}>
              <td className="px-4 py-2 font-semibold" style={{ color: "var(--text-primary)" }}>
                {t.name}
              </td>
              <td className="px-4 py-2" style={{ color: "var(--text-secondary)" }}>
                {t.siteNames.join(", ")}
              </td>
              <td className="px-4 py-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                {t.unitNames.join(", ")}
              </td>
              <td className="px-4 py-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                {t.phone ?? "–"}
              </td>
              <td className="px-4 py-2" style={{ color: "var(--text-secondary)" }}>
                {t.email ?? "–"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DiagnosticsPanel({
  diagnostics: d,
  defaultOpen = false,
  className,
}: {
  diagnostics: IdCheckDiagnostics;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <details
      open={defaultOpen}
      className={`rounded-2xl border p-6 text-xs ${className ?? ""}`}
      style={{ background: "var(--surface-1)", borderColor: "var(--gridline)", color: "var(--text-muted)" }}
    >
      <summary className="cursor-pointer text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        Detail teknis (untuk debugging)
      </summary>
      <p className="mt-3 leading-relaxed">
        Hanya nama key dan tipe isinya — tidak ada nilai/isi field yang ditampilkan. Key yang dipakai sebagai KTP/paspor:{" "}
        <b style={{ color: "var(--text-secondary)" }}>{d.matchedKeys.length > 0 ? d.matchedKeys.join(", ") : "tidak ditemukan"}</b>.
      </p>
      <p className="mt-2 leading-relaxed">
        Dari <code>include=owner</code>: {d.includeOwnersWithCustomFields} dari {d.ownersFromInclude} owner membawa{" "}
        <code>customFields</code>. Profil user lengkap diambil untuk {d.usersFetched} tenant, {d.fetchedUsersWithCustomFields}{" "}
        di antaranya punya <code>customFields</code>.
      </p>
      {d.customFieldKeys.length === 0 ? (
        <p className="mt-2">Tidak ada satu pun key customFields yang terbaca dari API.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-xl border" style={{ borderColor: "var(--gridline)" }}>
          <table className="w-full text-left">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--gridline)" }}>
                {["Sumber", "Key", "Muncul di", "Terisi", "Tipe isi"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.customFieldKeys.map((k) => (
                <tr key={`${k.source}:${k.key}`} style={{ borderBottom: "1px solid var(--gridline)" }}>
                  <td className="px-3 py-1.5 whitespace-nowrap">{k.source === "include" ? "include=owner" : "profil user"}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <code>{k.key}</code>
                  </td>
                  <td className="px-3 py-1.5">{k.records}</td>
                  <td className="px-3 py-1.5">{k.nonEmpty}</td>
                  <td className="px-3 py-1.5">
                    <code>{k.shapes.join(" | ")}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

export default function IdCheckPage() {
  const { data: session } = useSession();
  const [data, setData] = useState<IdCheckReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    try {
      const res = await fetch("/api/id-check", { signal: controller.signal });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Request failed with status ${res.status}`);
      setData(body as IdCheckReport);
      setError(null);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to load ID check data");
    } finally {
      if (abortRef.current === controller) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount, state settles asynchronously in `load`
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  // Zero IDs found across every active tenant is far more likely to mean the
  // field isn't coming back from the API than a genuine 0% — flag it instead
  // of presenting it as a real follow-up list.
  const suspiciousZero = data !== null && data.totalTenants > 0 && data.withId === 0;

  return (
    <div className="min-h-screen px-6 py-10 sm:px-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image src="/spacehub-logo.webp" alt="SpaceHub" width={121} height={36} priority />
            <span className="hidden h-6 w-px sm:block" style={{ background: "var(--gridline)" }} />
            <h1 className="hidden text-sm font-medium sm:block" style={{ color: "var(--text-secondary)" }}>
              Kelengkapan ID Tenant
            </h1>
          </div>
          <div className="flex items-baseline gap-4">
            <button onClick={() => load()} className="text-sm hover:underline" style={{ color: "var(--text-secondary)" }}>
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

        <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link href="/occupancy" className="text-sm hover:underline" style={{ color: "var(--series-1)" }}>
            ← Back to occupancy
          </Link>
          {loading && data && (
            <span className="inline-flex items-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
              <span
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current"
                style={{ borderTopColor: "transparent", color: "var(--series-1)" }}
              />
              Memuat…
            </span>
          )}
        </div>

        {error && (
          <div
            className="mb-6 rounded-lg border px-4 py-3 text-sm"
            style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)", background: "var(--surface-1)" }}
          >
            {error}
          </div>
        )}

        {loading && !data && <p style={{ color: "var(--text-secondary)" }}>Loading tenant ID data…</p>}

        {data && (
          <div style={{ opacity: loading ? 0.5 : 1, transition: "opacity 150ms ease", pointerEvents: loading ? "none" : "auto" }}>
            {suspiciousZero && (
              <div
                className="mb-6 rounded-lg border p-3 text-xs leading-relaxed"
                style={{ borderColor: "var(--status-warning)", background: "rgba(250, 183, 18, 0.08)", color: "var(--text-secondary)" }}
              >
                <b style={{ color: "var(--status-warning)" }}>Cek dulu sebelum menindaklanjuti:</b> tidak ada satu pun
                tenant aktif yang terdeteksi punya KTP/paspor. Kemungkinan besar field <code>passport-ktp</code> tidak
                terbaca dari API Storeganise, bukan berarti semua tenant benar-benar belum upload. &quot;Detail
                teknis&quot; tepat di bawah kotak ini menunjukkan field apa saja yang sebenarnya terbaca.
              </div>
            )}
            {suspiciousZero && <DiagnosticsPanel diagnostics={data.diagnostics} defaultOpen className="mb-8" />}

            <section className="mb-8 rounded-2xl border p-6" style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}>
              <p className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Tenant aktif yang sudah upload KTP/paspor
              </p>
              <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
                Kondisi saat ini · tenant dengan minimal 1 unit occupied
              </p>
              <div className="mb-3 flex flex-col items-start gap-1">
                <p className="text-4xl font-bold" style={{ color: "var(--text-primary)" }}>
                  {pct(data.withId, data.totalTenants).toFixed(1)}%
                </p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {data.withId} dari {data.totalTenants} tenant
                </p>
              </div>
              <Meter value={pct(data.withId, data.totalTenants)} />
              <div className="mt-5 grid grid-cols-3 gap-5">
                <div>
                  <p className="mb-1 text-[11px] font-bold tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
                    Sudah ada
                  </p>
                  <p className="text-2xl font-bold" style={{ color: "var(--status-good)" }}>
                    {data.withId}
                  </p>
                </div>
                <div>
                  <p className="mb-1 text-[11px] font-bold tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
                    Belum ada
                  </p>
                  <p className="text-2xl font-bold" style={{ color: data.withoutId > 0 ? "var(--status-critical)" : "var(--text-primary)" }}>
                    {data.withoutId}
                  </p>
                </div>
                <div>
                  <p className="mb-1 text-[11px] font-bold tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
                    Tidak bisa dicek
                  </p>
                  <p className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
                    {data.unknown}
                  </p>
                </div>
              </div>
            </section>

            <section className="mb-8 rounded-2xl border p-6" style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}>
              <p className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Per site
              </p>
              <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
                Tenant yang menyewa di beberapa site dihitung di tiap site tsb
              </p>
              <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--gridline)" }}>
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--gridline)" }}>
                      {["Site", "Tenant aktif", "Sudah ada", "Belum ada", "Lengkap"].map((h, i) => (
                        <th
                          key={h}
                          className={`px-4 py-3 font-medium whitespace-nowrap ${i > 0 ? "text-right" : ""}`}
                          style={{ color: "var(--text-secondary)" }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.bySite.map((s) => (
                      <tr key={s.siteId} style={{ borderBottom: "1px solid var(--gridline)" }}>
                        <td className="px-4 py-2 font-semibold" style={{ color: "var(--text-primary)" }}>
                          {s.siteName}
                        </td>
                        <td className="px-4 py-2 text-right" style={{ color: "var(--text-secondary)" }}>
                          {s.totalTenants}
                        </td>
                        <td className="px-4 py-2 text-right" style={{ color: "var(--text-secondary)" }}>
                          {s.withId}
                        </td>
                        <td className="px-4 py-2 text-right" style={{ color: "var(--text-secondary)" }}>
                          {s.withoutId}
                        </td>
                        <td className="px-4 py-2 text-right font-semibold" style={{ color: "var(--text-primary)" }}>
                          {pct(s.withId, s.totalTenants).toFixed(0)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="mb-8 rounded-2xl border p-6" style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}>
              <p className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Tenant yang belum upload KTP/paspor ({data.tenantsWithoutId.length})
              </p>
              <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
                Untuk ditindaklanjuti — tenant yang sudah punya ID tidak ditampilkan
              </p>
              {data.tenantsWithoutId.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  Semua tenant aktif sudah upload KTP/paspor.
                </p>
              ) : (
                <TenantTable tenants={data.tenantsWithoutId} />
              )}
            </section>

            {data.tenantsUnknown.length > 0 && (
              <section className="mb-8 rounded-2xl border p-6" style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}>
                <p className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  Tidak bisa dicek ({data.tenantsUnknown.length})
                </p>
                <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
                  Data user-nya gagal diambil dari Storeganise saat halaman ini dimuat — coba Refresh now
                </p>
                <TenantTable tenants={data.tenantsUnknown} />
              </section>
            )}

            <section className="rounded-2xl border p-6" style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}>
              <p className="mb-3 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Bagaimana angka ini dihitung
              </p>
              <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                <b style={{ color: "var(--text-secondary)" }}>Tenant aktif</b>: pemilik unit rental berstatus{" "}
                <code>occupied</code> di Storeganise, dihitung sekali per orang walau menyewa beberapa unit.
                <br />
                <b style={{ color: "var(--text-secondary)" }}>Sudah ada</b>: custom field <code>passport-ktp</code> di
                profil user tsb berisi lampiran. Halaman ini hanya mengecek ada/tidaknya lampiran — isi file
                KTP/paspor tidak pernah dibuka, dibaca, atau dikirim ke browser.
                <br />
                <b style={{ color: "var(--text-secondary)" }}>Tidak bisa dicek</b>: data user-nya gagal diambil dari
                Storeganise, jadi tidak dihitung sebagai &quot;belum ada&quot;.
              </p>
            </section>

            {!suspiciousZero && <DiagnosticsPanel diagnostics={data.diagnostics} className="mt-8" />}

            <p className="mt-8 text-xs" style={{ color: "var(--text-muted)" }}>
              Last updated {new Date(data.generatedAt).toLocaleTimeString()}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
