import { NextRequest, NextResponse } from "next/server";
import { getAddons, setAddons, MODULE_TYPES, type ModuleType } from "@/lib/bookings";

export const dynamic = "force-dynamic";

function parseModule(value: string | null): ModuleType | null {
  return value && (MODULE_TYPES as readonly string[]).includes(value) ? (value as ModuleType) : null;
}

// Admin-editable addon menu (e.g. Co-working's water refill/TV/lockers),
// one per module — same "ships empty, replace the whole list at once"
// pattern as /api/rates. ?module= selects which module's menu to read/write.
export async function GET(request: NextRequest) {
  try {
    const moduleType = parseModule(request.nextUrl.searchParams.get("module"));
    if (!moduleType) return NextResponse.json({ error: "Modul tidak valid" }, { status: 400 });
    const addons = await getAddons(moduleType);
    return NextResponse.json({ addons });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as { module?: string; addons?: { name: string; price: number }[] };
    const moduleType = parseModule(body.module ?? null);
    if (!moduleType) return NextResponse.json({ error: "Modul tidak valid" }, { status: 400 });
    if (!Array.isArray(body.addons)) {
      return NextResponse.json({ error: "Format tidak valid" }, { status: 400 });
    }
    for (const addon of body.addons) {
      if (!addon.name?.trim()) {
        return NextResponse.json({ error: "Nama addon tidak boleh kosong" }, { status: 400 });
      }
      if (typeof addon.price !== "number" || addon.price < 0 || Number.isNaN(addon.price)) {
        return NextResponse.json({ error: `Harga untuk ${addon.name} tidak valid` }, { status: 400 });
      }
    }
    const addons = await setAddons(body.addons, moduleType);
    return NextResponse.json({ addons });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
