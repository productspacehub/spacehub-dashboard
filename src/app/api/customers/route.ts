import { NextRequest, NextResponse } from "next/server";
import { createCustomer, searchCustomers, type CustomerInput } from "@/lib/bookings";

export const dynamic = "force-dynamic";

// ?q= matches phone or name (ILIKE) — used by the booking form's
// search-existing-customer step (§5.1: "search by phone/name; create inline
// if new").
export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get("q") ?? "";
    const customers = await searchCustomers(q);
    return NextResponse.json({ customers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as CustomerInput;
    if (!body.name?.trim() || !body.phone?.trim()) {
      return NextResponse.json({ error: "Nama dan nomor telepon wajib diisi" }, { status: 400 });
    }
    const customer = await createCustomer(body);
    return NextResponse.json({ customer }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
