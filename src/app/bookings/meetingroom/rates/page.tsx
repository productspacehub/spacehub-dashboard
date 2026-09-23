"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { signOut, useSession } from "next-auth/react";
import { PriceListEditor } from "@/components/bookings/PriceListEditor";
import type { RatePackage, ResourceRow } from "@/lib/bookings";

export default function MeetingRoomRatesPage() {
  const { data: session } = useSession();
  const [resources, setResources] = useState<ResourceRow[]>([]);

  useEffect(() => {
    fetch("/api/resources?module=meeting_room")
      .then((res) => res.json())
      .then((body) => setResources(body.resources ?? []))
      .catch(() => setResources([]));
  }, []);

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
          title="Rate table — Meeting Room"
          description='Harga per package (mis. Per Jam, Paket Setengah Hari). Pilih "Semua ruang" untuk tarif umum, atau pilih ruang tertentu untuk harga khusus ruang itu (mengalahkan tarif umum untuk package dengan nama yang sama). Minimal booking 3 jam — admin yang menghitung total sesuai durasi saat membuat booking.'
          emptyHint='Belum ada package. Tambahkan mis. "Per Jam" dengan harganya.'
          labelPlaceholder="Nama package, mis. Per Jam"
          apiPath="/api/rates?module=meeting_room"
          backHref="/bookings/meetingroom"
          backLabel="Kembali ke daftar booking"
          resourceOptions={resources}
          toRows={(json) =>
            ((json as { packages?: RatePackage[] }).packages ?? []).map((p) => ({
              label: p.packageName,
              price: String(p.price),
              resourceId: p.resourceId != null ? String(p.resourceId) : "",
            }))
          }
          toRequestBody={(rows) => ({
            module: "meeting_room",
            packages: rows.map((r) => ({
              packageName: r.label.trim(),
              price: Number(r.price) || 0,
              resourceId: r.resourceId ? Number(r.resourceId) : null,
            })),
          })}
        />
      </div>
    </div>
  );
}
