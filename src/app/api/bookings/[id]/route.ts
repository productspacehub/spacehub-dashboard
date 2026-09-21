import { NextRequest, NextResponse } from "next/server";
import { getBooking, updateBooking, type UpdateBookingInput } from "@/lib/bookings";

export const dynamic = "force-dynamic";

async function resolveId(params: Promise<{ id: string }>): Promise<number | null> {
  const { id } = await params;
  const parsed = Number(id);
  return Number.isInteger(parsed) ? parsed : null;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = await resolveId(params);
    if (id === null) return NextResponse.json({ error: "ID tidak valid" }, { status: 400 });

    const booking = await getBooking(id);
    if (!booking) return NextResponse.json({ error: "Booking tidak ditemukan" }, { status: 404 });
    return NextResponse.json({ booking });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// Booking detail view (§5.5: "customer info, package, dates, price, payment
// status/link, container, status, notes — all editable"). Business-rule
// enforcement (auto Pending Payment -> Confirmed on payment, container
// assignment validity) lives in updateBooking itself.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = await resolveId(params);
    if (id === null) return NextResponse.json({ error: "ID tidak valid" }, { status: 400 });

    const body = (await request.json()) as UpdateBookingInput;
    const booking = await updateBooking(id, body);
    return NextResponse.json({ booking });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const isNotFound = message.includes("tidak ditemukan");
    return NextResponse.json({ error: message }, { status: isNotFound ? 404 : 400 });
  }
}
