"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import AddressImportPanel from "@/components/AddressImportPanel";
import type { MappingOverview, QueueItem, RegionOption, TargetKind } from "@/lib/addressMapping";
import { normalize } from "@/lib/normalize";

type Filter = "all" | "unrecognized" | "province" | "ambiguous" | "foreign";
type Selected = { kind: TargetKind; code: string | null; label: string };

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Semua" },
  { key: "unrecognized", label: "Tidak dikenali" },
  { key: "province", label: "Hanya provinsi" },
  { key: "ambiguous", label: "Kota/kab. ambigu" },
  { key: "foreign", label: "Luar negeri" },
];

const card = { background: "var(--surface-1)", borderColor: "var(--gridline)" };
const inputStyle = { background: "var(--background)", border: "1px solid var(--gridline)", color: "var(--text-primary)" };

function filterOf(item: QueueItem): Filter {
  if (item.ambiguous) return "ambiguous";
  return item.autoLevel === "province" || item.autoLevel === "foreign" ? item.autoLevel : "unrecognized";
}

async function send(url: string, method: "POST" | "DELETE", body?: unknown): Promise<void> {
  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `Request failed with status ${res.status}`);
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="rounded-full px-3 py-1.5 text-sm font-medium"
      style={{
        background: active ? "var(--series-1)" : "transparent",
        color: active ? "var(--background)" : "var(--text-secondary)",
        border: active ? "none" : "1px solid var(--gridline)",
      }}
    >
      {children}
    </button>
  );
}

