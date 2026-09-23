"use client";

import Image from "next/image";
import { signOut, useSession } from "next-auth/react";
import { PriceListEditor } from "@/components/bookings/PriceListEditor";
import type { Addon } from "@/lib/bookings";

export default function SharedStorageAddonsPage() {
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
          title="Addon — Shared Storage"
          description="Addon yang bisa dipilih saat membuat booking (mis. Padlock). Bisa dipilih lebih dari satu unit per booking."
          emptyHint='Belum ada addon. Tambahkan mis. "Padlock" dengan harganya.'
          labelPlaceholder="Nama addon, mis. Padlock"
          apiPath="/api/addons?module=shared_storage"
          backHref="/bookings"
          backLabel="Kembali ke daftar booking"
          toRows={(json) => ((json as { addons?: Addon[] }).addons ?? []).map((a) => ({ label: a.name, price: String(a.price) }))}
          toRequestBody={(rows) => ({
            module: "shared_storage",
            addons: rows.map((r) => ({ name: r.label.trim(), price: Number(r.price) || 0 })),
          })}
        />
      </div>
    </div>
  );
}
