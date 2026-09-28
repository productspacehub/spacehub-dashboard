import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  BOOKING_SOURCES,
  BOOKING_STATUSES,
  MODULE_TYPES,
  createBooking,
  listBookings,
  type BookingStatus,
  type CreateBookingInput,
  type ModuleType,
} from "@/lib/bookings";

export const dynamic = "force-dynamic";

function parseModule(value: string | null): ModuleType | null {
  return value && (MODULE_TYPES as readonly string[]).includes(value) ? (value as ModuleType) : null;
}

// ?module= selects which module's bookings to list (required — bookings
// from different modules have different meaningful fields, so the UI never
// wants an unfiltered mix). ?status= one of BOOKING_STATUSES, ?q= matches
// customer name/phone (§5.5: "filterable by status and searchable by
// customer name/phone").
export async function GET(request: NextRequest) {
  try {
    const moduleType = parseModule(request.nextUrl.searchParams.get("module"));
    if (!moduleType) return NextResponse.json({ error: "Modul tidak valid" }, { status: 400 });

    const statusParam = request.nextUrl.searchParams.get("status");
    const status = statusParam && (BOOKING_STATUSES as readonly string[]).includes(statusParam) ? (statusParam as BookingStatus) : undefined;
    const q = request.nextUrl.searchParams.get("q") ?? undefined;
    const result = await listBookings({ moduleType, status, q });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const body = (await request.json()) as CreateBookingInput;

    if (!(MODULE_TYPES as readonly string[]).includes(body.moduleType)) {
      return NextResponse.json({ error: "Modul tidak valid" }, { status: 400 });
    }
    if (!body.packageType?.trim() || !body.startDate || typeof body.price !== "number" || !body.source) {
      return NextResponse.json({ error: "Package, tanggal mulai, harga, dan sumber wajib diisi" }, { status: 400 });
    }
    if (!(BOOKING_SOURCES as readonly string[]).includes(body.source)) {
      return NextResponse.json({ error: "Sumber booking tidak valid" }, { status: 400 });
    }
    if (!body.customerId && !body.newCustomer) {
      return NextResponse.json({ error: "Pilih customer yang sudah ada atau isi data customer baru" }, { status: 400 });
    }
    if (body.newCustomer && (!body.newCustomer.name?.trim() || !body.newCustomer.phone?.trim())) {
      return NextResponse.json({ error: "Nama dan nomor telepon customer wajib diisi" }, { status: 400 });
    }

    const booking = await createBooking({ ...body, createdBy: session?.user?.email ?? null });
    return NextResponse.json({ booking }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
