"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import type { Addon, BookingDetail, Customer, ModuleType, RatePackage } from "@/lib/bookings";
import { BOOKING_SOURCES, type BookingSource } from "@/lib/bookingConstants";

const inputStyle = {
  background: "var(--surface-1)",
  borderColor: "var(--gridline)",
  color: "var(--text-primary)",
} as const;

function formatIdr(value: number): string {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
}

export function NewBookingForm({
  moduleType,
  moduleLabel,
  backHref,
  ratesHref,
  addonsHref,
  footnote,
}: {
  moduleType: ModuleType;
  moduleLabel: string;
  backHref: string;
  ratesHref: string;
  addonsHref: string;
  footnote?: string;
}) {
  const { data: session } = useSession();
  const router = useRouter();

  const [rates, setRates] = useState<RatePackage[]>([]);
  const [addons, setAddons] = useState<Addon[]>([]);
  // addon name -> quantity (presence in the map = selected)
  const [selectedAddons, setSelectedAddons] = useState<Map<string, number>>(new Map());
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [creatingNewCustomer, setCreatingNewCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: "", phone: "", email: "", idNumber: "", notes: "" });

  const [packageType, setPackageType] = useState("");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [price, setPrice] = useState<string>("");
  const [source, setSource] = useState<BookingSource>("Walk-in");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/rates?module=${moduleType}`)
      .then((res) => res.json())
      .then((body) => setRates(body.packages ?? []))
      .catch(() => setRates([]));
    fetch(`/api/addons?module=${moduleType}`)
      .then((res) => res.json())
      .then((body) => setAddons(body.addons ?? []))
      .catch(() => setAddons([]));
  }, [moduleType]);

  useEffect(() => {
    if (selectedCustomer || creatingNewCustomer) return;
    const id = setTimeout(() => {
      fetch(`/api/customers?q=${encodeURIComponent(customerQuery)}`)
        .then((res) => res.json())
        .then((body) => setCustomerResults(body.customers ?? []))
        .catch(() => setCustomerResults([]));
    }, 250);
    return () => clearTimeout(id);
  }, [customerQuery, selectedCustomer, creatingNewCustomer]);

  function handlePackageChange(name: string) {
    setPackageType(name);
    const rate = rates.find((r) => r.packageName === name);
    if (rate) setPrice(String(rate.price));
  }

  function toggleAddon(name: string) {
    setSelectedAddons((prev) => {
      const next = new Map(prev);
      if (next.has(name)) next.delete(name);
      else next.set(name, 1);
      return next;
    });
  }

  function setAddonQuantity(name: string, quantity: number) {
    setSelectedAddons((prev) => {
      const next = new Map(prev);
      next.set(name, Math.max(1, Math.floor(quantity) || 1));
      return next;
    });
  }

  const addonsTotal = addons.reduce((sum, a) => sum + (selectedAddons.has(a.name) ? a.price * selectedAddons.get(a.name)! : 0), 0);
  const grandTotal = (Number(price) || 0) + addonsTotal;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!selectedCustomer && !creatingNewCustomer) {
      setError("Cari customer yang sudah ada atau buat customer baru");
      return;
    }
    if (creatingNewCustomer && (!newCustomer.name.trim() || !newCustomer.phone.trim())) {
      setError("Nama dan nomor telepon customer wajib diisi");
      return;
    }
    if (!packageType.trim() || !startDate || !price) {
      setError("Package, tanggal mulai, dan harga wajib diisi");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          moduleType,
          customerId: selectedCustomer?.id,
          newCustomer: creatingNewCustomer ? newCustomer : undefined,
          packageType,
          startDate,
          endDate: endDate || null,
          price: Number(price),
          source,
          addons: addons
            .filter((a) => selectedAddons.has(a.name))
            .map((a) => ({ name: a.name, price: a.price, quantity: selectedAddons.get(a.name)! })),
          notes,
        }),
      });
      const body = (await res.json()) as { booking?: BookingDetail; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Gagal membuat booking");
      router.push(`/bookings/${body.booking!.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuat booking");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen px-6 py-10 sm:px-10">
      <div className="mx-auto max-w-2xl">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image src="/spacehub-logo.webp" alt="SpaceHub" width={121} height={36} priority />
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

        <Link href={backHref} className="mb-6 inline-block text-sm hover:underline" style={{ color: "var(--series-1)" }}>
          ← Kembali ke daftar booking
        </Link>

        <h1 className="mb-6 text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
          Booking baru — {moduleLabel}
        </h1>

        {error && (
          <div className="mb-6 rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)", background: "var(--surface-1)" }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <section className="rounded-2xl border p-6" style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}>
            <p className="mb-4 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Customer</p>

            {selectedCustomer ? (
              <div className="flex items-center justify-between rounded-lg border px-4 py-3" style={{ borderColor: "var(--gridline)" }}>
                <div>
                  <p className="font-medium" style={{ color: "var(--text-primary)" }}>{selectedCustomer.name}</p>
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>{selectedCustomer.phone}</p>
                </div>
                <button type="button" onClick={() => setSelectedCustomer(null)} className="text-sm hover:underline" style={{ color: "var(--series-1)" }}>
                  Ganti
                </button>
              </div>
            ) : creatingNewCustomer ? (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <input placeholder="Nama *" value={newCustomer.name} onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" style={inputStyle} />
                  <input placeholder="Nomor telepon *" value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" style={inputStyle} />
                  <input placeholder="Email (opsional)" value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" style={inputStyle} />
                  <input placeholder="No. KTP (opsional)" value={newCustomer.idNumber} onChange={(e) => setNewCustomer({ ...newCustomer, idNumber: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" style={inputStyle} />
                </div>
                <textarea placeholder="Catatan (opsional)" value={newCustomer.notes} onChange={(e) => setNewCustomer({ ...newCustomer, notes: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" style={inputStyle} rows={2} />
                <button type="button" onClick={() => setCreatingNewCustomer(false)} className="self-start text-sm hover:underline" style={{ color: "var(--series-1)" }}>
                  ← Cari customer yang sudah ada
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <input
                  placeholder="Cari nama atau nomor telepon…"
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                  className="rounded-lg border px-3 py-2 text-sm"
                  style={inputStyle}
                />
                {customerResults.length > 0 && (
                  <div className="flex flex-col divide-y rounded-lg border" style={{ borderColor: "var(--gridline)" }}>
                    {customerResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelectedCustomer(c)}
                        className="flex items-center justify-between px-3 py-2 text-left text-sm hover:opacity-80"
                        style={{ borderColor: "var(--gridline)" }}
                      >
                        <span style={{ color: "var(--text-primary)" }}>{c.name}</span>
                        <span style={{ color: "var(--text-muted)" }}>{c.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
                <button type="button" onClick={() => setCreatingNewCustomer(true)} className="self-start text-sm hover:underline" style={{ color: "var(--series-1)" }}>
                  + Customer baru
                </button>
              </div>
            )}
          </section>

          <section className="rounded-2xl border p-6" style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}>
            <p className="mb-4 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Detail booking</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                Package *
                <select value={packageType} onChange={(e) => handlePackageChange(e.target.value)} className="rounded-lg border px-3 py-2 text-sm" style={inputStyle}>
                  <option value="">Pilih package…</option>
                  {rates.map((r) => (
                    <option key={r.id} value={r.packageName}>{r.packageName}</option>
                  ))}
                </select>
                {rates.length === 0 && (
                  <span style={{ color: "var(--status-warning)" }}>
                    Belum ada rate table — <Link href={ratesHref} className="hover:underline" style={{ color: "var(--series-1)" }}>atur harga dulu</Link>, atau isi package/harga manual di bawah.
                  </span>
                )}
              </label>
              {rates.length === 0 && (
                <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                  Nama package (manual)
                  <input value={packageType} onChange={(e) => setPackageType(e.target.value)} placeholder="mis. Daily / Weekly" className="rounded-lg border px-3 py-2 text-sm" style={inputStyle} />
                </label>
              )}
              <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                Sumber *
                <select value={source} onChange={(e) => setSource(e.target.value as BookingSource)} className="rounded-lg border px-3 py-2 text-sm" style={inputStyle}>
                  {BOOKING_SOURCES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                Tanggal mulai *
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-lg border px-3 py-2 text-sm" style={inputStyle} />
              </label>
              <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                Tanggal selesai (opsional)
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-lg border px-3 py-2 text-sm" style={inputStyle} />
              </label>
              <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                Harga paket (IDR) *
                <input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} className="rounded-lg border px-3 py-2 text-sm" style={inputStyle} />
              </label>
            </div>
            <label className="mt-4 flex flex-col gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
              Catatan
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="rounded-lg border px-3 py-2 text-sm" style={inputStyle} rows={2} />
            </label>
          </section>

          <section className="rounded-2xl border p-6" style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}>
            <p className="mb-4 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Addon (opsional)</p>
            {addons.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                Belum ada addon terdaftar — <Link href={addonsHref} className="hover:underline" style={{ color: "var(--series-1)" }}>atur addon dulu</Link> kalau perlu.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {addons.map((a) => {
                  const qty = selectedAddons.get(a.name);
                  return (
                    <div key={a.id} className="flex items-center gap-3">
                      <label className="flex flex-1 items-center gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
                        <input type="checkbox" checked={qty !== undefined} onChange={() => toggleAddon(a.name)} />
                        {a.name} {a.price > 0 && <span style={{ color: "var(--text-muted)" }}>(Rp{a.price.toLocaleString("id-ID")}/unit)</span>}
                      </label>
                      {qty !== undefined && (
                        <input
                          type="number"
                          min={1}
                          value={qty}
                          onChange={(e) => setAddonQuantity(a.name, Number(e.target.value))}
                          className="w-20 rounded-lg border px-2 py-1 text-sm"
                          style={inputStyle}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="rounded-2xl border p-6" style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}>
            <div className="flex items-center justify-between text-sm" style={{ color: "var(--text-secondary)" }}>
              <span>Harga paket</span>
              <span>{formatIdr(Number(price) || 0)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-sm" style={{ color: "var(--text-secondary)" }}>
              <span>Addon ({Array.from(selectedAddons.values()).reduce((a, b) => a + b, 0)} unit)</span>
              <span>{formatIdr(addonsTotal)}</span>
            </div>
            <div className="mt-3 flex items-center justify-between border-t pt-3 text-sm font-semibold" style={{ borderColor: "var(--gridline)", color: "var(--text-primary)" }}>
              <span>Total</span>
              <span>{formatIdr(grandTotal)}</span>
            </div>
          </section>

          {footnote && (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {footnote}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="self-start rounded-full px-5 py-2.5 text-sm font-medium disabled:opacity-50"
            style={{ background: "var(--series-1)", color: "var(--background)" }}
          >
            {submitting ? "Menyimpan…" : "Simpan booking"}
          </button>
        </form>
      </div>
    </div>
  );
}
