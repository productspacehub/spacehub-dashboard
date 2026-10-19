"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import type { BookingDetail } from "@/lib/bookings";
import { MODULE_CONFIG, MODULE_LABELS } from "@/lib/bookingConstants";

function formatIdr(value: number): string {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(value);
}

function formatDateLabel(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
}

// Plain hand-drawn outline icons for the contact row below — generic shapes
// (globe/handset/envelope/camera), not brand logos, so there's nothing to
// license and no icon library to add as a dependency for four small marks.
const iconProps = { width: 14, height: 14, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function GlobeIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <line x1="3" y1="12" x2="21" y2="12" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg {...iconProps}>
      <path d="M6.6 4h3l1.5 4-2 1.6a12.3 12.3 0 0 0 5.3 5.3l1.6-2 4 1.5v3c0 1.1-.9 2-2 2C9.6 19.4 4.6 14.4 4.6 6c0-1.1.9-2 2-2z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7l1.3-2.3h5.4L16 7" />
      <circle cx="12" cy="13.5" r="3.3" />
    </svg>
  );
}

// Printed with the browser's own Print dialog ("Save as PDF") rather than a
// server-generated PDF — no new dependency, and every browser already does
// this well. The receipt card is always styled light (not the app's dark
// theme) so screen and print match exactly — there is no light/dark
// distinction to keep in sync, it is simply what will end up on paper.
export default function BookingReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/bookings/${id}`)
      .then((res) => res.json())
      .then((body) => {
        if (body.error) throw new Error(body.error);
        setBooking(body.booking);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Gagal memuat booking"))
      .finally(() => setLoading(false));
  }, [id]);

  const backHref = booking ? `/bookings/${booking.id}` : "/bookings";

  return (
    <div className="min-h-screen bg-[var(--background)] px-6 py-10 sm:px-10 print:bg-white print:p-0">
      <div className="mx-auto max-w-2xl">
        <div className="print:hidden mb-6 flex items-center justify-between">
          <Link href={backHref} className="text-sm hover:underline" style={{ color: "var(--series-1)" }}>
            ← Kembali ke booking
          </Link>
          {booking && booking.paymentStatus === "Paid" && (
            <button
              onClick={() => window.print()}
              className="rounded-full px-4 py-2 text-sm font-medium"
              style={{ background: "var(--series-1)", color: "var(--background)" }}
            >
              Print / Simpan sebagai PDF
            </button>
          )}
        </div>

        {loading && <p style={{ color: "var(--text-secondary)" }}>Loading…</p>}

        {error && (
          <div className="print:hidden rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--status-critical)", color: "var(--status-critical)", background: "var(--surface-1)" }}>
            {error}
          </div>
        )}

        {booking && booking.paymentStatus !== "Paid" && (
          <div className="print:hidden rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--status-warning)", color: "var(--status-warning)", background: "var(--surface-1)" }}>
            Booking ini belum dibayar (status: {booking.paymentStatus}) — kwitansi hanya tersedia untuk booking
            dengan status pembayaran Paid.
          </div>
        )}

        {booking && booking.paymentStatus === "Paid" && (
          <div className="rounded-2xl border border-gray-300 bg-white p-8 text-gray-900 print:rounded-none print:border-0 print:p-0 shadow-sm print:shadow-none">
            <div className="mb-8 flex items-start justify-between">
              <Image src="/spacehub-logo-dark.webp" alt="SpaceHub" width={140} height={42} />
              <div className="text-right">
                <p className="text-lg font-bold">KWITANSI PEMBAYARAN</p>
                <p className="text-sm text-gray-500">Booking #{booking.id}</p>
                <p className="text-sm text-gray-500">Diterbitkan {formatDateLabel(new Date().toISOString().slice(0, 10))}</p>
              </div>
            </div>

            <div className="mb-8 grid grid-cols-2 gap-6">
              <div>
                <p className="mb-1 text-xs font-semibold tracking-wide text-gray-500 uppercase">Diterima dari</p>
                <p className="font-semibold">{booking.customer.name}</p>
                <p className="text-sm text-gray-600">{booking.customer.phone}</p>
                {booking.customer.email && <p className="text-sm text-gray-600">{booking.customer.email}</p>}
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold tracking-wide text-gray-500 uppercase">Layanan</p>
                <p className="font-semibold">{MODULE_LABELS[booking.moduleType]}</p>
                <p className="text-sm text-gray-600">{booking.packageType}</p>
                {MODULE_CONFIG[booking.moduleType].usesTimeSlots ? (
                  <p className="text-sm text-gray-600">
                    {formatDateLabel(booking.startDate)}, {booking.startTime}–{booking.endTime}
                    {booking.resourceName ? ` · ${booking.resourceName}` : ""}
                  </p>
                ) : (
                  <p className="text-sm text-gray-600">
                    {formatDateLabel(booking.startDate)}
                    {booking.endDate ? ` – ${formatDateLabel(booking.endDate)}` : ""}
                  </p>
                )}
                {booking.containerLabel && <p className="text-sm text-gray-600">Container: {booking.containerLabel}</p>}
              </div>
            </div>

            <table className="mb-6 w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-300">
                  <th className="pb-2 font-semibold">Item</th>
                  <th className="pb-2 text-right font-semibold">Jumlah</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-gray-100">
                  <td className="py-2">{booking.packageType}</td>
                  <td className="py-2 text-right">{formatIdr(booking.price)}</td>
                </tr>
                {booking.addons.map((a, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-2">
                      {a.name} {a.quantity > 1 ? `× ${a.quantity}` : ""}
                    </td>
                    <td className="py-2 text-right">{formatIdr(a.price * a.quantity)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="pt-3 font-bold">Total</td>
                  <td className="pt-3 text-right font-bold">{formatIdr(booking.price + booking.addonsTotal)}</td>
                </tr>
              </tfoot>
            </table>

            <div className="mb-8 rounded-lg bg-gray-50 px-4 py-3 text-sm">
              <p>
                Status pembayaran: <span className="font-semibold text-emerald-700">LUNAS</span>
              </p>
              {booking.paymentReference && <p className="mt-1 text-gray-600">Referensi: {booking.paymentReference}</p>}
            </div>

            <div className="border-t border-gray-200 pt-4">
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-gray-500">
                <span className="inline-flex items-center gap-1.5">
                  <GlobeIcon /> spacehub.id
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <PhoneIcon /> +62 851 7229 9309
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MailIcon /> hello@spacehub.id
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CameraIcon /> spacehub.storage
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