function MappingForm({
  item,
  queue,
  rules,
  onDone,
  onCancel,
}: {
  item: QueueItem;
  queue: QueueItem[];
  rules: MappingOverview["rules"];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RegionOption[]>([]);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [phrase, setPhrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (normalize(query).length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing results when the query gets too short
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/address-mapping/regions?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        const body = await res.json();
        if (res.ok) setResults(body.results as RegionOption[]);
      } catch {
        // superseded by a newer query, or offline — the list just stays as is
      }
    }, 250);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query]);

  const normalizedPhrase = normalize(phrase);
  const ruleAllowed = selected !== null && selected.kind !== "unmappable";
  // The server refuses to repoint an existing rule; say so before saving.
  const existingRule = ruleAllowed && normalizedPhrase ? rules.find((r) => r.phrase === normalizedPhrase) : undefined;
  // Upper bound: the server also refuses to apply a rule where it would
  // contradict a city/province the address already names.
  const preview = useMemo(() => {
    if (normalizedPhrase.length < 4) return null;
    const others = queue.filter((q) => q.hash !== item.hash && ` ${normalize(q.text)} `.includes(` ${normalizedPhrase} `));
    return { others, people: others.reduce((s, q) => s + q.people, 0) };
  }, [normalizedPhrase, queue, item.hash]);

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      if (ruleAllowed && normalizedPhrase) {
        await send("/api/address-mapping/rules", "POST", { phrase, kind: selected.kind, code: selected.code });
      }
      await send("/api/address-mapping/overrides", "POST", { hash: item.hash, kind: selected.kind, code: selected.code });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan");
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border p-4" style={{ borderColor: "var(--gridline)", background: "var(--background)" }}>
      <p className="mb-2 text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
        Alamat ini berada di…
      </p>
      {selected ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full px-3 py-1 font-medium" style={{ background: "rgba(25, 185, 234, 0.16)", color: "var(--series-1)" }}>
            {selected.label}
          </span>
          <button onClick={() => setSelected(null)} className="text-xs hover:underline" style={{ color: "var(--text-muted)" }}>
            ganti
          </button>
        </div>
      ) : (
        <>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari kecamatan, kota/kabupaten, atau provinsi…"
            className="w-full rounded-lg px-3 py-2 text-sm"
            style={inputStyle}
          />
          {results.length > 0 && (
            <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border" style={{ borderColor: "var(--gridline)" }}>
              {results.map((r) => (
                <button
                  key={`${r.kind}-${r.code}`}
                  onClick={() => setSelected({ kind: r.kind, code: r.code, label: `${r.label} — ${r.sublabel}` })}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-white/5"
                  style={{ borderBottom: "1px solid var(--gridline)", color: "var(--text-primary)" }}
                >
                  {r.label}
                  <span className="ml-2 text-xs" style={{ color: "var(--text-muted)" }}>
                    {r.sublabel}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span style={{ color: "var(--text-muted)" }}>atau:</span>
            <button onClick={() => setSelected({ kind: "foreign", code: null, label: "Luar negeri" })} className="hover:underline" style={{ color: "var(--series-1)" }}>
              Luar negeri
            </button>
            <button
              onClick={() => setSelected({ kind: "unmappable", code: null, label: "Tidak bisa dipetakan" })}
              className="hover:underline"
              style={{ color: "var(--series-1)" }}
            >
              Tidak bisa dipetakan (keluarkan dari antrean)
            </button>
          </div>
        </>
      )}

      {ruleAllowed && (
        <div className="mt-4">
          <label className="mb-1 block text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
            Opsional — terapkan juga ke alamat lain yang memuat frasa:
          </label>
          <input
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder="mis. nama apartemen/gedung/perumahan"
            className="w-full rounded-lg px-3 py-2 text-sm"
            style={inputStyle}
          />
          {existingRule && (
            <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--status-warning)" }}>
              Frasa ini sudah punya aturan → {existingRule.label} (dipakai {existingRule.addresses} alamat). Kosongkan frasa untuk
              hanya memetakan alamat ini, atau hapus aturan itu dulu di bagian &quot;Aturan&quot; kalau ingin menggantinya.
            </p>
          )}
          {preview && !existingRule && (
            <div className="mt-2 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
              Berlaku untuk maksimal {preview.others.length} alamat lain di antrean ({preview.people} orang), dan alamat baru
              yang memuat &quot;{normalizedPhrase}&quot;.
              {preview.others.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {preview.others.slice(0, 5).map((o) => (
                    <li key={o.hash}>{o.text}</li>
                  ))}
                  {preview.others.length > 5 && <li>…dan {preview.others.length - 5} lainnya</li>}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 text-xs" style={{ color: "var(--status-critical)" }}>
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button
          disabled={!selected || saving || !!existingRule}
          onClick={save}
          className="rounded-full px-4 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ background: "var(--series-1)", color: "var(--background)" }}
        >
          {saving ? "Menyimpan…" : "Simpan"}
        </button>
        <button onClick={onCancel} className="rounded-full px-4 py-1.5 text-sm" style={{ border: "1px solid var(--gridline)", color: "var(--text-secondary)" }}>
          Batal
        </button>
      </div>
    </div>
  );
}

export default function AddressMappingPage() {
  const { data: session } = useSession();
  const [data, setData] = useState<MappingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [openHash, setOpenHash] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/address-mapping");
      const body = await res.json();
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!res.ok) throw new Error(body?.error ?? `Request failed with status ${res.status}`);
      setData(body as MappingOverview);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat data pemetaan");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount, state settles asynchronously in `load`
    load();
  }, [load]);

  const remove = async (key: string, url: string) => {
    setBusy(key);
    try {
      await send(url, "DELETE");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus");
    } finally {
      setBusy(null);
    }
  };

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: 0, unrecognized: 0, province: 0, ambiguous: 0, foreign: 0 };
    for (const q of data?.queue ?? []) {
      c.all += 1;
      c[filterOf(q)] += 1;
    }
    return c;
  }, [data]);

  const normalizedSearch = normalize(search);
  const visible = (data?.queue ?? []).filter(
    (q) =>
      (filter === "all" || filterOf(q) === filter) &&
      (!activeOnly || q.active > 0) &&
      (!normalizedSearch || normalize(q.text).includes(normalizedSearch))
  );
  const queuePeople = (data?.queue ?? []).reduce((s, q) => s + q.people, 0);
  const queueActive = (data?.queue ?? []).filter((q) => q.active > 0).length;
  const ruleAddresses = (data?.rules ?? []).reduce((s, r) => s + r.addresses, 0);

  return (
    <div className="min-h-screen px-6 py-10 sm:px-10">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image src="/spacehub-logo.webp" alt="SpaceHub" width={121} height={36} priority />
            <span className="hidden h-6 w-px sm:block" style={{ background: "var(--gridline)" }} />
            <h1 className="hidden text-sm font-medium sm:block" style={{ color: "var(--text-secondary)" }}>
              Pemetaan Alamat
            </h1>
          </div>
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

        <Link href="/address-profile" className="mb-6 inline-block text-sm hover:underline" style={{ color: "var(--series-1)" }}>
          ← Back to profil alamat
        </Link>

        {forbidden && (
          <div className="rounded-2xl border p-6 text-sm" style={{ ...card, color: "var(--text-secondary)" }}>
            Halaman ini menampilkan alamat pelanggan dan khusus untuk tim yang ditunjuk. Hubungi admin dashboard kalau Anda
            perlu akses.
          </div>
        )}

        {error && (
          <div className="mb-6 rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)", background: "var(--surface-1)" }}>
            {error}
          </div>
        )}

        {!forbidden && !data && !error && <p style={{ color: "var(--text-secondary)" }}>Memuat…</p>}

        {data && (
          <>
            <div
              className="mb-6 rounded-lg border p-3 text-xs leading-relaxed"
              style={{ borderColor: "var(--status-warning)", background: "rgba(250, 183, 18, 0.08)", color: "var(--text-secondary)" }}
            >
              <b style={{ color: "var(--status-warning)" }}>Berisi alamat pelanggan.</b> Jangan dibagikan atau di-screenshot
              ke luar tim. Dashboard tidak menyimpan alamat — hanya sidik (hash) teks alamat dan wilayah yang Anda pilih.
            </div>

            {data.othersError && (
              <div className="mb-6 rounded-lg border px-4 py-3 text-xs leading-relaxed" style={{ borderColor: "var(--status-warning)", color: "var(--text-secondary)", background: "var(--surface-1)" }}>
                <b style={{ color: "var(--status-warning)" }}>Hanya alamat tenant aktif.</b> Daftar user atau riwayat rental dari
                Storeganise tidak bisa dibaca, jadi alamat pelanggan lain belum masuk antrean: {data.othersError}
              </div>
            )}

            <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
              {[
                ["Antrean", `${data.queue.length} alamat`, `${queuePeople} orang`],
                [
                  "Dipetakan manual",
                  `${data.overridden.length} alamat`,
                  `${data.overridden.reduce((s, o) => s + o.people, 0)} orang · ${data.overridden.filter((o) => o.importBatch).length} dari impor`,
                ],
                ["Lewat aturan", `${ruleAddresses} alamat`, `${data.rules.length} aturan`],
              ].map(([label, value, sub]) => (
                <div key={label} className="rounded-2xl border p-4" style={card}>
                  <p className="mb-1 text-[11px] font-bold tracking-wide uppercase" style={{ color: "var(--text-muted)" }}>
                    {label}
                  </p>
                  <p className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>
                    {value}
                  </p>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {sub}
                  </p>
                </div>
              ))}
            </div>

            <AddressImportPanel queueSize={data.queue.length} batches={data.importBatches} onChanged={load} />

            <section className="mb-8 rounded-2xl border p-6" style={card}>
              <p className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Antrean alamat
              </p>
              <p className="mb-4 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                Alamat semua pelanggan — tenant aktif, reservasi, sudah move-out, dan yang mendaftar tapi belum pernah sewa —
                yang belum bisa dikenali sampai kota/kabupaten. Alamat yang teksnya sama digabung — sekali petakan berlaku untuk
                semuanya.
              </p>
              <div className="mb-3 flex flex-wrap gap-2">
                {FILTERS.map((f) => (
                  <Pill key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)}>
                    {f.label} ({counts[f.key]})
                  </Pill>
                ))}
              </div>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari di antrean…"
                className="mb-3 w-full rounded-lg px-3 py-2 text-sm"
                style={inputStyle}
              />
              <label className="mb-4 flex items-center gap-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
                Hanya alamat tenant aktif ({queueActive})
              </label>
              {visible.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  {data.queue.length === 0 ? "Antrean kosong — semua alamat sudah bisa dikenali atau dipetakan." : "Tidak ada alamat yang cocok."}
                </p>
              ) : (
                <div className="flex flex-col">
                  {visible.map((q) => (
                    <div key={q.hash} className="py-3" style={{ borderBottom: "1px solid var(--gridline)" }}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm break-words" style={{ color: "var(--text-primary)" }}>
                            {q.text}
                          </p>
                          <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
                            {q.autoLabel} · {q.people} orang{q.active > 0 ? ` (${q.active} tenant aktif)` : ""}
                          </p>
                        </div>
                        {openHash !== q.hash && (
                          <button
                            onClick={() => setOpenHash(q.hash)}
                            className="rounded-full px-3 py-1 text-xs font-medium"
                            style={{ border: "1px solid var(--series-1)", color: "var(--series-1)" }}
                          >
                            Petakan
                          </button>
                        )}
                      </div>
                      {openHash === q.hash && (
                        <MappingForm
                          item={q}
                          queue={data.queue}
                          rules={data.rules}
                          onCancel={() => setOpenHash(null)}
                          onDone={async () => {
                            setOpenHash(null);
                            await load();
                          }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="mb-8 rounded-2xl border p-6" style={card}>
              <p className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Aturan ({data.rules.length})
              </p>
              <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
                Berlaku untuk semua alamat yang memuat frasanya, termasuk tenant baru — selama tidak bertentangan dengan kota/provinsi
                yang sudah tertulis di alamat.
              </p>
              {data.rules.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  Belum ada aturan.
                </p>
              ) : (
                data.rules.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm" style={{ borderBottom: "1px solid var(--gridline)" }}>
                    <div className="min-w-0">
                      <span style={{ color: "var(--text-primary)" }}>&quot;{r.phrase}&quot;</span>
                      <span style={{ color: "var(--text-muted)" }}> → </span>
                      <span style={{ color: "var(--text-primary)" }}>{r.label}</span>
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                        dipakai {r.addresses} alamat ({r.people} orang) · oleh {r.createdBy}
                      </p>
                    </div>
                    <button
                      disabled={busy === `rule-${r.id}`}
                      onClick={() => remove(`rule-${r.id}`, `/api/address-mapping/rules?id=${r.id}`)}
                      className="text-xs hover:underline disabled:opacity-50"
                      style={{ color: "var(--status-critical)" }}
                    >
                      Hapus
                    </button>
                  </div>
                ))
              )}
            </section>

            <section className="rounded-2xl border p-6" style={card}>
              <p className="mb-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Dipetakan manual ({data.overridden.length})
              </p>
              <p className="mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
                Termasuk hasil impor. Batalkan untuk mengembalikan alamat ke antrean.
                {data.orphanOverrides > 0 &&
                  ` ${data.orphanOverrides} pemetaan lain untuk alamat yang sudah tidak dipakai tenant aktif (alamatnya berubah atau tenant sudah move-out).`}
              </p>
              {data.overridden.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  Belum ada.
                </p>
              ) : (
                data.overridden.map((o) => (
                  <div key={o.hash} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm" style={{ borderBottom: "1px solid var(--gridline)" }}>
                    <div className="min-w-0 flex-1">
                      <p className="break-words" style={{ color: "var(--text-primary)" }}>
                        {o.text}
                      </p>
                      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                        {o.importBatch && (
                          <span className="mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase" style={{ background: "rgba(25, 185, 234, 0.16)", color: "var(--series-1)" }}>
                            impor
                          </span>
                        )}
                        → {o.label} · {o.people} orang · oleh {o.createdBy}
                      </p>
                    </div>
                    <button
                      disabled={busy === o.hash}
                      onClick={() => remove(o.hash, `/api/address-mapping/overrides?hash=${o.hash}`)}
                      className="text-xs hover:underline disabled:opacity-50"
                      style={{ color: "var(--status-critical)" }}
                    >
                      Batalkan
                    </button>
                  </div>
                ))
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
