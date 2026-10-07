import { NextRequest, NextResponse } from "next/server";
import { updateContainer } from "@/lib/bookings";

export const dynamic = "force-dynamic";

// Renaming a Container ID (e.g. the physical box got relabeled) — the only
// editable field a container has.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "ID tidak valid" }, { status: 400 });

    const body = (await request.json()) as { label?: string };
    if (!body.label?.trim()) {
      return NextResponse.json({ error: "Container ID wajib diisi" }, { status: 400 });
    }
    const container = await updateContainer(id, body.label);
    return NextResponse.json({ container });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const isDuplicate = message.includes("duplicate key") || message.includes("unique");
    const isNotFound = message.includes("tidak ditemukan");
    return NextResponse.json(
      { error: isDuplicate ? "Container ID ini sudah ada" : message },
      { status: isDuplicate ? 409 : isNotFound ? 404 : 500 }
    );
  }
}
