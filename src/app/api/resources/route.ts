import { NextRequest, NextResponse } from "next/server";
import { createResource, listResources, MODULE_TYPES, type ModuleType } from "@/lib/bookings";

export const dynamic = "force-dynamic";

function parseModule(value: string | null): ModuleType | null {
  return value && (MODULE_TYPES as readonly string[]).includes(value) ? (value as ModuleType) : null;
}

// Bookable rooms for Meeting Room / Studio (§7.2) — ?module= selects which
// module's room list to read/write, same pattern as containers/rates/addons.
export async function GET(request: NextRequest) {
  try {
    const moduleType = parseModule(request.nextUrl.searchParams.get("module"));
    if (!moduleType) return NextResponse.json({ error: "Modul tidak valid" }, { status: 400 });
    const resources = await listResources(moduleType);
    return NextResponse.json({ resources });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { module?: string; name?: string };
    const moduleType = parseModule(body.module ?? null);
    if (!moduleType) return NextResponse.json({ error: "Modul tidak valid" }, { status: 400 });
    if (!body.name?.trim()) {
      return NextResponse.json({ error: "Nama ruang wajib diisi" }, { status: 400 });
    }
    const resource = await createResource(moduleType, body.name);
    return NextResponse.json({ resource }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const isDuplicate = message.includes("duplicate key") || message.includes("unique");
    return NextResponse.json({ error: isDuplicate ? "Nama ruang ini sudah ada" : message }, { status: isDuplicate ? 409 : 500 });
  }
}
