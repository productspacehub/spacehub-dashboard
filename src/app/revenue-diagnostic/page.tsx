"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// TEMPORARY — see /api/revenue-diagnostic.

type Field = { path: string; type: string; value?: string };
type Result = {
  since: string;
  invoicesSince: number;
  requested: string[];
  notFound: string[];
  invoices: { sid: string; requested: boolean; invoice: Field[]; entries: Field[][] }[];
};

function Fields({ fields }: { fields: Field[] }) {
  return (
    <table className="w-full text-left font-mono text-xs">
      <tbody>
        {fields.map((f) => (
          <tr key={f.path} style={{ borderTop: "1px solid var(--gridline)" }}>
            <td className="py-1 pr-3" style={{ color: "var(--text-primary)" }}>
              {f.path}
            </td>
            <td className="py-1 pr-3" style={{ color: "var(--text-muted)" }}>
              {f.type}
            </td>
            <td className="py-1" style={{ color: "var(--series-1)" }}>
              {f.value ?? ""}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function RevenueDiagnosticPage() {
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/revenue-diagnostic${window.location.search}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? `Request failed with status ${res.status}`);
        setData(body as Result);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Gagal memuat"));
  }, []);

  return (
    <div className="min-h-screen px-6 py-10 sm:px-10">
      <div className="mx-auto max-w-4xl">
        <Link href="/" className="mb-6 inline-block text-sm hover:underline" style={{ color: "var(--series-1)" }}>
          ← Back to summary
        </Link>
        <h1 className="mb-1 text-lg font-semibold">Diagnostik invoice (sementara)</h1>
        <p className="mb-6 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
          Struktur data invoice dan barisnya dari Storeganise: nama field dan tipenya. Isi hanya ditampilkan untuk tanggal, jumlah,
          qty, dan status — tidak ada nama, email, atau deskripsi. Halaman ini akan dihapus setelah dipakai.
        </p>
        {error && <p style={{ color: "var(--status-critical)" }}>{error}</p>}
        {!data && !error && <p style={{ color: "var(--text-secondary)" }}>Memuat…</p>}
        {data && (
          <>
            <p className="mb-6 text-xs" style={{ color: "var(--text-secondary)" }}>
              {data.invoicesSince} invoice sejak {data.since}. Dicari: {data.requested.join(", ")}
              {data.notFound.length > 0 && <span style={{ color: "var(--status-warning)" }}> · tidak ketemu: {data.notFound.join(", ")}</span>}
            </p>
            {data.invoices.map((inv) => (
              <section key={inv.sid} className="mb-8 rounded-2xl border p-5" style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}>
                <p className="mb-3 text-sm font-semibold">
                  Invoice #{inv.sid} {inv.requested ? "(contoh dari Anda)" : "(invoice paid terbaru)"}
                </p>
                <Fields fields={inv.invoice} />
                {inv.entries.map((e, i) => (
                  <div key={i} className="mt-4">
                    <p className="mb-1 text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                      Baris {i + 1}
                    </p>
                    <Fields fields={e} />
                  </div>
                ))}
              </section>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
