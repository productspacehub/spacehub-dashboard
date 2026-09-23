"use client";

import Image from "next/image";
import { signOut, useSession } from "next-auth/react";
import { PriceListEditor } from "@/components/bookings/PriceListEditor";
import type { RatePackage } from "@/lib/bookings";

export default function StudioRatesPage() {
  const { data: session } = useSession();

  return (
    <div className="min-h-screen px-6 py-10 sm:px-10">
      <div className="mx-auto max-w-xl">
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

        <PriceListEditor
          title="Rate table — Studio"
          description="Harga per package (mis. Per Jam, Paket Half-Day). Minimal booking 3 jam — admin yang menghitung total sesuai durasi saat membuat booking."
          emptyHint='Belum ada package. Tambahkan mis. "Per Jam" dengan harganya.'
          labelPlaceholder="Nama package, mis. Per Jam"
          apiPath="/api/rates?module=studio"
          backHref="/bookings/studio"
          backLabel="Kembali ke daftar booking"
          toRows={(json) => ((json as { packages?: RatePackage[] }).packages ?? []).map((p) => ({ label: p.packageName, price: String(p.price) }))}
          toRequestBody={(rows) => ({
            module: "studio",
            packages: rows.map((r) => ({ packageName: r.label.trim(), price: Number(r.price) || 0 })),
          })}
        />
      </div>
    </div>
  );
}
