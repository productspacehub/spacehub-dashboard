import { NextRequest, NextResponse } from "next/server";
import { getRatePackages, setRatePackages, MODULE_TYPES, type ModuleType } from "@/lib/bookings";

export const dynamic = "force-dynamic";

function parseModule(value: string | null): ModuleType | null {
  return value && (MODULE_TYPES as readonly string[]).includes(value) ? (value as ModuleType) : null;
}

// Admin-editable rate table (§5.2), one per module — ships empty; GET/PUT
// the whole list at once rather than per-row endpoints, since it's a
// handful of rows an admin edits together (add/rename/reprice/remove a
// package). ?module= selects which module's table to read/write.
export async function GET(request: NextRequest) {
  try {
    const moduleType = parseModule(request.nextUrl.searchParams.get("module"));
    if (!moduleType) return NextResponse.json({ error: "Modul tidak valid" }, { status: 400 });
    const packages = await getRatePackages(moduleType);
    return NextResponse.json({ packages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      module?: string;
      packages?: { packageName: string; price: number; resourceId?: number | null }[];
    };
    const moduleType = parseModule(body.module ?? null);
    if (!moduleType) return NextResponse.json({ error: "Modul tidak valid" }, { status: 400 });
    if (!Array.isArray(body.packages)) {
      return NextResponse.json({ error: "Format tidak valid" }, { status: 400 });
    }
    for (const pkg of body.packages) {
      if (!pkg.packageName?.trim()) {
        return NextResponse.json({ error: "Nama paket tidak boleh kosong" }, { status: 400 });
      }
      if (typeof pkg.price !== "number" || pkg.price < 0 || Number.isNaN(pkg.price)) {
        return NextResponse.json({ error: `Harga untuk ${pkg.packageName} tidak valid` }, { status: 400 });
      }
      if (pkg.resourceId != null && typeof pkg.resourceId !== "number") {
        return NextResponse.json({ error: `Ruang untuk ${pkg.packageName} tidak valid` }, { status: 400 });
      }
    }
    const packages = await setRatePackages(body.packages, moduleType);
    return NextResponse.json({ packages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
