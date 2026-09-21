import { NextRequest, NextResponse } from "next/server";
import { getRatePackages, setRatePackages } from "@/lib/bookings";

export const dynamic = "force-dynamic";

// Admin-editable rate table (§5.2) — ships empty; GET/PUT the whole list at
// once rather than per-row endpoints, since it's a handful of rows an admin
// edits together (add/rename/reprice/remove a package).
export async function GET() {
  try {
    const packages = await getRatePackages();
    return NextResponse.json({ packages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as { packages?: { packageName: string; price: number }[] };
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
    }
    const packages = await setRatePackages(body.packages);
    return NextResponse.json({ packages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
