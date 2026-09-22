"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import type { BookingDetail, ContainerRow } from "@/lib/bookings";
import { BOOKING_STATUSES, PAYMENT_STATUSES, type BookingStatus, type PaymentStatus } from "@/lib/bookingConstants";

const inputStyle = {
  background: "var(--background)",
  borderColor: "var(--gridline)",
  color: "var(--text-primary)",
} as const;

function formatIdr(value: number): string {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
}

export default function BookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session } = useSession();

  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [containers, setContainers] = useState<ContainerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<{
    customer: { name: string; phone: string; email: string; idNumber: string; notes: string };
    packageType: string;
    startDate: string;
    endDate: string;
    price: string;
    paymentStatus: PaymentStatus;
    paymentReference: string;
    status: BookingStatus;
    containerId: number | null;
    notes: string;
  } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [bookingRes, containersRes] = await Promise.all([fetch(`/api/bookings/${id}`), fetch("/api/containers")]);
      const bookingBody = (await bookingRes.json()) as { booking?: BookingDetail; error?: string };
      if (!bookingRes.ok) throw new Error(bookingBody.error ?? "Gagal memuat booking");
      const containersBody = (await containersRes.json()) as { containers?: ContainerRow[] };

      setBooking(bookingBody.booking!);
      setContainers(containersBody.containers ?? []);
      setForm({
        customer: {
          name: bookingBody.booking!.customer.name,
          phone: bookingBody.booking!.customer.phone,
          email: bookingBody.booking!.customer.email ?? "",
          idNumber: bookingBody.booking!.customer.idNumber ?? "",
          notes: bookingBody.booking!.customer.notes ?? "",
        },
        packageType: bookingBody.booking!.packageType,
        startDate: bookingBody.booking!.startDate,
        endDate: bookingBody.booking!.endDate ?? "",
        price: String(bookingBody.booking!.price),
        paymentStatus: bookingBody.booking!.paymentStatus,
        paymentReference: bookingBody.booking!.paymentReference ?? "",
        status: bookingBody.booking!.status,
        containerId: bookingBody.booking!.containerId,
        notes: bookingBody.booking!.notes ?? "",
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat booking");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount, state settles asynchronously in `load`
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: form.customer,
          packageType: form.packageType,
          startDate: form.startDate,
          endDate: form.endDate || null,
          price: Number(form.price),
          paymentStatus: form.paymentStatus,
          paymentReference: form.paymentReference || null,
          status: form.status,
          containerId: form.containerId,
          notes: form.notes,
        }),
      });
      const body = (await res.json()) as { booking?: BookingDetail; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Gagal menyimpan");
      router.push("/bookings");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  }

  const selectableContainers = containers.filter((c) => c.status === "Free" || c.id === form?.containerId);

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

        <Link href="/bookings" className="mb-6 inline-block text-sm hover:underline" style={{ color: "var(--series-1)" }}>
          ← Kembali ke daftar booking
        </Link>

        {loading && !booking && <p style={{ color: "var(--text-secondary)" }}>Loading…</p>}

        {error && (
          <div className="mb-6 rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)", background: "var(--surface-1)" }}>
            {error}
          </div>
        )}

        {booking && form && (
          <>
            <div className="mb-6 flex items-center justify-between">
              <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
                Booking #{booking.id}
              </h1>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {booking.source} · dibuat {new Date(booking.createdAt).toLocaleDateString("id-ID")}
                {booking.createdBy ? ` oleh ${booking.createdBy}` : ""}
              </p>
            </div>

            <form onSubmit={handleSave} className="flex flex-col gap-6">
              <section className="rounded-2xl border p-6" style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}>
                <p className="mb-4 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Customer</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <input value={form.customer.name} onChange={(e) => setForm({ ...form, customer: { ...form.customer, name: e.target.value } })} placeholder="Nama" className="rounded-lg border px-3 py-2 text-sm" style={inputStyle} />
                  <input value={form.customer.phone} onChange={(e) => setForm({ ...form, customer: { ...form.customer, phone: e.target.value } })} placeholder="Nomor telepon" className="rounded-lg border px-3 py-2 text-sm" style={inputStyle} />
                  <input value={form.customer.email} onChange={(e) => setForm({ ...form, customer: { ...form.customer, email: e.target.value } })} placeholder="Email" className="rounded-lg border px-3 py-2 text-sm" style={inputStyle} />
                  <input value={form.customer.idNumber} onChange={(e) => setForm({ ...form, customer: { ...form.customer, idNumber: e.target.value } })} placeholder="No. KTP" className="rounded-lg border px-3 py-2 text-sm" style={inputStyle} />
                </div>
                <textarea value={form.customer.notes} onChange={(e) => setForm({ ...form, customer: { ...form.customer, notes: e.target.value } })} placeholder="Catatan customer" className="mt-3 w-full rounded-lg border px-3 py-2 text-sm" style={inputStyle} rows={2} />
              </section>

              <section className="rounded-2xl border p-6" style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}>
                <p className="mb-4 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Detail booking</p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                    Package
                    <input value={form.packageType} onChange={(e) => setForm({ ...form, packageType: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" style={inputStyle} />
                  </label>
                  <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                    Harga (IDR)
                    <input type="number" min={0} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" style={inputStyle} />
                    {Number(form.price) > 0 && <span style={{ color: "var(--text-muted)" }}>{formatIdr(Number(form.price))}</span>}
                  </label>
                  <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                    Tanggal mulai
                    <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" style={inputStyle} />
                  </label>
                  <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                    Tanggal selesai
                    <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" style={inputStyle} />
                  </label>
                </div>
                <label className="mt-4 flex flex-col gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                  Catatan booking
                  <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="rounded-lg border px-3 py-2 text-sm" style={inputStyle} rows={2} />
                </label>
              </section>

              <section className="rounded-2xl border p-6" style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}>
                <p className="mb-4 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Pembayaran</p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                    Status pembayaran
                    <select value={form.paymentStatus} onChange={(e) => setForm({ ...form, paymentStatus: e.target.value as PaymentStatus })} className="rounded-lg border px-3 py-2 text-sm" style={inputStyle}>
                      {PAYMENT_STATUSES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                    Link/referensi pembayaran
                    <input value={form.paymentReference} onChange={(e) => setForm({ ...form, paymentReference: e.target.value })} placeholder="mis. link Xendit" className="rounded-lg border px-3 py-2 text-sm" style={inputStyle} />
                  </label>
                </div>
                <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  Mengubah status pembayaran ke Paid saat status booking masih Pending Payment akan otomatis mengubah status ke Confirmed.
                </p>
              </section>

              <section className="rounded-2xl border p-6" style={{ background: "var(--surface-1)", borderColor: "var(--gridline)" }}>
                <p className="mb-4 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Status &amp; Container</p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                    Status booking
                    <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as BookingStatus })} className="rounded-lg border px-3 py-2 text-sm" style={inputStyle}>
                      {BOOKING_STATUSES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                    Container
                    <select
                      value={form.containerId ?? ""}
                      onChange={(e) => setForm({ ...form, containerId: e.target.value ? Number(e.target.value) : null })}
                      className="rounded-lg border px-3 py-2 text-sm"
                      style={inputStyle}
                    >
                      <option value="">Belum ditetapkan</option>
                      {selectableContainers.map((c) => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="mt-2 text-xs" style={{ color: "var(--text-muted)" }}>
                  Untuk mengubah status ke Active, pilih container yang Free dulu (drop-off). Melepas status Active akan otomatis mengembalikan container ke Free.
                </p>
              </section>

              <button type="submit" disabled={saving} className="self-start rounded-full px-5 py-2.5 text-sm font-medium disabled:opacity-50" style={{ background: "var(--series-1)", color: "var(--background)" }}>
                {saving ? "Menyimpan…" : "Simpan perubahan"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
